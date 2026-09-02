import { FormEvent, useEffect, useRef, useState } from "react";
import { Building, Mail, MapPin, Phone, Clock } from "lucide-react";
import { api, type ClinicInput, type ClinicRow } from "../api";
import { useAuth } from "../auth";
import { canManageClinicConfiguration } from "../permissions";
import { useClinic } from "../components/ClinicProvider";
import { useSyncTick } from "../sync";

function clinicToForm(clinic: ClinicRow): ClinicInput {
  return {
    name: clinic.name,
    email: clinic.email,
    address: clinic.address,
    phone: clinic.phone,
    timing: clinic.timing,
    logo: clinic.logo,
  };
}

export default function Clinic() {
  const syncTick = useSyncTick();
  const { state } = useAuth();
  const { refresh: refreshClinic } = useClinic();
  const allowed =
    state.status === "user" && canManageClinicConfiguration(state.user.role);
  const [formData, setFormData] = useState<ClinicInput>({
    name: "",
    email: "",
    address: "",
    phone: "",
    timing: "",
    logo: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const dirtyRef = useRef(false);

  function markDirty() {
    dirtyRef.current = true;
  }

  function applyClinic(clinic: ClinicRow, force = false) {
    if (!force && dirtyRef.current) return;
    setFormData(clinicToForm(clinic));
  }

  useEffect(() => {
    let cancelled = false;
    api
      .clinicGet()
      .then((clinic) => {
        if (cancelled) return;
        applyClinic(clinic);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(
          "Failed to load clinic info:",
          err instanceof Error ? err : err,
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Live sync must not wipe in-progress edits — only apply when clean.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncTick]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Please upload an image file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert("Image is too large. Please upload an image smaller than 2MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        markDirty();
        setFormData((prev) => ({
          ...prev,
          logo: event.target!.result as string,
        }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    markDirty();
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = await api.clinicUpdate(formData);
      dirtyRef.current = false;
      setFormData(clinicToForm(saved));
      refreshClinic();
      alert("Clinic info saved successfully!");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      alert("Failed to save clinic info: " + message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page">
        <p>Loading clinic info...</p>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="page">
        <h1>Unauthorized</h1>
        <p className="muted">Only a superadmin can edit clinic information.</p>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: "40rem" }}>
      <div className="page-head" style={{ marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Clinic Information</h1>
          <p className="muted" style={{ margin: 0 }}>
            Update details for your clinic, including contact and operational
            hours.
          </p>
        </div>
      </div>
      <form
        className="card"
        style={{
          padding: "1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
        }}
        onSubmit={onSubmit}
      >
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              fontWeight: 600,
            }}
          >
            Clinic Logo
          </span>
          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            style={{
              border: dragActive
                ? "2px dashed var(--primary)"
                : "2px dashed var(--border)",
              borderRadius: "8px",
              padding: "1.5rem",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: dragActive
                ? "rgba(var(--primary-rgb), 0.05)"
                : "var(--bg-card-hover, #fafafa)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              position: "relative",
              minHeight: "120px",
            }}
            onClick={() => document.getElementById("logo-file-input")?.click()}
          >
            <input
              type="file"
              id="logo-file-input"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileChange}
              disabled={saving}
            />
            {formData.logo ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "0.75rem",
                  width: "100%",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={formData.logo}
                  alt="Clinic Logo Preview"
                  style={{
                    maxHeight: "100px",
                    maxWidth: "100%",
                    objectFit: "contain",
                    borderRadius: "6px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    border: "1px solid var(--border)",
                  }}
                />
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="btn secondary sm"
                    onClick={() =>
                      document.getElementById("logo-file-input")?.click()
                    }
                    disabled={saving}
                    style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
                  >
                    Change Logo
                  </button>
                  <button
                    type="button"
                    className="btn danger sm"
                    onClick={() => {
                      markDirty();
                      setFormData((prev) => ({ ...prev, logo: null }));
                    }}
                    disabled={saving}
                    style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", pointerEvents: "none" }}>
                <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
                  🖼️
                </div>
                <p style={{ margin: "0 0 0.25rem 0", fontWeight: 500 }}>
                  Drag & drop your clinic logo here, or{" "}
                  <span
                    style={{
                      color: "var(--primary)",
                      textDecoration: "underline",
                    }}
                  >
                    browse
                  </span>
                </p>
                <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
                  Supports PNG, JPG, JPEG, SVG (Max 2MB)
                </p>
              </div>
            )}
          </div>
        </div>

        <label
          style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              fontWeight: 600,
            }}
          >
            <Building size={16} /> Name
          </span>
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
            disabled={saving}
          />
        </label>
        <label
          style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              fontWeight: 600,
            }}
          >
            <Mail size={16} /> Email
          </span>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
            disabled={saving}
          />
        </label>
        <label
          style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              fontWeight: 600,
            }}
          >
            <MapPin size={16} /> Address
          </span>
          <input
            type="text"
            name="address"
            value={formData.address}
            onChange={handleChange}
            required
            disabled={saving}
          />
        </label>
        <label
          style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              fontWeight: 600,
            }}
          >
            <Phone size={16} /> Phone Number
          </span>
          <input
            type="tel"
            name="phone"
            value={formData.phone}
            onChange={handleChange}
            required
            disabled={saving}
          />
        </label>
        <label
          style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              fontWeight: 600,
            }}
          >
            <Clock size={16} /> Timing
          </span>
          <input
            type="text"
            name="timing"
            value={formData.timing}
            onChange={handleChange}
            placeholder="e.g., Mon-Sat 9AM-6PM"
            required
            disabled={saving}
          />
        </label>
        <div
          className="row-actions"
          style={{ justifyContent: "flex-end", marginTop: "1rem" }}
        >
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
