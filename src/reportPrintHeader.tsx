import type { ClinicRow, OpdRequestRow, PetInput } from "./api";
import { Logo } from "./components/Logo";
import { calculateAge } from "./date";

/** Map an open OPD request row to the shape used by {@link ReportPrintHeader}. */
export function opdRequestToPetPrint(
  r: OpdRequestRow,
): PetInput & { card_id: string } {
  return {
    name: r.pet_name,
    species: r.species,
    breed: r.breed,
    age: r.age,
    date_of_birth: r.date_of_birth,
    sex: r.sex,
    weight: r.weight,
    owner_name: r.owner_name,
    owner_phone: r.owner_phone,
    card_id: r.pet_card_id,
  };
}

export function ReportPrintHeader({
  clinic,
  pet,
}: {
  clinic: ClinicRow | null;
  pet: PetInput & { card_id: string };
}) {
  return (
    <div
      className="print-header"
      style={{ marginBottom: "0.6rem", fontSize: "0.85rem", lineHeight: 1.35 }}
    >
      <div className="opd-prescription-top">
        <div
          className="opd-logo"
          style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
        >
          <Logo sidebarSize="48px" style={{ maxHeight: 48, width: "auto" }} />
        </div>
      </div>
      <div
        style={{
          borderBottom: "1px solid #eee",
          paddingBottom: "0.3rem",
          marginBottom: "0.5rem",
          marginTop: "0.4rem",
        }}
      >
        <strong style={{ fontSize: "0.8rem" }}>
          {new Date().toLocaleDateString("en-US", {
            day: "numeric",
            month: "short",
            year: "2-digit",
          })}{" "}
          •{" "}
          {new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </strong>
        {clinic && (
          <div style={{ marginTop: "0.4rem" }}>
            <p style={{ margin: 0, fontWeight: 500 }}>
              <strong>{clinic.name}</strong>
            </p>
            {clinic.address && (
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#666" }}>
                <strong>Address:</strong> {clinic.address}
              </p>
            )}
            <p style={{ margin: 0, fontSize: "0.75rem", color: "#666" }}>
              {clinic.email && (
                <span style={{ marginRight: "0.75rem" }}>
                  <strong>Email:</strong> {clinic.email}
                </span>
              )}
              {clinic.phone && (
                <span>
                  <strong>Phone:</strong> {clinic.phone}
                </span>
              )}
            </p>
          </div>
        )}
      </div>
      <div
        className="opd-prescription-body"
        style={{
          marginBottom: "0.6rem",
          borderBottom: "1px solid #eee",
          paddingBottom: "0.5rem",
        }}
      >
        <div>
          <strong
            style={{
              fontSize: "0.65rem",
              textTransform: "uppercase",
              color: "#666",
              display: "block",
              marginBottom: "2px",
              letterSpacing: "0.02em",
            }}
          >
            Client Information
          </strong>
          <p style={{ margin: 0, fontWeight: 500 }}>{pet.owner_name}</p>
          {pet.owner_phone && (
            <p style={{ margin: 0, fontSize: "0.75rem", color: "#666" }}>
              {pet.owner_phone}
            </p>
          )}
        </div>
        <div>
          <strong
            style={{
              fontSize: "0.65rem",
              textTransform: "uppercase",
              color: "#666",
              display: "block",
              marginBottom: "2px",
              letterSpacing: "0.02em",
            }}
          >
            Pet Information
          </strong>
          <p style={{ margin: 0, fontWeight: 500 }}>
            {pet.name}{" "}
            <span
              style={{ fontWeight: 400, fontSize: "0.75rem", color: "#666" }}
            >
              ({pet.card_id})
            </span>
          </p>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "#666" }}>
            {[
              pet.species,
              pet.breed,
              pet.weight,
              calculateAge(pet.date_of_birth, pet.age),
              pet.sex,
            ]
              .filter(Boolean)
              .join(" • ")}
          </p>
        </div>
      </div>
    </div>
  );
}
