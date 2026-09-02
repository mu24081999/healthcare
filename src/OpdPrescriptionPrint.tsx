import type { ClinicRow, OpdMedicineRow, PetInput } from "./api";
import { Logo } from "./components/Logo";
import { calculateAge } from "./date";

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
    vaccinated?: boolean;
    deworming?: boolean;
    prognosis?: string | null;
  };
}

export function OpdPrescriptionPrint({
  clinic,
  pet,
  consultation,
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

  // Change to "\n" to show each item on a new line, or ", " for comma-separated
  const SEPARATOR = "\n" as const;

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
          <Logo sidebarSize="48px" style={{ maxHeight: 48, width: "auto" }} />
        </div>
        <div className="muted small" style={{ visibility: "hidden" }}>
          &nbsp;
        </div>
      </div>

      <div className="opd-prescription-meta" style={{ marginTop: "0.6rem" }}>
        <div
          style={{
            borderBottom: "1px solid #eee",
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
            borderBottom: "1px solid #eee",
            paddingBottom: "0.5rem",
          }}
        >
          <div>
            <strong style={labelStyle}>Client Information</strong>
            <p style={{ margin: 0, fontWeight: 500 }}>{pet.owner_name}</p>
            {pet.owner_phone && (
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#666" }}>
                {pet.owner_phone}
              </p>
            )}
          </div>
          <div>
            <strong style={labelStyle}>Pet Information</strong>
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
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "1rem",
                marginTop: "0.4rem",
                fontSize: "0.8rem",
              }}
            >
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  margin: 0,
                }}
              >
                <input
                  type="checkbox"
                  checked={!!consultation.vaccinated}
                  readOnly
                  tabIndex={-1}
                />
                Vaccinated
              </label>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  margin: 0,
                }}
              >
                <input
                  type="checkbox"
                  checked={!!consultation.deworming}
                  readOnly
                  tabIndex={-1}
                />
                Deworming
              </label>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          marginTop: "0.4rem",
        }}
      >
        {(() => {
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
                    <p style={{ margin: 0 }}>
                      Temp: {consultation.temperature}
                    </p>
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

          return boxes.map((box, i) => (
            <div
              key={box.key}
              style={{
                flex: "1 1 33.333%",
                maxWidth: "33.333%",
                padding: "0 0.6rem 0.5rem 0.6rem",
                display: "flex",
                flexDirection: "column",
                borderLeft: i % 3 === 0 ? "none" : "1px dashed #ced7e7",
              }}
            >
              {box.content}
            </div>
          ));
        })()}

        {/* Full Width Section */}
        {(consultation.medicines.length > 0 ||
          consultation.clinical_treatment_remark ||
          consultation.recommended_food ||
          consultation.next_visit_at ||
          consultation.in_house_prescription) && (
          <div style={{ flex: "1 1 100%", marginTop: "0.6rem" }}>
            <strong
              style={{
                fontSize: "0.7rem",
                textTransform: "uppercase",
                color: "#333",
                display: "block",
                borderBottom: "1px solid #eee",
                paddingBottom: "3px",
                marginBottom: "2px",
              }}
            >
              Medicines & Treatment
            </strong>

            {consultation.medicines.length > 0 && (
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
                    <th style={{ textAlign: "left", padding: "2px 6px 2px 0" }}>
                      #
                    </th>
                    <th style={{ textAlign: "left", padding: "2px 6px" }}>
                      Rx
                    </th>
                    {consultation.in_house_prescription && (
                      <th
                        style={{
                          textAlign: "left",
                          borderLeft: "1px solid #ccc",
                          paddingLeft: "0.6rem",
                        }}
                      >
                        Home Medication
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {consultation.medicines.map((m, i) => (
                    <tr key={`${m.name}-${i}`}>
                      <td style={{ padding: "1px 6px 1px 0" }}>{i + 1}</td>
                      <td style={{ fontWeight: 500, padding: "1px 6px" }}>
                        {m.name}
                        {m.dosage ? ` (${m.dosage})` : ""}
                      </td>
                      {consultation.in_house_prescription && i === 0 && (
                        <td
                          rowSpan={consultation.medicines.length}
                          style={{
                            borderLeft: "1px solid #ccc",
                            paddingLeft: "0.6rem",
                            whiteSpace: "pre-wrap",
                            verticalAlign: "top",
                          }}
                        >
                          {consultation.in_house_prescription}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
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
                          style={{ display: "block", paddingLeft: "3.7rem" }}
                        >
                          {line}
                        </span>
                      ))}
                    </p>
                  );
                })()}

              {consultation.recommended_food && (
                <p style={{ margin: 0 }}>
                  <strong style={{ color: "#666" }}>Recommended food:</strong>{" "}
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
        )}
      </div>

      <div className="opd-footer" style={{ marginTop: "0.75rem" }}>
        <strong>Doctor:</strong> {consultation.doctor_signature_name}
      </div>

      <div style={{ marginTop: "0.55rem", fontSize: "0.8rem" }}>
        <strong style={{ color: "#666" }}>Prognosis:</strong>{" "}
        <span style={{ whiteSpace: "pre-wrap" }}>
          {(consultation.prognosis ?? "").trim() || "—"}
        </span>
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

// import type { ClinicRow, OpdMedicineRow, PetInput } from "./api";
// import { Logo } from "./components/Logo";
// import { calculateAge } from "./date";

// export interface OpdPrescriptionPrintProps {
//   clinic: ClinicRow | null;
//   pet: PetInput & { card_id: string };
//   consultation: {
//     id?: string;
//     created_at?: string;
//     temperature?: string | null;
//     physical_exam?: string | null;
//     history_observations: string[];
//     dx_items: string[];
//     ddx_items: string[];
//     diagnosis_note?: string | null;
//     differential_diagnosis_note?: string | null;
//     symptoms: string[];
//     recommended_lab_test_names: string[];
//     custom_lab_tests: string[];
//     medicines: OpdMedicineRow[];
//     clinical_treatment_remark?: string | null;
//     in_house_prescription?: string | null;
//     recommended_food?: string | null;
//     next_visit_at?: string | null;
//     doctor_signature_name: string;
//   };
// }

// export function OpdPrescriptionPrint({
//   clinic,
//   pet,
//   consultation,
// }: OpdPrescriptionPrintProps) {
//   const dateObj = consultation.created_at
//     ? new Date(consultation.created_at)
//     : new Date();
//   const day = dateObj.getDate();
//   const month = dateObj
//     .toLocaleString("en-US", { month: "short" })
//     .toLowerCase();
//   const year = dateObj.getFullYear().toString().slice(-2);
//   const time = dateObj.toLocaleTimeString([], {
//     hour: "2-digit",
//     minute: "2-digit",
//   });

//   const petDetails = [
//     pet.species,
//     pet.breed,
//     pet.weight,
//     calculateAge(pet.date_of_birth, pet.age),
//     pet.sex,
//   ].filter(Boolean);

//   return (
//     <div className="card print-area opd-prescription">
//       <div className="opd-prescription-top">
//         <div
//           className="opd-logo"
//           style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
//         >
//           <Logo />
//         </div>
//         <div className="muted small" style={{ visibility: "hidden" }}>
//           &nbsp;
//         </div>
//       </div>

//       <div className="opd-prescription-meta" style={{ marginTop: "1.5rem" }}>
//         <div
//           style={{
//             borderBottom: "1px solid #eee",
//             paddingBottom: "0.5rem",
//             marginBottom: "1.2rem",
//           }}
//         >
//           <strong style={{ fontSize: "0.85rem" }}>
//             {day} {month}, {year} • {time}
//           </strong>

//           {clinic && (
//             <div style={{ marginBottom: "1rem", marginTop: "1rem" }}>
//               <p style={{ margin: 0, fontWeight: 500 }}>
//                 <strong>{clinic.name}</strong>
//               </p>
//               {clinic.address && (
//                 <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>
//                   <strong>Address:</strong> {clinic.address}
//                 </p>
//               )}
//               <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>
//                 {clinic.email && (
//                   <span style={{ marginRight: "1rem" }}>
//                     <strong>Email:</strong> {clinic.email}
//                   </span>
//                 )}
//                 {clinic.phone && (
//                   <span>
//                     <strong>Phone:</strong> {clinic.phone}
//                   </span>
//                 )}
//               </p>
//               {clinic.timing && (
//                 <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>
//                   <strong>Timing:</strong> {clinic.timing}
//                 </p>
//               )}
//             </div>
//           )}
//         </div>

//         <div
//           className="opd-prescription-body"
//           style={{
//             marginBottom: "1.5rem",
//             borderBottom: "1px solid #eee",
//             paddingBottom: "1.2rem",
//           }}
//         >
//           <div>
//             <strong
//               style={{
//                 fontSize: "0.7rem",
//                 textTransform: "uppercase",
//                 color: "#666",
//                 display: "block",
//                 marginBottom: "4px",
//               }}
//             >
//               Client Information
//             </strong>
//             <p style={{ margin: 0, fontWeight: 500 }}>{pet.owner_name}</p>
//             {pet.owner_phone && (
//               <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>
//                 {pet.owner_phone}
//               </p>
//             )}
//           </div>
//           <div>
//             <strong
//               style={{
//                 fontSize: "0.7rem",
//                 textTransform: "uppercase",
//                 color: "#666",
//                 display: "block",
//                 marginBottom: "4px",
//               }}
//             >
//               Pet Information
//             </strong>
//             <p style={{ margin: 0, fontWeight: 500 }}>
//               {pet.name}{" "}
//               {pet.card_id && (
//                 <span
//                   style={{ fontWeight: 400, fontSize: "0.8rem", color: "#666" }}
//                 >
//                   ({pet.card_id})
//                 </span>
//               )}
//             </p>
//             {petDetails.length > 0 && (
//               <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>
//                 {petDetails.join(" • ")}
//               </p>
//             )}
//           </div>
//         </div>
//       </div>

//       <div
//         style={{
//           display: "flex",
//           flexWrap: "wrap",
//           marginTop: "1rem",
//         }}
//       >
//         {(() => {
//           const boxes = [
//             {
//               key: "susdx",
//               condition:
//                 consultation.dx_items.length > 0 ||
//                 !!consultation.diagnosis_note,
//               content: (
//                 <>
//                   <strong
//                     style={{
//                       fontSize: "0.7rem",
//                       textTransform: "uppercase",
//                       color: "#666",
//                       display: "block",
//                       marginBottom: "4px",
//                     }}
//                   >
//                     Sus.Dx
//                   </strong>
//                   <p style={{ margin: 0, fontWeight: 500, fontSize: "1rem" }}>
//                     {consultation.dx_items.join(", ") ||
//                       consultation.diagnosis_note}
//                   </p>
//                 </>
//               ),
//             },
//             {
//               key: "history",
//               condition: consultation.history_observations.length > 0,
//               content: (
//                 <>
//                   <strong
//                     style={{
//                       fontSize: "0.7rem",
//                       textTransform: "uppercase",
//                       color: "#666",
//                       display: "block",
//                       marginBottom: "4px",
//                     }}
//                   >
//                     Pet History
//                   </strong>
//                   <p style={{ margin: 0 }}>
//                     {consultation.history_observations.join(", ")}
//                   </p>
//                 </>
//               ),
//             },
//             {
//               key: "physical",
//               condition: !!(
//                 consultation.temperature || consultation.physical_exam
//               ),
//               content: (
//                 <>
//                   <strong
//                     style={{
//                       fontSize: "0.7rem",
//                       textTransform: "uppercase",
//                       color: "#666",
//                       display: "block",
//                       marginBottom: "4px",
//                     }}
//                   >
//                     Physical Exam
//                   </strong>
//                   {consultation.temperature && (
//                     <p style={{ margin: 0 }}>
//                       Temp: {consultation.temperature}
//                     </p>
//                   )}
//                   {consultation.physical_exam && (
//                     <p style={{ margin: "4px 0 0 0", fontSize: "0.9rem" }}>
//                       {consultation.physical_exam}
//                     </p>
//                   )}
//                 </>
//               ),
//             },
//             {
//               key: "ddx",
//               condition:
//                 consultation.ddx_items.length > 0 ||
//                 !!consultation.differential_diagnosis_note,
//               content: (
//                 <>
//                   <strong
//                     style={{
//                       fontSize: "0.7rem",
//                       textTransform: "uppercase",
//                       color: "#666",
//                       display: "block",
//                       marginBottom: "4px",
//                     }}
//                   >
//                     Differential Dx (D.D)
//                   </strong>
//                   <p style={{ margin: 0 }}>
//                     {consultation.ddx_items.join(", ") ||
//                       consultation.differential_diagnosis_note}
//                   </p>
//                 </>
//               ),
//             },
//             {
//               key: "tests",
//               condition:
//                 [
//                   ...consultation.recommended_lab_test_names,
//                   ...consultation.custom_lab_tests,
//                 ].length > 0,
//               content: (
//                 <>
//                   <strong
//                     style={{
//                       fontSize: "0.7rem",
//                       textTransform: "uppercase",
//                       color: "#666",
//                       display: "block",
//                       marginBottom: "4px",
//                     }}
//                   >
//                     Recommended Test
//                   </strong>
//                   <p style={{ margin: 0 }}>
//                     {[
//                       ...consultation.recommended_lab_test_names,
//                       ...consultation.custom_lab_tests,
//                     ].join(", ")}
//                   </p>
//                 </>
//               ),
//             },
//           ].filter((b) => b.condition);

//           return boxes.map((box, i) => (
//             <div
//               key={box.key}
//               style={{
//                 flex: "1 1 33.333%",
//                 maxWidth: "33.333%",
//                 padding: "0 1rem 1rem 1rem",
//                 display: "flex",
//                 flexDirection: "column",
//                 borderLeft: i % 3 === 0 ? "none" : "1px dashed #ced7e7",
//               }}
//             >
//               {box.content}
//             </div>
//           ));
//         })()}

//         {/* Full Width Section */}
//         {(consultation.medicines.length > 0 ||
//           consultation.clinical_treatment_remark ||
//           consultation.recommended_food ||
//           consultation.next_visit_at ||
//           consultation.in_house_prescription) && (
//           <div style={{ flex: "1 1 100%", marginTop: "1.5rem" }}>
//             <strong
//               style={{
//                 fontSize: "0.75rem",
//                 textTransform: "uppercase",
//                 color: "#333",
//                 display: "block",
//                 marginBottom: "",
//                 borderBottom: "1px solid #eee",
//                 paddingBottom: "6px",
//               }}
//             >
//               Medicines & Treatment
//             </strong>

//             {consultation.medicines.length > 0 && (
//               <table
//                 className="table prescription-table"
//                 style={{ width: "100%", marginBottom: "1rem" }}
//               >
//                 <thead>
//                   <tr>
//                     <th style={{ textAlign: "left" }}>#</th>
//                     <th style={{ textAlign: "left" }}>Rx</th>
//                     {consultation.in_house_prescription && (
//                       <th
//                         style={{
//                           textAlign: "left",
//                           borderLeft: "1px solid #ccc",
//                           paddingLeft: "1rem",
//                         }}
//                       >
//                         Home Medication
//                       </th>
//                     )}
//                   </tr>
//                 </thead>
//                 <tbody>
//                   {consultation.medicines.map((m, i) => (
//                     <tr key={`${m.name}-${i}`}>
//                       <td>{i + 1}</td>
//                       <td style={{ fontWeight: 500 }}>{m.name}</td>
//                       {consultation.in_house_prescription && i === 0 && (
//                         <td
//                           rowSpan={consultation.medicines.length}
//                           style={{
//                             borderLeft: "1px solid #ccc",
//                             paddingLeft: "1rem",
//                             whiteSpace: "pre-wrap",
//                             verticalAlign: "top",
//                           }}
//                         >
//                           {consultation.in_house_prescription}
//                         </td>
//                       )}
//                     </tr>
//                   ))}
//                 </tbody>
//               </table>
//             )}

//             <div
//               style={{
//                 marginTop: "1rem",
//                 fontSize: "0.9rem",
//                 display: "grid",
//                 gap: "6px",
//               }}
//             >
//               {consultation.clinical_treatment_remark && (
//                 <p style={{ margin: 0 }}>
//                   <strong style={{ color: "#666" }}>Remark:</strong>{" "}
//                   {consultation.clinical_treatment_remark}
//                 </p>
//               )}

//               {consultation.recommended_food && (
//                 <p style={{ margin: 0 }}>
//                   <strong style={{ color: "#666" }}>Recommended food:</strong>{" "}
//                   {consultation.recommended_food}
//                 </p>
//               )}
//               {consultation.next_visit_at && (
//                 <p style={{ margin: 0 }}>
//                   <strong style={{ color: "#666" }}>Next visit:</strong>{" "}
//                   {consultation.next_visit_at}
//                 </p>
//               )}
//             </div>
//           </div>
//         )}
//       </div>

//       <div className="opd-footer" style={{ marginTop: "2rem" }}>
//         <strong>Doctor:</strong> {consultation.doctor_signature_name}
//       </div>

//       {/* Urdu Consent / Legal Disclaimer Footer */}
//       <div
//         dir="rtl"
//         style={{
//           marginTop: "1rem",
//           paddingTop: "0.5rem",
//           fontSize: "0.85rem",
//           lineHeight: "1.6",
//           color: "#222",
//           textAlign: "justify",
//           fontFamily: "inherit",
//         }}
//       >
//         بحیثیت مالک اپنا جانور ولید پیٹس کئیر ہسپتال لایا ہوں جو کہ بیمار ہے۔
//         لہذا میں اس کا ہر ممکن علاج کرنے کی اجازت دیتا ہوں قطع نظر اس کے نتیجہ
//         میں جو بھی حالات پیدا ہوں، میں متعلقہ ڈاکٹر کو اس کا مورد الزام نہیں
//         ٹھہراوں گا اور کہیں بھی قانونی چارہ جوئی نہیں کروں گا اور میں بخوبی
//         جانتا ہوں کہ زندگی موت صرف رب کی طرف سے ہے۔ ڈاکٹر صرف کوشش کر سکتا ہے۔
//       </div>
//     </div>
//   );
// }
