import React from "react";
import type {
  ClinicRow,
  // OpdConsultationRow,
  OpdMedicineRow,
  PetInput,
} from "@/lib/types";
import { calculateAge } from "@/lib/date";

export interface OpdPrescriptionPrintProps {
  clinic: ClinicRow | null;
  pet: PetInput & { card_id: string };
  consultation: {
    id?: string;
    created_at?: string;
    temperature?: string | null;
    physical_exam?: string | null;
    history_observations: string[];
    dx_items: string[];
    ddx_items: string[];
    diagnosis_note?: string | null;
    differential_diagnosis_note?: string | null;
    symptoms: string[];
    recommended_lab_test_names: string[];
    custom_lab_tests: string[];
    medicines: OpdMedicineRow[];
    clinical_treatment_remark?: string | null;
    in_house_prescription?: string | null;
    recommended_food?: string | null;
    next_visit_at?: string | null;
    doctor_signature_name: string;
  };
  isDraft?: boolean;
}

export function OpdPrescriptionPrint({
  clinic,
  pet,
  consultation,
  isDraft = false,
}: OpdPrescriptionPrintProps) {
  const dateObj = consultation.created_at
    ? new Date(consultation.created_at)
    : new Date();
  const day = dateObj.getDate();
  const month = dateObj
    .toLocaleString("en-US", { month: "short" })
    .toLowerCase();
  const year = dateObj.getFullYear().toString().slice(-2);
  const time = dateObj.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const petDetails = [
    pet.species,
    pet.breed,
    pet.weight,
    calculateAge(pet.date_of_birth, pet.age),
    pet.sex,
  ].filter(Boolean);

  return (
    <div
      className="card print-area opd-prescription"
      style={{ fontSize: "0.85rem", lineHeight: 1.35 }}
    >
      <div className="opd-prescription-top">
        <div
          className="opd-logo"
          style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
        >
          {clinic?.logo ? (
            <img
              src={clinic.logo}
              alt="Clinic Logo"
              style={{
                width: "2rem",
                height: "2rem",
                objectFit: "contain",
              }}
            />
          ) : (
            clinic?.name || "Pet Care Clinic"
          )}
        </div>
        <div className="muted small">
          {isDraft
            ? "Prescription Draft"
            : `Prescription #${consultation.id?.slice(0, 8).toUpperCase()}`}
        </div>
      </div>

      <div className="opd-prescription-meta" style={{ marginTop: "0.6rem" }}>
        <div
          style={{
            borderBottom: "1.5px solid #6b7280",
            paddingBottom: "0.3rem",
            marginBottom: "0.5rem",
          }}
        >
          <strong style={{ fontSize: "0.8rem" }}>
            {day} {month}, {year} • {time}
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
              {clinic.timing && (
                <p style={{ margin: 0, fontSize: "0.75rem", color: "#666" }}>
                  <strong>Timing:</strong> {clinic.timing}
                </p>
              )}
            </div>
          )}
        </div>

        <div
          className="opd-prescription-body"
          style={{
            marginBottom: "0.6rem",
            borderBottom: "1.5px solid #6b7280",
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
              {pet.card_id && (
                <span
                  style={{
                    fontWeight: 400,
                    fontSize: "0.75rem",
                    color: "#666",
                  }}
                >
                  ({pet.card_id})
                </span>
              )}
            </p>
            {petDetails.length > 0 && (
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#666" }}>
                {petDetails.join(" • ")}
              </p>
            )}
          </div>
        </div>
      </div>

      {(() => {
        const labelStyle: React.CSSProperties = {
          fontSize: "0.65rem",
          textTransform: "uppercase",
          color: "#666",
          display: "block",
          marginBottom: "2px",
          letterSpacing: "0.02em",
        };

        const noteTextStyle: React.CSSProperties = {
          margin: 0,
          fontSize: "0.85rem",
          whiteSpace: "pre-line",
        };

        // Change to "\n" to show each item on a new line, or ", " for comma-separated
        const SEPARATOR = "\n" as const;

        const boxes = [
          {
            key: "susdx",
            condition:
              consultation.dx_items.length > 0 ||
              !!consultation.diagnosis_note?.trim(),
            content: (
              <>
                <strong style={labelStyle}>Sus.Dx</strong>
                {consultation.dx_items.length > 0 && (
                  <p
                    style={{
                      margin: 0,
                      fontWeight: 500,
                      fontSize: "0.9rem",
                      whiteSpace: "pre-line",
                    }}
                  >
                    {consultation.dx_items.join(SEPARATOR)}
                  </p>
                )}
                {consultation.diagnosis_note?.trim() && (
                  <p
                    style={{
                      ...noteTextStyle,
                      marginTop: consultation.dx_items.length > 0 ? 4 : 0,
                    }}
                  >
                    {consultation.dx_items.length > 0 && (
                      <strong style={{ color: "#666" }}>Dx note: </strong>
                    )}
                    {consultation.diagnosis_note.trim()}
                  </p>
                )}
              </>
            ),
          },
          {
            key: "history",
            condition: consultation.history_observations.length > 0,
            content: (
              <>
                <strong style={labelStyle}>Pet History</strong>
                <p style={{ margin: 0, whiteSpace: "pre-line" }}>
                  {consultation.history_observations.join(SEPARATOR)}
                </p>
              </>
            ),
          },
          {
            key: "physical",
            condition: !!(
              consultation.temperature || consultation.physical_exam
            ),
            content: (
              <>
                <strong style={labelStyle}>Physical Exam</strong>
                {consultation.temperature && (
                  <p style={{ margin: 0 }}>Temp: {consultation.temperature}</p>
                )}
                {consultation.physical_exam && (
                  <p
                    style={{
                      margin: "2px 0 0 0",
                      fontSize: "0.8rem",
                      whiteSpace: "pre-line",
                    }}
                  >
                    {consultation.physical_exam}
                  </p>
                )}
              </>
            ),
          },
          {
            key: "ddx",
            condition:
              consultation.ddx_items.length > 0 ||
              !!consultation.differential_diagnosis_note?.trim(),
            content: (
              <>
                <strong style={labelStyle}>Differential Dx (D.D)</strong>
                {consultation.ddx_items.length > 0 && (
                  <p style={{ margin: 0, whiteSpace: "pre-line" }}>
                    {consultation.ddx_items.join(SEPARATOR)}
                  </p>
                )}
                {consultation.differential_diagnosis_note?.trim() && (
                  <p
                    style={{
                      ...noteTextStyle,
                      marginTop: consultation.ddx_items.length > 0 ? 4 : 0,
                    }}
                  >
                    {consultation.ddx_items.length > 0 && (
                      <strong style={{ color: "#666" }}>D.D note: </strong>
                    )}
                    {consultation.differential_diagnosis_note.trim()}
                  </p>
                )}
              </>
            ),
          },
          {
            key: "tests",
            condition:
              [
                ...consultation.recommended_lab_test_names,
                ...consultation.custom_lab_tests,
              ].length > 0,
            content: (
              <>
                <strong style={labelStyle}>Recommended Test</strong>
                <p style={{ margin: 0, whiteSpace: "pre-line" }}>
                  {[
                    ...consultation.recommended_lab_test_names,
                    ...consultation.custom_lab_tests,
                  ].join(SEPARATOR)}
                </p>
              </>
            ),
          },
        ].filter((b) => b.condition);

        return (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              marginTop: "0.4rem",
            }}
          >
            {boxes.map((box, i) => (
              <div
                key={box.key}
                style={{
                  flex: "1 1 33.333%",
                  maxWidth: "33.333%",
                  padding: "0 0.6rem 0.5rem 0.6rem",
                  display: "flex",
                  flexDirection: "column",
                  borderLeft: i % 3 === 0 ? "none" : "1.5px dashed #6b7280",
                }}
              >
                {box.content}
              </div>
            ))}

            {/* Full Width Section */}
            {(() => {
              const medicines = consultation.medicines ?? [];
              const homeMed = (consultation.in_house_prescription ?? "").trim();
              const showMedsSection =
                medicines.length > 0 ||
                !!homeMed ||
                !!consultation.clinical_treatment_remark ||
                !!consultation.recommended_food ||
                !!consultation.next_visit_at;
              if (!showMedsSection) return null;

              return (
              <div style={{ flex: "1 1 100%", marginTop: "0.6rem" }}>
                <strong
                  style={{
                    fontSize: "0.7rem",
                    textTransform: "uppercase",
                    color: "#333",
                    display: "block",
                    borderBottom: "1.5px solid #6b7280",
                    paddingBottom: "3px",
                    marginBottom: "2px",
                  }}
                >
                  Medicines & Treatment
                </strong>

                {medicines.length > 0 && (
                  <table
                    className="table prescription-table"
                    style={{
                      width: "100%",
                      marginBottom: "0.4rem",
                      fontSize: "0.8rem",
                      borderCollapse: "collapse",
                    }}
                  >
                    <thead>
                      <tr>
                        <th
                          style={{
                            textAlign: "left",
                            padding: "2px 6px 2px 0",
                          }}
                        >
                          #
                        </th>
                        <th style={{ textAlign: "left", padding: "2px 6px" }}>
                          Rx
                        </th>
                        {homeMed && (
                          <th
                            style={{
                              textAlign: "left",
                              borderLeft: "1.5px solid #6b7280",
                              paddingLeft: "0.6rem",
                            }}
                          >
                            Home Medication
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {medicines.map((m, i) => (
                        <tr key={`${m.name}-${i}`}>
                          <td style={{ padding: "1px 6px 1px 0" }}>{i + 1}</td>
                          <td style={{ fontWeight: 500, padding: "1px 6px" }}>
                            {m.name}
                            {m.dosage ? ` (${m.dosage})` : ""}
                          </td>
                          {homeMed && i === 0 && (
                            <td
                              rowSpan={medicines.length}
                              style={{
                                borderLeft: "1.5px solid #6b7280",
                                paddingLeft: "0.6rem",
                                whiteSpace: "pre-wrap",
                                verticalAlign: "top",
                              }}
                            >
                              {homeMed}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Home medication alone (no Rx list) — still print on add/edit/update */}
                {homeMed && medicines.length === 0 && (
                  <div
                    style={{
                      marginBottom: "0.4rem",
                      fontSize: "0.8rem",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    <strong style={{ color: "#666" }}>Home Medication:</strong>{" "}
                    {homeMed}
                  </div>
                )}

                <div
                  style={{
                    marginTop: "0.4rem",
                    fontSize: "0.8rem",
                    display: "grid",
                    gap: "3px",
                  }}
                >
                  {consultation.clinical_treatment_remark &&
                    (() => {
                      const lines =
                        consultation.clinical_treatment_remark.split("\n");
                      return (
                        <p style={{ margin: 0 }}>
                          <strong style={{ color: "#666" }}>Remark:</strong>{" "}
                          {lines[0]}
                          {lines.slice(1).map((line, i) => (
                            <span
                              key={i}
                              style={{
                                display: "block",
                                paddingLeft: "3.7rem",
                              }}
                            >
                              {line}
                            </span>
                          ))}
                        </p>
                      );
                    })()}

                  {consultation.recommended_food && (
                    <p style={{ margin: 0 }}>
                      <strong style={{ color: "#666" }}>
                        Recommended food:
                      </strong>{" "}
                      {consultation.recommended_food}
                    </p>
                  )}
                  {consultation.next_visit_at && (
                    <p style={{ margin: 0 }}>
                      <strong style={{ color: "#666" }}>Next visit:</strong>{" "}
                      {consultation.next_visit_at}
                    </p>
                  )}
                </div>
              </div>
              );
            })()}
          </div>
        );
      })()}
      <div className="opd-footer" style={{ marginTop: "0.75rem" }}>
        <strong>Doctor:</strong> {consultation.doctor_signature_name}
      </div>

      {/* Urdu Consent / Legal Disclaimer Footer */}
      <div
        className="urdu-footer"
        dir="rtl"
        style={{
          marginTop: "0.5rem",
          paddingTop: "0.3rem",
          fontSize: "0.7rem",
          lineHeight: "1.4",
          color: "#222",
          textAlign: "justify",
          fontFamily: "inherit",
        }}
      >
        بحیثیت مالک اپنا جانور ولید پیٹس کئیر ہسپتال لایا ہوں جو کہ بیمار ہے۔
        لہذا میں اس کا ہر ممکن علاج کرنے کی اجازت دیتا ہوں قطع نظر اس کے نتیجہ
        میں جو بھی حالات پیدا ہوں، میں متعلقہ ڈاکٹر کو اس کا مورد الزام نہیں
        ٹھہراوں گا اور کہیں بھی قانونی چارہ جوئی نہیں کروں گا اور میں بخوبی
        جانتا ہوں کہ زندگی موت صرف رب کی طرف سے ہے۔ ڈاکٹر صرف کوشش کر سکتا ہے۔
      </div>
    </div>
  );
}
