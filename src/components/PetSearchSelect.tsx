import { useEffect, useMemo, useRef, useState } from "react";
import type { PetRow } from "../api";
import { duplicatePetNameKeys, formatPetName } from "../petLabel";

type PetSearchSelectProps = {
  pets: PetRow[];
  value: string;
  onChange: (petId: string) => void;
  required?: boolean;
  placeholder?: string;
};

function petSearchHaystack(p: PetRow): string {
  return [
    p.name,
    p.card_id,
    p.owner_name,
    p.owner_phone,
    p.species,
    p.breed,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function PetSearchSelect({
  pets,
  value,
  onChange,
  required,
  placeholder = "Search pet name, card ID, or owner…",
}: PetSearchSelectProps) {
  const duplicateNames = useMemo(() => duplicatePetNameKeys(pets), [pets]);
  const selected = pets.find((p) => p.id === value) ?? null;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pets.slice(0, 12);
    return pets.filter((p) => petSearchHaystack(p).includes(q)).slice(0, 12);
  }, [pets, query]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!open || highlightIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-index="${highlightIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, open]);

  function pick(p: PetRow) {
    onChange(p.id);
    setQuery("");
    setOpen(false);
  }

  function label(p: PetRow): string {
    const name = formatPetName(p, duplicateNames);
    const extras = [p.card_id, p.owner_name, p.owner_phone]
      .filter(Boolean)
      .join(" · ");
    return extras ? `${name} — ${extras}` : name;
  }

  return (
    <div className="catalog-search-picker" ref={wrapRef}>
      {selected && !open ? (
        <div className="pet-search-selected">
          <span>{label(selected)}</span>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(true);
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            className="catalog-search-input"
            style={{ maxWidth: "100%", width: "100%" }}
            value={query}
            required={required && !value}
            placeholder={placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (!open) setOpen(true);
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlightIndex((i) =>
                  Math.min(i + 1, Math.max(matches.length - 1, 0)),
                );
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlightIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const pickPet = matches[highlightIndex];
                if (pickPet) pick(pickPet);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          {open && (
            <ul className="catalog-search-results" ref={listRef}>
              {matches.length === 0 ? (
                <li className="catalog-search-empty" style={{ padding: "0.5rem 0.75rem" }}>
                  No matching pets
                </li>
              ) : (
                matches.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      data-index={i}
                      className={i === highlightIndex ? "is-highlighted" : ""}
                      onMouseEnter={() => setHighlightIndex(i)}
                      onClick={() => pick(p)}
                    >
                      {label(p)}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
