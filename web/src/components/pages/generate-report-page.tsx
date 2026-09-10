"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { api, valueHighlight } from "@/lib/api";
import type {
  AnalyteRow,
  ClinicRow,
  LabOrderRow,
  LabResultValueInput,
  PetRow,
} from "@/lib/types";
import { appPrint, downloadHtmlFile, escapeHtml } from "@/lib/print";
import { ReportPrintHeader } from "@/components/report-print-header";
import { duplicatePetNameKeys, formatPetName } from "@/lib/pet-label";

export default function GenerateReportPage() {
  const [pets, setPets] = useState<Awaited<ReturnType<typeof api.petsList>>>(
    [],
  );
  const [petId, setPetId] = useState("");
  const [orders, setOrders] = useState<LabOrderRow[]>([]);
  const [orderId, setOrderId] = useState("");
  const [analytes, setAnalytes] = useState<AnalyteRow[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<Awaited<
    ReturnType<typeof api.labResultSave>
  > | null>(null);
  const [pet, setPet] = useState<PetRow | null>(null);
  const [clinic, setClinic] = useState<ClinicRow | null>(null);

  useEffect(() => {
    api
      .petsList()
      .then(setPets)
      .catch((e) => setErr(String(e)));
    api
      .clinicGet()
      .then(setClinic)
      .catch(() => {});
  }, []);

  const duplicateNames = duplicatePetNameKeys(pets);

  useEffect(() => {
    if (!petId) {
      setOrders([]);
      setOrderId("");
      setPet(null);
      return;
    }
    api
      .labOrdersForPet(petId)
      .then((o) => {
        setOrders(o.filter((x) => x.status === "pending"));
        setOrderId("");
        setAnalytes([]);
        setValues({});
        setSaved(null);
      })
      .catch((e) => setErr(String(e)));
    api
      .petsGet(petId)
      .then(setPet)
      .catch(() => {});
  }, [petId]);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === orderId),
    [orders, orderId],
  );

  useEffect(() => {
    if (!selectedOrder) {
      setAnalytes([]);
      setValues({});
      return;
    }
    api
      .labAnalytesList(selectedOrder.lab_test_id)
      .then((rows) => {
        setAnalytes(rows);
        const init: Record<string, string> = {};
        rows.forEach((a) => {
          init[a.id] = "";
        });
        setValues(init);
      })
      .catch((e) => setErr(String(e)));
  }, [selectedOrder]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!selectedOrder) return;
    setErr(null);
    const payload: LabResultValueInput[] = [];
    for (const a of analytes) {
      const raw = values[a.id]?.trim();
      if (raw === "") {
        setErr(
          "Enter a value for each analyte or remove the test from the order.",
        );
        return;
      }
      payload.push({ analyte_id: a.id, observed_value: raw });
    }
    try {
      const res = await api.labResultSave(
        selectedOrder.id,
        payload,
        notes || null,
      );
      setSaved(res);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function printReport() {
    setErr(null);
    try {
      await appPrint();
    } catch (e) {
      setErr(
        `Print failed: ${e instanceof Error ? e.message : String(e)}. Try “Save as HTML”.`,
      );
    }
  }

  function saveReportHtml() {
    if (!saved) return;
    const hasUnit = saved.values.some(
      (v) => v.unit && v.unit.trim() !== "" && v.unit.trim() !== "—",
    );
    const hasRange = saved.values.some(
      (v) =>
        (v.normal_min != null &&
          String(v.normal_min).trim() !== "" &&
          String(v.normal_min).trim() !== "—") ||
        (v.normal_max != null &&
          String(v.normal_max).trim() !== "" &&
          String(v.normal_max).trim() !== "—"),
    );
    const hasRemarks = saved.values.some(
      (v) => v.remarks && v.remarks.trim() !== "" && v.remarks.trim() !== "—",
    );

    const rows = saved.values
      .map((v) => {
        const h = valueHighlight(v.observed_value, v.normal_min, v.normal_max);
        const flag = h === "low" ? " (low)" : h === "high" ? " (high)" : "";
        return `<tr>
          <td>${escapeHtml(v.analyte_name)}</td>
          ${hasUnit ? `<td>${escapeHtml(v.unit ?? "—")}</td>` : ""}
          ${hasRange ? `<td>${v.normal_min ?? "—"} – ${v.normal_max ?? "—"}</td>` : ""}
          <td><strong>${v.observed_value}</strong>${escapeHtml(flag)}</td>
          ${hasRemarks ? `<td>${escapeHtml(v.remarks ?? "—")}</td>` : ""}
        </tr>`;
      })
      .join("\n");
    const notesBlock = saved.notes
      ? `<p><strong>Notes:</strong> ${escapeHtml(saved.notes)}</p>`
      : "";
    const body = `
    <h1>Laboratory report</h1>
    <p><strong>Pet:</strong> ${escapeHtml(pet?.name ?? "")}</p>
    <p><strong>Date:</strong> ${escapeHtml(new Date(saved.created_at).toLocaleString())}</p>
    ${notesBlock}
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:40rem">
      <thead><tr>
        <th>Analyte</th>
        ${hasUnit ? "<th>Unit</th>" : ""}
        ${hasRange ? "<th>Reference</th>" : ""}
        <th>Result</th>
        ${hasRemarks ? "<th>Value</th>" : ""}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    `;
    downloadHtmlFile(
      `lab-report-${saved.id.slice(0, 8)}.html`,
      "Laboratory report",
      body,
    );
  }

  return (
    <div className="page" style={{ maxWidth: "none" }}>
      <div className="page-head" style={{ marginBottom: "1.5rem" }}>
        <div>
          <Link
            href="/lab"
            className="muted"
            style={{ textDecoration: "none" }}
          >
            ← Laboratory
          </Link>
          <h1 style={{ marginBottom: "0.25rem" }}>Generate lab report</h1>
        </div>
        <div className="actions">
          <Link
            href="/reports/generated"
            className="btn accent"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              textDecoration: "none",
            }}
          >
            <FileText size={16} /> View all generated reports
          </Link>
        </div>
      </div>
      <p className="muted" style={{ marginBottom: "1.5rem" }}>
        Choose a pet with a <strong>pending</strong> lab order, enter result
        values, then save to append the report to medical history.
      </p>
      {err && <p className="error">{err}</p>}

      {!saved && (
        <form className="card" style={{ padding: "0.5rem" }} onSubmit={onSave}>
          <div className="grid2" style={{ padding: "0.75rem" }}>
            <label>
              Pet
              <select
                required
                value={petId}
                onChange={(e) => setPetId(e.target.value)}
              >
                <option value="">Choose…</option>
                {pets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatPetName(p, duplicateNames)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Pending order
              <select
                required
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                disabled={!petId || orders.length === 0}
              >
                <option value="">
                  {orders.length === 0 ? "No pending orders" : "Choose…"}
                </option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.receipt_number} —{" "}
                    {new Date(o.created_at).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {analytes.length > 0 && (
            <div style={{ padding: "0.75rem" }}>
              <h3>Results</h3>
              <p className="muted small">
                Values outside the reference range are highlighted.
              </p>
              {(() => {
                const hasUnit = analytes.some((a) => a.unit && a.unit.trim());
                const hasRange = analytes.some(
                  (a) => a.normal_min != null || a.normal_max != null,
                );
                const hasRemarks = analytes.some(
                  (a) => a.remarks && a.remarks.trim(),
                );

                return (
                  <table
                    className="table"
                    style={{
                      borderCollapse: "separate",
                      borderSpacing: "0 0.25rem",
                    }}
                  >
                    <thead>
                      <tr>
                        <th style={{ padding: "0.75rem" }}>Analyte</th>
                        {hasUnit && (
                          <th style={{ padding: "0.75rem" }}>Unit</th>
                        )}
                        {hasRange && (
                          <th style={{ padding: "0.75rem" }}>Reference</th>
                        )}
                        <th style={{ padding: "0.75rem" }}>Result</th>
                        {hasRemarks && (
                          <th style={{ padding: "0.75rem" }}>Value</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {analytes.map((a) => {
                        const v = values[a.id];
                        const num = v === "" ? NaN : Number(v);
                        const h =
                          !Number.isNaN(num) && v !== ""
                            ? valueHighlight(num, a.normal_min, a.normal_max)
                            : "ok";
                        return (
                          <tr
                            key={a.id}
                            className="pet-row"
                            style={{ transition: "background 0.2s" }}
                          >
                            <td style={{ padding: "1rem 0.75rem" }}>
                              {a.name}
                            </td>
                            {hasUnit && (
                              <td style={{ padding: "1rem 0.75rem" }}>
                                {a.unit ?? "—"}
                              </td>
                            )}
                            {hasRange && (
                              <td style={{ padding: "1rem 0.75rem" }}>
                                {a.normal_min ?? "—"} – {a.normal_max ?? "—"}
                              </td>
                            )}
                            <td style={{ padding: "1rem 0.75rem" }}>
                              <input
                                className={`narrow ${
                                  h !== "ok" ? `hl-${h}` : ""
                                }`}
                                value={v ?? ""}
                                onChange={(e) =>
                                  setValues({
                                    ...values,
                                    [a.id]: e.target.value,
                                  })
                                }
                              />
                            </td>
                            {hasRemarks && (
                              <td style={{ padding: "1rem 0.75rem" }}>
                                {a.remarks ?? "—"}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
              <label>
                Notes
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <button
                type="submit"
                className="btn primary"
                style={{ marginTop: "0.75rem" }}
              >
                Save report
              </button>
            </div>
          )}
        </form>
      )}

      {saved && (
        <div
          className="card print-area"
          style={{ padding: "0.3rem", fontSize: "0.85rem", lineHeight: 1.35 }}
        >
          <div id="lab-report-print" className="receipt">
            <div className="only-print">
              <ReportPrintHeader
                clinic={clinic}
                pet={{ ...pet!, card_id: pet!.card_id }}
              />
            </div>
            <h2
              style={{
                padding: "0.3rem 0.5rem",
                margin: "0.4rem 0",
                fontSize: "0.9rem",
                fontWeight: 600,
              }}
            >
              Laboratory report
            </h2>
            <p
              style={{
                padding: "0.1rem 0.5rem",
                margin: "0.2rem 0",
                fontSize: "0.8rem",
              }}
            >
              <strong>Date:</strong>{" "}
              {new Date(saved.created_at).toLocaleString()}
            </p>
            {saved.notes && (
              <p
                style={{
                  padding: "0.1rem 0.5rem",
                  margin: "0.2rem 0",
                  fontSize: "0.8rem",
                }}
              >
                <strong>Notes:</strong> {saved.notes}
              </p>
            )}
            {(() => {
              const hasUnit = saved.values.some(
                (v) => v.unit && v.unit.trim() !== "" && v.unit.trim() !== "—",
              );
              const hasRange = saved.values.some(
                (v) =>
                  (v.normal_min != null &&
                    String(v.normal_min).trim() !== "" &&
                    String(v.normal_min).trim() !== "—") ||
                  (v.normal_max != null &&
                    String(v.normal_max).trim() !== "" &&
                    String(v.normal_max).trim() !== "—"),
              );
              const hasRemarks = saved.values.some(
                (v) =>
                  v.remarks &&
                  v.remarks.trim() !== "" &&
                  v.remarks.trim() !== "—",
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
                      <th
                        style={{
                          padding: "2px 6px",
                          fontSize: "0.65rem",
                          textTransform: "uppercase",
                          color: "#666",
                          letterSpacing: "0.02em",
                        }}
                      >
                        Analyte
                      </th>
                      {hasUnit && (
                        <th
                          style={{
                            padding: "2px 6px",
                            fontSize: "0.65rem",
                            textTransform: "uppercase",
                            color: "#666",
                            letterSpacing: "0.02em",
                          }}
                        >
                          Unit
                        </th>
                      )}
                      {hasRange && (
                        <th
                          style={{
                            padding: "2px 6px",
                            fontSize: "0.65rem",
                            textTransform: "uppercase",
                            color: "#666",
                            letterSpacing: "0.02em",
                          }}
                        >
                          Reference
                        </th>
                      )}
                      <th
                        style={{
                          padding: "2px 6px",
                          fontSize: "0.65rem",
                          textTransform: "uppercase",
                          color: "#666",
                          letterSpacing: "0.02em",
                        }}
                      >
                        Result
                      </th>
                      {hasRemarks && (
                        <th
                          style={{
                            padding: "2px 6px",
                            fontSize: "0.65rem",
                            textTransform: "uppercase",
                            color: "#666",
                            letterSpacing: "0.02em",
                          }}
                        >
                          Value
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {saved.values.map((v) => {
                      const h = valueHighlight(
                        v.observed_value,
                        v.normal_min,
                        v.normal_max,
                      );
                      return (
                        <tr key={v.id}>
                          <td style={{ padding: "1px 6px" }}>
                            {v.analyte_name}
                          </td>
                          {hasUnit && (
                            <td style={{ padding: "1px 6px" }}>
                              {v.unit ?? "—"}
                            </td>
                          )}
                          {hasRange && (
                            <td style={{ padding: "1px 6px" }}>
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
                          <td
                            style={{ padding: "1px 6px" }}
                            className={h !== "ok" ? `hl-${h}-text` : ""}
                          >
                            {v.observed_value}
                          </td>
                          {hasRemarks && (
                            <td style={{ padding: "1px 6px" }}>
                              {v.remarks ?? "—"}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })()}
          </div>
          <div
            className="no-print row-actions"
            style={{ padding: "0.4rem", gap: "0.4rem", fontSize: "0.8rem" }}
          >
            <button
              type="button"
              className="btn primary"
              onClick={() => void printReport()}
              style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
            >
              Print / Save as PDF
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={saveReportHtml}
              style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
            >
              Save as HTML
            </button>
            <button
              type="button"
              className="btn ghost"
              style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
              onClick={() => {
                setSaved(null);
                setNotes("");
                setOrderId("");
                setPetId("");
              }}
            >
              New report
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
