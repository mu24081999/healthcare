"use client";

import { FormEvent, useEffect, useState } from "react";
import { Dog, FlaskConical, Calendar, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import type { LabOrderRow, PetListRow } from "@/lib/types";
import { appPrint, downloadHtmlFile, escapeHtml } from "@/lib/print";
import { duplicatePetNameKeys, formatPetName } from "@/lib/pet-label";

export default function LabPage() {
  const [pets, setPets] = useState<PetListRow[]>([]);
  const [tests, setTests] = useState<Awaited<ReturnType<typeof api.labTestsList>>>(
    []
  );
  const [petId, setPetId] = useState("");
  const [testId, setTestId] = useState("");
  const [tentative, setTentative] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<LabOrderRow | null>(null);
  const [pet, setPet] = useState<Awaited<ReturnType<typeof api.petsGet>> | null>(
    null
  );
  const [testName, setTestName] = useState("");

  async function load() {
    setErr(null);
    try {
      const [p, t] = await Promise.all([api.petsList(), api.labTestsList()]);
      setPets(p);
      setTests(t);
      if (!testId && t[0]) setTestId(t[0].id);
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  const duplicateNames = duplicatePetNameKeys(pets);

  useEffect(() => {
    if (!lastOrder) {
      setPet(null);
      setTestName("");
      return;
    }
    (async () => {
      try {
        const p = await api.petsGet(lastOrder.pet_id);
        const t = tests.find((x) => x.id === lastOrder.lab_test_id);
        setPet(p);
        setTestName(t?.name ?? lastOrder.lab_test_id);
      } catch {
        setPet(null);
      }
    })();
  }, [lastOrder, tests]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const order = await api.labOrderCreate({
        pet_id: petId,
        lab_test_id: testId,
        tentative_report_at: tentative || null,
      });
      setLastOrder(order);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function printReceipt() {
    setErr(null);
    try {
      await appPrint();
    } catch (e) {
      setErr(
        `Print failed: ${e instanceof Error ? e.message : String(e)}. Try “Save HTML” and open the file to print.`
      );
    }
  }

  function saveReceiptHtml() {
    if (!lastOrder) return;
    const petLine = pet
      ? `${escapeHtml(pet.name)} (${escapeHtml(pet.species ?? "—")})`
      : "…";
    const ownerLine = pet?.owner_name ? escapeHtml(pet.owner_name) : "—";
    const testLine = escapeHtml(testName || lastOrder.lab_test_id);
    const tent = lastOrder.tentative_report_at
      ? new Date(lastOrder.tentative_report_at).toLocaleString()
      : "—";
    const ordered = new Date(lastOrder.created_at).toLocaleString();
    const body = `
    <h1>Pet Care Clinic — Lab receipt</h1>
    <p><strong>Receipt:</strong> ${escapeHtml(lastOrder.receipt_number ?? "")}</p>
    <p><strong>Pet:</strong> ${petLine}</p>
    <p><strong>Owner:</strong> ${ownerLine}</p>
    <p><strong>Test:</strong> ${testLine}</p>
    <p><strong>Tentative report:</strong> ${escapeHtml(tent)}</p>
    <p class="muted">Ordered: ${escapeHtml(ordered)}</p>
    `;
    const safeName = (lastOrder.receipt_number ?? "receipt").replace(
      /[^\w.-]+/g,
      "_"
    );
    downloadHtmlFile(`lab-receipt-${safeName}.html`, "Lab receipt", body);
  }

  return (
    <div className="page">
      <div style={{ marginBottom: '2rem' }}>
        <h1>Laboratory</h1>
        <p className="muted">
          Select a pet and an existing test panel. A receipt is generated with a
          tentative report time.
        </p>
      </div>
      {err && <p className="error">{err}</p>}

      <div className="grid2" style={{ alignItems: 'flex-start' }}>
        <form className="card" onSubmit={submit} style={{ padding: '1.5rem' }}>
          <h2 style={{ marginBottom: '1.5rem' }}>New lab order</h2>
          
          <div className="auth-form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="auth-form-label">
              Pet
              <div style={{ position: 'relative' }}>
                <Dog size={18} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: '#777777' }} />
                <select
                  required
                  className="auth-form-input"
                  style={{ width: '100%', paddingLeft: '2.2rem', paddingRight: '2rem', appearance: 'none' }}
                  value={petId}
                  onChange={(e) => setPetId(e.target.value)}
                >
                  <option value="">Choose a pet…</option>
                  {pets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {formatPetName(p, duplicateNames)}
                    </option>
                  ))}
                </select>
                <ChevronRight size={18} style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%) rotate(90deg)', color: '#777777', pointerEvents: 'none' }} />
              </div>
            </label>

            <label className="auth-form-label">
              Test panel
              <div style={{ position: 'relative' }}>
                <FlaskConical size={18} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: '#777777' }} />
                <select
                  required
                  className="auth-form-input"
                  style={{ width: '100%', paddingLeft: '2.2rem', paddingRight: '2rem', appearance: 'none' }}
                  value={testId}
                  onChange={(e) => setTestId(e.target.value)}
                >
                  {tests.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <ChevronRight size={18} style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%) rotate(90deg)', color: '#777777', pointerEvents: 'none' }} />
              </div>
            </label>

            <label className="auth-form-label">
              Tentative report time
              <div style={{ position: 'relative' }}>
                <Calendar size={18} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: '#777777' }} />
                <input
                  type="datetime-local"
                  className="auth-form-input"
                  style={{ width: '100%', paddingLeft: '2.2rem' }}
                  value={tentative}
                  onChange={(e) => setTentative(e.target.value)}
                />
              </div>
            </label>
          </div>

          <button type="submit" className="btn primary" style={{ width: '100%', padding: '0.6rem', fontSize: '1rem' }}>
            Create receipt
          </button>
        </form>

        <div className="card print-area" style={{ padding: '1.5rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>Receipt</h2>
          {!lastOrder && (
            <p className="muted">Create an order to see the receipt.</p>
          )}
          {lastOrder && (
            <>
              <div id="lab-receipt-print" className="receipt lab-print-area" style={{ padding: '1rem', background: '#f5f5f5', borderRadius: '8px', border: '1px solid #e5e5e5' }}>
                <h3 style={{ marginBottom: '1rem', color: '#111111', borderBottom: '1px solid #e5e5e5', paddingBottom: '0.5rem' }}>Lab Receipt</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <p style={{ margin: 0 }}><strong style={{ color: '#777777' }}>Receipt:</strong><br /> {lastOrder.receipt_number}</p>
                  <p style={{ margin: 0 }}><strong style={{ color: '#777777' }}>Test:</strong><br /> {testName || "—"}</p>
                  <p style={{ margin: 0 }}><strong style={{ color: '#777777' }}>Pet:</strong><br /> {pet ? `${pet.name} (${pet.species ?? "—"})` : "Loading…"}</p>
                  <p style={{ margin: 0 }}><strong style={{ color: '#777777' }}>Owner:</strong><br /> {pet?.owner_name ?? "—"}</p>
                  <p style={{ margin: 0, gridColumn: 'span 2' }}><strong style={{ color: '#777777' }}>Tentative report:</strong><br /> {lastOrder.tentative_report_at ? new Date(lastOrder.tentative_report_at).toLocaleString() : "—"}</p>
                </div>
                <p className="small muted" style={{ marginTop: '1rem', paddingTop: '0.5rem', borderTop: '1px dashed #cccccc' }}>
                  Ordered: {new Date(lastOrder.created_at).toLocaleString()}
                </p>
              </div>
              <div className="no-print row-actions" style={{ marginTop: '1.5rem' }}>
                <button type="button" className="btn primary" onClick={() => void printReceipt()}>
                  Print / Save as PDF
                </button>
                <button type="button" className="btn ghost" onClick={saveReceiptHtml}>
                  Save as HTML
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
