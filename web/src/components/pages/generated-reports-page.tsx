"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { api, valueHighlight } from "@/lib/api";
import type {
  ClinicRow,
  LabResultDetail,
  LabResultSummaryRow,
  PetRow,
} from "@/lib/types";
import { useAuth } from "@/components/auth-provider";
import { canManageClinic } from "@/lib/permissions";
import { appPrint, downloadLabReportHtml } from "@/lib/print";
import { transformToHistory, type HistoryRow } from "@/lib/lab-history";
import { ReportPrintHeader } from "@/components/report-print-header";

type ModalState = null | {
  readOnly: boolean;
  summary: LabResultSummaryRow;
  detail: LabResultDetail | null;
  pet: PetRow | null;
  notes: string;
  values: Record<string, string>;
};

const thStyle: React.CSSProperties = {
  padding: "2px 6px",
  fontSize: "0.65rem",
  textTransform: "uppercase",
  color: "#666",
  letterSpacing: "0.02em",
};

const tdStyle: React.CSSProperties = {
  padding: "1px 6px",
};

export default function GeneratedReportsPage() {
  const { state } = useAuth();
  const canEdit = state.status === "user" && canManageClinic(state.user.role);

  const [rows, setRows] = useState<LabResultSummaryRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyData, setHistoryData] = useState<{
    dates: string[];
    rows: HistoryRow[];
  } | null>(null);
  const [clinic, setClinic] = useState<ClinicRow | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setRows((await api.labResultsHistory()) as LabResultSummaryRow[]);
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    load();
    api
      .clinicGet()
      .then(setClinic)
      .catch(() => {});
  }, [load]);

  async function openModal(summary: LabResultSummaryRow, readOnly: boolean) {
    setErr(null);
    setShowHistory(false);
    setHistoryData(null);
    setModal({
      readOnly,
      summary,
      detail: null,
      pet: null,
      notes: "",
      values: {},
    });
    try {
      const [detail, pet] = await Promise.all([
        api.labResultGet(summary.id),
        api.petsGet(summary.pet_id),
      ]);
      const historyDetails = (await api.labResultsForHistory(
        detail.pet_id,
        detail.lab_test_id,
      )) as LabResultDetail[];
      const vals: Record<string, string> = {};
      if (Array.isArray(detail.values)) {
        detail.values.forEach((v) => {
          vals[v.id] = String(v.observed_value);
        });
      }
      setModal({
        readOnly,
        summary,
        detail,
        pet,
        notes: detail.notes ?? "",
        values: vals,
      });
      const fullHistory = transformToHistory(historyDetails);
      if (fullHistory) {
        // .slice(-4) grabs the last 4 items (the latest dates, assuming chronological order)
        setHistoryData({
          dates: fullHistory.dates.slice(-4),
          rows: fullHistory.rows,
        });
      }
    } catch (e) {
      setErr(String(e));
      setModal(null);
    }
  }

  function loadHistory() {
    setShowHistory(true);
  }

  async function saveModal(e: FormEvent) {
    e.preventDefault();
    if (!modal?.detail || modal.readOnly) return;
    setErr(null);
    try {
      const patches = modal.detail.values.map((v) => ({
        id: v.id,
        observedValue: String(modal.values[v.id] ?? ""),
      }));
      // Numeric validation removed to support text-based results.
      const updated = await api.labResultUpdate(
        modal.summary.id,
        patches,
        modal.notes || null,
      );
      const vals: Record<string, string> = {};
      updated.values.forEach((v) => {
        vals[v.id] = String(v.observed_value);
      });
      setModal({
        readOnly: true,
        summary: {
          ...modal.summary,
          notes: updated.notes,
        },
        detail: updated,
        pet: modal.pet,
        notes: updated.notes ?? "",
        values: vals,
      });
      await load();
    } catch (e) {
      setErr(String(e));
    }
  }

  function downloadCurrent() {
    if (!modal?.detail) return;
    downloadLabReportHtml(
      modal.detail,
      modal.summary.pet_name,
      modal.summary.test_name,
    );
  }

  async function printCurrent() {
    setErr(null);
    try {
      await appPrint();
    } catch (e) {
      setErr(
        `Print failed: ${e instanceof Error ? e.message : String(e)}. Try Download HTML.`,
      );
    }
  }

  return (
    <div className="page" style={{ maxWidth: "none" }}>
      <div className="page-head no-print" style={{ marginBottom: "1rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.2rem" }}>Generated reports</h1>
          <p className="muted" style={{ margin: 0 }}>
            View, edit and print all laboratory reports.
          </p>
        </div>
        <div className="actions">
          <Link
            href="/reports"
            className="btn accent"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              textDecoration: "none",
            }}
          >
            <FileText size={16} /> Generate new report
          </Link>
        </div>
      </div>

      {err && <p className="error">{err}</p>}

      <div className="card no-print" style={{ padding: "0.5rem" }}>
        {rows.length === 0 ? (
          <p className="muted" style={{ padding: "1rem" }}>
            No reports yet. Generate one from the Lab workflow.
          </p>
        ) : (
          <table
            className="table"
            style={{ borderCollapse: "separate", borderSpacing: "0 0.2rem" }}
          >
            <thead>
              <tr>
                <th style={{ padding: "0.5rem 0.75rem" }}>Date</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Pet</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Test panel</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Notes</th>
                <th style={{ padding: "0.5rem 0.75rem" }} className="right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="pet-row"
                  style={{ transition: "background 0.2s" }}
                >
                  <td style={{ padding: "0.6rem 0.75rem" }}>
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: "0.6rem 0.75rem" }}>
                    <Link
                      href={`/pets/${r.pet_id}?tab=medical`}
                      style={{ fontWeight: 600 }}
                    >
                      {r.pet_name}
                    </Link>
                  </td>
                  <td style={{ padding: "0.6rem 0.75rem" }}>{r.test_name}</td>
                  <td
                    style={{ padding: "0.6rem 0.75rem" }}
                    className="ellipsis-cell"
                    title={r.notes ?? ""}
                  >
                    {r.notes
                      ? r.notes.length > 40
                        ? `${r.notes.slice(0, 40)}…`
                        : r.notes
                      : "—"}
                  </td>
                  <td
                    style={{ padding: "0.6rem 0.75rem" }}
                    className="right nowrap row-actions-container"
                  >
                    <div
                      className="hidden-actions"
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        opacity: 0,
                        transition: "opacity 0.2s",
                      }}
                    >
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => void openModal(r, true)}
                      >
                        View
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          className="btn primary small"
                          onClick={() => void openModal(r, false)}
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setModal(null)}
        >
          <div
            className="card modal wide-modal"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            {!modal.detail ? (
              <p>Loading…</p>
            ) : modal.readOnly ? (
              <div
                id="generated-report-print"
                className="receipt"
                style={{ fontSize: "0.85rem", lineHeight: 1.35 }}
              >
                <div
                  className="no-print row-actions"
                  style={{ marginBottom: "0.5rem", gap: "0.4rem" }}
                >
                  <button
                    type="button"
                    className={`btn ${!showHistory ? "primary" : "ghost"} small`}
                    onClick={() => setShowHistory(false)}
                    style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
                  >
                    Current Report
                  </button>
                  <button
                    type="button"
                    className={`btn ${showHistory ? "primary" : "ghost"} small`}
                    onClick={() => void loadHistory()}
                    style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
                  >
                    View History
                  </button>
                </div>

                {!showHistory ? (
                  <>
                    <div className="only-print">
                      <ReportPrintHeader
                        clinic={clinic}
                        pet={{ ...modal.pet!, card_id: modal.pet!.card_id }}
                      />
                    </div>
                    <h2
                      style={{
                        fontSize: "0.9rem",
                        margin: "0.4rem 0",
                        fontWeight: 600,
                      }}
                    >
                      Laboratory report
                    </h2>
                    <p style={{ margin: "0.2rem 0", fontSize: "0.8rem" }}>
                      <strong>Test panel:</strong> {modal.summary.test_name}
                    </p>
                    <p style={{ margin: "0.2rem 0", fontSize: "0.8rem" }}>
                      <strong>Date:</strong>{" "}
                      {new Date(modal.detail.created_at).toLocaleString()}
                    </p>
                    {(() => {
                      const hasUnit = modal.detail.values.some(
                        (v) =>
                          v.unit &&
                          v.unit.trim() !== "" &&
                          v.unit.trim() !== "—",
                      );
                      const hasRange = modal.detail.values.some(
                        (v) =>
                          (v.normal_min != null &&
                            String(v.normal_min).trim() !== "" &&
                            String(v.normal_min).trim() !== "—") ||
                          (v.normal_max != null &&
                            String(v.normal_max).trim() !== "" &&
                            String(v.normal_max).trim() !== "—"),
                      );
                      return (
                        <table
                          className="table"
                          style={{
                            width: "100%",
                            fontSize: "0.8rem",
                            marginTop: "0.4rem",
                          }}
                        >
                          <thead>
                            <tr>
                              <th style={thStyle}>Analyte</th>
                              {hasUnit && <th style={thStyle}>Unit</th>}
                              {hasRange && <th style={thStyle}>Reference</th>}
                              <th style={thStyle}>Result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {modal.detail.values.map((v) => {
                              const h = valueHighlight(
                                v.observed_value,
                                v.normal_min,
                                v.normal_max,
                              );
                              return (
                                <tr key={v.id}>
                                  <td style={tdStyle}>{v.analyte_name}</td>
                                  {hasUnit && (
                                    <td style={tdStyle}>{v.unit ?? "—"}</td>
                                  )}
                                  {hasRange && (
                                    <td style={tdStyle}>
                                      {(v.normal_min != null &&
                                        String(v.normal_min).trim() !== "" &&
                                        String(v.normal_min).trim() !== "—") ||
                                      (v.normal_max != null &&
                                        String(v.normal_max).trim() !== "" &&
                                        String(v.normal_max).trim() !== "—")
                                        ? `${v.normal_min ?? "—"} – ${v.normal_max ?? "—"}`
                                        : "—"}
                                    </td>
                                  )}
                                  <td style={tdStyle}>
                                    <span
                                      className={
                                        h !== "ok" ? `hl-${h}-text` : undefined
                                      }
                                    >
                                      {h !== "ok" ? <strong>{v.observed_value}</strong> : v.observed_value}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      );
                    })()}
                    {modal.detail.notes && (
                      <p style={{ margin: "0.2rem 0", fontSize: "0.8rem" }}>
                        <strong>Notes:</strong> {modal.detail.notes}
                      </p>
                    )}
                  </>
                ) : !historyData ? (
                  <p>Loading history…</p>
                ) : (
                  <>
                    <div className="only-print">
                      <ReportPrintHeader
                        clinic={clinic}
                        pet={{ ...modal.pet!, card_id: modal.pet!.card_id }}
                      />
                    </div>
                    <h2
                      style={{
                        fontSize: "0.9rem",
                        margin: "0.4rem 0",
                        fontWeight: 600,
                      }}
                    >
                      Laboratory History: {modal.summary.test_name}
                    </h2>
                    <p style={{ margin: "0.2rem 0", fontSize: "0.8rem" }}>
                      <strong>Pet:</strong> {modal.summary.pet_name}
                    </p>
                    <div className="history-container">
                      <table
                        className="table"
                        style={{
                          width: "100%",
                          fontSize: "0.8rem",
                          borderCollapse: "collapse",
                        }}
                      >
                        <thead>
                          <tr>
                            <th style={thStyle}>Analyte</th>
                            <th style={thStyle}>Unit</th>
                            <th style={thStyle}>Reference</th>
                            {historyData.dates.map((d) => (
                              <th
                                key={d}
                                style={{ ...thStyle, textAlign: "center" }}
                              >
                                {d}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {historyData.rows.map((r) => (
                            <tr key={r.analyteName}>
                              <td style={{ ...tdStyle, verticalAlign: "top" }}>
                                <strong>{r.analyteName}</strong>
                              </td>
                              <td
                                style={{ ...tdStyle, verticalAlign: "top" }}
                                className="muted small"
                              >
                                {r.unit ?? "—"}
                              </td>
                              <td
                                style={{ ...tdStyle, verticalAlign: "top" }}
                                className="muted small"
                              >
                                {r.referenceRange}
                              </td>
                              {historyData.dates.map((d) => {
                                const entry = r.values[d];
                                const val = entry != null ? entry.value : null;
                                const h = entry != null && val != null ? valueHighlight(val, entry.normal_min, entry.normal_max) : "ok";
                                return (
                                  <td
                                    key={d}
                                    style={{
                                      ...tdStyle,
                                      verticalAlign: "top",
                                      textAlign: "center",
                                    }}
                                  >
                                    {val != null ? (
                                      h !== "ok" ? <strong>{val}</strong> : val
                                    ) : (
                                      <span className="muted">—</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                <div
                  className="no-print row-actions"
                  style={{ marginTop: "0.5rem", gap: "0.4rem" }}
                >
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => void printCurrent()}
                  >
                    Print / Save as PDF
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={downloadCurrent}
                  >
                    Download HTML
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setModal(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={saveModal}>
                <h2>Edit laboratory report</h2>
                <p className="muted small">
                  {modal.summary.pet_name} · {modal.summary.test_name}
                </p>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Analyte</th>
                      <th>Ref</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modal.detail.values.map((v) => {
                      const num = Number(modal.values[v.id] ?? "");
                      const h = valueHighlight(num, v.normal_min, v.normal_max);
                      return (
                        <tr key={v.id}>
                          <td>{v.analyte_name}</td>
                          <td>
                            {v.normal_min ?? "—"} – {v.normal_max ?? "—"}
                          </td>
                          <td>
                            <input
                              className={`narrow ${h !== "ok" ? `hl-${h}` : ""}`}
                              value={modal.values[v.id] ?? ""}
                              onChange={(e) =>
                                setModal({
                                  ...modal,
                                  values: {
                                    ...modal.values,
                                    [v.id]: e.target.value,
                                  },
                                })
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <label>
                  Notes
                  <textarea
                    rows={2}
                    value={modal.notes}
                    onChange={(e) =>
                      setModal({ ...modal, notes: e.target.value })
                    }
                  />
                </label>
                <div className="no-print row-actions">
                  <button type="submit" className="btn primary">
                    Save changes
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => void printCurrent()}
                  >
                    Print / Save as PDF
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={downloadCurrent}
                  >
                    Download HTML
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setModal(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// "use client";

// import Link from "next/link";
// import { FormEvent, useCallback, useEffect, useState } from "react";
// import { FileText } from "lucide-react";
// import { api, valueHighlight } from "@/lib/api";
// import type {
//   ClinicRow,
//   LabResultDetail,
//   LabResultSummaryRow,
//   PetRow,
// } from "@/lib/types";
// import { useAuth } from "@/components/auth-provider";
// import { canManageClinic } from "@/lib/permissions";
// import { appPrint, downloadLabReportHtml } from "@/lib/print";
// import { transformToHistory, type HistoryRow } from "@/lib/lab-history";
// import { ReportPrintHeader } from "@/components/report-print-header";

// type ModalState = null | {
//   readOnly: boolean;
//   summary: LabResultSummaryRow;
//   detail: LabResultDetail | null;
//   pet: PetRow | null;
//   notes: string;
//   values: Record<string, string>;
// };

// export default function GeneratedReportsPage() {
//   const { state } = useAuth();
//   const canEdit = state.status === "user" && canManageClinic(state.user.role);

//   const [rows, setRows] = useState<LabResultSummaryRow[]>([]);
//   const [err, setErr] = useState<string | null>(null);
//   const [modal, setModal] = useState<ModalState>(null);
//   const [showHistory, setShowHistory] = useState(false);
//   const [historyData, setHistoryData] = useState<{
//     dates: string[];
//     rows: HistoryRow[];
//   } | null>(null);
//   const [clinic, setClinic] = useState<ClinicRow | null>(null);

//   const load = useCallback(async () => {
//     setErr(null);
//     try {
//       setRows((await api.labResultsHistory()) as LabResultSummaryRow[]);
//     } catch (e) {
//       setErr(String(e));
//     }
//   }, []);

//   useEffect(() => {
//     load();
//     api
//       .clinicGet()
//       .then(setClinic)
//       .catch(() => {});
//   }, [load]);

//   async function openModal(summary: LabResultSummaryRow, readOnly: boolean) {
//     setErr(null);
//     setShowHistory(false);
//     setHistoryData(null);
//     setModal({
//       readOnly,
//       summary,
//       detail: null,
//       pet: null,
//       notes: "",
//       values: {},
//     });
//     try {
//       const [detail, pet] = await Promise.all([
//         api.labResultGet(summary.id),
//         api.petsGet(summary.pet_id),
//       ]);
//       const historyDetails = (await api.labResultsForHistory(
//         detail.pet_id,
//         detail.lab_test_id,
//       )) as LabResultDetail[];
//       const vals: Record<string, string> = {};
//       if (Array.isArray(detail.values)) {
//         detail.values.forEach((v) => {
//           vals[v.id] = String(v.observed_value);
//         });
//       }
//       setModal({
//         readOnly,
//         summary,
//         detail,
//         pet,
//         notes: detail.notes ?? "",
//         values: vals,
//       });
//       const fullHistory = transformToHistory(historyDetails);
//       if (fullHistory) {
//         // .slice(-5) grabs the last 5 items (the latest dates, assuming chronological order)
//         setHistoryData({
//           dates: fullHistory.dates.slice(-4),
//           rows: fullHistory.rows,
//         });
//       }
//     } catch (e) {
//       setErr(String(e));
//       setModal(null);
//     }
//   }

//   function loadHistory() {
//     setShowHistory(true);
//   }

//   async function saveModal(e: FormEvent) {
//     e.preventDefault();
//     if (!modal?.detail || modal.readOnly) return;
//     setErr(null);
//     try {
//       const patches = modal.detail.values.map((v) => ({
//         id: v.id,
//         observedValue: String(modal.values[v.id] ?? ""),
//       }));
//       // Numeric validation removed to support text-based results.
//       const updated = await api.labResultUpdate(
//         modal.summary.id,
//         patches,
//         modal.notes || null,
//       );
//       const vals: Record<string, string> = {};
//       updated.values.forEach((v) => {
//         vals[v.id] = String(v.observed_value);
//       });
//       setModal({
//         readOnly: true,
//         summary: {
//           ...modal.summary,
//           notes: updated.notes,
//         },
//         detail: updated,
//         pet: modal.pet,
//         notes: updated.notes ?? "",
//         values: vals,
//       });
//       await load();
//     } catch (e) {
//       setErr(String(e));
//     }
//   }

//   function downloadCurrent() {
//     if (!modal?.detail) return;
//     downloadLabReportHtml(
//       modal.detail,
//       modal.summary.pet_name,
//       modal.summary.test_name,
//     );
//   }

//   async function printCurrent() {
//     setErr(null);
//     try {
//       await appPrint();
//     } catch (e) {
//       setErr(
//         `Print failed: ${e instanceof Error ? e.message : String(e)}. Try Download HTML.`,
//       );
//     }
//   }

//   return (
//     <div className="page" style={{ maxWidth: "none" }}>
//       <div className="page-head" style={{ marginBottom: "1.5rem" }}>
//         <div>
//           <h1 style={{ marginBottom: "0.25rem" }}>Generated reports</h1>
//           <p className="muted" style={{ margin: 0 }}>
//             View, edit and print all laboratory reports.
//           </p>
//         </div>
//         <div className="actions">
//           <Link
//             href="/reports"
//             className="btn accent"
//             style={{
//               display: "flex",
//               alignItems: "center",
//               gap: "0.4rem",
//               textDecoration: "none",
//             }}
//           >
//             <FileText size={16} /> Generate new report
//           </Link>
//         </div>
//       </div>
//       {err && <p className="error">{err}</p>}

//       <div className="card" style={{ padding: "0.5rem" }}>
//         {rows.length === 0 ? (
//           <p className="muted" style={{ padding: "1rem" }}>
//             No reports yet. Generate one from the Lab workflow.
//           </p>
//         ) : (
//           <table
//             className="table"
//             style={{ borderCollapse: "separate", borderSpacing: "0 0.25rem" }}
//           >
//             <thead>
//               <tr>
//                 <th style={{ padding: "0.75rem" }}>Date</th>
//                 <th style={{ padding: "0.75rem" }}>Pet</th>
//                 <th style={{ padding: "0.75rem" }}>Test panel</th>
//                 <th style={{ padding: "0.75rem" }}>Notes</th>
//                 <th style={{ padding: "0.75rem" }} className="right">
//                   Actions
//                 </th>
//               </tr>
//             </thead>
//             <tbody>
//               {rows.map((r) => (
//                 <tr
//                   key={r.id}
//                   className="pet-row"
//                   style={{ transition: "background 0.2s" }}
//                 >
//                   <td style={{ padding: "1.25rem 0.75rem" }}>
//                     {new Date(r.created_at).toLocaleString()}
//                   </td>
//                   <td style={{ padding: "1.25rem 0.75rem" }}>
//                     <Link
//                       href={`/pets/${r.pet_id}?tab=medical`}
//                       style={{ fontWeight: 600 }}
//                     >
//                       {r.pet_name}
//                     </Link>
//                   </td>
//                   <td style={{ padding: "1.25rem 0.75rem" }}>{r.test_name}</td>
//                   <td
//                     style={{ padding: "1.25rem 0.75rem" }}
//                     className="ellipsis-cell"
//                     title={r.notes ?? ""}
//                   >
//                     {r.notes
//                       ? r.notes.length > 40
//                         ? `${r.notes.slice(0, 40)}…`
//                         : r.notes
//                       : "—"}
//                   </td>
//                   <td
//                     style={{ padding: "1.25rem 0.75rem" }}
//                     className="right nowrap row-actions-container"
//                   >
//                     <div
//                       className="hidden-actions"
//                       style={{
//                         display: "flex",
//                         gap: "0.5rem",
//                         opacity: 0,
//                         transition: "opacity 0.2s",
//                       }}
//                     >
//                       <button
//                         type="button"
//                         className="btn ghost small"
//                         onClick={() => void openModal(r, true)}
//                       >
//                         View
//                       </button>
//                       {canEdit && (
//                         <button
//                           type="button"
//                           className="btn primary small"
//                           onClick={() => void openModal(r, false)}
//                         >
//                           Edit
//                         </button>
//                       )}
//                     </div>
//                   </td>
//                 </tr>
//               ))}
//             </tbody>
//           </table>
//         )}
//       </div>

//       {modal && (
//         <div
//           className="modal-backdrop"
//           role="presentation"
//           onClick={() => setModal(null)}
//         >
//           <div
//             className="card modal wide-modal"
//             role="dialog"
//             onClick={(e) => e.stopPropagation()}
//           >
//             {!modal.detail ? (
//               <p>Loading…</p>
//             ) : modal.readOnly ? (
//               <div
//                 id="generated-report-print"
//                 className="receipt"
//                 style={{ fontSize: "0.85rem", lineHeight: 1.35 }}
//               >
//                 <div
//                   className="no-print row-actions"
//                   style={{ marginBottom: "0.5rem", gap: "0.4rem" }}
//                 >
//                   <button
//                     type="button"
//                     className={`btn ${!showHistory ? "primary" : "ghost"} small`}
//                     onClick={() => setShowHistory(false)}
//                     style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
//                   >
//                     Current Report
//                   </button>
//                   <button
//                     type="button"
//                     className={`btn ${showHistory ? "primary" : "ghost"} small`}
//                     onClick={() => void loadHistory()}
//                     style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
//                   >
//                     View History
//                   </button>
//                 </div>

//                 {!showHistory ? (
//                   <>
//                     <div className="only-print">
//                       <ReportPrintHeader
//                         clinic={clinic}
//                         pet={{ ...modal.pet!, card_id: modal.pet!.card_id }}
//                       />
//                     </div>
//                     <h2
//                       style={{
//                         fontSize: "0.9rem",
//                         margin: "0.4rem 0",
//                         fontWeight: 600,
//                       }}
//                     >
//                       Laboratory report
//                     </h2>
//                     <p style={{ margin: "0.2rem 0", fontSize: "0.8rem" }}>
//                       <strong>Test panel:</strong> {modal.summary.test_name}
//                     </p>
//                     <p style={{ margin: "0.2rem 0", fontSize: "0.8rem" }}>
//                       <strong>Date:</strong>{" "}
//                       {new Date(modal.detail.created_at).toLocaleString()}
//                     </p>
//                     {(() => {
//                       const hasUnit = modal.detail.values.some(
//                         (v) =>
//                           v.unit &&
//                           v.unit.trim() !== "" &&
//                           v.unit.trim() !== "—",
//                       );
//                       const hasRange = modal.detail.values.some(
//                         (v) =>
//                           (v.normal_min != null &&
//                             String(v.normal_min).trim() !== "" &&
//                             String(v.normal_min).trim() !== "—") ||
//                           (v.normal_max != null &&
//                             String(v.normal_max).trim() !== "" &&
//                             String(v.normal_max).trim() !== "—"),
//                       );
//                       return (
//                         <table
//                           className="table"
//                           style={{
//                             width: "100%",
//                             fontSize: "0.8rem",
//                             marginTop: "0.4rem",
//                           }}
//                         >
//                           <thead>
//                             <tr>
//                               <th
//                                 style={{
//                                   padding: "2px 6px",
//                                   fontSize: "0.65rem",
//                                   textTransform: "uppercase",
//                                   color: "#666",
//                                   letterSpacing: "0.02em",
//                                 }}
//                               >
//                                 Analyte
//                               </th>
//                               {hasUnit && (
//                                 <th
//                                   style={{
//                                     padding: "2px 6px",
//                                     fontSize: "0.65rem",
//                                     textTransform: "uppercase",
//                                     color: "#666",
//                                     letterSpacing: "0.02em",
//                                   }}
//                                 >
//                                   Unit
//                                 </th>
//                               )}
//                               {hasRange && (
//                                 <th
//                                   style={{
//                                     padding: "2px 6px",
//                                     fontSize: "0.65rem",
//                                     textTransform: "uppercase",
//                                     color: "#666",
//                                     letterSpacing: "0.02em",
//                                   }}
//                                 >
//                                   Reference
//                                 </th>
//                               )}
//                               <th
//                                 style={{
//                                   padding: "2px 6px",
//                                   fontSize: "0.65rem",
//                                   textTransform: "uppercase",
//                                   color: "#666",
//                                   letterSpacing: "0.02em",
//                                 }}
//                               >
//                                 Result
//                               </th>
//                             </tr>
//                           </thead>
//                           <tbody>
//                             {modal.detail.values.map((v) => {
//                               const h = valueHighlight(
//                                 v.observed_value,
//                                 v.normal_min,
//                                 v.normal_max,
//                               );
//                               return (
//                                 <tr key={v.id}>
//                                   <td style={{ padding: "1px 6px" }}>
//                                     {v.analyte_name}
//                                   </td>
//                                   {hasUnit && (
//                                     <td style={{ padding: "1px 6px" }}>
//                                       {v.unit ?? "—"}
//                                     </td>
//                                   )}
//                                   {hasRange && (
//                                     <td style={{ padding: "1px 6px" }}>
//                                       {(v.normal_min != null &&
//                                         String(v.normal_min).trim() !== "" &&
//                                         String(v.normal_min).trim() !== "—") ||
//                                       (v.normal_max != null &&
//                                         String(v.normal_max).trim() !== "" &&
//                                         String(v.normal_max).trim() !== "—")
//                                         ? `${v.normal_min ?? "—"} – ${v.normal_max ?? "—"}`
//                                         : "—"}
//                                     </td>
//                                   )}
//                                   <td style={{ padding: "1px 6px" }}>
//                                     <span
//                                       className={
//                                         h !== "ok" ? `hl-${h}-text` : undefined
//                                       }
//                                     >
//                                       <strong>{v.observed_value}</strong>
//                                     </span>
//                                   </td>
//                                 </tr>
//                               );
//                             })}
//                           </tbody>
//                         </table>
//                       );
//                     })()}
//                     {modal.detail.notes && (
//                       <p style={{ margin: "0.2rem 0", fontSize: "0.8rem" }}>
//                         <strong>Notes:</strong> {modal.detail.notes}
//                       </p>
//                     )}
//                   </>
//                 ) : !historyData ? (
//                   <p>Loading history…</p>
//                 ) : (
//                   <>
//                     <div className="only-print">
//                       <ReportPrintHeader
//                         clinic={clinic}
//                         pet={{ ...modal.pet!, card_id: modal.pet!.card_id }}
//                       />
//                     </div>
//                     <h2
//                       className="no-print"
//                       style={{
//                         fontSize: "0.9rem",
//                         margin: "0.4rem 0",
//                         fontWeight: 600,
//                       }}
//                     >
//                       Laboratory History: {modal.summary.test_name}
//                     </h2>
//                     <h2
//                       className="only-print"
//                       style={{
//                         fontSize: "0.9rem",
//                         margin: "0.4rem 0",
//                         fontWeight: 600,
//                       }}
//                     >
//                       Laboratory History: {modal.summary.test_name}
//                     </h2>
//                     <p style={{ margin: "0.2rem 0", fontSize: "0.8rem" }}>
//                       <strong>Pet:</strong> {modal.summary.pet_name}
//                     </p>
//                     <div className="history-container">
//                       <table
//                         className="table"
//                         style={{ width: "100%", fontSize: "0.8rem" }}
//                       >
//                         <thead>
//                           <tr>
//                             <th
//                               style={{
//                                 padding: "2px 6px",
//                                 fontSize: "0.65rem",
//                                 textTransform: "uppercase",
//                                 color: "#666",
//                                 letterSpacing: "0.02em",
//                               }}
//                             >
//                               Analyte
//                             </th>
//                             <th
//                               style={{
//                                 padding: "2px 6px",
//                                 fontSize: "0.65rem",
//                                 textTransform: "uppercase",
//                                 color: "#666",
//                                 letterSpacing: "0.02em",
//                               }}
//                             >
//                               Reference
//                             </th>
//                             <th
//                               style={{
//                                 padding: "2px 6px",
//                                 fontSize: "0.65rem",
//                                 textTransform: "uppercase",
//                                 color: "#666",
//                                 letterSpacing: "0.02em",
//                               }}
//                             >
//                               History Results
//                             </th>
//                           </tr>
//                         </thead>
//                         <tbody>
//                           {historyData.rows.map((r) => (
//                             <tr key={r.analyteName}>
//                               <td
//                                 style={{
//                                   verticalAlign: "top",
//                                   padding: "1px 6px",
//                                 }}
//                               >
//                                 <strong>{r.analyteName}</strong>
//                                 {r.unit && (
//                                   <div
//                                     className="muted small"
//                                     style={{ fontSize: "0.7rem" }}
//                                   >
//                                     {r.unit}
//                                   </div>
//                                 )}
//                               </td>
//                               <td
//                                 style={{
//                                   verticalAlign: "top",
//                                   padding: "1px 6px",
//                                 }}
//                                 className="muted small"
//                               >
//                                 {r.referenceRange}
//                               </td>
//                               <td
//                                 style={{
//                                   verticalAlign: "top",
//                                   padding: "1px 6px",
//                                 }}
//                               >
//                                 <div
//                                   style={{
//                                     display: "flex",
//                                     flexWrap: "wrap",
//                                     gap: "0.3rem",
//                                   }}
//                                 >
//                                   {historyData.dates.map(
//                                     (d) =>
//                                       r.values[d] != null && (
//                                         <div
//                                           key={d}
//                                           style={{
//                                             display: "flex",
//                                             flexDirection: "column",
//                                             borderRadius: "4px",
//                                             padding: "0.1rem 0.3rem",
//                                             minWidth: "70px",
//                                           }}
//                                         >
//                                           <span
//                                             className="muted"
//                                             style={{ fontSize: "0.65rem" }}
//                                           >
//                                             {d}
//                                           </span>
//                                           <strong
//                                             style={{ fontSize: "0.8rem" }}
//                                           >
//                                             {r.values[d]}
//                                           </strong>
//                                         </div>
//                                       ),
//                                   )}
//                                 </div>
//                               </td>
//                             </tr>
//                           ))}
//                         </tbody>
//                       </table>
//                     </div>
//                   </>
//                 )}

//                 <div
//                   className="no-print row-actions"
//                   style={{ marginTop: "0.5rem", gap: "0.4rem" }}
//                 >
//                   <button
//                     type="button"
//                     className="btn primary"
//                     onClick={() => void printCurrent()}
//                   >
//                     Print / Save as PDF
//                   </button>
//                   <button
//                     type="button"
//                     className="btn ghost"
//                     onClick={downloadCurrent}
//                   >
//                     Download HTML
//                   </button>
//                   <button
//                     type="button"
//                     className="btn ghost"
//                     onClick={() => setModal(null)}
//                   >
//                     Close
//                   </button>
//                 </div>
//               </div>
//             ) : (
//               <form onSubmit={saveModal}>
//                 <h2>Edit laboratory report</h2>
//                 <p className="muted small">
//                   {modal.summary.pet_name} · {modal.summary.test_name}
//                 </p>
//                 <table className="table">
//                   <thead>
//                     <tr>
//                       <th>Analyte</th>
//                       <th>Ref</th>
//                       <th>Value</th>
//                     </tr>
//                   </thead>
//                   <tbody>
//                     {modal.detail.values.map((v) => {
//                       const num = Number(modal.values[v.id] ?? "");
//                       const h = valueHighlight(num, v.normal_min, v.normal_max);
//                       return (
//                         <tr key={v.id}>
//                           <td>{v.analyte_name}</td>
//                           <td>
//                             {v.normal_min ?? "—"} – {v.normal_max ?? "—"}
//                           </td>
//                           <td>
//                             <input
//                               className={`narrow ${h !== "ok" ? `hl-${h}` : ""}`}
//                               value={modal.values[v.id] ?? ""}
//                               onChange={(e) =>
//                                 setModal({
//                                   ...modal,
//                                   values: {
//                                     ...modal.values,
//                                     [v.id]: e.target.value,
//                                   },
//                                 })
//                               }
//                             />
//                           </td>
//                         </tr>
//                       );
//                     })}
//                   </tbody>
//                 </table>
//                 <label>
//                   Notes
//                   <textarea
//                     rows={2}
//                     value={modal.notes}
//                     onChange={(e) =>
//                       setModal({ ...modal, notes: e.target.value })
//                     }
//                   />
//                 </label>
//                 <div className="no-print row-actions">
//                   <button type="submit" className="btn primary">
//                     Save changes
//                   </button>
//                   <button
//                     type="button"
//                     className="btn ghost"
//                     onClick={() => void printCurrent()}
//                   >
//                     Print / Save as PDF
//                   </button>
//                   <button
//                     type="button"
//                     className="btn ghost"
//                     onClick={downloadCurrent}
//                   >
//                     Download HTML
//                   </button>
//                   <button
//                     type="button"
//                     className="btn ghost"
//                     onClick={() => setModal(null)}
//                   >
//                     Cancel
//                   </button>
//                 </div>
//               </form>
//             )}
//           </div>
//         </div>
//       )}
//     </div>
//   );
// }
