import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";

type CatalogOption = { id: string; name: string };

type CatalogSearchPickerProps = {
  placeholder: string;
  catalog: CatalogOption[];
  selected: string[];
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  onAddNew?: () => void;
  /** Extra action button (e.g. "+ Add other medicine") */
  extraAction?: ReactNode;
  /** When false, hide the selected-name chips (caller renders custom UI). Default true. */
  showSelectedChips?: boolean;
};

export default function CatalogSearchPicker({
  placeholder,
  catalog,
  selected,
  onAdd,
  onRemove,
  onAddNew,
  extraAction,
  showSelectedChips = true,
}: CatalogSearchPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalog
      .filter((item) => item.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [catalog, query]);

  // Prefer highlighting the first selectable (not already-added) result.
  const firstSelectableIndex = useMemo(() => {
    const idx = matches.findIndex((item) => !selected.includes(item.name));
    return idx;
  }, [matches, selected]);

  useEffect(() => {
    setHighlightIndex(firstSelectableIndex);
  }, [query, firstSelectableIndex]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setHighlightIndex(-1);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (highlightIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-index="${highlightIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  function pick(name: string) {
    if (!selected.includes(name)) {
      onAdd(name);
    }
    setQuery("");
    setOpen(false);
    setHighlightIndex(-1);
  }

  function moveHighlight(direction: 1 | -1) {
    if (matches.length === 0) return;
    setOpen(true);
    setHighlightIndex((prev) => {
      let next = prev < 0 ? (direction === 1 ? -1 : matches.length) : prev;
      for (let step = 0; step < matches.length; step++) {
        next = (next + direction + matches.length) % matches.length;
        if (!selected.includes(matches[next].name)) {
          return next;
        }
      }
      return prev;
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp") && query.trim()) {
      setOpen(true);
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
      return;
    }
    if (e.key === "Enter") {
      if (open && highlightIndex >= 0 && highlightIndex < matches.length) {
        e.preventDefault();
        const item = matches[highlightIndex];
        if (item && !selected.includes(item.name)) {
          pick(item.name);
        }
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setHighlightIndex(-1);
    }
  }

  return (
    <div className="catalog-search-picker no-print" ref={wrapRef}>
      <div className="catalog-search-picker-bar">
        <input
          type="search"
          className="catalog-search-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (query.trim()) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-autocomplete="list"
          aria-activedescendant={
            highlightIndex >= 0 && matches[highlightIndex]
              ? `catalog-option-${matches[highlightIndex].id}`
              : undefined
          }
        />
        {onAddNew && (
          <button type="button" className="btn ghost small" onClick={onAddNew}>
            + Add New
          </button>
        )}
        {extraAction}
      </div>
      {open && query.trim() && matches.length > 0 && (
        <ul
          className="catalog-search-results"
          role="listbox"
          ref={listRef}
        >
          {matches.map((item, index) => {
            const isSelected = selected.includes(item.name);
            const isHighlighted = index === highlightIndex;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  id={`catalog-option-${item.id}`}
                  data-index={index}
                  role="option"
                  aria-selected={isHighlighted}
                  className={[
                    isSelected ? "is-selected" : "",
                    isHighlighted ? "is-highlighted" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined}
                  onClick={() => pick(item.name)}
                  onMouseEnter={() => {
                    if (!isSelected) setHighlightIndex(index);
                  }}
                  disabled={isSelected}
                >
                  {item.name}
                  {isSelected ? " (added)" : ""}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && query.trim() && matches.length === 0 && (
        <p className="catalog-search-empty muted small">No matches</p>
      )}
      {showSelectedChips && selected.length > 0 && (
        <div className="catalog-search-selected">
          {selected.map((name) => (
            <span key={name} className="catalog-selected-chip">
              {name}
              <button
                type="button"
                className="catalog-selected-chip-remove"
                title={`Remove ${name}`}
                onClick={() => onRemove(name)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
