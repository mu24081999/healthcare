"use client";

import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2, Edit2, Calendar, LayoutGrid, Dog, Hash } from "lucide-react";
import { api } from "@/lib/api";
import type {
  HospitalizationInput,
  HospitalizationRow,
  PetListRow,
} from "@/lib/types";
import { duplicatePetNameKeys, formatPetName } from "@/lib/pet-label";

const today = new Date().toISOString().slice(0, 10);

export default function HospitalizationPage() {
  const [pets, setPets] = useState<PetListRow[]>([]);
  const [hospitalizations, setHospitalizations] = useState<
    HospitalizationRow[]
  >([]);
  const [form, setForm] = useState<HospitalizationInput>({
    pet_id: "",
    cage_number: "",
    check_in_date: today,
    check_out_date: null,
  });
  const [edit, setEdit] = useState<HospitalizationRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadAll() {
    setErr(null);
    try {
      setPets(await api.petsList());
      setHospitalizations(await api.hospitalizationsList());
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function saveHospitalization(e: FormEvent) {
    e.preventDefault();
    if (
      !form.pet_id ||
      !form.cage_number.trim() ||
      !form.check_in_date.trim()
    ) {
      setErr("Pet, check in date, and cage number are required.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await api.hospitalizationsUpsert(
        {
          ...form,
          check_out_date: form.check_out_date || null,
        },
        edit?.id,
      );
      setEdit(null);
      setForm({
        pet_id: "",
        cage_number: "",
        check_in_date: today,
        check_out_date: null,
      });
      await loadAll();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(h: HospitalizationRow) {
    setEdit(h);
    setForm({
      pet_id: h.pet_id,
      cage_number: h.cage_number,
      check_in_date: h.check_in_date,
      check_out_date: h.check_out_date ?? null,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteHospitalization(id: string) {
    if (!confirm("Delete this hospitalization entry?")) return;
    setErr(null);
    try {
      await api.hospitalizationsDelete(id);
      if (edit?.id === id) {
        setEdit(null);
        setForm({
          pet_id: "",
          cage_number: "",
          check_in_date: today,
          check_out_date: null,
        });
      }
      await loadAll();
    } catch (e) {
      setErr(String(e));
    }
  }

  const duplicateNames = duplicatePetNameKeys(pets);
  const petMap = Object.fromEntries(
    pets.map((p) => [p.id, formatPetName(p, duplicateNames)]),
  );

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>Hospitalization</h1>
          <p className="muted" style={{ margin: 0 }}>Track ward admissions with check-in, check-out, and cage number.</p>
        </div>
      </div>
      {err && <p className="error">{err}</p>}

      <div className="stack">
        <form className="card" style={{ padding: '1rem' }} onSubmit={saveHospitalization}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {edit ? <Edit2 size={18} /> : <Plus size={18} />} {edit ? "Edit hospitalization" : "New hospitalization"}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}><Dog size={16} /> Pet *</span>
              <select
                required
                value={form.pet_id}
                onChange={(e) => setForm({ ...form, pet_id: e.target.value })}
              >
                <option value="">Select pet</option>
                {pets.map((pet) => (
                  <option key={pet.id} value={pet.id}>
                    {formatPetName(pet, duplicateNames)} ({pet.card_id})
                  </option>
                ))}
              </select>
            </label>

            <div className="grid2" style={{ gap: '1rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}><Calendar size={16} /> Check in date *</span>
                <input
                  required
                  type="date"
                  value={form.check_in_date}
                  onChange={(e) =>
                    setForm({ ...form, check_in_date: e.target.value })
                  }
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}><Calendar size={16} /> Check out date</span>
                <input
                  type="date"
                  value={form.check_out_date ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      check_out_date: e.target.value || null,
                    })
                  }
                />
              </label>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}><Hash size={16} /> Cage number *</span>
              <input
                required
                value={form.cage_number}
                onChange={(e) =>
                  setForm({ ...form, cage_number: e.target.value })
                }
              />
            </label>
          </div>

          <div className="row-actions" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy
                ? "Saving..."
                : edit
                  ? "Save changes"
                  : "Save hospitalization"}
            </button>
            {edit && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setEdit(null);
                  setForm({
                    pet_id: "",
                    cage_number: "",
                    check_in_date: today,
                    check_out_date: null,
                  });
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="card" style={{ padding: '0.5rem' }}>
          <h2 style={{ padding: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><LayoutGrid size={18}/> Existing hospitalizations</h2>
          {hospitalizations.length === 0 ? (
            <p className="muted" style={{ padding: '0.75rem' }}>No hospitalizations recorded yet.</p>
          ) : (
            <table className="table" style={{ borderCollapse: 'separate', borderSpacing: '0 0.25rem' }}>
              <thead>
                <tr>
                  <th style={{ padding: '0.75rem' }}>Pet</th>
                  <th style={{ padding: '0.75rem' }}><Calendar size={14}/> Check in</th>
                  <th style={{ padding: '0.75rem' }}><Calendar size={14}/> Check out</th>
                  <th style={{ padding: '0.75rem' }}>Cage</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {hospitalizations.map((h) => (
                  <tr key={h.id} className="pet-row" style={{ transition: 'background 0.2s' }}>
                    <td style={{ padding: '1rem 0.75rem' }}>{petMap[h.pet_id] ?? "Unknown pet"}</td>
                    <td style={{ padding: '1rem 0.75rem' }}>{h.check_in_date}</td>
                    <td style={{ padding: '1rem 0.75rem' }}>{h.check_out_date ?? "—"}</td>
                    <td style={{ padding: '1rem 0.75rem' }}>{h.cage_number}</td>
                    <td style={{ padding: '1rem 0.75rem', textAlign: 'left' }}>
                      <div className="hidden-actions" style={{ display: 'flex', justifyContent: 'flex-start', gap: '0.5rem', opacity: 0, transition: 'opacity 0.2s', pointerEvents: 'auto' }}>
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() => startEdit(h)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn danger ghost small"
                          onClick={(e) => { e.stopPropagation(); void deleteHospitalization(h.id); }}
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
