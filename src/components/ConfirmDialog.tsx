import { useEffect, useState } from "react";

let _globalResolve: ((value: boolean) => void) | null = null;

export function showConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    _globalResolve = resolve;
    window.dispatchEvent(
      new CustomEvent("confirm-dialog:show", { detail: { message } }),
    );
  });
}

export default function ConfirmDialog() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    function onShow(e: Event) {
      const detail = (e as CustomEvent).detail;
      setMessage(detail.message);
      setOpen(true);
    }
    window.addEventListener("confirm-dialog:show", onShow);
    return () => window.removeEventListener("confirm-dialog:show", onShow);
  }, []);

  if (!open) return null;

  function resolve(result: boolean) {
    setOpen(false);
    _globalResolve?.(result);
    _globalResolve = null;
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => resolve(false)}>
      <div
        className="card modal"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ padding: "1.25rem" }}
      >
        <h3 style={{ marginTop: 0 }}>{message}</h3>
        <div className="row-actions" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => resolve(false)}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => resolve(true)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
