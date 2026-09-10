"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { OpdPrescriptionPrint } from "@/components/opd-prescription-print";
import { api, valueHighlight } from "@/lib/api";
import {
  appPrint,
  downloadLabReportHtml,
  downloadHtmlFile,
  escapeHtml,
} from "@/lib/print";
import { transformToHistory, type HistoryRow } from "@/lib/lab-history";
import { ReportPrintHeader } from "@/components/report-print-header";
import type {
  AnalyteRow,
  ClinicRow,
  GroomingInput,
  GroomingRow,
  LabOrderRow,
  LabResultDetail,
  LabResultValueInput,
  LabTestRow,
  MedicalInput,
  MedicalRow,
  OpdConsultationInput,
  OpdConsultationRow,
  OpdMedicineRow,
  PetInput,
  VaccinationInput,
  VaccinationRow,
} from "@/lib/types";
import { canManageClinic } from "@/lib/permissions";
import { calculateAge } from "@/lib/date";

function PrintHeader({
  clinic,
  pet,
}: {
  clinic: ClinicRow | null;
  pet: PetInput & { card_id: string };
}) {
  return (
    <div className="print-header" style={{ marginBottom: "1.5rem" }}>
      <div className="opd-prescription-top">
        <div className="opd-logo">Pet Care Clinic</div>
        <div className="muted small">Card ID: {pet.card_id}</div>
      </div>
      <div
        style={{
          borderBottom: "1px solid #eee",
          paddingBottom: "0.5rem",
          marginBottom: "1.2rem",
          marginTop: "1rem",
        }}
      >
        <strong style={{ fontSize: "0.85rem" }}>
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
          <div style={{ marginTop: "1rem" }}>
            <p style={{ margin: 0, fontWeight: 500 }}>
              <strong>{clinic.name}</strong>
            </p>
            {clinic.address && (
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>
                <strong>Address:</strong> {clinic.address}
              </p>
            )}
            <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>
              {clinic.email && (
                <span style={{ marginRight: "1rem" }}>
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
          marginBottom: "1.5rem",
          borderBottom: "1px solid #eee",
          paddingBottom: "1.2rem",
        }}
      >
        <div>
          <strong
            style={{
              fontSize: "0.7rem",
              textTransform: "uppercase",
              color: "#666",
              display: "block",
              marginBottom: "4px",
            }}
          >
            Client Information
          </strong>
          <p style={{ margin: 0, fontWeight: 500 }}>{pet.owner_name}</p>
          {pet.owner_phone && (
            <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>
              {pet.owner_phone}
            </p>
          )}
        </div>
        <div>
          <strong
            style={{
              fontSize: "0.7rem",
              textTransform: "uppercase",
              color: "#666",
              display: "block",
              marginBottom: "4px",
            }}
          >
            Pet Information
          </strong>
          <p style={{ margin: 0, fontWeight: 500 }}>
            {pet.name}{" "}
            <span
              style={{ fontWeight: 400, fontSize: "0.8rem", color: "#666" }}
            >
              ({pet.card_id})
            </span>
          </p>
          <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>
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

type Tab =
  | "overview"
  | "medical"
  | "vaccinations"
  | "deworming"
  | "grooming"
  | "surgery"
  | "opd"
  | "radiology"
  | "ultrasonography"
  | "lab"
  | "lab_test";

export default function PetDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state } = useAuth();
  const canManage = state.status === "user" && canManageClinic(state.user.role);
  const [tab, setTab] = useState<Tab>("overview");
  const [pet, setPet] = useState<Awaited<
    ReturnType<typeof api.petsGet>
  > | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<PetInput | null>(null);

  const [medical, setMedical] = useState<
    Awaited<ReturnType<typeof api.medicalList>>
  >([]);
  const [clinic, setClinic] = useState<ClinicRow | null>(null);
  const [grooming, setGrooming] = useState<
    Awaited<ReturnType<typeof api.groomingList>>
  >([]);
  const [vax, setVax] = useState<
    Awaited<ReturnType<typeof api.vaccinationsList>>
  >([]);
  const [orders, setOrders] = useState<
    Awaited<ReturnType<typeof api.labOrdersForPet>>
  >([]);
  const [labTestMap, setLabTestMap] = useState<Record<string, string>>({});
  const [vaccineOptions, setVaccineOptions] = useState<string[]>([]);
  const [dewormOptions, setDewormOptions] = useState<string[]>([]);
  const [surgeryOptions, setSurgeryOptions] = useState<string[]>([]);
  const [opdHistory, setOpdHistory] = useState<
    Awaited<ReturnType<typeof api.opdConsultationsList>>
  >([]);
  const [selectedOpdHistory, setSelectedOpdHistory] = useState<
    Awaited<ReturnType<typeof api.opdConsultationsList>>[number] | null
  >(null);
  const [opdEdit, setOpdEdit] = useState<OpdConsultationRow | null>(null);
  const [opdEditForm, setOpdEditForm] = useState<OpdConsultationInput>({
    request_id: "",
    temperature: "",
    body_weight: "",
    diagnosis_note: "",
    differential_diagnosis_note: "",
    clinical_treatment_remark: "",
    recommended_food: "",
    next_visit_at: "",
    doctor_signature_name: "",
  });
  const [opdUpdateBusy, setOpdUpdateBusy] = useState(false);
  const [printingItem, setPrintingItem] = useState<any | null>(null);

  async function printSingleItem(item: any) {
    setPrintingItem(item);
    // Wait for DOM to update
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
    try {
      await appPrint();
    } finally {
      setPrintingItem(null);
    }
  }

  const [medForm, setMedForm] = useState<MedicalInput>({
    entry_type: "external_lab",
    title: "",
    body: "",
    dx_note: "",
    ddx_note: "",
    external_file_path: "",
  });
  const [groomForm, setGroomForm] = useState<GroomingInput>({
    service_type: "Nail clipping",
    performed_date: new Date().toISOString().slice(0, 10),
    administered_date: new Date().toISOString().slice(0, 10),
    next_due_date: "",
    reminder_days_before: 7,
    notes: "",
  });
  const [vaxForm, setVaxForm] = useState<VaccinationInput>({
    vaccine_name: "",
    administered_date: new Date().toISOString().slice(0, 10),
    next_due_date: "",
    reminder_days_before: 7,
    notes: "",
  });
  const [dewormForm, setDewormForm] = useState<MedicalInput>({
    entry_type: "deworming",
    title: "",
    administered_date: new Date().toISOString().slice(0, 10),
    next_due_date: "",
    reminder_days_before: 7,
    body: "",
  });
  const [surgeryName, setSurgeryName] = useState("");
  const [surgeryRemark, setSurgeryRemark] = useState("");
  const [surgeryDxNote, setSurgeryDxNote] = useState("");
  const [surgeryDdxNote, setSurgeryDdxNote] = useState("");
  const [radiologyItems, setRadiologyItems] = useState({
    paths: [] as string[],
    remark: "",
    dx_note: "",
    ddx_note: "",
  });
  const [ultraItems, setUltraItems] = useState({
    paths: [] as string[],
    remark: "",
    dx_note: "",
    ddx_note: "",
  });

  // Lab Test tab states
  const [labTests, setLabTests] = useState<LabTestRow[]>([]);
  const [labOrdersPending, setLabOrdersPending] = useState<LabOrderRow[]>([]);
  const [labOrderId, setLabOrderId] = useState("");
  const [labAnalytes, setLabAnalytes] = useState<AnalyteRow[]>([]);
  const [labValues, setLabValues] = useState<Record<string, string>>({});
  const [labNotes, setLabNotes] = useState("");
  const [labSavedReport, setLabSavedReport] = useState<Awaited<
    ReturnType<typeof api.labResultSave>
  > | null>(null);
  const [labTestId, setLabTestId] = useState("");
  const [labTentative, setLabTentative] = useState("");
  const [labTabErr, setLabTabErr] = useState<string | null>(null);
  const [lastLabOrder, setLastLabOrder] = useState<LabOrderRow | null>(null);
  const [lastLabOrderTestName, setLastLabOrderTestName] = useState("");

  const selectedLabOrder = labOrdersPending.find((x) => x.id === labOrderId);

  async function loadLabOrdersForPet(petId: string) {
    try {
      const o = await api.labOrdersForPet(petId);
      const pending = o.filter((x) => x.status === "pending");
      setLabOrdersPending(pending);
    } catch (e) {
      setLabTabErr(String(e));
    }
  }

  async function createLabOrder(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setLabTabErr(null);
    try {
      const order = await api.labOrderCreate({
        pet_id: id,
        lab_test_id: labTestId,
        tentative_report_at: labTentative || null,
      });
      await loadLabOrdersForPet(id);
      const t = labTests.find((x) => x.id === order.lab_test_id);
      setLastLabOrderTestName(t?.name ?? order.lab_test_id);
      setLastLabOrder(order);
      setLabOrderId(order.id);
      setLabTentative("");
    } catch (e) {
      setLabTabErr(String(e));
    }
  }

  async function saveLabReport(e: FormEvent) {
    e.preventDefault();
    if (!selectedLabOrder) return;
    setLabTabErr(null);
    const payload: LabResultValueInput[] = [];
    for (const a of labAnalytes) {
      const raw = labValues[a.id]?.trim();
      if (raw === "") {
        setLabTabErr(
          "Enter a value for each analyte or remove the test from the order.",
        );
        return;
      }
      payload.push({ analyte_id: a.id, observed_value: raw });
    }
    try {
      const res = await api.labResultSave(
        selectedLabOrder.id,
        payload,
        labNotes || null,
      );
      setLabSavedReport(res);
      await loadLabOrdersForPet(id!);
    } catch (e) {
      setLabTabErr(String(e));
    }
  }

  async function printLabReport() {
    setLabTabErr(null);
    try {
      await appPrint({ opdPrintMode: "case-tab" });
    } catch (e) {
      setLabTabErr(
        `Print failed: ${e instanceof Error ? e.message : String(e)}. Try “Save as HTML”.`,
      );
    }
  }

  function saveLabReportHtml() {
    if (!labSavedReport || !pet) return;
    const hasUnit = labSavedReport.values.some((v) => v.unit && v.unit.trim());
    const hasRange = labSavedReport.values.some(
      (v) => v.normal_min != null || v.normal_max != null,
    );
    const hasRemarks = labSavedReport.values.some(
      (v) => v.remarks && v.remarks.trim(),
    );

    const rows = labSavedReport.values
      .map((v) => {
        const h = valueHighlight(v.observed_value, v.normal_min, v.normal_max);
        const flag = h === "low" ? " (low)" : h === "high" ? " (high)" : "";
        return `<tr>
          <td>${escapeHtml(v.analyte_name)}</td>
          ${hasUnit ? `<td>${escapeHtml(v.unit ?? "—")}</td>` : ""}
          ${hasRange ? `<td>${v.normal_min ?? "—"} – ${v.normal_max ?? "—"}</td>` : ""}
          <td><strong>${v.observed_value}</strong>${escapeHtml(flag)}</td>
          ${hasRemarks ? `<td>${escapeHtml(v.remarks ?? "—")}</td>` : ""}
        </tr>`;
      })
      .join("\n");
    const notesBlock = labSavedReport.notes
      ? `<p><strong>Notes:</strong> ${escapeHtml(labSavedReport.notes)}</p>`
      : "";
    const body = `
    <h1>Laboratory report</h1>
    <p><strong>Pet:</strong> ${escapeHtml(pet.name)}</p>
    <p><strong>Date:</strong> ${escapeHtml(new Date(labSavedReport.created_at).toLocaleString())}</p>
    ${notesBlock}
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:40rem">
      <thead><tr>
        <th>Analyte</th>
        ${hasUnit ? "<th>Unit</th>" : ""}
        ${hasRange ? "<th>Reference</th>" : ""}
        <th>Result</th>
        ${hasRemarks ? "<th>Value</th>" : ""}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    `;
    downloadHtmlFile(
      `lab-report-${labSavedReport.id.slice(0, 8)}.html`,
      "Laboratory report",
      body,
    );
  }

  async function printLabReceipt() {
    setLabTabErr(null);
    try {
      await appPrint({ opdPrintMode: "case-tab" });
    } catch (e) {
      setLabTabErr(
        `Print failed: ${e instanceof Error ? e.message : String(e)}. Try “Save as HTML”.`,
      );
    }
  }

  function saveLabReceiptHtml() {
    if (!lastLabOrder || !pet) return;
    const petLine = `${escapeHtml(pet.name)} (${escapeHtml(pet.species ?? "—")})`;
    const ownerLine = pet.owner_name ? escapeHtml(pet.owner_name) : "—";
    const testLine = escapeHtml(
      lastLabOrderTestName || lastLabOrder.lab_test_id,
    );
    const tent = lastLabOrder.tentative_report_at
      ? new Date(lastLabOrder.tentative_report_at).toLocaleString()
      : "—";
    const ordered = new Date(lastLabOrder.created_at).toLocaleString();
    const body = `
    <h1>Pet Care Clinic — Lab receipt</h1>
    <p><strong>Receipt:</strong> ${escapeHtml(lastLabOrder.receipt_number ?? "")}</p>
    <p><strong>Pet:</strong> ${petLine}</p>
    <p><strong>Owner:</strong> ${ownerLine}</p>
    <p><strong>Test:</strong> ${testLine}</p>
    <p><strong>Tentative report:</strong> ${escapeHtml(tent)}</p>
    <p class="muted">Ordered: ${escapeHtml(ordered)}</p>
    `;
    const safeName = (lastLabOrder.receipt_number ?? "receipt").replace(
      /[^\w.-]+/g,
      "_",
    );
    downloadHtmlFile(`lab-receipt-${safeName}.html`, "Lab receipt", body);
  }

  function resetLabReportForm() {
    setLabSavedReport(null);
    setLabNotes("");
    setLabOrderId("");
    setLastLabOrder(null);
  }

  async function fileToDataUrl(file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function canPreviewImage(path: string | null | undefined): path is string {
    if (!path) return false;
    if (path.startsWith("data:image/")) return true;
    return /^https?:\/\//i.test(path);
  }

  const [medicalEdit, setMedicalEdit] = useState<MedicalRow | null>(null);
  const [medicalEditForm, setMedicalEditForm] = useState<MedicalInput>({
    entry_type: "external_lab",
    title: "",
    body: "",
    external_file_path: "",
  });
  const [vaccinationEdit, setVaccinationEdit] = useState<VaccinationRow | null>(
    null,
  );
  const [vaccinationEditForm, setVaccinationEditForm] =
    useState<VaccinationInput>({
      vaccine_name: "",
      administered_date: new Date().toISOString().slice(0, 10),
      next_due_date: "",
      reminder_days_before: 7,
      notes: "",
    });
  const [groomingEdit, setGroomingEdit] = useState<GroomingRow | null>(null);
  const [groomingEditForm, setGroomingEditForm] = useState<GroomingInput>({
    service_type: "",
    administered_date: "",
    next_due_date: "",
    reminder_days_before: 7,
    performed_date: "",
    notes: "",
  });
  const [labModal, setLabModal] = useState<{
    resultId: string;
    detail: LabResultDetail | null;
    notes: string;
    values: Record<string, string>;
    readOnly: boolean;
    testName: string;
    petName: string;
  } | null>(null);
  const [labModalShowHistory, setLabModalShowHistory] = useState(false);
  const [labModalHistoryData, setLabModalHistoryData] = useState<{
    dates: string[];
    rows: HistoryRow[];
  } | null>(null);

  async function loadAll() {
    if (!id) return;
    setErr(null);
    try {
      const p = await api.petsGet(id);
      setPet(p);
      setEdit({
        name: p.name,
        species: p.species,
        breed: p.breed,
        age: p.age,
        date_of_birth: p.date_of_birth,
        sex: p.sex,
        weight: p.weight,
        vaccine_status: p.vaccine_status,
        deworming_status: p.deworming_status,
        owner_name: p.owner_name,
        owner_phone: p.owner_phone,
        owner_address: p.owner_address,
        owner_email: p.owner_email,
        notes: p.notes,
      });
      setMedical(await api.medicalList(id));
      setGrooming(await api.groomingList(id));
      setVax(await api.vaccinationsList(id));
      setOrders(await api.labOrdersForPet(id));
      setOpdHistory(await api.opdConsultationsList(id));
      const labTests = (await api.labTestsList()) as LabTestRow[];
      setLabTestMap(Object.fromEntries(labTests.map((t) => [t.id, t.name])));
      setClinic(await api.clinicGet());
      setVaccineOptions(
        (await api.opdCatalogList("vaccine")).map((x) => x.name),
      );
      setDewormOptions(
        (await api.opdCatalogList("deworming")).map((x) => x.name),
      );
      setSurgeryOptions(
        (await api.opdCatalogList("surgery")).map((x) => x.name),
      );
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    loadAll();
  }, [id]);

  useEffect(() => {
    const t = searchParams.get("tab");
    if (
      t === "overview" ||
      t === "medical" ||
      t === "deworming" ||
      t === "surgery" ||
      t === "grooming" ||
      t === "vaccinations" ||
      t === "radiology" ||
      t === "ultrasonography" ||
      t === "lab" ||
      t === "lab_test" ||
      t === "opd"
    ) {
      setTab(t);
    }
  }, [searchParams]);

  function goTab(next: Tab) {
    setTab(next);
    router.replace(`/pets/${id}?tab=${next}`, { scroll: false });
  }

  async function savePet(e: FormEvent) {
    e.preventDefault();
    if (!id || !edit) return;
    setErr(null);
    try {
      const p = await api.petsUpdate(id, edit);
      setPet(p);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function addMedical(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setErr(null);
    try {
      await api.medicalAdd(id, {
        ...medForm,
        external_file_path: medForm.external_file_path || null,
      });
      setMedForm({
        entry_type: "external_lab",
        title: "",
        body: "",
        dx_note: "",
        ddx_note: "",
        external_file_path: "",
      });
      setMedical(await api.medicalList(id));
    } catch (e) {
      setErr(String(e));
    }
  }

  async function addGroom(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setErr(null);
    try {
      await api.groomingAdd(id, groomForm);
      setGroomForm({
        service_type: "Nail clipping",
        performed_date: new Date().toISOString().slice(0, 10),
        administered_date: new Date().toISOString().slice(0, 10),
        next_due_date: "",
        reminder_days_before: 7,
        notes: "",
      });
      setGrooming(await api.groomingList(id));
    } catch (e) {
      setErr(String(e));
    }
  }

  async function addVax(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setErr(null);
    try {
      await api.vaccinationsUpsert(id, {
        ...vaxForm,
        next_due_date: vaxForm.next_due_date || null,
      });
      setVax(await api.vaccinationsList(id));
      setVaxForm({
        vaccine_name: "",
        administered_date: new Date().toISOString().slice(0, 10),
        next_due_date: "",
        reminder_days_before: 7,
        notes: "",
      });
      if (vaxForm.vaccine_name.trim()) {
        await api
          .opdCatalogCreate("vaccine", vaxForm.vaccine_name.trim())
          .catch(() => undefined);
        setVaccineOptions(
          (await api.opdCatalogList("vaccine")).map((x) => x.name),
        );
      }
    } catch (e) {
      setErr(String(e));
    }
  }

  function startEditVaccination(v: VaccinationRow) {
    setVaccinationEdit(v);
    setVaccinationEditForm({
      vaccine_name: v.vaccine_name,
      administered_date:
        v.administered_date ?? new Date().toISOString().slice(0, 10),
      next_due_date: v.next_due_date ?? "",
      reminder_days_before: v.reminder_days_before ?? 7,
      notes: v.notes ?? "",
    });
  }

  async function saveVaccinationEdit(e: FormEvent) {
    e.preventDefault();
    if (!id || !vaccinationEdit) return;
    setErr(null);
    try {
      await api.vaccinationsUpsert(
        id,
        {
          ...vaccinationEditForm,
          next_due_date: vaccinationEditForm.next_due_date || null,
        },
        vaccinationEdit.id,
      );
      setVaccinationEdit(null);
      setVax(await api.vaccinationsList(id));
      if (vaccinationEditForm.vaccine_name.trim()) {
        await api
          .opdCatalogCreate("vaccine", vaccinationEditForm.vaccine_name.trim())
          .catch(() => undefined);
        setVaccineOptions(
          (await api.opdCatalogList("vaccine")).map((x) => x.name),
        );
      }
    } catch (e) {
      setErr(String(e));
    }
  }

  async function deleteVaccination(v: VaccinationRow) {
    if (!id) return;
    if (!confirm("Delete this vaccination record?")) return;
    setErr(null);
    try {
      await api.vaccinationsDelete(id, v.id);
      setVax(await api.vaccinationsList(id));
    } catch (e) {
      setErr(String(e));
    }
  }

  async function addDeworming(e: FormEvent) {
    e.preventDefault();
    if (!dewormForm.title?.trim()) return;
    setErr(null);
    try {
      await api.medicalAdd(id, {
        ...dewormForm,
        title: dewormForm.title.trim(),
        next_due_date: dewormForm.next_due_date || null,
        body:
          dewormForm.body ||
          `Deworming performed by ${state.status === "user" ? state.user.display_name : "staff"}`,
      });
      await api
        .opdCatalogCreate("deworming", dewormForm.title.trim())
        .catch(() => undefined);
      setDewormOptions(
        (await api.opdCatalogList("deworming")).map((x) => x.name),
      );
      setDewormForm({
        entry_type: "deworming",
        title: "",
        administered_date: new Date().toISOString().slice(0, 10),
        next_due_date: "",
        reminder_days_before: 7,
        body: "",
      });
      setMedical(await api.medicalList(id));
    } catch (e) {
      setErr(String(e));
    }
  }

  async function addSurgery(e: FormEvent) {
    e.preventDefault();
    if (!surgeryName.trim()) return;
    setErr(null);
    try {
      await api.medicalAdd(id, {
        entry_type: "surgery",
        title: surgeryName.trim(),
        body: surgeryRemark.trim() || null,
        dx_note: surgeryDxNote.trim() || null,
        ddx_note: surgeryDdxNote.trim() || null,
      });
      await api
        .opdCatalogCreate("surgery", surgeryName.trim())
        .catch(() => undefined);
      setSurgeryOptions(
        (await api.opdCatalogList("surgery")).map((x) => x.name),
      );
      setSurgeryName("");
      setSurgeryRemark("");
      setSurgeryDxNote("");
      setSurgeryDdxNote("");
      setMedical(await api.medicalList(id));
    } catch (e) {
      setErr(String(e));
    }
  }

  async function addImagingRecords(
    section: "radiology" | "ultrasonography",
    data: {
      paths: string[];
      remark: string;
      dx_note: string;
      ddx_note: string;
    },
  ) {
    setErr(null);
    try {
      const validPaths = data.paths.filter((p) => p.trim());
      if (validPaths.length === 0) return;
      await api.medicalAdd(id, {
        entry_type: section,
        title:
          section === "radiology"
            ? "Radiology report"
            : "Ultrasonography report",
        body: data.remark.trim() || null,
        dx_note: data.dx_note.trim() || null,
        ddx_note: data.ddx_note.trim() || null,
        external_file_path: validPaths[0],
        external_file_paths: validPaths,
      });
      setMedical(await api.medicalList(id));
    } catch (e) {
      setErr(String(e));
    }
  }

  async function onDelete() {
    if (!id || !pet || !canManage) return;
    if (!confirm(`Delete ${pet.name}?`)) return;
    setErr(null);
    try {
      await api.petsDelete(id);
      router.push("/pets");
    } catch (e) {
      setErr(String(e));
    }
  }

  function startEditMedical(m: MedicalRow) {
    setMedicalEdit(m);
    setMedicalEditForm({
      entry_type: m.entry_type,
      title: m.title ?? "",
      body: m.body ?? "",
      body_weight: m.body_weight ?? "",
      dx_note: m.dx_note ?? "",
      ddx_note: m.ddx_note ?? "",
      dx_items: m.dx_items ?? [],
      ddx_items: m.ddx_items ?? [],
      administered_date: m.administered_date ?? "",
      next_due_date: m.next_due_date ?? "",
      reminder_days_before: m.reminder_days_before ?? 7,
      external_file_path: m.external_file_path ?? "",
      external_file_paths: m.external_file_paths ?? [],
    });
  }

  async function saveMedicalEdit(e: FormEvent) {
    e.preventDefault();
    if (!id || !medicalEdit) return;
    setErr(null);
    try {
      await api.medicalUpdate(id, medicalEdit.id, {
        ...medicalEditForm,
        external_file_path: medicalEditForm.external_file_path || null,
      });
      setMedicalEdit(null);
      setMedical(await api.medicalList(id));
    } catch (e) {
      setErr(String(e));
    }
  }

  async function deleteMedicalEntry(m: MedicalRow) {
    if (!id) return;
    if (!confirm("Remove this history entry?")) return;
    setErr(null);
    try {
      await api.medicalDelete(id, m.id);
      setMedicalEdit(null);
      setMedical(await api.medicalList(id));
      setLabModal(null);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function openLabModal(
    resultId: string,
    readOnly: boolean,
    knownTestName?: string,
    knownPetName?: string,
  ) {
    setErr(null);
    setLabModalShowHistory(false);
    setLabModalHistoryData(null);
    setLabModal({
      resultId,
      detail: null,
      notes: "",
      values: {},
      readOnly,
      testName: knownTestName ?? "",
      petName: knownPetName ?? "",
    });
    try {
      const detail = await api.labResultGet(resultId);
      const historyDetails = (await api.labResultsForHistory(
        detail.pet_id,
        detail.lab_test_id,
      )) as LabResultDetail[];
      const vals: Record<string, string> = {};
      if (Array.isArray(detail.values)) {
        detail.values.forEach((v) => {
          vals[v.id] = String(v.observed_value);
        });
      }
      const resolvedTestName =
        knownTestName ?? labTestMap[detail.lab_test_id] ?? detail.lab_test_id;
      setLabModal({
        resultId,
        detail,
        notes: detail.notes ?? "",
        values: vals,
        readOnly,
        testName: resolvedTestName,
        petName: knownPetName ?? pet?.name ?? "",
      });
      setLabModalHistoryData(transformToHistory(historyDetails));
    } catch (e) {
      setErr(String(e));
      setLabModal(null);
    }
  }

  function downloadLabReportCurrent() {
    if (!labModal?.detail) return;
    downloadLabReportHtml(labModal.detail, labModal.petName, labModal.testName);
  }

  async function printLabModal() {
    setErr(null);
    try {
      await appPrint();
    } catch (e) {
      setErr(
        `Print failed: ${e instanceof Error ? e.message : String(e)}. Try Download HTML.`,
      );
    }
  }

  async function saveLabModal(e: FormEvent) {
    e.preventDefault();
    if (!labModal?.detail || !id || labModal.readOnly) return;
    setErr(null);
    try {
      const patches = labModal.detail.values.map((v) => ({
        id: v.id,
        observedValue: String(labModal.values[v.id] ?? ""),
      }));
      // Numeric validation removed to support text-based results.
      await api.labResultUpdate(
        labModal.resultId,
        patches,
        labModal.notes || null,
      );
      setLabModal(null);
      setMedical(await api.medicalList(id));
    } catch (e) {
      setErr(String(e));
    }
  }

  function startEditGrooming(g: GroomingRow) {
    setGroomingEdit(g);
    setGroomingEditForm({
      service_type: g.service_type,
      administered_date: g.administered_date ?? "",
      next_due_date: g.next_due_date ?? "",
      reminder_days_before: g.reminder_days_before ?? 7,
      performed_date: g.performed_date,
      notes: g.notes,
    });
  }

  async function saveGroomingEdit(e: FormEvent) {
    e.preventDefault();
    if (!id || !groomingEdit) return;
    setErr(null);
    try {
      await api.groomingUpdate(id, groomingEdit.id, groomingEditForm);
      setGroomingEdit(null);
      setGrooming(await api.groomingList(id));
    } catch (e) {
      setErr(String(e));
    }
  }

  async function deleteGroomingEntry(g: GroomingRow) {
    if (!id) return;
    if (!confirm("Delete this grooming entry?")) return;
    setErr(null);
    try {
      await api.groomingDelete(id, g.id);
      setGroomingEdit(null);
      setGrooming(await api.groomingList(id));
    } catch (e) {
      setErr(String(e));
    }
  }

  async function deleteOpdHistoryEntry(entryId: string) {
    setErr(null);
    try {
      await api.opdConsultationDelete(entryId);
      setOpdHistory(await api.opdConsultationsList(id));
      setSelectedOpdHistory((prev) => (prev?.id === entryId ? null : prev));
    } catch (e) {
      setErr(String(e));
    }
  }

  function startEditOpd(h: OpdConsultationRow) {
    setOpdEdit(h);
    setOpdEditForm({
      request_id: h.request_id,
      temperature: h.temperature ?? "",
      body_weight: h.body_weight ?? "",
      diagnosis_note: h.diagnosis_note ?? "",
      differential_diagnosis_note: h.differential_diagnosis_note ?? "",
      clinical_treatment_remark: h.clinical_treatment_remark ?? "",
      recommended_food: h.recommended_food ?? "",
      next_visit_at: h.next_visit_at ?? "",
      doctor_signature_name: h.doctor_signature_name,
      history_observations: h.history_observations,
      dx_items: h.dx_items,
      ddx_items: h.ddx_items,
      symptoms: h.symptoms,
      recommended_lab_test_ids: h.recommended_lab_test_ids,
      custom_lab_tests: h.custom_lab_tests,
      medicines: h.medicines.map((m: OpdMedicineRow) => ({
        name: m.name,
        dosage: m.dosage,
        direction_per_day: m.direction_per_day,
      })),
    });
  }

  async function saveOpdEdit(e: FormEvent) {
    e.preventDefault();
    if (!id || !opdEdit) return;
    setErr(null);
    try {
      await api.opdConsultationUpdate(opdEdit.id, opdEditForm);
      setOpdEdit(null);
      const updatedHistory = await api.opdConsultationsList(id);
      setOpdHistory(updatedHistory);
      if (selectedOpdHistory?.id === opdEdit.id) {
        setSelectedOpdHistory(
          updatedHistory.find((x) => x.id === opdEdit.id) ?? null,
        );
      }
    } catch (e) {
      setErr(String(e));
    }
  }

  async function reopenSelectedOpdCase() {
    if (!selectedOpdHistory) return;
    setErr(null);
    try {
      await api.opdRequestReopen(selectedOpdHistory.request_id);
      await loadAll();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function updateSelectedOpdCase() {
    if (!selectedOpdHistory) return;
    setErr(null);
    setOpdUpdateBusy(true);
    try {
      const input: OpdConsultationInput = {
        request_id: selectedOpdHistory.request_id,
        doctor_signature_name: selectedOpdHistory.doctor_signature_name,
        temperature: selectedOpdHistory.temperature,
        history_observations: selectedOpdHistory.history_observations,
        dx_items: selectedOpdHistory.dx_items,
        ddx_items: selectedOpdHistory.ddx_items,
        diagnosis_note: selectedOpdHistory.diagnosis_note,
        differential_diagnosis_note:
          selectedOpdHistory.differential_diagnosis_note,
        symptoms: selectedOpdHistory.symptoms,
        recommended_lab_test_ids: selectedOpdHistory.recommended_lab_test_ids,
        custom_lab_tests: selectedOpdHistory.custom_lab_tests,
        medicines: selectedOpdHistory.medicines,
        clinical_treatment_remark: selectedOpdHistory.clinical_treatment_remark,
        in_house_prescription: selectedOpdHistory.in_house_prescription,
        recommended_food: selectedOpdHistory.recommended_food,
        next_visit_at: selectedOpdHistory.next_visit_at,
      };
      await api.opdConsultationUpdate(selectedOpdHistory.id, input);
      await loadAll();
    } catch (e) {
      setErr(String(e));
    } finally {
      setOpdUpdateBusy(false);
    }
  }

  useEffect(() => {
    async function loadTests() {
      try {
        setLabTests(await api.labTestsList());
      } catch (e) {
        setErr(String(e));
      }
    }
    void loadTests();
  }, []);

  useEffect(() => {
    if (tab === "lab_test" && id) {
      void loadLabOrdersForPet(id);
    }
  }, [tab, id]);

  useEffect(() => {
    if (selectedLabOrder) {
      setLabAnalytes([]);
      setLabValues({});
      setLabTabErr(null);
      void api
        .labAnalytesList(selectedLabOrder.lab_test_id)
        .then(setLabAnalytes)
        .catch((e) => setLabTabErr(String(e)));
    } else {
      setLabAnalytes([]);
      setLabValues({});
    }
  }, [labOrderId]);

  useEffect(() => {
    if (tab === "lab_test") {
      setLabTabErr(null);
    }
  }, [tab]);

  if (!id) return null;
  if (!pet || !edit) {
    return (
      <div className="page">
        <p>{err ?? "Loading…"}</p>
      </div>
    );
  }

  return (
    <div className="page pet-detail-page">
      <div className="page-head no-print">
        <div>
          <Link href="/pets" className="muted no-print">
            ← Pets
          </Link>
          <h1>{pet.name}</h1>
          <p className="muted small">
            Card ID: <code>{pet.card_id}</code>
          </p>
        </div>
        <div className="actions">
          <Link
            href={`/pets?add_for_phone=${encodeURIComponent(pet.owner_phone ?? "")}&add_for_name=${encodeURIComponent(pet.owner_name ?? "")}&add_for_address=${encodeURIComponent(pet.owner_address ?? "")}&add_for_email=${encodeURIComponent(pet.owner_email ?? "")}`}
            className="btn primary no-print"
          >
            + Add another pet for this owner
          </Link>
          {canManage && (
            <button
              type="button"
              className="btn danger ghost no-print"
              onClick={onDelete}
            >
              Delete pet
            </button>
          )}
        </div>
      </div>
      {err && <p className="error">{err}</p>}

      <div className="tabs no-print">
        {(
          [
            ["overview", "Profile"],
            ["medical", "Medical & lab history"],
            ["vaccinations", "Vaccinations"],
            ["deworming", "Deworming"],
            ["grooming", "Grooming"],
            ["surgery", "Surgery"],
            ["opd", "OPD"],
            ["radiology", "Radiology"],
            ["ultrasonography", "Ultrasonography"],
            ["lab", "Lab orders"],
            ["lab_test", "Lab Test"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`tab ${tab === k ? "active" : ""}`}
            onClick={() => goTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div
          className={`card print-area ${printingItem || labModal ? "no-print" : ""}`}
        >
          <div className="row-actions no-print">
            <button
              type="button"
              className="btn primary"
              onClick={() => void appPrint()}
            >
              Print profile
            </button>
          </div>
          <div className="only-print">
            <h2
              style={{
                textAlign: "center",
                textTransform: "uppercase",
                marginBottom: "1.5rem",
              }}
            >
              Pet profile
            </h2>
            <PrintHeader
              clinic={clinic}
              pet={{ ...edit!, card_id: pet.card_id }}
            />
          </div>
          <form onSubmit={savePet}>
            <h2 className="no-print">Profile</h2>
            <div className="grid2">
              <label>
                Name *
                <input
                  required
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </label>
              <label>
                Species
                <input
                  required
                  value={edit.species ?? ""}
                  onChange={(e) =>
                    setEdit({ ...edit, species: e.target.value || null })
                  }
                />
              </label>
              <label>
                Breed
                <input
                  value={edit.breed ?? ""}
                  onChange={(e) =>
                    setEdit({ ...edit, breed: e.target.value || null })
                  }
                />
              </label>
              <label>
                Date of Birth
                <input
                  type="date"
                  value={edit.date_of_birth ?? ""}
                  onChange={(e) =>
                    setEdit({ ...edit, date_of_birth: e.target.value || null })
                  }
                />
              </label>
              <label>
                Weight
                <input
                  value={edit.weight ?? ""}
                  onChange={(e) =>
                    setEdit({ ...edit, weight: e.target.value || null })
                  }
                />
              </label>
              <label>
                Sex
                <select
                  value={edit.sex ?? "Unknown"}
                  onChange={(e) =>
                    setEdit({ ...edit, sex: e.target.value || null })
                  }
                >
                  <option>Male</option>
                  <option>Female</option>
                  <option>Unknown</option>
                </select>
              </label>
              <label>
                Vaccine status
                <select
                  value={edit.vaccine_status ?? "No"}
                  onChange={(e) =>
                    setEdit({ ...edit, vaccine_status: e.target.value || null })
                  }
                >
                  <option>Yes</option>
                  <option>No</option>
                  <option>Due</option>
                </select>
              </label>
              <label>
                Deworming status
                <select
                  value={edit.deworming_status ?? "No"}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      deworming_status: e.target.value || null,
                    })
                  }
                >
                  <option>Yes</option>
                  <option>No</option>
                  <option>Due</option>
                </select>
              </label>
              <label>
                Owner name
                <input
                  required
                  value={edit.owner_name ?? ""}
                  onChange={(e) =>
                    setEdit({ ...edit, owner_name: e.target.value || null })
                  }
                />
              </label>
              <label>
                Owner phone
                <input
                  required
                  value={edit.owner_phone ?? ""}
                  onChange={(e) =>
                    setEdit({ ...edit, owner_phone: e.target.value || null })
                  }
                />
              </label>
              <label>
                Owner address
                <input
                  value={edit.owner_address ?? ""}
                  onChange={(e) =>
                    setEdit({ ...edit, owner_address: e.target.value || null })
                  }
                />
              </label>
              <label>
                Owner email
                <input
                  value={edit.owner_email ?? ""}
                  onChange={(e) =>
                    setEdit({ ...edit, owner_email: e.target.value || null })
                  }
                />
              </label>
            </div>
            <label>
              Notes
              <textarea
                rows={4}
                value={edit.notes ?? ""}
                onChange={(e) =>
                  setEdit({ ...edit, notes: e.target.value || null })
                }
              />
            </label>
            <button type="submit" className="btn primary no-print">
              Save changes
            </button>
          </form>
        </div>
      )}

      {tab === "medical" && (
        <div className="stack">
          <div
            className={`card print-area ${printingItem || labModal ? "no-print" : ""}`}
          >
            <div className="row-actions no-print">
              <button
                type="button"
                className="btn primary"
                onClick={() => void appPrint()}
              >
                Print medical history
              </button>
            </div>
            <div className="only-print">
              <h2
                style={{
                  textAlign: "center",
                  textTransform: "uppercase",
                  marginBottom: "1.5rem",
                }}
              >
                Medical & laboratory history
              </h2>
              <PrintHeader
                clinic={clinic}
                pet={{ ...edit!, card_id: pet.card_id }}
              />
            </div>
            <h2 className="no-print">Medical & laboratory history</h2>
            <p className="muted no-print">
              Laboratory reports created from{" "}
              <Link href="/reports">Generate lab report</Link> appear here.{" "}
              <strong>All staff</strong> can open <strong>View report</strong>{" "}
              to see results. Grooming is on the Grooming tab.{" "}
              {canManage && (
                <span>
                  Staff can also edit entry text, correct lab values, and remove
                  entries.
                </span>
              )}
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Title</th>
                  <th>Details</th>
                  <th className="right no-print">Actions</th>
                </tr>
              </thead>
              <tbody>
                {medical.map((m) => {
                  const canEditMeta = !m.lab_result_id || canManage;
                  const canDelete = !m.lab_result_id || canManage;
                  return (
                    <tr key={m.id}>
                      <td>{new Date(m.created_at).toLocaleString()}</td>
                      <td>{m.entry_type}</td>
                      <td>{m.title ?? "—"}</td>
                      <td
                        style={{
                          maxWidth: "300px",
                          wordBreak: "break-word",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {m.dx_note && (
                          <div className="small">
                            <strong>Dx:</strong> {m.dx_note}
                          </div>
                        )}
                        {m.ddx_note && (
                          <div className="small">
                            <strong>D.D:</strong> {m.ddx_note}
                          </div>
                        )}
                        <div className="small">
                          <strong>Remarks:</strong> {m.body ?? "—"}
                        </div>
                        {(m.dx_items?.length ?? 0) > 0 && (
                          <div className="small">
                            <strong>Catalog Dx:</strong>{" "}
                            {m.dx_items?.join(", ")}
                          </div>
                        )}
                        {(m.ddx_items?.length ?? 0) > 0 && (
                          <div className="small">
                            <strong>Catalog D.D:</strong>{" "}
                            {m.ddx_items?.join(", ")}
                          </div>
                        )}
                        {m.external_file_path && (
                          <div className="small">
                            {!canPreviewImage(m.external_file_path) && (
                              <>File: {m.external_file_path}</>
                            )}
                            {canPreviewImage(m.external_file_path) && (
                              <div style={{ marginTop: 6 }}>
                                <img
                                  src={m.external_file_path}
                                  alt="Attachment preview"
                                  style={{ maxWidth: 160 }}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="right nowrap">
                        {canEditMeta && (
                          <button
                            type="button"
                            className="btn ghost small"
                            onClick={() => startEditMedical(m)}
                          >
                            Edit
                          </button>
                        )}
                        {m.lab_result_id && (
                          <button
                            type="button"
                            className="btn ghost small"
                            onClick={() =>
                              void openLabModal(m.lab_result_id!, true)
                            }
                          >
                            View report
                          </button>
                        )}
                        {canManage && m.lab_result_id && (
                          <button
                            type="button"
                            className="btn primary small"
                            onClick={() =>
                              void openLabModal(m.lab_result_id!, false)
                            }
                          >
                            Edit values
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="btn danger ghost small"
                            onClick={() => void deleteMedicalEntry(m)}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {medical.length === 0 && <p className="muted">No entries yet.</p>}
          </div>

          <form className="card no-print" onSubmit={addMedical}>
            <h3>Add outside lab report reference</h3>
            <label>
              Title
              <input
                value={medForm.title ?? ""}
                onChange={(e) =>
                  setMedForm({ ...medForm, title: e.target.value })
                }
              />
            </label>
            <div className="grid2">
              <label>
                Dx
                <input
                  value={medForm.dx_note ?? ""}
                  onChange={(e) =>
                    setMedForm({ ...medForm, dx_note: e.target.value })
                  }
                />
              </label>
              <label>
                D.D
                <input
                  value={medForm.ddx_note ?? ""}
                  onChange={(e) =>
                    setMedForm({ ...medForm, ddx_note: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              Notes
              <textarea
                rows={3}
                value={medForm.body ?? ""}
                onChange={(e) =>
                  setMedForm({ ...medForm, body: e.target.value })
                }
              />
            </label>
            <label>
              File path (optional)
              <input
                placeholder="/path/to/report.pdf"
                value={medForm.external_file_path ?? ""}
                onChange={(e) =>
                  setMedForm({
                    ...medForm,
                    external_file_path: e.target.value,
                  })
                }
              />
            </label>
            <button type="submit" className="btn primary">
              Add to history
            </button>
          </form>
        </div>
      )}

      {tab === "grooming" && (
        <div className="stack">
          <div className={`card ${printingItem ? "no-print" : ""}`}>
            <h2>Grooming log</h2>
            <p className="muted small">
              Nail trims, baths, and other grooming — separate from medical/lab
              records.
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Performed</th>
                  <th>Given</th>
                  <th>Next due</th>
                  <th>Remind (days)</th>
                  <th>Notes</th>
                  <th className="right no-print">Actions</th>
                </tr>
              </thead>
              <tbody>
                {grooming.map((g) => (
                  <tr key={g.id}>
                    <td>{g.service_type}</td>
                    <td>{g.performed_date}</td>
                    <td>{g.administered_date ?? "—"}</td>
                    <td>{g.next_due_date ?? "—"}</td>
                    <td>{g.reminder_days_before ?? "—"}</td>
                    <td>{g.notes ?? "—"}</td>
                    <td className="right nowrap no-print">
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => void printSingleItem(g)}
                      >
                        Print
                      </button>
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => startEditGrooming(g)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn danger ghost small"
                        onClick={() => void deleteGroomingEntry(g)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {grooming.length === 0 && (
              <p className="muted">No grooming entries yet.</p>
            )}
          </div>
          <form className="card no-print" onSubmit={addGroom}>
            <h3>Add grooming</h3>
            <div className="grid2">
              <label>
                Service *
                <input
                  required
                  value={groomForm.service_type}
                  onChange={(e) =>
                    setGroomForm({ ...groomForm, service_type: e.target.value })
                  }
                />
              </label>
              <label>
                Performed *
                <input
                  type="date"
                  required
                  value={groomForm.performed_date}
                  onChange={(e) =>
                    setGroomForm({
                      ...groomForm,
                      performed_date: e.target.value,
                    })
                  }
                />
              </label>
            </div>
            <div className="grid2">
              <label>
                Given date
                <input
                  type="date"
                  value={groomForm.administered_date ?? ""}
                  onChange={(e) =>
                    setGroomForm({
                      ...groomForm,
                      administered_date: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Due date
                <input
                  type="date"
                  value={groomForm.next_due_date ?? ""}
                  onChange={(e) =>
                    setGroomForm({
                      ...groomForm,
                      next_due_date: e.target.value,
                    })
                  }
                />
              </label>
            </div>
            <label>
              Reminder (days before)
              <input
                type="number"
                value={groomForm.reminder_days_before ?? ""}
                onChange={(e) =>
                  setGroomForm({
                    ...groomForm,
                    reminder_days_before: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Notes
              <textarea
                rows={2}
                value={groomForm.notes ?? ""}
                onChange={(e) =>
                  setGroomForm({ ...groomForm, notes: e.target.value || null })
                }
              />
            </label>
            <button type="submit" className="btn primary">
              Save grooming
            </button>
          </form>
        </div>
      )}

      {tab === "surgery" && (
        <div className="stack">
          <div className={`card print-area ${printingItem ? "no-print" : ""}`}>
            <div className="row-actions no-print">
              <button
                type="button"
                className="btn primary"
                onClick={() => void appPrint()}
              >
                Print surgery report
              </button>
            </div>

            <div className="only-print">
              <h2
                style={{
                  textAlign: "center",
                  textTransform: "uppercase",
                  marginBottom: "1.5rem",
                }}
              >
                Surgery Report
              </h2>
              <PrintHeader
                clinic={clinic}
                pet={{ ...edit!, card_id: pet.card_id }}
              />
            </div>

            <h2 className="no-print">Surgery history</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Surgery</th>
                  <th>Details</th>
                  <th className="right no-print">Actions</th>
                </tr>
              </thead>
              <tbody>
                {medical
                  .filter((m) => m.entry_type === "surgery")
                  .map((m) => (
                    <tr key={m.id}>
                      <td style={{ verticalAlign: "top" }}>
                        {new Date(m.created_at).toLocaleString()}
                      </td>
                      <td style={{ verticalAlign: "top" }}>{m.title ?? "—"}</td>
                      <td style={{ verticalAlign: "top" }}>
                        <div
                          style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {m.dx_note && (
                            <div style={{ marginBottom: "0.5rem" }}>
                              <strong>Dx:</strong> {m.dx_note}
                            </div>
                          )}
                          {m.ddx_note && (
                            <div style={{ marginBottom: "0.5rem" }}>
                              <strong>D.D:</strong> {m.ddx_note}
                            </div>
                          )}
                          <div style={{ marginBottom: "0.5rem" }}>
                            <strong>Remarks:</strong> {m.body ?? "—"}
                          </div>
                        </div>

                        {(m.dx_items?.length ?? 0) > 0 && (
                          <div className="small muted">
                            Catalog Dx: {m.dx_items?.join(", ")}
                          </div>
                        )}
                        {(m.ddx_items?.length ?? 0) > 0 && (
                          <div className="small muted">
                            Catalog D.D: {m.ddx_items?.join(", ")}
                          </div>
                        )}
                      </td>
                      <td
                        className="right nowrap no-print"
                        style={{ verticalAlign: "top" }}
                      >
                        <button
                          type="button"
                          className="btn ghost small"
                          style={{ marginRight: "0.35rem" }}
                          onClick={() => void printSingleItem(m)}
                        >
                          Print
                        </button>
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() => startEditMedical(m)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn danger ghost small"
                          onClick={() => void deleteMedicalEntry(m)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {printingItem && printingItem.entry_type === "surgery" && (
            <div className="only-print print-area">
              <h2
                style={{
                  textAlign: "center",
                  textTransform: "uppercase",
                  marginBottom: "1.5rem",
                }}
              >
                Surgery Report
              </h2>
              <PrintHeader
                clinic={clinic}
                pet={{ ...edit!, card_id: pet.card_id }}
              />
              <div style={{ marginBottom: "1rem" }}>
                <strong>Date:</strong>{" "}
                {new Date(printingItem.created_at).toLocaleString()}
              </div>
              <div style={{ marginBottom: "0.5rem" }}>
                <strong>Surgery:</strong> {printingItem.title}
              </div>
              {printingItem.dx_note && (
                <div style={{ marginBottom: "0.5rem" }}>
                  <strong>Dx:</strong> {printingItem.dx_note}
                </div>
              )}
              {printingItem.ddx_note && (
                <div style={{ marginBottom: "0.5rem" }}>
                  <strong>D.D:</strong> {printingItem.ddx_note}
                </div>
              )}
              <div style={{ marginTop: "0.5rem" }}>
                <strong>Remarks:</strong> {printingItem.body ?? "—"}
              </div>
            </div>
          )}
          <form className="card no-print" onSubmit={addSurgery}>
            <h3>Add surgery</h3>
            <label>
              Surgery name
              <input
                list="surgery-master-list"
                value={surgeryName}
                onChange={(e) => setSurgeryName(e.target.value)}
                required
              />
            </label>
            <datalist id="surgery-master-list">
              {surgeryOptions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <div className="grid2">
              <label>
                Dx
                <input
                  value={surgeryDxNote}
                  onChange={(e) => setSurgeryDxNote(e.target.value)}
                />
              </label>
              <label>
                D.D
                <input
                  value={surgeryDdxNote}
                  onChange={(e) => setSurgeryDdxNote(e.target.value)}
                />
              </label>
            </div>
            <label>
              Remarks
              <textarea
                rows={2}
                value={surgeryRemark}
                onChange={(e) => setSurgeryRemark(e.target.value)}
              />
            </label>
            <button type="submit" className="btn primary">
              Save surgery
            </button>
          </form>
        </div>
      )}

      {tab === "vaccinations" && (
        <div className="stack">
          <div className={`card ${printingItem ? "no-print" : ""}`}>
            <h2>Vaccinations</h2>
            <p className="muted">
              Set <strong>next due date</strong> and reminders appear on the
              dashboard.
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Vaccine</th>
                  <th>Given</th>
                  <th>Next due</th>
                  <th>Remind (days)</th>
                  <th>Notes</th>
                  <th className="right no-print">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vax.map((v) => (
                  <tr key={v.id}>
                    <td>{v.vaccine_name}</td>
                    <td>{v.administered_date ?? "—"}</td>
                    <td>{v.next_due_date ?? "—"}</td>
                    <td>{v.reminder_days_before ?? "—"}</td>
                    <td>{v.notes ?? "—"}</td>
                    <td className="right nowrap no-print">
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => void printSingleItem(v)}
                      >
                        Print
                      </button>
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => startEditVaccination(v)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn danger ghost small"
                        onClick={() => void deleteVaccination(v)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form className="card no-print" onSubmit={addVax}>
            <h3>Add vaccination</h3>
            <div className="grid2">
              <label>
                Vaccine name *
                <input
                  list="vaccine-master-list"
                  required
                  value={vaxForm.vaccine_name}
                  onChange={(e) =>
                    setVaxForm({ ...vaxForm, vaccine_name: e.target.value })
                  }
                />
              </label>
              <label>
                Given *
                <input
                  type="date"
                  required
                  value={vaxForm.administered_date ?? ""}
                  onChange={(e) =>
                    setVaxForm({
                      ...vaxForm,
                      administered_date: e.target.value,
                    })
                  }
                />
              </label>
            </div>
            <div className="grid2">
              <label>
                Due date
                <input
                  type="date"
                  value={vaxForm.next_due_date ?? ""}
                  onChange={(e) =>
                    setVaxForm({ ...vaxForm, next_due_date: e.target.value })
                  }
                />
              </label>
              <label>
                Reminder (days before)
                <input
                  type="number"
                  value={vaxForm.reminder_days_before ?? ""}
                  onChange={(e) =>
                    setVaxForm({
                      ...vaxForm,
                      reminder_days_before: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            <label>
              Notes
              <textarea
                rows={2}
                value={vaxForm.notes ?? ""}
                onChange={(e) =>
                  setVaxForm({ ...vaxForm, notes: e.target.value })
                }
              />
            </label>
            <datalist id="vaccine-master-list">
              {vaccineOptions.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <button type="submit" className="btn primary">
              Save vaccination
            </button>
          </form>
        </div>
      )}

      {tab === "deworming" && (
        <div className="stack">
          <div className={`card ${printingItem ? "no-print" : ""}`}>
            <h2>Deworming history</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Rx</th>
                  <th>Given</th>
                  <th>Next due</th>
                  <th>Remind (days)</th>
                  <th>Notes</th>
                  <th className="right no-print">Actions</th>
                </tr>
              </thead>
              <tbody>
                {medical
                  .filter((m) => m.entry_type === "deworming")
                  .map((m) => (
                    <tr key={m.id}>
                      <td>{m.title}</td>
                      <td>{m.administered_date ?? "—"}</td>
                      <td>{m.next_due_date ?? "—"}</td>
                      <td>{m.reminder_days_before ?? "—"}</td>
                      <td>{m.body ?? "—"}</td>
                      <td className="right nowrap no-print">
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() => void printSingleItem(m)}
                        >
                          Print
                        </button>
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() => startEditMedical(m)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn danger ghost small"
                          onClick={() => void deleteMedicalEntry(m)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <form className="card no-print" onSubmit={addDeworming}>
            <h3>Add deworming</h3>
            <div className="grid2">
              <label>
                Medicine name *
                <input
                  list="deworm-master-list"
                  required
                  value={dewormForm.title ?? ""}
                  onChange={(e) =>
                    setDewormForm({ ...dewormForm, title: e.target.value })
                  }
                />
              </label>
              <label>
                Given *
                <input
                  type="date"
                  required
                  value={dewormForm.administered_date ?? ""}
                  onChange={(e) =>
                    setDewormForm({
                      ...dewormForm,
                      administered_date: e.target.value,
                    })
                  }
                />
              </label>
            </div>
            <div className="grid2">
              <label>
                Due date
                <input
                  type="date"
                  value={dewormForm.next_due_date ?? ""}
                  onChange={(e) =>
                    setDewormForm({
                      ...dewormForm,
                      next_due_date: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Reminder (days before)
                <input
                  type="number"
                  value={dewormForm.reminder_days_before ?? ""}
                  onChange={(e) =>
                    setDewormForm({
                      ...dewormForm,
                      reminder_days_before: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            <label>
              Notes
              <textarea
                rows={2}
                value={dewormForm.body ?? ""}
                onChange={(e) =>
                  setDewormForm({ ...dewormForm, body: e.target.value })
                }
              />
            </label>
            <datalist id="deworm-master-list">
              {dewormOptions.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
            <button type="submit" className="btn primary">
              Save deworming
            </button>
          </form>
        </div>
      )}

      {tab === "lab" && (
        <div
          className={`card print-area ${printingItem || labModal ? "no-print" : ""}`}
        >
          <div className="row-actions no-print">
            <button
              type="button"
              className="btn primary"
              onClick={() => void appPrint()}
            >
              Print lab orders
            </button>
          </div>
          <div className="only-print">
            <h2
              style={{
                textAlign: "center",
                textTransform: "uppercase",
                marginBottom: "1.5rem",
              }}
            >
              Lab orders
            </h2>
            <PrintHeader
              clinic={clinic}
              pet={{ ...edit!, card_id: pet.card_id }}
            />
          </div>
          <h2 className="no-print">Lab orders for this pet</h2>
          <p className="muted no-print">
            Create orders from <Link href="/lab">Laboratory</Link>. Pending
            orders can be completed under Generate lab report.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Test</th>
                <th>Status</th>
                <th>Tentative report</th>
                <th>Created</th>
                <th className="right no-print">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.receipt_number}</td>
                  <td>{labTestMap[o.lab_test_id] ?? "Unknown"}</td>
                  <td>{o.status}</td>
                  <td>{o.tentative_report_at ?? "—"}</td>
                  <td>{new Date(o.created_at).toLocaleString()}</td>
                  <td className="right nowrap no-print">
                    {o.lab_result_id ? (
                      <>
                        <button
                          type="button"
                          className="btn ghost small"
                          style={{ marginRight: "0.35rem" }}
                          onClick={() =>
                            void openLabModal(
                              o.lab_result_id!,
                              true,
                              labTestMap[o.lab_test_id],
                              pet?.name ?? "",
                            )
                          }
                        >
                          View report
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            className="btn primary small"
                            onClick={() =>
                              void openLabModal(
                                o.lab_result_id!,
                                false,
                                labTestMap[o.lab_test_id],
                                pet?.name ?? "",
                              )
                            }
                          >
                            Edit values
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="muted small">Pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 && <p className="muted">No lab orders yet.</p>}
        </div>
      )}

      {tab === "opd" && (
        <div className="stack">
          <div className={`card ${printingItem ? "no-print" : ""}`}>
            <h2>OPD prescription history</h2>
            <p className="muted">
              Created from <Link href="/opd">OPD</Link> consultations for this
              pet.
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vet</th>
                  <th>Dx</th>
                  <th>D.D</th>
                  <th>Next visit</th>
                  <th className="right no-print">Actions</th>
                </tr>
              </thead>
              <tbody>
                {opdHistory.map((h) => (
                  <tr key={h.id}>
                    <td>{new Date(h.created_at).toLocaleString()}</td>
                    <td>{h.vet_name}</td>
                    <td>{h.diagnosis_note ?? "—"}</td>
                    <td>{h.differential_diagnosis_note ?? "—"}</td>
                    <td>{h.next_visit_at ?? "—"}</td>
                    <td className="right no-print">
                      <button
                        type="button"
                        className="btn ghost small"
                        style={{ marginRight: "0.35rem" }}
                        onClick={() => void printSingleItem(h)}
                      >
                        Print
                      </button>
                      <button
                        type="button"
                        className="btn ghost small"
                        style={{ marginRight: "0.35rem" }}
                        onClick={() => setSelectedOpdHistory(h)}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        className="btn ghost small"
                        style={{ marginRight: "0.35rem" }}
                        onClick={() => startEditOpd(h)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn danger ghost small"
                        onClick={() => void deleteOpdHistoryEntry(h.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {opdHistory.length === 0 && (
              <p className="muted">No OPD entries yet for this pet.</p>
            )}
          </div>
          {selectedOpdHistory && (
            <div className="card no-print" style={{ marginTop: "0.8rem" }}>
              <h3>Prescription details</h3>
              <p>
                <strong>Vet:</strong> {selectedOpdHistory.vet_name}
              </p>
              <label>
                Temperature
                <input
                  value={selectedOpdHistory.temperature ?? ""}
                  onChange={(e) =>
                    setSelectedOpdHistory({
                      ...selectedOpdHistory,
                      temperature: e.target.value || null,
                    })
                  }
                />
              </label>
              <p>
                <strong>Dx:</strong> {selectedOpdHistory.diagnosis_note ?? "—"}
              </p>
              <p>
                <strong>D.D:</strong>{" "}
                {selectedOpdHistory.differential_diagnosis_note ?? "—"}
              </p>
              <p>
                <strong>Symptoms:</strong>{" "}
                {selectedOpdHistory.symptoms.join(", ") || "—"}
              </p>
              <p>
                <strong>History / Observation:</strong>{" "}
                {selectedOpdHistory.history_observations.join(", ") || "—"}
              </p>
              <p>
                <strong>Dx tabs:</strong>{" "}
                {selectedOpdHistory.dx_items.join(", ") || "—"}
              </p>
              <p>
                <strong>D.D tabs:</strong>{" "}
                {selectedOpdHistory.ddx_items.join(", ") || "—"}
              </p>
              <p>
                <strong>Lab tests:</strong>{" "}
                {[
                  ...selectedOpdHistory.recommended_lab_test_names,
                  ...selectedOpdHistory.custom_lab_tests,
                ].join(", ") || "—"}
              </p>
              <p>
                <strong>Rx:</strong>{" "}
                {selectedOpdHistory.medicines
                  .map(
                    (m) =>
                      `${m.name} - ${m.dosage ?? m.direction_per_day ?? "—"}`,
                  )
                  .join("; ") || "—"}
              </p>
              <label>
                Treatment remark
                <textarea
                  rows={2}
                  value={selectedOpdHistory.clinical_treatment_remark ?? ""}
                  onChange={(e) =>
                    setSelectedOpdHistory({
                      ...selectedOpdHistory,
                      clinical_treatment_remark: e.target.value || null,
                    })
                  }
                />
              </label>
              <p>
                <strong>Food:</strong>{" "}
                {selectedOpdHistory.recommended_food ?? "—"}
              </p>
              <p>
                <strong>Next visit:</strong>{" "}
                {selectedOpdHistory.next_visit_at ?? "—"}
              </p>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={opdUpdateBusy}
                  onClick={() => void updateSelectedOpdCase()}
                >
                  {opdUpdateBusy ? "Saving..." : "Save updates"}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void reopenSelectedOpdCase()}
                >
                  Reopen case
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "radiology" && (
        <div className="stack">
          <div className={`card print-area ${printingItem ? "no-print" : ""}`}>
            <div className="row-actions no-print">
              <button
                type="button"
                className="btn primary"
                onClick={() => void appPrint()}
              >
                Print radiology report
              </button>
            </div>

            <div className="only-print">
              <h2
                style={{
                  textAlign: "center",
                  textTransform: "uppercase",
                  marginBottom: "1.5rem",
                }}
              >
                Radiology Report
              </h2>
              <PrintHeader
                clinic={clinic}
                pet={{ ...edit!, card_id: pet.card_id }}
              />
            </div>

            <h2 className="no-print">Radiology</h2>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {medical
                .filter((m) => m.entry_type === "radiology")
                .map((m) => (
                  <li
                    key={m.id}
                    style={{
                      marginBottom: "2rem",
                      borderBottom: "1px solid #eee",
                      paddingBottom: "1.5rem",
                    }}
                  >
                    <div
                      className="row-actions no-print"
                      style={{ marginBottom: "1rem" }}
                    >
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => void printSingleItem(m)}
                      >
                        Print this report
                      </button>
                    </div>
                    <div style={{ marginBottom: "0.5rem" }}>
                      <strong>Date:</strong>{" "}
                      {new Date(m.created_at).toLocaleString()}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "10px",
                        marginBottom: "1rem",
                      }}
                    >
                      {m.external_file_paths &&
                      m.external_file_paths.length > 0 ? (
                        m.external_file_paths.map((p: string, i: number) => (
                          <img
                            key={i}
                            src={p}
                            alt={`Radiology ${i + 1}`}
                            style={{
                              maxWidth: "200px",
                              maxHeight: "200px",
                              display: "block",
                              objectFit: "contain",
                            }}
                          />
                        ))
                      ) : canPreviewImage(m.external_file_path) ? (
                        <img
                          src={m.external_file_path}
                          alt="Radiology"
                          style={{
                            maxWidth: "200px",
                            maxHeight: "200px",
                            display: "block",
                            objectFit: "contain",
                          }}
                        />
                      ) : null}
                    </div>
                    {m.dx_note && (
                      <div style={{ marginBottom: "0.5rem" }}>
                        <strong>Dx:</strong> {m.dx_note}
                      </div>
                    )}
                    {m.ddx_note && (
                      <div style={{ marginBottom: "0.5rem" }}>
                        <strong>D.D:</strong> {m.ddx_note}
                      </div>
                    )}
                    {(m.dx_items?.length ?? 0) > 0 && (
                      <div className="small muted">
                        <strong>Catalog Dx:</strong> {m.dx_items?.join(", ")}
                      </div>
                    )}
                    {(m.ddx_items?.length ?? 0) > 0 && (
                      <div className="small muted">
                        <strong>Catalog D.D:</strong> {m.ddx_items?.join(", ")}
                      </div>
                    )}
                    <div style={{ marginTop: "0.5rem" }}>
                      <strong>Remarks:</strong> {m.body ?? "—"}
                    </div>
                    <div
                      className="no-print row-actions"
                      style={{ marginTop: "0.5rem" }}
                    >
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => startEditMedical(m)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn danger ghost small"
                        onClick={() => void deleteMedicalEntry(m)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          </div>

          {printingItem && printingItem.entry_type === "radiology" && (
            <div className="only-print print-area">
              <h2
                style={{
                  textAlign: "center",
                  textTransform: "uppercase",
                  marginBottom: "1.5rem",
                }}
              >
                Radiology Report
              </h2>
              <PrintHeader
                clinic={clinic}
                pet={{ ...edit!, card_id: pet.card_id }}
              />
              <div style={{ marginBottom: "1rem" }}>
                <strong>Date:</strong>{" "}
                {new Date(printingItem.created_at).toLocaleString()}
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "10px",
                  marginBottom: "1rem",
                }}
              >
                {printingItem.external_file_paths &&
                printingItem.external_file_paths.length > 0 ? (
                  printingItem.external_file_paths.map(
                    (p: string, i: number) => (
                      <img
                        key={i}
                        src={p}
                        alt={`Radiology ${i + 1}`}
                        style={{
                          maxWidth: "300px",
                          maxHeight: "300px",
                          display: "block",
                          objectFit: "contain",
                        }}
                      />
                    ),
                  )
                ) : canPreviewImage(printingItem.external_file_path) ? (
                  <img
                    src={printingItem.external_file_path}
                    alt="Radiology"
                    style={{
                      maxWidth: "300px",
                      maxHeight: "300px",
                      display: "block",
                      objectFit: "contain",
                    }}
                  />
                ) : null}
              </div>
              {printingItem.dx_note && (
                <div style={{ marginBottom: "0.5rem" }}>
                  <strong>Dx:</strong> {printingItem.dx_note}
                </div>
              )}
              {printingItem.ddx_note && (
                <div style={{ marginBottom: "0.5rem" }}>
                  <strong>D.D:</strong> {printingItem.ddx_note}
                </div>
              )}
              <div style={{ marginTop: "0.5rem" }}>
                <strong>Remarks:</strong> {printingItem.body ?? "—"}
              </div>
            </div>
          )}
          <form
            className="card no-print"
            onSubmit={(e) => {
              e.preventDefault();
              void addImagingRecords("radiology", radiologyItems);
              setRadiologyItems({
                paths: [],
                remark: "",
                dx_note: "",
                ddx_note: "",
              });
            }}
          >
            <h3>Add radiology report</h3>
            <div className="grid2">
              <label>
                Images
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length === 0) return;
                    Promise.all(files.map((f) => fileToDataUrl(f)))
                      .then((encodedList) =>
                        setRadiologyItems((prev) => ({
                          ...prev,
                          paths: [...prev.paths, ...encodedList],
                        })),
                      )
                      .catch((err) => setErr(String(err)));
                  }}
                />
              </label>
              <label>
                Dx
                <input
                  placeholder="Dx"
                  value={radiologyItems.dx_note}
                  onChange={(e) =>
                    setRadiologyItems((prev) => ({
                      ...prev,
                      dx_note: e.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="grid2" style={{ marginTop: "0.5rem" }}>
              <label>
                D.D
                <input
                  placeholder="D.D"
                  value={radiologyItems.ddx_note}
                  onChange={(e) =>
                    setRadiologyItems((prev) => ({
                      ...prev,
                      ddx_note: e.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Remark
                <input
                  placeholder="Remark"
                  value={radiologyItems.remark}
                  onChange={(e) =>
                    setRadiologyItems((prev) => ({
                      ...prev,
                      remark: e.target.value,
                    }))
                  }
                />
              </label>
            </div>

            {radiologyItems.paths.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                  marginTop: "1rem",
                }}
              >
                {radiologyItems.paths.map((p, idx) => (
                  <div key={idx} style={{ position: "relative" }}>
                    <img
                      src={p}
                      alt="Radiology preview"
                      style={{
                        maxWidth: 120,
                        maxHeight: 120,
                        objectFit: "cover",
                        borderRadius: 4,
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-danger btn-xs"
                      style={{
                        position: "absolute",
                        top: -5,
                        right: -5,
                        padding: "2px 6px",
                        borderRadius: "50%",
                        minWidth: 0,
                      }}
                      onClick={() =>
                        setRadiologyItems((prev) => ({
                          ...prev,
                          paths: prev.paths.filter((_, i) => i !== idx),
                        }))
                      }
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="row-actions" style={{ marginTop: "1rem" }}>
              <button type="submit" className="btn primary">
                Save radiology report
              </button>
            </div>
          </form>
        </div>
      )}

      {tab === "ultrasonography" && (
        <div className="stack">
          <div className={`card print-area ${printingItem ? "no-print" : ""}`}>
            <div className="row-actions no-print">
              <button
                type="button"
                className="btn primary"
                onClick={() => void appPrint()}
              >
                Print ultrasonography report
              </button>
            </div>

            <div className="only-print">
              <h2
                style={{
                  textAlign: "center",
                  textTransform: "uppercase",
                  marginBottom: "1.5rem",
                }}
              >
                Ultrasonography Report
              </h2>
              <PrintHeader
                clinic={clinic}
                pet={{ ...edit!, card_id: pet.card_id }}
              />
            </div>

            <h2 className="no-print">Ultrasonography</h2>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {medical
                .filter((m) => m.entry_type === "ultrasonography")
                .map((m) => (
                  <li
                    key={m.id}
                    style={{
                      marginBottom: "2rem",
                      borderBottom: "1px solid #eee",
                      paddingBottom: "1.5rem",
                    }}
                  >
                    <div
                      className="row-actions no-print"
                      style={{ marginBottom: "1rem" }}
                    >
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => void printSingleItem(m)}
                      >
                        Print this report
                      </button>
                    </div>
                    <div style={{ marginBottom: "0.5rem" }}>
                      <strong>Date:</strong>{" "}
                      {new Date(m.created_at).toLocaleString()}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "10px",
                        marginBottom: "1rem",
                      }}
                    >
                      {m.external_file_paths &&
                      m.external_file_paths.length > 0 ? (
                        m.external_file_paths.map((p: string, i: number) => (
                          <img
                            key={i}
                            src={p}
                            alt={`Ultrasonography ${i + 1}`}
                            style={{
                              maxWidth: "200px",
                              maxHeight: "200px",
                              display: "block",
                              objectFit: "contain",
                            }}
                          />
                        ))
                      ) : canPreviewImage(m.external_file_path) ? (
                        <img
                          src={m.external_file_path}
                          alt="Ultrasonography"
                          style={{
                            maxWidth: "200px",
                            maxHeight: "200px",
                            display: "block",
                            objectFit: "contain",
                          }}
                        />
                      ) : null}
                    </div>
                    {m.dx_note && (
                      <div style={{ marginBottom: "0.5rem" }}>
                        <strong>Dx:</strong> {m.dx_note}
                      </div>
                    )}
                    {m.ddx_note && (
                      <div style={{ marginBottom: "0.5rem" }}>
                        <strong>D.D:</strong> {m.ddx_note}
                      </div>
                    )}
                    {(m.dx_items?.length ?? 0) > 0 && (
                      <div className="small muted">
                        <strong>Catalog Dx:</strong> {m.dx_items?.join(", ")}
                      </div>
                    )}
                    {(m.ddx_items?.length ?? 0) > 0 && (
                      <div className="small muted">
                        <strong>Catalog D.D:</strong> {m.ddx_items?.join(", ")}
                      </div>
                    )}
                    <div style={{ marginTop: "0.5rem" }}>
                      <strong>Remarks:</strong> {m.body ?? "—"}
                    </div>
                    <div
                      className="no-print row-actions"
                      style={{ marginTop: "0.5rem" }}
                    >
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => startEditMedical(m)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn danger ghost small"
                        onClick={() => void deleteMedicalEntry(m)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          </div>

          {printingItem && printingItem.entry_type === "ultrasonography" && (
            <div className="only-print print-area">
              <h2
                style={{
                  textAlign: "center",
                  textTransform: "uppercase",
                  marginBottom: "1.5rem",
                }}
              >
                Ultrasonography Report
              </h2>
              <PrintHeader
                clinic={clinic}
                pet={{ ...edit!, card_id: pet.card_id }}
              />
              <div style={{ marginBottom: "1rem" }}>
                <strong>Date:</strong>{" "}
                {new Date(printingItem.created_at).toLocaleString()}
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "10px",
                  marginBottom: "1rem",
                }}
              >
                {printingItem.external_file_paths &&
                printingItem.external_file_paths.length > 0 ? (
                  printingItem.external_file_paths.map(
                    (p: string, i: number) => (
                      <img
                        key={i}
                        src={p}
                        alt={`Ultrasonography ${i + 1}`}
                        style={{
                          maxWidth: "300px",
                          maxHeight: "300px",
                          display: "block",
                          objectFit: "contain",
                        }}
                      />
                    ),
                  )
                ) : canPreviewImage(printingItem.external_file_path) ? (
                  <img
                    src={printingItem.external_file_path}
                    alt="Ultrasonography"
                    style={{
                      maxWidth: "300px",
                      maxHeight: "300px",
                      display: "block",
                      objectFit: "contain",
                    }}
                  />
                ) : null}
              </div>
              {printingItem.dx_note && (
                <div style={{ marginBottom: "0.5rem" }}>
                  <strong>Dx:</strong> {printingItem.dx_note}
                </div>
              )}
              {printingItem.ddx_note && (
                <div style={{ marginBottom: "0.5rem" }}>
                  <strong>D.D:</strong> {printingItem.ddx_note}
                </div>
              )}
              <div style={{ marginTop: "0.5rem" }}>
                <strong>Remarks:</strong> {printingItem.body ?? "—"}
              </div>
            </div>
          )}
          <form
            className="card no-print"
            onSubmit={(e) => {
              e.preventDefault();
              void addImagingRecords("ultrasonography", ultraItems);
              setUltraItems({
                paths: [],
                remark: "",
                dx_note: "",
                ddx_note: "",
              });
            }}
          >
            <h3>Add ultrasonography report</h3>
            <div className="grid2">
              <label>
                Images
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length === 0) return;
                    Promise.all(files.map((f) => fileToDataUrl(f)))
                      .then((encodedList) =>
                        setUltraItems((prev) => ({
                          ...prev,
                          paths: [...prev.paths, ...encodedList],
                        })),
                      )
                      .catch((err) => setErr(String(err)));
                  }}
                />
              </label>
              <label>
                Dx
                <input
                  placeholder="Dx"
                  value={ultraItems.dx_note}
                  onChange={(e) =>
                    setUltraItems((prev) => ({
                      ...prev,
                      dx_note: e.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="grid2" style={{ marginTop: "0.5rem" }}>
              <label>
                D.D
                <input
                  placeholder="D.D"
                  value={ultraItems.ddx_note}
                  onChange={(e) =>
                    setUltraItems((prev) => ({
                      ...prev,
                      ddx_note: e.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Remark
                <input
                  placeholder="Remark"
                  value={ultraItems.remark}
                  onChange={(e) =>
                    setUltraItems((prev) => ({
                      ...prev,
                      remark: e.target.value,
                    }))
                  }
                />
              </label>
            </div>

            {ultraItems.paths.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                  marginTop: "1rem",
                }}
              >
                {ultraItems.paths.map((p, idx) => (
                  <div key={idx} style={{ position: "relative" }}>
                    <img
                      src={p}
                      alt="Ultrasonography preview"
                      style={{
                        maxWidth: 120,
                        maxHeight: 120,
                        objectFit: "cover",
                        borderRadius: 4,
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-danger btn-xs"
                      style={{
                        position: "absolute",
                        top: -5,
                        right: -5,
                        padding: "2px 6px",
                        borderRadius: "50%",
                        minWidth: 0,
                      }}
                      onClick={() =>
                        setUltraItems((prev) => ({
                          ...prev,
                          paths: prev.paths.filter((_, i) => i !== idx),
                        }))
                      }
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="row-actions" style={{ marginTop: "1rem" }}>
              <button type="submit" className="btn primary">
                Save ultrasonography report
              </button>
            </div>
          </form>
        </div>
      )}

      {tab === "lab_test" && pet && (
        <div className="stack opd-case-tab-print">
          {labTabErr && <p className="error">{labTabErr}</p>}

          {/* Saved Report Print View */}
          {labSavedReport && (
            <div
              className="card print-area opd-case-tab-print"
              style={{ fontSize: "0.85rem", lineHeight: 1.35 }}
            >
              <div id="lab-report-print" className="receipt">
                <div className="only-print">
                  <PrintHeader
                    clinic={clinic}
                    pet={{ ...pet, card_id: pet.card_id }}
                  />
                </div>
                <h2
                  style={{
                    fontSize: "0.9rem",
                    margin: "0.4rem 0",
                    fontWeight: 600,
                  }}
                >
                  Laboratory report
                </h2>
                <p style={{ margin: "0.2rem 0", fontSize: "0.8rem" }}>
                  <strong>Date:</strong>{" "}
                  {new Date(labSavedReport.created_at).toLocaleString()}
                </p>
                {labSavedReport.notes && (
                  <p style={{ margin: "0.2rem 0", fontSize: "0.8rem" }}>
                    <strong>Notes:</strong> {labSavedReport.notes}
                  </p>
                )}
                {(() => {
                  const hasUnit = labSavedReport.values.some(
                    (v) => v.unit && v.unit.trim(),
                  );
                  const hasRange = labSavedReport.values.some(
                    (v) => v.normal_min != null || v.normal_max != null,
                  );
                  const hasRemarks = labSavedReport.values.some(
                    (v) => v.remarks && v.remarks.trim(),
                  );

                  return (
                    <table
                      className="table"
                      style={{
                        width: "100%",
                        fontSize: "0.8rem",
                        marginTop: "0.4rem",
                      }}
                    >
                      <thead>
                        <tr>
                          <th
                            style={{
                              padding: "2px 6px",
                              fontSize: "0.65rem",
                              textTransform: "uppercase",
                              color: "#666",
                              letterSpacing: "0.02em",
                            }}
                          >
                            Analyte
                          </th>
                          {hasUnit && (
                            <th
                              style={{
                                padding: "2px 6px",
                                fontSize: "0.65rem",
                                textTransform: "uppercase",
                                color: "#666",
                                letterSpacing: "0.02em",
                              }}
                            >
                              Unit
                            </th>
                          )}
                          {hasRange && (
                            <th
                              style={{
                                padding: "2px 6px",
                                fontSize: "0.65rem",
                                textTransform: "uppercase",
                                color: "#666",
                                letterSpacing: "0.02em",
                              }}
                            >
                              Reference
                            </th>
                          )}
                          <th
                            style={{
                              padding: "2px 6px",
                              fontSize: "0.65rem",
                              textTransform: "uppercase",
                              color: "#666",
                              letterSpacing: "0.02em",
                            }}
                          >
                            Result
                          </th>
                          {hasRemarks && (
                            <th
                              style={{
                                padding: "2px 6px",
                                fontSize: "0.65rem",
                                textTransform: "uppercase",
                                color: "#666",
                                letterSpacing: "0.02em",
                              }}
                            >
                              Value
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {labSavedReport.values.map((v) => {
                          const h = valueHighlight(
                            v.observed_value,
                            v.normal_min,
                            v.normal_max,
                          );
                          return (
                            <tr key={v.id}>
                              <td style={{ padding: "1px 6px" }}>
                                {v.analyte_name}
                              </td>
                              {hasUnit && (
                                <td style={{ padding: "1px 6px" }}>
                                  {v.unit ?? "—"}
                                </td>
                              )}
                              {hasRange && (
                                <td style={{ padding: "1px 6px" }}>
                                  {v.normal_min ?? "—"} – {v.normal_max ?? "—"}
                                </td>
                              )}
                              <td
                                style={{ padding: "1px 6px" }}
                                className={h !== "ok" ? `hl-${h}-text` : ""}
                              >
                                {h !== "ok" ? <strong>{v.observed_value}</strong> : v.observed_value}
                              </td>
                              {hasRemarks && (
                                <td style={{ padding: "1px 6px" }}>
                                  {v.remarks ?? "—"}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
              <div className="no-print row-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void printLabReport()}
                >
                  Print / Save as PDF
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={saveLabReportHtml}
                >
                  Save as HTML
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={resetLabReportForm}
                >
                  New report
                </button>
              </div>
            </div>
          )}

          {/* Saved Receipt View (only shown if not viewing a saved report) */}
          {!labSavedReport && lastLabOrder && (
            <div className="card print-area opd-case-tab-print">
              <h2>Receipt</h2>
              <div id="lab-receipt-print" className="receipt">
                <h3>Pet Care Clinic</h3>
                <p>
                  <strong>Receipt:</strong> {lastLabOrder.receipt_number}
                </p>
                <p>
                  <strong>Pet:</strong> {pet.name} ({pet.species ?? "—"})
                </p>
                <p>
                  <strong>Owner:</strong> {pet.owner_name ?? "—"}
                </p>
                <p>
                  <strong>Test:</strong> {lastLabOrderTestName || "—"}
                </p>
                <p>
                  <strong>Tentative report:</strong>{" "}
                  {lastLabOrder.tentative_report_at
                    ? new Date(
                        lastLabOrder.tentative_report_at,
                      ).toLocaleString()
                    : "—"}
                </p>
                <p className="small muted">
                  Ordered: {new Date(lastLabOrder.created_at).toLocaleString()}
                </p>
              </div>
              <div className="no-print row-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void printLabReceipt()}
                >
                  Print / Save as PDF
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={saveLabReceiptHtml}
                >
                  Save as HTML
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setLastLabOrder(null)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Forms Section (only shown when not viewing a saved report) */}
          {!labSavedReport && (
            <div className="no-print grid2">
              {/* Order creation form */}
              <form className="card" onSubmit={createLabOrder}>
                <h2>New lab order</h2>
                <label>
                  Pet
                  <input
                    type="text"
                    value={`${pet.name} (${pet.card_id})`}
                    disabled
                  />
                </label>
                <label>
                  Test panel
                  <select
                    required
                    value={labTestId}
                    onChange={(e) => setLabTestId(e.target.value)}
                  >
                    <option value="">Select a test</option>
                    {labTests.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tentative report time
                  <input
                    type="datetime-local"
                    value={labTentative}
                    onChange={(e) => setLabTentative(e.target.value)}
                  />
                </label>
                <button type="submit" className="btn primary">
                  Create receipt
                </button>
              </form>

              {/* Report entry form */}
              <form className="card" onSubmit={saveLabReport}>
                <h2>Save Lab Report</h2>
                <label>
                  Pending order
                  <select
                    required
                    value={labOrderId}
                    onChange={(e) => setLabOrderId(e.target.value)}
                    disabled={labOrdersPending.length === 0}
                  >
                    <option value="">Select an order</option>
                    {labOrdersPending.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.receipt_number} (
                        {labTestMap[o.lab_test_id] ?? o.lab_test_id})
                      </option>
                    ))}
                  </select>
                </label>

                {labAnalytes.length > 0 && (
                  <div className="stack">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Analyte</th>
                          {labAnalytes.some((a) => a.unit && a.unit.trim()) && (
                            <th>Unit</th>
                          )}
                          {labAnalytes.some(
                            (a) => a.normal_min != null || a.normal_max != null,
                          ) && <th>Reference</th>}
                          <th>Result</th>
                          {labAnalytes.some(
                            (a) => a.remarks && a.remarks.trim(),
                          ) && <th>Value</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {labAnalytes.map((a) => {
                          const raw = labValues[a.id] ?? "";
                          const h = valueHighlight(
                            raw,
                            a.normal_min,
                            a.normal_max,
                          );
                          const hasUnit = a.unit && a.unit.trim();
                          const hasRange =
                            a.normal_min != null || a.normal_max != null;
                          const hasRemarks = a.remarks && a.remarks.trim();
                          return (
                            <tr key={a.id}>
                              <td>{a.name}</td>
                              {hasUnit && <td>{a.unit ?? "—"}</td>}
                              {hasRange && (
                                <td className="muted small">
                                  {a.normal_min ?? "—"} – {a.normal_max ?? "—"}
                                </td>
                              )}
                              <td>
                                <input
                                  className={`narrow ${h !== "ok" ? `hl-${h}` : ""}`}
                                  required
                                  placeholder="Enter result..."
                                  value={raw}
                                  onChange={(e) =>
                                    setLabValues((prev) => ({
                                      ...prev,
                                      [a.id]: e.target.value,
                                    }))
                                  }
                                />
                              </td>
                              {hasRemarks && <td>{a.remarks ?? "—"}</td>}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <label>
                      Notes
                      <textarea
                        rows={2}
                        value={labNotes}
                        onChange={(e) => setLabNotes(e.target.value)}
                      />
                    </label>
                    <button type="submit" className="btn primary">
                      Save Report
                    </button>
                  </div>
                )}
                {labOrderId && labAnalytes.length === 0 && (
                  <p className="muted">Loading analytes…</p>
                )}
                {!labOrderId && (
                  <p className="muted">
                    Select a pending order to enter results.
                  </p>
                )}
              </form>
            </div>
          )}
        </div>
      )}

      {printingItem && (
        <div className="only-print print-area">
          {/* Medical / Deworming / Lab Reference */}
          {medical.some((m) => m.id === printingItem.id) &&
            !["surgery", "radiology", "ultrasonography"].includes(
              printingItem.entry_type,
            ) && (
              <>
                <h2
                  style={{
                    textAlign: "center",
                    textTransform: "uppercase",
                    marginBottom: "1.5rem",
                  }}
                >
                  Medical Report
                </h2>
                <PrintHeader
                  clinic={clinic}
                  pet={{ ...edit!, card_id: pet.card_id }}
                />
                <div style={{ marginBottom: "1rem" }}>
                  <strong>Type:</strong> {printingItem.entry_type}
                </div>
                <div style={{ marginBottom: "1rem" }}>
                  <strong>Date:</strong>{" "}
                  {new Date(printingItem.created_at).toLocaleString()}
                </div>
                {printingItem.title && (
                  <div style={{ marginBottom: "1rem" }}>
                    <strong>Title:</strong> {printingItem.title}
                  </div>
                )}
                {printingItem.dx_note && (
                  <div style={{ marginBottom: "0.5rem" }}>
                    <strong>Dx:</strong> {printingItem.dx_note}
                  </div>
                )}
                {printingItem.ddx_note && (
                  <div style={{ marginBottom: "0.5rem" }}>
                    <strong>D.D:</strong> {printingItem.ddx_note}
                  </div>
                )}
                <div style={{ marginTop: "0.5rem" }}>
                  <strong>Remarks:</strong> {printingItem.body ?? "—"}
                </div>
              </>
            )}

          {/* Vaccination */}
          {vax.some((v) => v.id === printingItem.id) && (
            <>
              <h2
                style={{
                  textAlign: "center",
                  textTransform: "uppercase",
                  marginBottom: "1.5rem",
                }}
              >
                Vaccination Certificate
              </h2>
              <PrintHeader
                clinic={clinic}
                pet={{ ...edit!, card_id: pet.card_id }}
              />
              <div style={{ marginBottom: "1rem" }}>
                <strong>Vaccine:</strong> {printingItem.vaccine_name}
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <strong>Date Given:</strong> {printingItem.administered_date}
              </div>
              {printingItem.next_due_date && (
                <div style={{ marginBottom: "1rem" }}>
                  <strong>Next Due:</strong> {printingItem.next_due_date}
                </div>
              )}
              {printingItem.notes && (
                <div style={{ marginTop: "0.5rem" }}>
                  <strong>Notes:</strong> {printingItem.notes}
                </div>
              )}
            </>
          )}

          {/* Grooming */}
          {grooming.some((g) => g.id === printingItem.id) && (
            <>
              <h2
                style={{
                  textAlign: "center",
                  textTransform: "uppercase",
                  marginBottom: "1.5rem",
                }}
              >
                Grooming Report
              </h2>
              <PrintHeader
                clinic={clinic}
                pet={{ ...edit!, card_id: pet.card_id }}
              />
              <div style={{ marginBottom: "1rem" }}>
                <strong>Service:</strong> {printingItem.service_type}
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <strong>Date Performed:</strong> {printingItem.performed_date}
              </div>
              {printingItem.next_due_date && (
                <div style={{ marginBottom: "1rem" }}>
                  <strong>Next Due:</strong> {printingItem.next_due_date}
                </div>
              )}
              {printingItem.notes && (
                <div style={{ marginTop: "0.5rem" }}>
                  <strong>Notes:</strong> {printingItem.notes}
                </div>
              )}
            </>
          )}

          {/* OPD Consultation */}
          {opdHistory.some((h) => h.id === printingItem.id) && (
            <OpdPrescriptionPrint
              clinic={clinic}
              pet={{
                ...edit!,
                card_id: pet.card_id,
              }}
              consultation={printingItem}
            />
          )}
        </div>
      )}

      {medicalEdit && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setMedicalEdit(null)}
        >
          <div
            className="card modal wide-modal"
            role="dialog"
            aria-labelledby="med-edit-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="med-edit-title">
              Edit {medicalEdit.entry_type.replace("_", " ")}
            </h2>
            <form onSubmit={saveMedicalEdit}>
              {!["surgery", "radiology", "ultrasonography"].includes(
                medicalEditForm.entry_type,
              ) && (
                <label>
                  Type
                  <input
                    value={medicalEditForm.entry_type}
                    onChange={(e) =>
                      setMedicalEditForm({
                        ...medicalEditForm,
                        entry_type: e.target.value,
                      })
                    }
                    disabled={!!medicalEdit.lab_result_id}
                  />
                </label>
              )}
              <label>
                Title
                <input
                  value={medicalEditForm.title ?? ""}
                  onChange={(e) =>
                    setMedicalEditForm({
                      ...medicalEditForm,
                      title: e.target.value,
                    })
                  }
                />
              </label>

              <div className="grid2">
                <label>
                  Dx note
                  <input
                    value={medicalEditForm.dx_note ?? ""}
                    onChange={(e) =>
                      setMedicalEditForm({
                        ...medicalEditForm,
                        dx_note: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  D.D note
                  <input
                    value={medicalEditForm.ddx_note ?? ""}
                    onChange={(e) =>
                      setMedicalEditForm({
                        ...medicalEditForm,
                        ddx_note: e.target.value,
                      })
                    }
                  />
                </label>
              </div>

              {!["surgery", "radiology", "ultrasonography"].includes(
                medicalEditForm.entry_type,
              ) && (
                <div className="grid3">
                  <label>
                    Given
                    <input
                      type="date"
                      value={medicalEditForm.administered_date ?? ""}
                      onChange={(e) =>
                        setMedicalEditForm({
                          ...medicalEditForm,
                          administered_date: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Next due
                    <input
                      type="date"
                      value={medicalEditForm.next_due_date ?? ""}
                      onChange={(e) =>
                        setMedicalEditForm({
                          ...medicalEditForm,
                          next_due_date: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Remind (days)
                    <input
                      type="number"
                      value={medicalEditForm.reminder_days_before ?? ""}
                      onChange={(e) =>
                        setMedicalEditForm({
                          ...medicalEditForm,
                          reminder_days_before: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
              )}

              <label>
                Remarks / Body
                <textarea
                  rows={4}
                  value={medicalEditForm.body ?? ""}
                  onChange={(e) =>
                    setMedicalEditForm({
                      ...medicalEditForm,
                      body: e.target.value,
                    })
                  }
                />
              </label>

              <div style={{ marginBottom: "1rem" }}>
                <label>Images / Files</label>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "10px",
                    marginTop: "0.5rem",
                  }}
                >
                  {(medicalEditForm.external_file_paths ?? []).map((p, idx) => (
                    <div
                      key={idx}
                      style={{ position: "relative", width: 100, height: 100 }}
                    >
                      {canPreviewImage(p) ? (
                        <img
                          src={p}
                          alt="preview"
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            borderRadius: 4,
                          }}
                        />
                      ) : (
                        <div
                          className="card"
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "0.7rem",
                            overflow: "hidden",
                          }}
                        >
                          {String(p).split("/").pop()}
                        </div>
                      )}
                      <button
                        type="button"
                        className="btn danger small"
                        style={{
                          position: "absolute",
                          top: -5,
                          right: -5,
                          padding: "2px 5px",
                          fontSize: "10px",
                          borderRadius: "50%",
                        }}
                        onClick={() => {
                          const next = (
                            medicalEditForm.external_file_paths ?? []
                          ).filter((_, i) => i !== idx);
                          setMedicalEditForm({
                            ...medicalEditForm,
                            external_file_paths: next,
                            external_file_path: next[0] ?? "",
                          });
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <label
                    className="card"
                    style={{
                      width: 100,
                      height: 100,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      border: "2px dashed #ccc",
                      marginBottom: 0,
                    }}
                  >
                    <span style={{ fontSize: "1.5rem" }}>+</span>
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={async (e) => {
                        const files = Array.from(e.target.files ?? []);
                        const newPaths = await Promise.all(
                          files.map((f) => fileToDataUrl(f)),
                        );
                        const next = [
                          ...(medicalEditForm.external_file_paths ?? []),
                          ...newPaths,
                        ];
                        setMedicalEditForm({
                          ...medicalEditForm,
                          external_file_paths: next,
                          external_file_path: next[0] ?? "",
                        });
                      }}
                    />
                  </label>
                </div>
              </div>

              {!["radiology", "ultrasonography"].includes(
                medicalEditForm.entry_type,
              ) && (
                <label>
                  Single File path (fallback)
                  <input
                    value={medicalEditForm.external_file_path ?? ""}
                    onChange={(e) =>
                      setMedicalEditForm({
                        ...medicalEditForm,
                        external_file_path: e.target.value,
                      })
                    }
                    disabled={!!medicalEdit.lab_result_id}
                  />
                </label>
              )}

              <div className="row-actions">
                <button type="submit" className="btn primary">
                  Save changes
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setMedicalEdit(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {groomingEdit && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setGroomingEdit(null)}
        >
          <div
            className="card modal"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Edit grooming</h2>
            <form onSubmit={saveGroomingEdit}>
              <label>
                Service
                <input
                  required
                  value={groomingEditForm.service_type}
                  onChange={(e) =>
                    setGroomingEditForm({
                      ...groomingEditForm,
                      service_type: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Date
                <input
                  type="date"
                  required
                  value={groomingEditForm.performed_date}
                  onChange={(e) =>
                    setGroomingEditForm({
                      ...groomingEditForm,
                      performed_date: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Given date
                <input
                  type="date"
                  value={groomingEditForm.administered_date ?? ""}
                  onChange={(e) =>
                    setGroomingEditForm({
                      ...groomingEditForm,
                      administered_date: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Due date
                <input
                  type="date"
                  value={groomingEditForm.next_due_date ?? ""}
                  onChange={(e) =>
                    setGroomingEditForm({
                      ...groomingEditForm,
                      next_due_date: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Reminder (days before)
                <input
                  type="number"
                  value={groomingEditForm.reminder_days_before ?? ""}
                  onChange={(e) =>
                    setGroomingEditForm({
                      ...groomingEditForm,
                      reminder_days_before: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                Notes
                <input
                  value={groomingEditForm.notes ?? ""}
                  onChange={(e) =>
                    setGroomingEditForm({
                      ...groomingEditForm,
                      notes: e.target.value || null,
                    })
                  }
                />
              </label>
              <div className="row-actions">
                <button type="submit" className="btn primary">
                  Save
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setGroomingEdit(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {vaccinationEdit && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setVaccinationEdit(null)}
        >
          <div
            className="card modal"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Edit vaccination</h2>
            <form onSubmit={saveVaccinationEdit}>
              <label>
                Vaccine name
                <input
                  required
                  value={vaccinationEditForm.vaccine_name}
                  onChange={(e) =>
                    setVaccinationEditForm({
                      ...vaccinationEditForm,
                      vaccine_name: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Given
                <input
                  type="date"
                  required
                  value={vaccinationEditForm.administered_date ?? ""}
                  onChange={(e) =>
                    setVaccinationEditForm({
                      ...vaccinationEditForm,
                      administered_date: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Next due
                <input
                  type="date"
                  value={vaccinationEditForm.next_due_date ?? ""}
                  onChange={(e) =>
                    setVaccinationEditForm({
                      ...vaccinationEditForm,
                      next_due_date: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Reminder (days before)
                <input
                  type="number"
                  value={vaccinationEditForm.reminder_days_before ?? ""}
                  onChange={(e) =>
                    setVaccinationEditForm({
                      ...vaccinationEditForm,
                      reminder_days_before: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                Notes
                <textarea
                  rows={2}
                  value={vaccinationEditForm.notes ?? ""}
                  onChange={(e) =>
                    setVaccinationEditForm({
                      ...vaccinationEditForm,
                      notes: e.target.value,
                    })
                  }
                />
              </label>
              <div className="row-actions">
                <button type="submit" className="btn primary">
                  Save
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setVaccinationEdit(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {labModal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setLabModal(null)}
        >
          <div
            id="lab-report-print-area"
            className="card modal wide-modal"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            {!labModal.detail ? (
              <p>Loading…</p>
            ) : labModal.readOnly ? (
              <div
                id="generated-report-print"
                className="receipt"
                style={{ fontSize: "0.85rem", lineHeight: 1.35 }}
              >
                <div
                  className="no-print row-actions"
                  style={{ marginBottom: "0.5rem", gap: "0.4rem" }}
                >
                  <button
                    type="button"
                    className={`btn ${!labModalShowHistory ? "primary" : "ghost"} small`}
                    onClick={() => setLabModalShowHistory(false)}
                    style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
                  >
                    Current Report
                  </button>
                  <button
                    type="button"
                    className={`btn ${labModalShowHistory ? "primary" : "ghost"} small`}
                    onClick={() => setLabModalShowHistory(true)}
                    style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
                  >
                    View History
                  </button>
                </div>

                {!labModalShowHistory ? (
                  <>
                    <div className="only-print">
                      <ReportPrintHeader
                        clinic={clinic}
                        pet={{ ...edit!, card_id: pet!.card_id }}
                      />
                    </div>
                    <h2
                      style={{
                        fontSize: "0.9rem",
                        margin: "0.4rem 0",
                        fontWeight: 600,
                      }}
                    >
                      Laboratory report
                    </h2>
                    {labModal.testName && (
                      <p style={{ margin: "0.2rem 0", fontSize: "0.8rem" }}>
                        <strong>Test panel:</strong> {labModal.testName}
                      </p>
                    )}
                    <p style={{ margin: "0.2rem 0", fontSize: "0.8rem" }}>
                      <strong>Date:</strong>{" "}
                      {new Date(labModal.detail.created_at).toLocaleString()}
                    </p>
                    {(() => {
                      const hasUnit = labModal.detail.values.some(
                        (v) =>
                          v.unit &&
                          v.unit.trim() !== "" &&
                          v.unit.trim() !== "—",
                      );
                      const hasRange = labModal.detail.values.some(
                        (v) =>
                          (v.normal_min != null &&
                            String(v.normal_min).trim() !== "" &&
                            String(v.normal_min).trim() !== "—") ||
                          (v.normal_max != null &&
                            String(v.normal_max).trim() !== "" &&
                            String(v.normal_max).trim() !== "—"),
                      );
                      return (
                        <table
                          className="table"
                          style={{
                            width: "100%",
                            fontSize: "0.8rem",
                            marginTop: "0.4rem",
                          }}
                        >
                          <thead>
                            <tr>
                              <th
                                style={{
                                  padding: "2px 6px",
                                  fontSize: "0.65rem",
                                  textTransform: "uppercase",
                                  color: "#666",
                                  letterSpacing: "0.02em",
                                }}
                              >
                                Analyte
                              </th>
                              {hasUnit && (
                                <th
                                  style={{
                                    padding: "2px 6px",
                                    fontSize: "0.65rem",
                                    textTransform: "uppercase",
                                    color: "#666",
                                    letterSpacing: "0.02em",
                                  }}
                                >
                                  Unit
                                </th>
                              )}
                              {hasRange && (
                                <th
                                  style={{
                                    padding: "2px 6px",
                                    fontSize: "0.65rem",
                                    textTransform: "uppercase",
                                    color: "#666",
                                    letterSpacing: "0.02em",
                                  }}
                                >
                                  Reference
                                </th>
                              )}
                              <th
                                style={{
                                  padding: "2px 6px",
                                  fontSize: "0.65rem",
                                  textTransform: "uppercase",
                                  color: "#666",
                                  letterSpacing: "0.02em",
                                }}
                              >
                                Result
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {labModal.detail.values.map((v) => {
                              const h = valueHighlight(
                                v.observed_value,
                                v.normal_min,
                                v.normal_max,
                              );
                              return (
                                <tr key={v.id}>
                                  <td style={{ padding: "1px 6px" }}>
                                    {v.analyte_name}
                                  </td>
                                  {hasUnit && (
                                    <td style={{ padding: "1px 6px" }}>
                                      {v.unit ?? "—"}
                                    </td>
                                  )}
                                  {hasRange && (
                                    <td style={{ padding: "1px 6px" }}>
                                      {(v.normal_min != null &&
                                        String(v.normal_min).trim() !== "" &&
                                        String(v.normal_min).trim() !== "—") ||
                                      (v.normal_max != null &&
                                        String(v.normal_max).trim() !== "" &&
                                        String(v.normal_max).trim() !== "—")
                                        ? `${v.normal_min ?? "—"} – ${v.normal_max ?? "—"}`
                                        : "—"}
                                    </td>
                                  )}
                                  <td style={{ padding: "1px 6px" }}>
                                    <span
                                      className={
                                        h !== "ok" ? `hl-${h}-text` : undefined
                                      }
                                    >
                                      {h !== "ok" ? <strong>{v.observed_value}</strong> : v.observed_value}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      );
                    })()}
                    {labModal.detail.notes && (
                      <p style={{ margin: "0.2rem 0", fontSize: "0.8rem" }}>
                        <strong>Notes:</strong> {labModal.detail.notes}
                      </p>
                    )}
                  </>
                ) : !labModalHistoryData ? (
                  <p>Loading history…</p>
                ) : (
                  <>
                    <div className="only-print">
                      <ReportPrintHeader
                        clinic={clinic}
                        pet={{ ...edit!, card_id: pet!.card_id }}
                      />
                    </div>
                    <h2
                      style={{
                        fontSize: "0.9rem",
                        margin: "0.4rem 0",
                        fontWeight: 600,
                      }}
                    >
                      Laboratory History
                      {labModal.testName ? `: ${labModal.testName}` : ""}
                    </h2>
                    {labModal.petName && (
                      <p style={{ margin: "0.2rem 0", fontSize: "0.8rem" }}>
                        <strong>Pet:</strong> {labModal.petName}
                      </p>
                    )}
                    <div className="history-container">
                      <table
                        className="table"
                        style={{
                          width: "100%",
                          fontSize: "0.8rem",
                          borderCollapse: "collapse",
                        }}
                      >
                        <thead>
                          <tr>
                            <th
                              style={{
                                padding: "2px 6px",
                                fontSize: "0.65rem",
                                textTransform: "uppercase",
                                color: "#666",
                                letterSpacing: "0.02em",
                              }}
                            >
                              Analyte
                            </th>
                            <th
                              style={{
                                padding: "2px 6px",
                                fontSize: "0.65rem",
                                textTransform: "uppercase",
                                color: "#666",
                                letterSpacing: "0.02em",
                              }}
                            >
                              Unit
                            </th>
                            <th
                              style={{
                                padding: "2px 6px",
                                fontSize: "0.65rem",
                                textTransform: "uppercase",
                                color: "#666",
                                letterSpacing: "0.02em",
                              }}
                            >
                              Reference
                            </th>
                            {labModalHistoryData.dates.map((d) => (
                              <th
                                key={d}
                                style={{
                                  padding: "2px 6px",
                                  fontSize: "0.65rem",
                                  textTransform: "uppercase",
                                  color: "#666",
                                  letterSpacing: "0.02em",
                                  textAlign: "center",
                                }}
                              >
                                {d}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {labModalHistoryData.rows.map((r) => (
                            <tr key={r.analyteName}>
                              <td
                                style={{
                                  padding: "1px 6px",
                                  verticalAlign: "top",
                                }}
                              >
                                <strong>{r.analyteName}</strong>
                              </td>
                              <td
                                style={{
                                  padding: "1px 6px",
                                  verticalAlign: "top",
                                }}
                                className="muted small"
                              >
                                {r.unit ?? "—"}
                              </td>
                              <td
                                style={{
                                  padding: "1px 6px",
                                  verticalAlign: "top",
                                }}
                                className="muted small"
                              >
                                {r.referenceRange}
                              </td>
                              {labModalHistoryData.dates.map((d) => {
                                const entry = r.values[d];
                                const val = entry != null ? entry.value : null;
                                const h = entry != null && val != null ? valueHighlight(val, entry.normal_min, entry.normal_max) : "ok";
                                return (
                                  <td
                                    key={d}
                                    style={{
                                      padding: "1px 6px",
                                      verticalAlign: "top",
                                      textAlign: "center",
                                    }}
                                  >
                                    {val != null ? (
                                      h !== "ok" ? <strong>{val}</strong> : val
                                    ) : (
                                      <span className="muted">—</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                <div
                  className="no-print row-actions"
                  style={{ marginTop: "0.5rem", gap: "0.4rem" }}
                >
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => void printLabModal()}
                  >
                    Print / Save as PDF
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={downloadLabReportCurrent}
                  >
                    Download HTML
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setLabModal(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={saveLabModal}>
                <h2>Edit laboratory report</h2>
                {labModal.testName && (
                  <p className="muted small">
                    {labModal.petName && `${labModal.petName} · `}
                    {labModal.testName}
                  </p>
                )}
                <table className="table">
                  <thead>
                    <tr>
                      <th>Analyte</th>
                      <th>Ref</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {labModal.detail.values.map((v) => {
                      const num = Number(labModal.values[v.id] ?? "");
                      const h = valueHighlight(num, v.normal_min, v.normal_max);
                      return (
                        <tr key={v.id}>
                          <td>{v.analyte_name}</td>
                          <td>
                            {v.normal_min ?? "—"} – {v.normal_max ?? "—"}
                          </td>
                          <td>
                            <input
                              className={`narrow ${h !== "ok" ? `hl-${h}` : ""}`}
                              value={labModal.values[v.id] ?? ""}
                              onChange={(e) =>
                                setLabModal({
                                  ...labModal,
                                  values: {
                                    ...labModal.values,
                                    [v.id]: e.target.value,
                                  },
                                })
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <label>
                  Notes
                  <textarea
                    rows={2}
                    value={labModal.notes}
                    onChange={(e) =>
                      setLabModal({ ...labModal, notes: e.target.value })
                    }
                  />
                </label>
                <div className="no-print row-actions">
                  <button type="submit" className="btn primary">
                    Save changes
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => void printLabModal()}
                  >
                    Print / Save as PDF
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={downloadLabReportCurrent}
                  >
                    Download HTML
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setLabModal(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {opdEdit && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setOpdEdit(null)}
        >
          <div
            className="card modal"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Edit OPD consultation</h2>
            <form onSubmit={saveOpdEdit}>
              <div className="grid2">
                <label>
                  Temperature
                  <input
                    value={opdEditForm.temperature ?? ""}
                    onChange={(e) =>
                      setOpdEditForm({
                        ...opdEditForm,
                        temperature: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Weight
                  <input
                    value={opdEditForm.body_weight ?? ""}
                    onChange={(e) =>
                      setOpdEditForm({
                        ...opdEditForm,
                        body_weight: e.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <label>
                Dx note
                <input
                  value={opdEditForm.diagnosis_note ?? ""}
                  onChange={(e) =>
                    setOpdEditForm({
                      ...opdEditForm,
                      diagnosis_note: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                D.D note
                <input
                  value={opdEditForm.differential_diagnosis_note ?? ""}
                  onChange={(e) =>
                    setOpdEditForm({
                      ...opdEditForm,
                      differential_diagnosis_note: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Treatment remark
                <textarea
                  rows={2}
                  value={opdEditForm.clinical_treatment_remark ?? ""}
                  onChange={(e) =>
                    setOpdEditForm({
                      ...opdEditForm,
                      clinical_treatment_remark: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Food
                <input
                  value={opdEditForm.recommended_food ?? ""}
                  onChange={(e) =>
                    setOpdEditForm({
                      ...opdEditForm,
                      recommended_food: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Next visit
                <input
                  type="date"
                  value={opdEditForm.next_visit_at ?? ""}
                  onChange={(e) =>
                    setOpdEditForm({
                      ...opdEditForm,
                      next_visit_at: e.target.value,
                    })
                  }
                />
              </label>
              <p className="muted small">
                Note: Advanced fields like catalog chips and medicine lists can
                be edited by using &quot;Reopen case&quot; in the OPD tab.
              </p>
              <div className="row-actions">
                <button type="submit" className="btn primary">
                  Save
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setOpdEdit(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
