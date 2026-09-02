import { FormEvent, useEffect, useState, JSX } from "react";
import {
  Plus,
  Trash2,
  Edit2,
  Settings,
  Package,
  Utensils,
  AlertCircle,
  FileText,
} from "lucide-react";
import { api, type OpdCatalogItemRow, type OpdCatalogType } from "../api";
import { useAuth } from "../auth";
import { canManageClinicConfiguration } from "../permissions";
import { useSyncTick } from "../sync";
import ConfirmDialog, { showConfirm } from "../components/ConfirmDialog";
import PromptDialog, { showPrompt } from "../components/PromptDialog";

export default function OpdSettings() {
  const syncTick = useSyncTick();
  const { state } = useAuth();
  const canManage =
    state.status === "user" && canManageClinicConfiguration(state.user.role);

  const [historyCatalog, setHistoryCatalog] = useState<OpdCatalogItemRow[]>([]);
  const [dxCatalog, setDxCatalog] = useState<OpdCatalogItemRow[]>([]);
  const [ddxCatalog, setDdxCatalog] = useState<OpdCatalogItemRow[]>([]);
  const [medCatalog, setMedCatalog] = useState<OpdCatalogItemRow[]>([]);
  const [foodCatalog, setFoodCatalog] = useState<OpdCatalogItemRow[]>([]);
  const [symptomCatalog, setSymptomCatalog] = useState<OpdCatalogItemRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [catalogType, setCatalogType] = useState<OpdCatalogType>("medicine");
  const [catalogName, setCatalogName] = useState("");

  async function loadCatalogs() {
    setErr(null);
    try {
      const [history, dx, ddx, meds, foods, symptoms] = await Promise.all([
        api.opdCatalogList("history_observation"),
        api.opdCatalogList("dx"),
        api.opdCatalogList("ddx"),
        api.opdCatalogList("medicine"),
        api.opdCatalogList("food"),
        api.opdCatalogList("symptom"),
      ]);
      setHistoryCatalog(history);
      setDxCatalog(dx);
      setDdxCatalog(ddx);
      setMedCatalog(meds);
      setFoodCatalog(foods);
      setSymptomCatalog(symptoms);
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    void loadCatalogs();
  }, [syncTick]);

  async function addToCatalog(e: FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    if (!catalogName.trim()) return;
    setErr(null);
    try {
      await api.opdCatalogCreate(catalogType, catalogName.trim());
      setCatalogName("");
      await loadCatalogs();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function removeCatalogItem(item: OpdCatalogItemRow) {
    if (!canManage) return;
    if (!(await showConfirm(`Delete "${item.name}"?`))) return;
    setErr(null);
    try {
      await api.opdCatalogDelete(item.id);
      await loadCatalogs();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function renameCatalogItem(item: OpdCatalogItemRow) {
    if (!canManage) return;
    const newName = await showPrompt(`Rename "${item.name}"`);
    if (!newName?.trim() || newName.trim() === item.name) return;
    setErr(null);
    try {
      await api.opdCatalogRename(item.id, newName.trim());
      await loadCatalogs();
    } catch (e) {
      setErr(String(e));
    }
  }

  if (!canManage) {
    return (
      <div className="page">
        <h1>Unauthorized</h1>
        <p>You do not have permission to access OPD settings.</p>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: "none" }}>
      <ConfirmDialog />
      <PromptDialog />
      <div className="page-head" style={{ marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>OPD Settings</h1>
          <p className="muted" style={{ margin: 0 }}>
            Manage default options for OPD prescriptions, pharmacy, and food
            catalog.
          </p>
        </div>
      </div>

      {err && <p className="error">{err}</p>}

      <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
        <h2
          style={{
            fontSize: "1.1rem",
            marginBottom: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <Settings size={18} /> Add catalog item
        </h2>
        <form
          onSubmit={addToCatalog}
          style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}
        >
          <select
            value={catalogType}
            onChange={(e) => setCatalogType(e.target.value as OpdCatalogType)}
            style={{ flex: 1, padding: "0.5rem" }}
          >
            <option value="history_observation">History / Observation</option>
            <option value="dx">Dx (Prescription)</option>
            <option value="ddx">D.D (Prescription)</option>
            <option value="medicine">Medicine (Pharmacy)</option>
            <option value="food">Food</option>
            <option value="symptom" style={{ display: "none" }}>
              Symptom
            </option>
          </select>
          <input
            value={catalogName}
            onChange={(e) => setCatalogName(e.target.value)}
            placeholder="Item name"
            required
            style={{ flex: 2, padding: "0.5rem" }}
          />
          <button
            type="submit"
            className="btn primary"
            style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
          >
            <Plus size={16} /> Add item
          </button>
        </form>
      </div>

      <div className="grid2">
        <CatalogSection
          title="Pharmacy (Medicines)"
          icon={<Package size={18} />}
          items={medCatalog}
          onRename={renameCatalogItem}
          onRemove={removeCatalogItem}
        />
        <CatalogSection
          title="Food Catalog"
          icon={<Utensils size={18} />}
          items={foodCatalog}
          onRename={renameCatalogItem}
          onRemove={removeCatalogItem}
        />
        <div style={{ display: "none" }}>
          <CatalogSection
            title="Symptoms"
            icon={<AlertCircle size={18} />}
            items={symptomCatalog}
            onRename={renameCatalogItem}
            onRemove={removeCatalogItem}
          />
        </div>
        <CatalogSection
          title="History / Observation"
          icon={<FileText size={18} />}
          items={historyCatalog}
          onRename={renameCatalogItem}
          onRemove={removeCatalogItem}
        />
        <CatalogSection
          title="Sus.Dx"
          icon={<FileText size={18} />}
          items={dxCatalog}
          onRename={renameCatalogItem}
          onRemove={removeCatalogItem}
        />
        <CatalogSection
          title="Differential Diagnosis (D.D)"
          icon={<FileText size={18} />}
          items={ddxCatalog}
          onRename={renameCatalogItem}
          onRemove={removeCatalogItem}
        />
      </div>
    </div>
  );
}

function CatalogSection({
  title,
  icon,
  items,
  onRename,
  onRemove,
}: {
  title: string;
  icon: JSX.Element;
  items: OpdCatalogItemRow[];
  onRename: (item: OpdCatalogItemRow) => void;
  onRemove: (item: OpdCatalogItemRow) => void;
}) {
  return (
    <div className="card" style={{ padding: "0.5rem" }}>
      <h3
        style={{
          padding: "0.75rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        {icon} {title}
      </h3>
      {items.length === 0 ? (
        <p className="muted" style={{ padding: "0.75rem" }}>
          No items added.
        </p>
      ) : (
        <table
          className="table"
          style={{ borderCollapse: "separate", borderSpacing: "0 0.25rem" }}
        >
          <tbody>
            {items.map((i) => (
              <tr
                key={i.id}
                className="pet-row"
                style={{ transition: "background 0.2s" }}
              >
                <td style={{ padding: "1rem 0.75rem" }}>{i.name}</td>
                <td
                  style={{ padding: "1rem 0.75rem" }}
                  className="right nowrap row-actions-container"
                >
                  <div
                    className="hidden-actions"
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      opacity: 0,
                      transition: "opacity 0.2s",
                    }}
                  >
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => void onRename(i)}
                    >
                      <Edit2 size={14} /> Rename
                    </button>
                    <button
                      type="button"
                      className="btn danger ghost small"
                      onClick={() => void onRemove(i)}
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
  );
}
