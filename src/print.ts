import type { LabResultDetail } from "./api";
import { valueHighlight } from "./api";

export type AppPrintOptions = {
  /**
   * OPD page uses scoped @media print rules. Set when printing from OPD so the
   * correct panel stays visible (saved prescription vs active case tab).
   */
  opdPrintMode?: "prescription" | "case-tab";
};

/**
 * Opens the system print dialog. In Tauri on macOS/iOS, `window.print` is
 * replaced at startup to call the native webview print path; on Linux/Windows
 * the embedded WebView handles `window.print()` directly. Always use this
 * instead of calling `invoke("plugin:webview|print")` from app code.
 *
 * Resolves after the `afterprint` event fires, or after a safety timeout.
 */
export async function appPrint(opts?: AppPrintOptions): Promise<void> {
  const root = document.documentElement;
  const mode = opts?.opdPrintMode;

  return new Promise((resolve) => {
    let finished = false;
    const onAfterPrint = () => {
      if (finished) return;
      finished = true;
      if (mode) delete root.dataset.opdPrintMode;
      window.removeEventListener("afterprint", onAfterPrint);
      resolve();
    };

    window.addEventListener("afterprint", onAfterPrint);

    if (mode) {
      root.dataset.opdPrintMode = mode;
    }

    const ret = window.print() as unknown;

    if (
      ret !== undefined &&
      ret !== null &&
      typeof (ret as Promise<void>).then === "function"
    ) {
      (ret as Promise<void>).then(() => {
        // Some webviews resolve the promise but don't fire afterprint yet.
        setTimeout(onAfterPrint, 500);
      }).catch(() => {
        setTimeout(onAfterPrint, 500);
      });
    } else {
      // For blocking window.print(), afterprint fires when it returns.
      // But we add a safety timeout in case afterprint never fires.
      setTimeout(onAfterPrint, 2000);
    }
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Download a minimal HTML document (open in a browser and print / Save as PDF). */
export function downloadHtmlFile(filename: string, title: string, bodyHtml: string) {
  const doc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { margin: 0.5in; }
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; color: #111; }
    h1 { font-size: 1.25rem; margin-bottom: 1rem; }
    p { margin: 0.35rem 0; }
    .muted { color: #555; font-size: 0.9rem; }
    @media print {
      body { max-width: none; margin: 0; padding: 0; }
    }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
  const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(url);
}

/** Build and download an HTML file for a saved laboratory report. */
export function downloadLabReportHtml(
  detail: LabResultDetail,
  petName: string,
  testName: string
) {
  const rows = detail.values
    .map((v) => {
      const h = valueHighlight(
        v.observed_value,
        v.normal_min,
        v.normal_max
      );
      const flag =
        h === "low" ? " (low)" : h === "high" ? " (high)" : "";
      return `<tr><td>${escapeHtml(v.analyte_name)}</td><td>${escapeHtml(v.unit ?? "—")}</td><td>${v.normal_min ?? "—"} – ${v.normal_max ?? "—"}</td><td><strong>${v.observed_value}</strong>${escapeHtml(flag)}</td></tr>`;
    })
    .join("\n");
  const notesBlock = detail.notes
    ? `<p><strong>Notes:</strong> ${escapeHtml(detail.notes)}</p>`
    : "";
  const body = `
    <h1>Laboratory report</h1>
    <p><strong>Pet:</strong> ${escapeHtml(petName)}</p>
    <p><strong>Test panel:</strong> ${escapeHtml(testName)}</p>
    <p><strong>Date:</strong> ${escapeHtml(new Date(detail.created_at).toLocaleString())}</p>
    ${notesBlock}
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:40rem">
      <thead><tr><th>Analyte</th><th>Unit</th><th>Reference</th><th>Result</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    `;
  const safe = `lab-report-${detail.id.slice(0, 8)}`;
  downloadHtmlFile(`${safe}.html`, "Laboratory report", body);
}
