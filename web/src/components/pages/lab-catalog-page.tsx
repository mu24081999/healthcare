"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AnalyteInput, AnalyteRow, LabTestInput, LabTestRow } from "@/lib/types";

export default function LabCatalogPage() {
  const [tests, setTests] = useState<LabTestRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [analytes, setAnalytes] = useState<AnalyteRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [testForm, setTestForm] = useState<LabTestInput>({ name: "" });
  const [editingTestId, setEditingTestId] = useState<string | null>(null);

  const [analyteForm, setAnalyteForm] = useState<AnalyteInput>({
    name: "",
    unit: "",
    normal_min: null,
    normal_max: null,
    sort_order: 0,
    remarks: "",
  });
  const [editingAnalyteId, setEditingAnalyteId] = useState<string | null>(null);

  async function loadTests() {
    setErr(null);
    try {
      const t = await api.labTestsListAll();
      setTests(t);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function loadAnalytes(testId: string) {
    setErr(null);
    try {
      setAnalytes(await api.labAnalytesList(testId));
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    loadTests();
  }, []);

  useEffect(() => {
    if (selected) loadAnalytes(selected);
    else setAnalytes([]);
  }, [selected]);

  async function saveTest(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      if (editingTestId) {
        await api.labTestUpdate(editingTestId, testForm);
      } else {
        const row = await api.labTestCreate(testForm);
        setSelected(row.id);
      }
      setTestForm({ name: "" });
      setEditingTestId(null);
      await loadTests();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function deactivateTest(id: string) {
    if (!confirm("Deactivate this test panel?")) return;
    setErr(null);
    try {
      await api.labTestDelete(id);
      if (selected === id) setSelected(null);
      await loadTests();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function saveAnalyte(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setErr(null);
    try {
      await api.labAnalyteUpsert(selected, analyteForm, editingAnalyteId);
      setAnalyteForm({
        name: "",
        unit: "",
        normal_min: null,
        normal_max: null,
        sort_order: 0,
        remarks: "",
      });
      setEditingAnalyteId(null);
      await loadAnalytes(selected);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function deleteAnalyte(id: string) {
    if (!confirm("Delete this analyte?")) return;
    setErr(null);
    try {
      await api.labAnalyteDelete(id);
      if (selected) await loadAnalytes(selected);
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head" style={{ marginBottom: '1.5rem' }}>
        <div>
          <Link href="/lab" className="muted" style={{ textDecoration: 'none' }}>← Laboratory</Link>
          <h1 style={{ marginBottom: '0.25rem' }}>Lab catalog</h1>
        </div>
      </div>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>
        Define test panels and analytes with reference ranges. Managers and vets share the same access.
      </p>
      {err && <p className="error">{err}</p>}

      <div className="grid2">
        <div className="card" style={{ padding: '0.5rem' }}>
          <h2 style={{ padding: '0.75rem' }}>Test panels</h2>
          <form onSubmit={saveTest} className="stack tight" style={{ padding: '0.75rem' }}>
            <label>
              Name
              <input
                required
                value={testForm.name}
                onChange={(e) =>
                  setTestForm({ ...testForm, name: e.target.value })
                }
              />
            </label>
            <label>
              Code
              <input
                value={testForm.code ?? ""}
                onChange={(e) =>
                  setTestForm({ ...testForm, code: e.target.value || null })
                }
              />
            </label>
            <label>
              Default report hours
              <input
                type="number"
                value={testForm.default_report_hours ?? ""}
                onChange={(e) =>
                  setTestForm({
                    ...testForm,
                    default_report_hours: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
            </label>
            <div className="row-actions">
              <button type="submit" className="btn primary">
                {editingTestId ? "Update panel" : "Add panel"}
              </button>
              {editingTestId && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setEditingTestId(null);
                    setTestForm({ name: "" });
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
          <table className="table" style={{ borderCollapse: 'separate', borderSpacing: '0 0.25rem' }}>
            <thead>
              <tr>
                <th style={{ padding: '0.75rem' }}>Name</th>
                <th style={{ padding: '0.75rem' }}>Active</th>
                <th style={{ padding: '0.75rem' }} className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tests.map((t) => (
                <tr
                  key={t.id}
                  className={`pet-row ${selected === t.id ? "selected-row" : ""}`}
                  style={{ transition: 'background 0.2s' }}
                >
                  <td style={{ padding: '1rem 0.75rem' }}>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => {
                        setSelected(t.id);
                        setEditingTestId(null);
                        setTestForm({ name: "" });
                      }}
                    >
                      {t.name}
                    </button>
                  </td>
                  <td style={{ padding: '1rem 0.75rem' }}>{t.active ? "yes" : "no"}</td>
                  <td style={{ padding: '1rem 0.75rem' }} className="right nowrap row-actions-container">
                    <div className="hidden-actions" style={{ display: 'flex', gap: '0.5rem', opacity: 0, transition: 'opacity 0.2s' }}>
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => {
                          setSelected(t.id);
                          setEditingTestId(t.id);
                          setTestForm({
                            name: t.name,
                            code: t.code,
                            default_report_hours: t.default_report_hours,
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn danger ghost small"
                        onClick={() => deactivateTest(t.id)}
                      >
                        Deactivate
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ padding: '0.5rem' }}>
          <h2 style={{ padding: '0.75rem' }}>Analytes & reference ranges</h2>
          {!selected && (
            <p className="muted" style={{ padding: '0.75rem' }}>Select a test panel on the left.</p>
          )}
          {selected && (
            <>
              <form onSubmit={saveAnalyte} className="stack tight" style={{ padding: '0.75rem' }}>
                <div className="grid2">
                  <label>
                    Name
                    <input
                      required
                      value={analyteForm.name}
                      onChange={(e) =>
                        setAnalyteForm({ ...analyteForm, name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Unit
                    <input
                      value={analyteForm.unit ?? ""}
                      onChange={(e) =>
                        setAnalyteForm({
                          ...analyteForm,
                          unit: e.target.value || null,
                        })
                      }
                    />
                  </label>
                  <label>
                    Normal min
                    <input
                      type="number"
                      step="any"
                      value={analyteForm.normal_min ?? ""}
                      onChange={(e) =>
                        setAnalyteForm({
                          ...analyteForm,
                          normal_min: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                    />
                  </label>
                  <label>
                    Normal max
                    <input
                      type="number"
                      step="any"
                      value={analyteForm.normal_max ?? ""}
                      onChange={(e) =>
                        setAnalyteForm({
                          ...analyteForm,
                          normal_max: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                    />
                  </label>
                  <label>
                    Sort order
                    <input
                      type="number"
                      value={analyteForm.sort_order ?? 0}
                      onChange={(e) =>
                        setAnalyteForm({
                          ...analyteForm,
                          sort_order: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Value
                    <input
                      placeholder="e.g. Positive or 10.5"
                      value={analyteForm.remarks ?? ""}
                      onChange={(e) =>
                        setAnalyteForm({
                          ...analyteForm,
                          remarks: e.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <div className="row-actions">
                  <button type="submit" className="btn primary">
                    {editingAnalyteId ? "Update analyte" : "Add analyte"}
                  </button>
                  {editingAnalyteId && (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        setEditingAnalyteId(null);
                        setAnalyteForm({
                          name: "",
                          unit: "",
                          normal_min: null,
                          normal_max: null,
                          sort_order: 0,
                          remarks: "",
                        });
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
              {(() => {
                const hasUnit = analytes.some((a) => a.unit && a.unit.trim());
                const hasRange = analytes.some(
                  (a) => a.normal_min != null || a.normal_max != null
                );
                const hasRemarks = analytes.some(
                  (a) => a.remarks && a.remarks.trim()
                );

                return (
                  <table className="table" style={{ borderCollapse: 'separate', borderSpacing: '0 0.25rem' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '0.75rem' }}>Name</th>
                        {hasUnit && <th style={{ padding: '0.75rem' }}>Unit</th>}
                        {hasRange && <th style={{ padding: '0.75rem' }}>Ref range</th>}
                        {hasRemarks && <th style={{ padding: '0.75rem' }}>Value</th>}
                        <th style={{ padding: '0.75rem' }} className="right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytes.map((a) => (
                        <tr key={a.id} className="pet-row" style={{ transition: 'background 0.2s' }}>
                          <td style={{ padding: '1rem 0.75rem' }}>{a.name}</td>
                          {hasUnit && <td style={{ padding: '1rem 0.75rem' }}>{a.unit ?? "—"}</td>}
                          {hasRange && (
                            <td style={{ padding: '1rem 0.75rem' }}>
                              {a.normal_min ?? "—"} – {a.normal_max ?? "—"}
                            </td>
                          )}
                          {hasRemarks && <td style={{ padding: '1rem 0.75rem' }}>{a.remarks ?? "—"}</td>}
                          <td style={{ padding: '1rem 0.75rem' }} className="right nowrap row-actions-container">
                            <div className="hidden-actions" style={{ display: 'flex', gap: '0.5rem', opacity: 0, transition: 'opacity 0.2s' }}>
                              <button
                                type="button"
                                className="btn ghost small"
                                onClick={() => {
                                  setEditingAnalyteId(a.id);
                                  setAnalyteForm({
                                    name: a.name,
                                    unit: a.unit,
                                    normal_min: a.normal_min,
                                    normal_max: a.normal_max,
                                    sort_order: a.sort_order,
                                    remarks: a.remarks ?? "",
                                  });
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn danger ghost small"
                                onClick={() => deleteAnalyte(a.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
