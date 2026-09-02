import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, Plus, FileText, Trash2, ClipboardList } from "lucide-react";
import { api, type PetInput, type PetListRow } from "../api";
import { useAuth } from "../auth";
import ConfirmDialog, { showConfirm } from "../components/ConfirmDialog";
import { canManageClinic } from "../permissions";
import { calculateAge } from "../date";
import { duplicatePetNameKeys, formatPetName } from "../petLabel";
import { useSyncTick } from "../sync";

export default function Pets() {
  const syncTick = useSyncTick();
  const { state } = useAuth();
  const canDelete =
    state.status === "user" && canManageClinic(state.user.role);
  const [searchParams] = useSearchParams();
  const [pets, setPets] = useState<PetListRow[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PetInput>({
    name: "",
    species: "",
    age: "",
    date_of_birth: "",
    sex: "Unknown",
    weight: "",
    vaccine_status: "No",
    deworming_status: "No",
    owner_name: "",
    owner_phone: "",
    owner_address: "",
  });
  const [savedOwner, setSavedOwner] = useState<
    Pick<PetInput, "owner_name" | "owner_phone" | "owner_address"> | null
  >(null);

  useEffect(() => {
    const addForPhone = searchParams.get("add_for_phone");
    const addForName = searchParams.get("add_for_name");
    const addForAddress = searchParams.get("add_for_address");
    const addForEmail = searchParams.get("add_for_email");
    if (addForPhone) {
      setOpen(true);
      setForm((prev) => ({
        ...prev,
        owner_phone: addForPhone,
        owner_name: addForName ?? prev.owner_name,
        owner_address: addForAddress ?? prev.owner_address,
        owner_email: addForEmail ?? prev.owner_email,
      }));
    }
  }, [searchParams]);

  async function load() {
    setErr(null);
    try {
      setPets(await api.petsList(q));
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    void load();
  }, [q, syncTick]);

  const duplicateNames = duplicatePetNameKeys(pets);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api.petsCreate(form);
      setSavedOwner({
        owner_name: form.owner_name ?? "",
        owner_phone: form.owner_phone ?? "",
        owner_address: form.owner_address ?? "",
      });
      setOpen(false);
      setForm({
        name: "",
        species: "",
        age: "",
        date_of_birth: "",
        sex: "Unknown",
        weight: "",
        vaccine_status: "No",
        deworming_status: "No",
        owner_name: "",
        owner_phone: "",
        owner_address: "",
      });
      await load();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function onDelete(id: string, name: string) {
    if (!await showConfirm(`Delete ${name}? This cannot be undone.`)) return;
    setErr(null);
    try {
      await api.petsDelete(id);
      await load();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function createOpdRequest(petId: string) {
    setErr(null);
    try {
      await api.opdRequestCreate(petId);
      alert("OPD request created and sent to vets.");
    } catch (e) {
      setErr(String(e));
    }
  }

  function applyOwnerFromPhone(phone: string) {
    const match = pets.find((p) => (p.owner_phone ?? "").trim() === phone.trim());
    if (!match) return;
    setForm((prev) => ({
      ...prev,
      owner_name: prev.owner_name || match.owner_name || "",
      owner_address: prev.owner_address || match.owner_address || "",
    }));
  }

  function addAnotherPetSameOwner() {
    if (!savedOwner) return;
    setOpen(true);
    setForm({
      name: "",
      species: "",
      breed: "",
      age: "",
      date_of_birth: "",
      sex: "Unknown",
      weight: "",
      vaccine_status: "No",
      deworming_status: "No",
      owner_name: savedOwner.owner_name ?? "",
      owner_phone: savedOwner.owner_phone ?? "",
      owner_address: savedOwner.owner_address ?? "",
      notes: "",
    });
  }

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <ConfirmDialog />
      <div className="page-head" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>Pets</h1>
          <p className="muted" style={{ margin: 0 }}>Manage pet profiles, medical records and appointments.</p>
        </div>
        <div className="actions">
          <Link to="/reports" className="btn accent" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <FileText size={16} /> Generate lab report
          </Link>
          <button type="button" className="btn primary" onClick={() => setOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Plus size={16} /> Add pet
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem", padding: '0.75rem' }}>
        <div style={{ position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#5c6473' }} />
          <input 
            value={q} 
            onChange={(e) => setQ(e.target.value)} 
            placeholder="Search pets by name, owner or phone" 
            style={{ width: '100%', paddingLeft: '2.5rem', border: 'none', background: 'transparent', fontSize: '1rem' }}
          />
        </div>
      </div>
      {err && <p className="error">{err}</p>}

      {open && (
        <div className="modal-backdrop" role="presentation">
          <div className="card modal">
            <h2>New pet</h2>
            <form onSubmit={onCreate}>
              <label>
                Name *
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                Species
                <input
                  required
                  value={form.species ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, species: e.target.value || null })
                  }
                />
              </label>
              <label>
                Breed
                <input
                  value={form.breed ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, breed: e.target.value || null })
                  }
                />
              </label>
              <label>
                Date of Birth
                <input
                  type="date"
                  value={form.date_of_birth ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, date_of_birth: e.target.value || null })
                  }
                />
              </label>
              <label>
                Weight
                <input
                  value={form.weight ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, weight: e.target.value || null })
                  }
                  placeholder="e.g. 5kg"
                />
              </label>
              <label>
                Sex
                <select
                  value={form.sex ?? "Unknown"}
                  onChange={(e) => setForm({ ...form, sex: e.target.value })}
                >
                  <option>Male</option>
                  <option>Female</option>
                  <option>Unknown</option>
                </select>
              </label>
              <label>
                Vaccine status
                <select
                  value={form.vaccine_status ?? "No"}
                  onChange={(e) => setForm({ ...form, vaccine_status: e.target.value })}
                >
                  <option>Yes</option>
                  <option>No</option>
                  <option>Due</option>
                </select>
              </label>
              <label>
                Deworming status
                <select
                  value={form.deworming_status ?? "No"}
                  onChange={(e) => setForm({ ...form, deworming_status: e.target.value })}
                >
                  <option>Yes</option>
                  <option>No</option>
                  <option>Due</option>
                </select>
              </label>
              <label>
                Owner name
                <input
                  required
                  value={form.owner_name ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, owner_name: e.target.value || null })
                  }
                />
              </label>
              <label>
                Owner phone
                <input
                  required
                  value={form.owner_phone ?? ""}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    setForm({ ...form, owner_phone: v });
                    if (v) applyOwnerFromPhone(v);
                  }}
                />
              </label>
              <label>
                Address
                <textarea
                  rows={2}
                  value={form.owner_address ?? ""}
                  onChange={(e) => setForm({ ...form, owner_address: e.target.value || null })}
                />
              </label>
              <label>
                Notes
                <textarea
                  rows={3}
                  value={form.notes ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, notes: e.target.value || null })
                  }
                />
              </label>
              <div className="row-actions">
                <button type="submit" className="btn primary">
                  Save
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: '0.5rem' }}>
        {savedOwner && (
          <div className="row-actions" style={{ marginBottom: "0.6rem" }}>
            <button type="button" className="btn ghost" onClick={addAnotherPetSameOwner}>
              + Add Another Pet for Same Owner
            </button>
          </div>
        )}
        <table className="table" style={{ borderCollapse: 'separate', borderSpacing: '0 0.25rem' }}>
          <thead>
            <tr>
              <th style={{ padding: '0.75rem' }}>Name</th>
              <th style={{ padding: '0.75rem' }}>Card ID</th>
              <th style={{ padding: '0.75rem' }}>Species</th>
              <th style={{ padding: '0.75rem' }}>Age</th>
              <th style={{ padding: '0.75rem' }}>Weight</th>
              <th style={{ padding: '0.75rem' }}>Owner</th>
              <th style={{ padding: '0.75rem' }}>Phone</th>
              <th style={{ padding: '0.75rem' }}>Vaccine</th>
              <th style={{ padding: '0.75rem' }}>Deworming</th>
              <th style={{ padding: '0.75rem' }}>History</th>
              <th style={{ padding: '0.75rem' }}></th>
            </tr>
          </thead>
          <tbody>
            {pets.map((p) => (
              <tr key={p.id} className="pet-row" style={{ transition: 'background 0.2s' }}>
                <td style={{ padding: '1.25rem 0.75rem' }}>
                  <Link to={`/pets/${p.id}`} style={{ fontWeight: 600 }}>
                    {formatPetName(p, duplicateNames)}
                  </Link>
                </td>
                <td style={{ padding: '1.25rem 0.75rem' }}>
                  <code className="small" style={{ background: '#f0f4f9', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>{p.card_id}</code>
                </td>
                <td style={{ padding: '1.25rem 0.75rem' }}>{p.species ?? "—"}</td>
                <td style={{ padding: '1.25rem 0.75rem' }}>{calculateAge(p.date_of_birth, p.age)}</td>
                <td style={{ padding: '1.25rem 0.75rem' }}>{p.weight ?? "—"}</td>
                <td style={{ padding: '1.25rem 0.75rem' }}>{p.owner_name ?? "—"}</td>
                <td style={{ padding: '1.25rem 0.75rem' }}>{p.owner_phone ?? "—"}</td>
                <td style={{ padding: '1.25rem 0.75rem' }}>
                    <span style={{ padding: '0.35rem 0.75rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 600, background: p.vaccine_status === 'Yes' ? '#e6f6f2' : '#fde8e8', color: p.vaccine_status === 'Yes' ? '#1c7c64' : '#9b1c1c' }}>
                        {p.vaccine_status ?? "No"}
                    </span>
                </td>
                <td style={{ padding: '1.25rem 0.75rem' }}>
                    <span style={{ padding: '0.35rem 0.75rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 600, background: p.deworming_status === 'Yes' ? '#e6f6f2' : '#fde8e8', color: p.deworming_status === 'Yes' ? '#1c7c64' : '#9b1c1c' }}>
                        {p.deworming_status ?? "No"}
                    </span>
                </td>
                <td style={{ padding: '1.25rem 0.75rem' }}>
                  <Link to={`/pets/${p.id}?tab=medical`} className="small">
                    {p.medical_count} medical
                  </Link>
                  {" · "}
                  <Link to={`/pets/${p.id}?tab=grooming`} className="small">
                    {p.grooming_count} grooming
                  </Link>
                </td>
                <td className="right row-actions-container" style={{ padding: '1.25rem 0.75rem' }}>
                  <div className="hidden-actions" style={{ display: 'flex', gap: '0.5rem', opacity: 0, transition: 'opacity 0.2s' }}>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => void createOpdRequest(p.id)}
                    >
                      <ClipboardList size={14} /> OPD
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        className="btn danger ghost small"
                        onClick={() => onDelete(p.id, p.name)}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pets.length === 0 && (
          <p className="muted" style={{ padding: '1rem' }}>No pets yet. Add one to get started.</p>
        )}
      </div>
    </div>
  );
}
