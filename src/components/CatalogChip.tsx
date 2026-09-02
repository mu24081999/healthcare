import { X, Pencil } from "lucide-react";
import { api, type OpdCatalogItemRow } from "../api";
import { showPrompt } from "./PromptDialog";
import { showConfirm } from "./ConfirmDialog";

interface CatalogChipProps {
  item: OpdCatalogItemRow;
  selected: boolean;
  onToggle: () => void;
  onAfterChange: () => void;
  setErr: (msg: string | null) => void;
}

export default function CatalogChip({
  item,
  selected,
  onToggle,
  onAfterChange,
  setErr,
}: CatalogChipProps) {
  async function handleRename(e: React.MouseEvent) {
    e.stopPropagation();
    const newName = await showPrompt(`Rename "${item.name}"`);
    if (!newName?.trim() || newName.trim() === item.name) return;
    try {
      await api.opdCatalogRename(item.id, newName.trim());
      onAfterChange();
    } catch (err) {
      setErr(String(err));
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    const ok = await showConfirm(`Delete "${item.name}"?`);
    if (!ok) return;
    try {
      await api.opdCatalogDelete(item.id);
      onAfterChange();
    } catch (err) {
      setErr(String(err));
    }
  }

  return (
    <span className={`catalog-chip ${selected ? "selected" : ""}`}>
      <button
        type="button"
        className={`btn small ${selected ? "primary" : "ghost"}`}
        onClick={onToggle}
      >
        {item.name}
      </button>
      <span className="catalog-chip-actions">
        <button
          type="button"
          className="catalog-chip-icon"
          title="Rename"
          onClick={handleRename}
        >
          <Pencil size={11} />
        </button>
        <button
          type="button"
          className="catalog-chip-icon danger"
          title="Delete"
          onClick={handleDelete}
        >
          <X size={12} />
        </button>
      </span>
    </span>
  );
}
