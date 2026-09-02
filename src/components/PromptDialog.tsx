import { useEffect, useRef, useState } from "react";

let _globalResolve: ((value: string | null) => void) | null = null;

export function showPrompt(message: string): Promise<string | null> {
  return new Promise((resolve) => {
    _globalResolve = resolve;
    window.dispatchEvent(
      new CustomEvent("prompt-dialog:show", { detail: { message } }),
    );
  });
}

export default function PromptDialog() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onShow(e: Event) {
      const detail = (e as CustomEvent).detail;
      setMessage(detail.message);
      setValue("");
      setOpen(true);
    }
    window.addEventListener("prompt-dialog:show", onShow);
    return () => window.removeEventListener("prompt-dialog:show", onShow);
  }, []);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!open) return null;

  function resolve(result: string | null) {
    setOpen(false);
    _globalResolve?.(result);
    _globalResolve = null;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    resolve(value);
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => resolve(null)}>
      <form
        className="card modal"
        onSubmit={onSubmit}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ padding: "1.25rem" }}
      >
        <h3 style={{ marginTop: 0 }}>{message}</h3>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ width: "100%", marginBottom: "1rem" }}
        />
        <div className="row-actions" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={() => resolve(null)}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            OK
          </button>
        </div>
      </form>
    </div>
  );
}
