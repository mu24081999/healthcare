"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { api, valueHighlight } from "@/lib/api";
import { canManageStaffAccounts } from "@/lib/permissions";
import { appPrint, downloadHtmlFile, escapeHtml } from "@/lib/print";
import { calculateAge } from "@/lib/date";
import {
  ReportPrintHeader,
  opdRequestToPetPrint,
} from "@/components/report-print-header";
import { OpdPrescriptionPrint } from "@/components/opd-prescription-print";
import {
  duplicateOpdPetNameKeys,
  formatOpdPetName,
} from "@/lib/pet-label";
import type {
  AnalyteRow,
  ClinicRow,
  GroomingRow,
  LabOrderRow,
  LabResultValueInput,
  LabTestRow,
  MedicalRow,
  OpdCatalogItemRow,
  OpdCatalogType,
  OpdConsultationInput,
  OpdConsultationRow,
  OpdRequestRow,
  VaccinationRow,
} from "@/lib/types";

/** Matches web `pet-detail-page` print labels and preview titles. */
type OpdCaseSectionTab =
  | "vaccinations"
  | "deworming"
  | "grooming"
  | "surgery"
  | "radiology"
  | "ultrasonography";

const OPD_CASE_TAB_WEB: Record<
  OpdCaseSectionTab,
  { tabLabel: string; printTitle: string; screenTitle: string }
> = {
  vaccinations: {
    tabLabel: "Vaccinations",
    printTitle: "Vaccinations",
    screenTitle: "Vaccinations",
  },
  deworming: {
    tabLabel: "Deworming",
    printTitle: "Deworming history",
    screenTitle: "Deworming history",
  },
  grooming: {
    tabLabel: "Grooming",
    printTitle: "Grooming log",
    screenTitle: "Grooming log",
  },
  surgery: {
    tabLabel: "Surgery",
    printTitle: "Surgery report",
    screenTitle: "Surgery history",
  },
  radiology: {
    tabLabel: "Radiology",
    printTitle: "Radiology report",
    screenTitle: "Radiology",
  },
  ultrasonography: {
    tabLabel: "Ultrasonography",
    printTitle: "Ultrasonography report",
    screenTitle: "Ultrasonography",
  },
};

type TreatmentDraft = {
  name: string;
  dosage: string;
  instruction: string;
};

export default function OpdPage() {
  const { state } = useAuth();
  const isVet = state.status === "user" && state.user.role === "vet";
  const defaultDoctorName =
    state.status === "user" ? state.user.display_name : "Veterinarian";

  const [requests, setRequests] = useState<OpdRequestRow[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null,
  );
  const [petHistory, setPetHistory] = useState<OpdConsultationRow[]>([]);
  const [savedConsultation, setSavedConsultation] =
    useState<OpdConsultationRow | null>(null);
  const [labTests, setLabTests] = useState<LabTestRow[]>([]);
  const [historyCatalog, setHistoryCatalog] = useState<OpdCatalogItemRow[]>([]);
  const [dxCatalog, setDxCatalog] = useState<OpdCatalogItemRow[]>([]);
  const [ddxCatalog, setDdxCatalog] = useState<OpdCatalogItemRow[]>([]);
  const [surgeryDxCatalog, setSurgeryDxCatalog] = useState<OpdCatalogItemRow[]>(
    [],
  );
  const [surgeryDdxCatalog, setSurgeryDdxCatalog] = useState<
    OpdCatalogItemRow[]
  >([]);
  const [radiologyDxCatalog, setRadiologyDxCatalog] = useState<
    OpdCatalogItemRow[]
  >([]);
  const [radiologyDdxCatalog, setRadiologyDdxCatalog] = useState<
    OpdCatalogItemRow[]
  >([]);
  const [ultraDxCatalog, setUltraDxCatalog] = useState<OpdCatalogItemRow[]>([]);
  const [ultraDdxCatalog, setUltraDdxCatalog] = useState<OpdCatalogItemRow[]>(
    [],
  );
  const [medCatalog, setMedCatalog] = useState<OpdCatalogItemRow[]>([]);
  const [foodCatalog, setFoodCatalog] = useState<OpdCatalogItemRow[]>([]);
  const [symptomCatalog, setSymptomCatalog] = useState<OpdCatalogItemRow[]>([]);

  const [caseSurgeryDxItems, setCaseSurgeryDxItems] = useState<string[]>([]);
  const [caseSurgeryDdxItems, setCaseSurgeryDdxItems] = useState<string[]>([]);
  const [caseRadiologyDxItems, setCaseRadiologyDxItems] = useState<string[]>(
    [],
  );
  const [caseRadiologyDdxItems, setCaseRadiologyDdxItems] = useState<string[]>(
    [],
  );
  const [caseUltraDxItems, setCaseUltraDxItems] = useState<string[]>([]);
  const [caseUltraDdxItems, setCaseUltraDdxItems] = useState<string[]>([]);

  const [caseSurgeryDxNote, setCaseSurgeryDxNote] = useState("");
  const [caseSurgeryDdxNote, setCaseSurgeryDdxNote] = useState("");
  const [caseRadiologyDxNote, setCaseRadiologyDxNote] = useState("");
  const [caseRadiologyDdxNote, setCaseRadiologyDdxNote] = useState("");
  const [caseUltraDxNote, setCaseUltraDxNote] = useState("");
  const [caseUltraDdxNote, setCaseUltraDdxNote] = useState("");

  const [clinic, setClinic] = useState<ClinicRow | null>(null);
  const [summary, setSummary] = useState<{
    checked_today: number;
    checked_week: number;
    checked_month: number;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [caseTab, setCaseTab] = useState<
    | "prescription"
    | "vaccinations"
    | "deworming"
    | "grooming"
    | "surgery"
    | "radiology"
    | "ultrasonography"
    | "lab_test"
  >("prescription");
  const [caseVaccinations, setCaseVaccinations] = useState<VaccinationRow[]>(
    [],
  );
  const [caseGrooming, setCaseGrooming] = useState<GroomingRow[]>([]);
  const [caseMedical, setCaseMedical] = useState<MedicalRow[]>([]);
  const [caseVaccineName, setCaseVaccineName] = useState("");
  const [caseVaxWeight, setCaseVaxWeight] = useState("");
  const [caseDewormWeight, setCaseDewormWeight] = useState("");
  const [caseGroomingWeight, setCaseGroomingWeight] = useState("");
  const [caseSurgeryWeight, setCaseSurgeryWeight] = useState("");
  const [caseRadiologyWeight, setCaseRadiologyWeight] = useState("");
  const [caseUltraWeight, setCaseUltraWeight] = useState("");

  const [printingItem, setPrintingItem] = useState<any | null>(null);

  async function printMedicalEntry(m: MedicalRow) {
    setPrintingItem(m);
    // Wait for DOM to update
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
    try {
      await appPrint({ opdPrintMode: "case-tab" });
    } finally {
      setPrintingItem(null);
    }
  }

  const [caseVaxGiven, setCaseVaxGiven] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [caseVaxDue, setCaseVaxDue] = useState("");
  const [caseVaxReminder, setCaseVaxReminder] = useState(7);
  const [caseVaxNotes, setCaseVaxNotes] = useState("");

  const [caseDewormingName, setCaseDewormingName] = useState("");
  const [caseDewormGiven, setCaseDewormGiven] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [caseDewormDue, setCaseDewormDue] = useState("");
  const [caseDewormReminder, setCaseDewormReminder] = useState(7);
  const [caseDewormNotes, setCaseDewormNotes] = useState("");

  const [caseGroomingService, setCaseGroomingService] = useState("");
  const [caseGroomingGiven, setCaseGroomingGiven] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [caseGroomingDue, setCaseGroomingDue] = useState("");
  const [caseGroomingReminder, setCaseGroomingReminder] = useState(7);
  const [caseGroomingNote, setCaseGroomingNote] = useState("");

  const [caseSurgeryName, setCaseSurgeryName] = useState("");
  const [caseSurgeryRemark, setCaseSurgeryRemark] = useState("");
  const [caseRadiologyPath, setCaseRadiologyPath] = useState("");
  const [caseRadiologyPaths, setCaseRadiologyPaths] = useState<string[]>([]);
  const [caseRadiologyRemark, setCaseRadiologyRemark] = useState("");
  const [caseUltraPath, setCaseUltraPath] = useState("");
  const [caseUltraPaths, setCaseUltraPaths] = useState<string[]>([]);
  const [caseUltraRemark, setCaseUltraRemark] = useState("");

  const [caseEditingVaccId, setCaseEditingVaccId] = useState<string | null>(
    null,
  );
  const [caseEditingGroomId, setCaseEditingGroomId] = useState<string | null>(
    null,
  );
  const [caseEditingMedicalId, setCaseEditingMedicalId] = useState<
    string | null
  >(null);

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

  function rowImage(m: MedicalRow, alt: string) {
    const paths =
      m.external_file_paths && m.external_file_paths.length > 0
        ? m.external_file_paths
        : canPreviewImage(m.external_file_path)
          ? [m.external_file_path]
          : [];

    if (paths.length === 0) return null;

    return (
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: 6 }}
      >
        {paths.map((p: string, i: number) => (
          <img
            key={i}
            src={p}
            alt={`${alt} ${i + 1}`}
            style={{
              maxWidth: "200px",
              display: "block",
              objectFit: "contain",
            }}
          />
        ))}
      </div>
    );
  }

  const [temperature, setTemperature] = useState("");
  const [physicalExam, setPhysicalExam] = useState("");
  const [historyObservations, setHistoryObservations] = useState<string[]>([]);
  const [dxItems, setDxItems] = useState<string[]>([]);
  const [ddxItems, setDdxItems] = useState<string[]>([]);
  const [dxNote, setDxNote] = useState("");
  const [ddNote, setDdNote] = useState("");
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [labTestIds, setLabTestIds] = useState<string[]>([]);
  const [otherTests, setOtherTests] = useState("");
  const [medicines, setMedicines] = useState<TreatmentDraft[]>([]);
  const [treatmentRemark, setTreatmentRemark] = useState("");
  const [inHousePrescription, setInHousePrescription] = useState("");
  const [food, setFood] = useState("");
  const [nextVisit, setNextVisit] = useState("");
  const [doctorName, setDoctorName] = useState(defaultDoctorName);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [prescriptionWeight, setPrescriptionWeight] = useState("");
  const [editingConsultationId, setEditingConsultationId] = useState<
    string | null
  >(null);

  // Lab Test tab states
  const [labOrders, setLabOrders] = useState<LabOrderRow[]>([]);
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

  const selectedRequest = useMemo(
    () => requests.find((r) => r.id === selectedRequestId) ?? null,
    [requests, selectedRequestId],
  );

  const draftStorageKey = (requestId: string) => `opd-draft:${requestId}`;

  function buildConsultationInput(): OpdConsultationInput {
    return {
      request_id: selectedRequest?.id ?? "",
      temperature: temperature.trim() || null,
      body_weight: prescriptionWeight.trim() || null,
      physical_exam: physicalExam.trim() || null,
      history_observations: historyObservations,
      dx_items: dxItems,
      ddx_items: ddxItems,
      diagnosis_note: dxNote || null,
      differential_diagnosis_note: ddNote || null,
      symptoms,
      recommended_lab_test_ids: labTestIds,
      custom_lab_tests: otherTests
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      medicines: medicines
        .map((m) => ({
          name: m.name.trim(),
          dosage: m.dosage.trim() || null,
          direction_per_day: m.instruction.trim() || null,
        }))
        .filter((m) => Boolean(m.name)),
      clinical_treatment_remark: treatmentRemark.trim() || null,
      in_house_prescription: inHousePrescription.trim() || null,
      recommended_food: food.trim() || null,
      next_visit_at: nextVisit || null,
      doctor_signature_name: doctorName.trim() || defaultDoctorName,
    };
  }

  function loadDraftForRequest(requestId: string) {
    try {
      const raw = window.localStorage.getItem(draftStorageKey(requestId));
      if (!raw) return null;
      return JSON.parse(raw) as Omit<OpdConsultationInput, "request_id">;
    } catch {
      return null;
    }
  }

  /** Shared by localStorage drafts and persisted consultations (e.g. reopened OPD). */
  function hydratePrescriptionForm(
    d: {
      temperature?: string | null;
      physical_exam?: string | null;
      history_observations?: string[];
      dx_items?: string[];
      ddx_items?: string[];
      diagnosis_note?: string | null;
      differential_diagnosis_note?: string | null;
      symptoms?: string[];
      recommended_lab_test_ids?: string[];
      custom_lab_tests?: string[];
      medicines?: {
        name: string;
        dosage?: string | null;
        direction_per_day?: string | null;
      }[];
      clinical_treatment_remark?: string | null;
      in_house_prescription?: string | null;
      recommended_food?: string | null;
      next_visit_at?: string | null;
      doctor_signature_name?: string;
      body_weight?: string | null;
    },
    doctorFallback: string,
  ) {
    setTemperature(d.temperature ?? "");
    setPhysicalExam(d.physical_exam ?? "");
    setHistoryObservations(d.history_observations ?? []);
    setDxItems(d.dx_items ?? []);
    setDdxItems(d.ddx_items ?? []);
    setDxNote(d.diagnosis_note ?? "");
    setDdNote(d.differential_diagnosis_note ?? "");
    setSymptoms(d.symptoms ?? []);
    setLabTestIds(d.recommended_lab_test_ids ?? []);
    setOtherTests((d.custom_lab_tests ?? []).join(", "));
    setMedicines(
      (d.medicines ?? []).map((m) => ({
        name: m.name ?? "",
        dosage: m.dosage ?? "",
        instruction: m.direction_per_day ?? "",
      })),
    );
    setTreatmentRemark(d.clinical_treatment_remark ?? "");
    setInHousePrescription(d.in_house_prescription ?? "");
    setFood(d.recommended_food ?? "");
    setNextVisit(d.next_visit_at ?? "");
    setDoctorName(d.doctor_signature_name ?? doctorFallback);
    setPrescriptionWeight(d.body_weight ?? "");
  }

  function startEditConsultation(c: OpdConsultationRow) {
    setEditingConsultationId(c.id);
    hydratePrescriptionForm(c, c.doctor_signature_name);
    setCaseTab("prescription");
  }

  function cancelConsultationEdit() {
    setEditingConsultationId(null);
    if (selectedRequest) {
      const d = loadDraftForRequest(selectedRequest.id);
      if (d) {
        hydratePrescriptionForm(d, defaultDoctorName);
      } else {
        hydratePrescriptionForm({}, defaultDoctorName);
      }
    }
  }

  function saveDraft() {
    if (!selectedRequest) return;
    const input = buildConsultationInput();
    window.localStorage.setItem(
      draftStorageKey(selectedRequest.id),
      JSON.stringify(input),
    );
    setDraftSavedAt(new Date().toISOString());
    setErr(null);
  }

  function removeDraft(requestId: string) {
    window.localStorage.removeItem(draftStorageKey(requestId));
  }

  async function loadCore() {
    setErr(null);
    try {
      const [
        reqs,
        tests,
        historyItems,
        dx,
        ddx,
        surgeryDx,
        surgeryDdx,
        radiologyDx,
        radiologyDdx,
        ultraDx,
        ultraDdx,
        meds,
        foods,
        symptoms,
        opdSummary,
        clinicData,
      ] = await Promise.all([
        api.opdRequestsList("open"),
        api.labTestsList(),
        api.opdCatalogList("history_observation"),
        api.opdCatalogList("dx"),
        api.opdCatalogList("ddx"),
        api.opdCatalogList("surgery_dx"),
        api.opdCatalogList("surgery_ddx"),
        api.opdCatalogList("radiology_dx"),
        api.opdCatalogList("radiology_ddx"),
        api.opdCatalogList("ultrasonography_dx"),
        api.opdCatalogList("ultrasonography_ddx"),
        api.opdCatalogList("medicine"),
        api.opdCatalogList("food"),
        api.opdCatalogList("symptom"),
        api.opdDashboard(),
        api.clinicGet(),
      ]);
      setRequests(reqs);
      setLabTests(tests);
      setHistoryCatalog(historyItems);
      setDxCatalog(dx);
      setDdxCatalog(ddx);
      setSurgeryDxCatalog(surgeryDx);
      setSurgeryDdxCatalog(surgeryDdx);
      setRadiologyDxCatalog(radiologyDx);
      setRadiologyDdxCatalog(radiologyDdx);
      setUltraDxCatalog(ultraDx);
      setUltraDdxCatalog(ultraDdx);
      setMedCatalog(meds);
      setFoodCatalog(foods);
      setSymptomCatalog(symptoms);
      setSummary({
        checked_today: opdSummary.checked_today,
        checked_week: opdSummary.checked_week,
        checked_month: opdSummary.checked_month,
      });
      setClinic(clinicData);
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    void loadCore();
  }, []);

  const duplicateOpdNames = duplicateOpdPetNameKeys(requests);

  useEffect(() => {
    setDoctorName(defaultDoctorName);
  }, [defaultDoctorName]);

  useEffect(() => {
    setCaseEditingVaccId(null);
    setCaseEditingGroomId(null);
    setCaseEditingMedicalId(null);
    if (caseTab !== "lab_test") {
      setLabOrderId("");
      setLabSavedReport(null);
      setLabNotes("");
      setLastLabOrder(null);
      setLabTabErr(null);
    }
  }, [caseTab]);

  async function loadLabOrdersForPet(petId: string) {
    setLabTabErr(null);
    try {
      const o = await api.labOrdersForPet(petId);
      setLabOrders(o.filter((x) => x.status === "pending"));
    } catch (e) {
      setLabTabErr(String(e));
    }
  }

  useEffect(() => {
    if (caseTab === "lab_test" && selectedRequest) {
      void loadLabOrdersForPet(selectedRequest.pet_id);
    }
  }, [caseTab, selectedRequest]);

  useEffect(() => {
    if (labTests.length > 0 && !labTestId) {
      setLabTestId(labTests[0].id);
    }
  }, [labTests, labTestId]);

  const selectedLabOrder = useMemo(
    () => labOrders.find((o) => o.id === labOrderId),
    [labOrders, labOrderId],
  );

  useEffect(() => {
    if (!selectedLabOrder) {
      setLabAnalytes([]);
      setLabValues({});
      return;
    }
    setLabTabErr(null);
    api
      .labAnalytesList(selectedLabOrder.lab_test_id)
      .then((rows) => {
        setLabAnalytes(rows);
        const init: Record<string, string> = {};
        rows.forEach((a) => {
          init[a.id] = "";
        });
        setLabValues(init);
      })
      .catch((e) => setLabTabErr(String(e)));
  }, [selectedLabOrder]);

  async function openRequest(r: OpdRequestRow) {
    setErr(null);
    try {
      let chosen = r;
      if (isVet && (r.status === "pending" || !r.assigned_vet_id)) {
        chosen = await api.opdRequestClaim(r.id);
      }
      setSelectedRequestId(chosen.id);
      setRequests((prev) => prev.map((x) => (x.id === chosen.id ? chosen : x)));
      const [history, vaccinations, grooming, medical] = await Promise.all([
        api.opdConsultationsList(chosen.pet_id),
        api.vaccinationsList(chosen.pet_id),
        api.groomingList(chosen.pet_id),
        api.medicalList(chosen.pet_id),
      ]);
      setPetHistory(history);
      setCaseVaccinations(vaccinations);
      setCaseGrooming(grooming);
      setCaseMedical(medical);
      setCaseEditingVaccId(null);
      setCaseEditingGroomId(null);
      setCaseEditingMedicalId(null);
      setCaseTab("prescription");
      setSavedConsultation(null);
      setTemperature("");
      setPhysicalExam("");
      setHistoryObservations([]);
      setDxItems([]);
      setDdxItems([]);
      setDxNote("");
      setDdNote("");
      setCaseSurgeryDxItems([]);
      setCaseSurgeryDdxItems([]);
      setCaseRadiologyDxItems([]);
      setCaseRadiologyDdxItems([]);
      setCaseUltraDxItems([]);
      setCaseUltraDdxItems([]);

      setCaseSurgeryDxNote("");
      setCaseSurgeryDdxNote("");
      setCaseRadiologyDxNote("");
      setCaseRadiologyDdxNote("");
      setCaseUltraDxNote("");
      setCaseUltraDdxNote("");

      setSymptoms([]);
      setLabTestIds([]);
      setOtherTests("");
      setMedicines([]);
      setTreatmentRemark("");
      setInHousePrescription("");
      setFood("");
      setNextVisit("");
      setDoctorName(defaultDoctorName);
      setDraftSavedAt(null);

      const priorForRequest = history
        .filter((h) => h.request_id === chosen.id)
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )[0];

      const draft = loadDraftForRequest(chosen.id);
      if (priorForRequest) {
        hydratePrescriptionForm(
          {
            temperature: priorForRequest.temperature,
            physical_exam: priorForRequest.physical_exam,
            history_observations: priorForRequest.history_observations,
            dx_items: priorForRequest.dx_items,
            ddx_items: priorForRequest.ddx_items,
            diagnosis_note: priorForRequest.diagnosis_note,
            differential_diagnosis_note:
              priorForRequest.differential_diagnosis_note,
            symptoms: priorForRequest.symptoms,
            recommended_lab_test_ids: priorForRequest.recommended_lab_test_ids,
            custom_lab_tests: priorForRequest.custom_lab_tests,
            medicines: priorForRequest.medicines,
            clinical_treatment_remark:
              priorForRequest.clinical_treatment_remark,
            in_house_prescription: priorForRequest.in_house_prescription,
            recommended_food: priorForRequest.recommended_food,
            next_visit_at: priorForRequest.next_visit_at,
            doctor_signature_name: priorForRequest.doctor_signature_name,
            body_weight: priorForRequest.body_weight,
          },
          defaultDoctorName,
        );
      }
      if (draft) {
        hydratePrescriptionForm(draft, defaultDoctorName);
        setDraftSavedAt(new Date().toISOString());
      }
    } catch (e) {
      setErr(String(e));
    }
  }

  async function submitConsultation(e?: FormEvent) {
    e?.preventDefault();
    if (!selectedRequest || !isVet) return;
    setErr(null);
    setBusy(true);
    try {
      const input = buildConsultationInput();
      let saved: OpdConsultationRow;
      if (editingConsultationId) {
        saved = await api.opdConsultationUpdate(editingConsultationId, input);
        setEditingConsultationId(null);
      } else {
        saved = await api.opdConsultationCreate(input);
      }
      if (selectedRequest) {
        removeDraft(selectedRequest.id);
      }
      setSavedConsultation(saved);
      setSelectedRequestId(null);
      setPetHistory([]);
      await loadCore();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteHistoryEntry(entry: OpdConsultationRow) {
    setErr(null);
    try {
      await api.opdConsultationDelete(entry.id);
      if (selectedRequest) {
        setPetHistory(await api.opdConsultationsList(selectedRequest.pet_id));
      } else {
        setPetHistory((prev) => prev.filter((x) => x.id !== entry.id));
      }
      setSavedConsultation((prev) => (prev?.id === entry.id ? null : prev));
      await loadCore();
    } catch (e) {
      setErr(String(e));
    }
  }

  function toggleChip(
    value: string,
    setState: (next: string[]) => void,
    current: string[],
  ) {
    setState(
      current.includes(value)
        ? current.filter((x) => x !== value)
        : [...current, value],
    );
  }

  function toggleLabTest(id: string) {
    setLabTestIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleMedicine(name: string) {
    setMedicines((prev) => {
      const exists = prev.some((m) => m.name === name);
      if (exists) return prev.filter((m) => m.name !== name);
      return [...prev, { name, dosage: "", instruction: "" }];
    });
  }

  function updateMedicine(index: number, patch: Partial<TreatmentDraft>) {
    setMedicines((prev) =>
      prev.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    );
  }

  async function addCatalogChip(itemType: OpdCatalogType, label: string) {
    const name = prompt(`Add new ${label}`);
    if (!name?.trim()) return;
    try {
      await api.opdCatalogCreate(itemType, name.trim());
      await loadCore();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function printPrescription() {
    try {
      await appPrint({ opdPrintMode: "prescription" });
    } catch (e) {
      setErr(String(e));
    }
  }

  async function createLabOrder(e: FormEvent) {
    e.preventDefault();
    if (!selectedRequest) return;
    setLabTabErr(null);
    try {
      const order = await api.labOrderCreate({
        pet_id: selectedRequest.pet_id,
        lab_test_id: labTestId,
        tentative_report_at: labTentative || null,
      });
      // Refresh the orders list
      const o = await api.labOrdersForPet(selectedRequest.pet_id);
      const pending = o.filter((x) => x.status === "pending");
      setLabOrders(pending);
      // Set last created order
      const t = labTests.find((x) => x.id === order.lab_test_id);
      setLastLabOrderTestName(t?.name ?? order.lab_test_id);
      setLastLabOrder(order);
      // Automatically select the newly created order
      setLabOrderId(order.id);
      // Clear order form inputs
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
      if (selectedRequest) {
        void loadLabOrdersForPet(selectedRequest.pet_id);
      }
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
    if (!labSavedReport || !selectedRequest) return;
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
    <p><strong>Pet:</strong> ${escapeHtml(selectedRequest.pet_name)}</p>
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
    if (!lastLabOrder || !selectedRequest) return;
    const petLine = `${escapeHtml(selectedRequest.pet_name)} (${escapeHtml(selectedRequest.species ?? "—")})`;
    const ownerLine = selectedRequest.owner_name
      ? escapeHtml(selectedRequest.owner_name)
      : "—";
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

  function renderCaseTabDataPreview(): ReactNode {
    if (
      caseTab === "prescription" ||
      caseTab === "lab_test" ||
      !selectedRequest
    )
      return null;
    const tab = caseTab as OpdCaseSectionTab;

    if (tab === "vaccinations") {
      return (
        <table className="table" style={{ width: "100%", fontSize: "0.92rem" }}>
          <thead>
            <tr>
              <th>Vaccine</th>
              <th>Weight</th>
              <th>Given</th>
              <th>Due</th>
              <th>Remind</th>
              <th>Notes</th>
              <th className="no-print right"> </th>
            </tr>
          </thead>
          <tbody>
            {caseVaccinations.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No vaccination rows yet.
                </td>
              </tr>
            ) : (
              caseVaccinations.map((v) => (
                <tr key={v.id}>
                  <td>{v.vaccine_name}</td>
                  <td>{v.body_weight ?? "—"}</td>
                  <td>{v.administered_date ?? "—"}</td>
                  <td>{v.next_due_date ?? "—"}</td>
                  <td>{v.reminder_days_before ?? "—"}</td>
                  <td style={{ whiteSpace: "pre-wrap" }}>{v.notes ?? "—"}</td>
                  <td className="no-print right">
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => startEditVaccination(v)}
                    >
                      Edit
                    </button>{" "}
                    <button
                      type="button"
                      className="btn danger ghost small"
                      onClick={() => void deleteCaseVaccinationRow(v.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      );
    }

    if (tab === "grooming") {
      return (
        <table className="table" style={{ width: "100%", fontSize: "0.92rem" }}>
          <thead>
            <tr>
              <th>Service</th>
              <th>Weight</th>
              <th>Performed</th>
              <th>Given</th>
              <th>Due</th>
              <th>Remind</th>
              <th>Notes</th>
              <th className="no-print right"> </th>
            </tr>
          </thead>
          <tbody>
            {caseGrooming.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  No grooming rows yet.
                </td>
              </tr>
            ) : (
              caseGrooming.map((g) => (
                <tr key={g.id}>
                  <td>{g.service_type}</td>
                  <td>{g.body_weight ?? "—"}</td>
                  <td>{g.performed_date}</td>
                  <td>{g.administered_date ?? "—"}</td>
                  <td>{g.next_due_date ?? "—"}</td>
                  <td>{g.reminder_days_before ?? "—"}</td>
                  <td style={{ whiteSpace: "pre-wrap" }}>{g.notes ?? "—"}</td>
                  <td className="no-print right">
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => startEditGroomRow(g)}
                    >
                      Edit
                    </button>{" "}
                    <button
                      type="button"
                      className="btn danger ghost small"
                      onClick={() => void deleteCaseGroomRow(g.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      );
    }

    if (tab === "deworming") {
      const rows = caseMedical.filter((m) => m.entry_type === "deworming");
      return (
        <table className="table" style={{ width: "100%", fontSize: "0.92rem" }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Weight</th>
              <th>Given</th>
              <th>Due</th>
              <th>Remind</th>
              <th>Notes</th>
              <th className="no-print right"> </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No deworming rows yet.
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.id}>
                  <td>{m.title}</td>
                  <td>{m.body_weight ?? "—"}</td>
                  <td>{m.administered_date ?? "—"}</td>
                  <td>{m.next_due_date ?? "—"}</td>
                  <td>{m.reminder_days_before ?? "—"}</td>
                  <td style={{ whiteSpace: "pre-wrap" }}>{m.body ?? "—"}</td>
                  <td className="no-print right">
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => startEditMedicalRow(m)}
                    >
                      Edit
                    </button>{" "}
                    <button
                      type="button"
                      className="btn danger ghost small"
                      onClick={() => void deleteCaseMedicalRow(m.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      );
    }

    if (tab === "surgery") {
      const rows = caseMedical.filter((m) => m.entry_type === "surgery");
      return (
        <table className="table" style={{ width: "100%", fontSize: "0.92rem" }}>
          <thead>
            <tr>
              <th>Surgery</th>
              <th>Details</th>
              <th className="no-print right"> </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  No surgery entries yet.
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.id}>
                  <td style={{ verticalAlign: "top" }}>{m.title}</td>
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
                        <div>
                          <strong>Dx:</strong> {m.dx_note}
                        </div>
                      )}
                      {m.ddx_note && (
                        <div>
                          <strong>D.D:</strong> {m.ddx_note}
                        </div>
                      )}
                      <div>
                        <strong>Remarks:</strong> {m.body ?? "—"}
                      </div>
                    </div>
                  </td>
                  <td className="no-print right">
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => printMedicalEntry(m)}
                    >
                      Print
                    </button>{" "}
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => startEditMedicalRow(m)}
                    >
                      Edit
                    </button>{" "}
                    <button
                      type="button"
                      className="btn danger ghost small"
                      onClick={() => void deleteCaseMedicalRow(m.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      );
    }

    if (tab === "radiology") {
      const rows = caseMedical.filter((m) => m.entry_type === "radiology");
      if (rows.length === 0) {
        return <p className="muted">No radiology entries yet.</p>;
      }
      return (
        <div style={{ fontSize: "0.92rem" }}>
          {rows.map((m) => {
            const dxLine = joinedCatalogNote(m.dx_items, m.dx_note);
            const ddxLine = joinedCatalogNote(m.ddx_items, m.ddx_note);
            const showPathFallback =
              Boolean(m.external_file_path) &&
              !canPreviewImage(m.external_file_path);
            return (
              <div
                key={m.id}
                style={{
                  marginBottom: "0.85rem",
                  borderBottom: "1px solid #e0e0e0",
                  paddingBottom: "0.65rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    {m.external_file_paths &&
                    m.external_file_paths.length > 0 ? (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "10px",
                          marginBottom: "0.5rem",
                        }}
                      >
                        {m.external_file_paths.map((p: string, i: number) => (
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
                        ))}
                      </div>
                    ) : canPreviewImage(m.external_file_path) ? (
                      <img
                        src={m.external_file_path}
                        alt="Radiology"
                        style={{
                          maxWidth: "300px",
                          maxHeight: "300px",
                          display: "block",
                          objectFit: "contain",
                          marginBottom: "0.5rem",
                        }}
                      />
                    ) : null}
                    {showPathFallback ? (
                      <div className="small muted" style={{ marginTop: 6 }}>
                        File: {m.external_file_path}
                      </div>
                    ) : null}
                    {(m.body ?? "").trim() ? (
                      <div
                        style={{ marginTop: "0.35rem", whiteSpace: "pre-wrap" }}
                      >
                        {m.body}
                      </div>
                    ) : null}
                    {dxLine ? (
                      <div className="small" style={{ marginTop: "0.25rem" }}>
                        <strong>Dx:</strong> {dxLine}
                      </div>
                    ) : null}
                    {ddxLine ? (
                      <div className="small" style={{ marginTop: "0.2rem" }}>
                        <strong>D.D:</strong> {ddxLine}
                      </div>
                    ) : null}
                  </div>
                  <div
                    className="no-print row-actions"
                    style={{ flexShrink: 0 }}
                  >
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => printMedicalEntry(m)}
                    >
                      Print
                    </button>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => startEditMedicalRow(m)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn danger ghost small"
                      onClick={() => void deleteCaseMedicalRow(m.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (tab === "ultrasonography") {
      const rows = caseMedical.filter(
        (m) => m.entry_type === "ultrasonography",
      );
      if (rows.length === 0) {
        return <p className="muted">No ultrasonography entries yet.</p>;
      }
      return (
        <div style={{ fontSize: "0.92rem" }}>
          {rows.map((m) => {
            const dxLine = joinedCatalogNote(m.dx_items, m.dx_note);
            const ddxLine = joinedCatalogNote(m.ddx_items, m.ddx_note);
            const showPathFallback =
              Boolean(m.external_file_path) &&
              !canPreviewImage(m.external_file_path);
            return (
              <div
                key={m.id}
                style={{
                  marginBottom: "0.85rem",
                  borderBottom: "1px solid #e0e0e0",
                  paddingBottom: "0.65rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    {m.external_file_paths &&
                    m.external_file_paths.length > 0 ? (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "10px",
                          marginBottom: "0.5rem",
                        }}
                      >
                        {m.external_file_paths.map((p: string, i: number) => (
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
                        ))}
                      </div>
                    ) : canPreviewImage(m.external_file_path) ? (
                      <img
                        src={m.external_file_path}
                        alt="Ultrasonography"
                        style={{
                          maxWidth: "300px",
                          maxHeight: "300px",
                          display: "block",
                          objectFit: "contain",
                          marginBottom: "0.5rem",
                        }}
                      />
                    ) : null}
                    {showPathFallback ? (
                      <div className="small muted" style={{ marginTop: 6 }}>
                        File: {m.external_file_path}
                      </div>
                    ) : null}
                    {(m.body ?? "").trim() ? (
                      <div
                        style={{ marginTop: "0.35rem", whiteSpace: "pre-wrap" }}
                      >
                        {m.body}
                      </div>
                    ) : null}
                    {dxLine ? (
                      <div className="small" style={{ marginTop: "0.25rem" }}>
                        <strong>Dx:</strong> {dxLine}
                      </div>
                    ) : null}
                    {ddxLine ? (
                      <div className="small" style={{ marginTop: "0.2rem" }}>
                        <strong>D.D:</strong> {ddxLine}
                      </div>
                    ) : null}
                  </div>
                  <div
                    className="no-print row-actions"
                    style={{ flexShrink: 0 }}
                  >
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => printMedicalEntry(m)}
                    >
                      Print
                    </button>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => startEditMedicalRow(m)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn danger ghost small"
                      onClick={() => void deleteCaseMedicalRow(m.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    return null;
  }

  function renderPrescriptionDraftPrintBody(): ReactNode {
    if (!selectedRequest) return null;
    const input = buildConsultationInput();
    const labNames = labTests
      .filter((t) => labTestIds.includes(t.id))
      .map((t) => t.name);

    return (
      <OpdPrescriptionPrint
        clinic={clinic}
        pet={opdRequestToPetPrint(selectedRequest)}
        isDraft
        consultation={{
          temperature: input.temperature,
          physical_exam: input.physical_exam,
          history_observations: input.history_observations ?? [],
          dx_items: input.dx_items ?? [],
          ddx_items: input.ddx_items ?? [],
          diagnosis_note: input.diagnosis_note,
          differential_diagnosis_note: input.differential_diagnosis_note,
          symptoms: input.symptoms ?? [],
          recommended_lab_test_names: labNames,
          custom_lab_tests: input.custom_lab_tests ?? [],
          medicines: (input.medicines ?? []).map((m) => ({
            name: m.name,
            dosage: m.dosage ?? null,
            direction_per_day: m.direction_per_day ?? null,
          })),
          clinical_treatment_remark: input.clinical_treatment_remark,
          in_house_prescription: input.in_house_prescription,
          recommended_food: input.recommended_food,
          next_visit_at: input.next_visit_at,
          doctor_signature_name: input.doctor_signature_name,
        }}
      />
    );
  }

  async function reloadCaseSections(petId: string) {
    const [vaccinations, grooming, medical] = await Promise.all([
      api.vaccinationsList(petId),
      api.groomingList(petId),
      api.medicalList(petId),
    ]);
    setCaseVaccinations(vaccinations);
    setCaseGrooming(grooming);
    setCaseMedical(medical);
  }

  function joinedCatalogNote(
    items: string[] | null | undefined,
    note: string | null | undefined,
  ): string | null {
    const parts = [
      ...(items ?? []).map((s) => s.trim()).filter(Boolean),
      (note ?? "").trim(),
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }

  function cancelCaseSectionEdit() {
    setCaseEditingVaccId(null);
    setCaseEditingGroomId(null);
    setCaseEditingMedicalId(null);
    const today = new Date().toISOString().slice(0, 10);
    if (caseTab === "vaccinations") {
      setCaseVaccineName("");
      setCaseVaxWeight("");
      setCaseVaxGiven(today);
      setCaseVaxDue("");
      setCaseVaxReminder(7);
      setCaseVaxNotes("");
    } else if (caseTab === "deworming") {
      setCaseDewormingName("");
      setCaseDewormWeight("");
      setCaseDewormGiven(today);
      setCaseDewormDue("");
      setCaseDewormReminder(7);
      setCaseDewormNotes("");
    } else if (caseTab === "grooming") {
      setCaseGroomingService("");
      setCaseGroomingWeight("");
      setCaseGroomingGiven(today);
      setCaseGroomingDue("");
      setCaseGroomingReminder(7);
      setCaseGroomingNote("");
    } else if (caseTab === "surgery") {
      setCaseSurgeryName("");
      setCaseSurgeryWeight("");
      setCaseSurgeryRemark("");
      setCaseSurgeryDxItems([]);
      setCaseSurgeryDdxItems([]);
      setCaseSurgeryDxNote("");
      setCaseSurgeryDdxNote("");
    } else if (caseTab === "radiology") {
      setCaseRadiologyRemark("");
      setCaseRadiologyWeight("");
      setCaseRadiologyPath("");
      setCaseRadiologyPaths([]);
      setCaseRadiologyDxItems([]);
      setCaseRadiologyDdxItems([]);
      setCaseRadiologyDxNote("");
      setCaseRadiologyDdxNote("");
    } else if (caseTab === "ultrasonography") {
      setCaseUltraRemark("");
      setCaseUltraWeight("");
      setCaseUltraPath("");
      setCaseUltraPaths([]);
      setCaseUltraDxItems([]);
      setCaseUltraDdxItems([]);
      setCaseUltraDxNote("");
      setCaseUltraDdxNote("");
    }
  }

  function startEditVaccination(v: VaccinationRow) {
    setCaseEditingGroomId(null);
    setCaseEditingMedicalId(null);
    setCaseEditingVaccId(v.id);
    setCaseVaccineName(v.vaccine_name);
    setCaseVaxWeight(v.body_weight ?? "");
    setCaseVaxGiven(
      v.administered_date ?? new Date().toISOString().slice(0, 10),
    );
    setCaseVaxDue(v.next_due_date ?? "");
    setCaseVaxReminder(v.reminder_days_before ?? 7);
    setCaseVaxNotes(v.notes ?? "");
  }

  function startEditGroomRow(g: GroomingRow) {
    setCaseEditingVaccId(null);
    setCaseEditingMedicalId(null);
    setCaseEditingGroomId(g.id);
    setCaseGroomingService(g.service_type);
    setCaseGroomingWeight(g.body_weight ?? "");
    setCaseGroomingGiven(
      g.administered_date ?? new Date().toISOString().slice(0, 10),
    );
    setCaseGroomingDue(g.next_due_date ?? "");
    setCaseGroomingReminder(g.reminder_days_before ?? 7);
    setCaseGroomingNote(g.notes ?? "");
  }

  function startEditMedicalRow(m: MedicalRow) {
    setCaseEditingVaccId(null);
    setCaseEditingGroomId(null);
    setCaseEditingMedicalId(m.id);
    const today = new Date().toISOString().slice(0, 10);
    if (m.entry_type === "deworming") {
      setCaseDewormingName(m.title ?? "");
      setCaseDewormWeight(m.body_weight ?? "");
      setCaseDewormGiven(m.administered_date ?? today);
      setCaseDewormDue(m.next_due_date ?? "");
      setCaseDewormReminder(m.reminder_days_before ?? 7);
      setCaseDewormNotes(m.body ?? "");
    } else if (m.entry_type === "surgery") {
      setCaseSurgeryName(m.title ?? "");
      setCaseSurgeryWeight(m.body_weight ?? "");
      setCaseSurgeryRemark(m.body ?? "");
      setCaseSurgeryDxItems(m.dx_items ?? []);
      setCaseSurgeryDdxItems(m.ddx_items ?? []);
      setCaseSurgeryDxNote(m.dx_note ?? "");
      setCaseSurgeryDdxNote(m.ddx_note ?? "");
    } else if (m.entry_type === "radiology") {
      setCaseRadiologyPath(m.external_file_path ?? "");
      setCaseRadiologyPaths(m.external_file_paths ?? []);
      setCaseRadiologyWeight(m.body_weight ?? "");
      setCaseRadiologyRemark(m.body ?? "");
      setCaseRadiologyDxItems(m.dx_items ?? []);
      setCaseRadiologyDdxItems(m.ddx_items ?? []);
      setCaseRadiologyDxNote(m.dx_note ?? "");
      setCaseRadiologyDdxNote(m.ddx_note ?? "");
    } else if (m.entry_type === "ultrasonography") {
      setCaseUltraPath(m.external_file_path ?? "");
      setCaseUltraPaths(m.external_file_paths ?? []);
      setCaseUltraWeight(m.body_weight ?? "");
      setCaseUltraRemark(m.body ?? "");
      setCaseUltraDxItems(m.dx_items ?? []);
      setCaseUltraDdxItems(m.ddx_items ?? []);
      setCaseUltraDxNote(m.dx_note ?? "");
      setCaseUltraDdxNote(m.ddx_note ?? "");
    }
  }

  async function deleteCaseVaccinationRow(id: string) {
    if (!selectedRequest) return;
    if (!confirm("Delete this vaccination row?")) return;
    setErr(null);
    try {
      await api.vaccinationsDelete(selectedRequest.pet_id, id);
      if (caseEditingVaccId === id) cancelCaseSectionEdit();
      await reloadCaseSections(selectedRequest.pet_id);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function deleteCaseGroomRow(id: string) {
    if (!selectedRequest) return;
    if (!confirm("Delete this grooming row?")) return;
    setErr(null);
    try {
      await api.groomingDelete(selectedRequest.pet_id, id);
      if (caseEditingGroomId === id) cancelCaseSectionEdit();
      await reloadCaseSections(selectedRequest.pet_id);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function deleteCaseMedicalRow(id: string) {
    if (!selectedRequest) return;
    if (!confirm("Delete this entry?")) return;
    setErr(null);
    try {
      await api.medicalDelete(selectedRequest.pet_id, id);
      if (caseEditingMedicalId === id) cancelCaseSectionEdit();
      await reloadCaseSections(selectedRequest.pet_id);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function addCaseSectionData() {
    if (!selectedRequest) return;
    setErr(null);
    try {
      if (caseTab === "vaccinations" && caseVaccineName.trim()) {
        await api.vaccinationsUpsert(
          selectedRequest.pet_id,
          {
            vaccine_name: caseVaccineName.trim(),
            administered_date: caseVaxGiven || null,
            next_due_date: caseVaxDue || null,
            reminder_days_before: caseVaxReminder,
            notes: caseVaxNotes.trim() || null,
            body_weight: caseVaxWeight.trim() || null,
          },
          caseEditingVaccId,
        );
        setCaseEditingVaccId(null);
        setCaseVaccineName("");
        setCaseVaxWeight("");
        setCaseVaxGiven(new Date().toISOString().slice(0, 10));
        setCaseVaxDue("");
        setCaseVaxReminder(7);
        setCaseVaxNotes("");
      } else if (caseTab === "deworming" && caseDewormingName.trim()) {
        const dewormInput = {
          entry_type: "deworming",
          title: caseDewormingName.trim(),
          administered_date: caseDewormGiven || null,
          next_due_date: caseDewormDue || null,
          reminder_days_before: caseDewormReminder,
          body: caseDewormNotes.trim() || null,
          body_weight: caseDewormWeight.trim() || null,
          dx_items: [] as string[],
          ddx_items: [] as string[],
          dx_note: null as string | null,
          ddx_note: null as string | null,
          external_file_path: null as string | null,
        };
        if (caseEditingMedicalId) {
          await api.medicalUpdate(
            selectedRequest.pet_id,
            caseEditingMedicalId,
            dewormInput,
          );
          setCaseEditingMedicalId(null);
        } else {
          await api.medicalAdd(selectedRequest.pet_id, dewormInput);
        }
        setCaseDewormingName("");
        setCaseDewormWeight("");
        setCaseDewormGiven(new Date().toISOString().slice(0, 10));
        setCaseDewormDue("");
        setCaseDewormReminder(7);
        setCaseDewormNotes("");
      } else if (caseTab === "grooming" && caseGroomingService.trim()) {
        const groomRow = caseEditingGroomId
          ? caseGrooming.find((g) => g.id === caseEditingGroomId)
          : null;
        const performed =
          groomRow?.performed_date ?? new Date().toISOString().slice(0, 10);
        const groomInput = {
          service_type: caseGroomingService.trim(),
          performed_date: performed,
          administered_date: caseGroomingGiven || null,
          next_due_date: caseGroomingDue || null,
          reminder_days_before: caseGroomingReminder,
          notes: caseGroomingNote.trim() || null,
          body_weight: caseGroomingWeight.trim() || null,
        };
        if (caseEditingGroomId) {
          await api.groomingUpdate(
            selectedRequest.pet_id,
            caseEditingGroomId,
            groomInput,
          );
          setCaseEditingGroomId(null);
        } else {
          await api.groomingAdd(selectedRequest.pet_id, groomInput);
        }
        setCaseGroomingService("");
        setCaseGroomingWeight("");
        setCaseGroomingGiven(new Date().toISOString().slice(0, 10));
        setCaseGroomingDue("");
        setCaseGroomingReminder(7);
        setCaseGroomingNote("");
      } else if (caseTab === "surgery" && caseSurgeryName.trim()) {
        const surgeryInput = {
          entry_type: "surgery",
          title: caseSurgeryName.trim(),
          body: caseSurgeryRemark.trim() || null,
          body_weight: caseSurgeryWeight.trim() || null,
          dx_items: caseSurgeryDxItems,
          ddx_items: caseSurgeryDdxItems,
          dx_note: caseSurgeryDxNote.trim() || null,
          ddx_note: caseSurgeryDdxNote.trim() || null,
        };
        if (caseEditingMedicalId) {
          await api.medicalUpdate(
            selectedRequest.pet_id,
            caseEditingMedicalId,
            surgeryInput,
          );
          setCaseEditingMedicalId(null);
        } else {
          await api.medicalAdd(selectedRequest.pet_id, surgeryInput);
        }
        setCaseSurgeryName("");
        setCaseSurgeryWeight("");
        setCaseSurgeryRemark("");
        setCaseSurgeryDxItems([]);
        setCaseSurgeryDdxItems([]);
        setCaseSurgeryDxNote("");
        setCaseSurgeryDdxNote("");
      } else if (caseTab === "radiology" && caseRadiologyPaths.length > 0) {
        const prev = caseEditingMedicalId
          ? caseMedical.find((x) => x.id === caseEditingMedicalId)
          : null;
        const radInput = {
          entry_type: "radiology",
          title: prev?.title?.trim() || "Radiology report",
          body: caseRadiologyRemark.trim() || null,
          body_weight: caseRadiologyWeight.trim() || null,
          external_file_path: caseRadiologyPaths[0],
          external_file_paths: caseRadiologyPaths,
          dx_items: caseRadiologyDxItems,
          ddx_items: caseRadiologyDdxItems,
          dx_note: caseRadiologyDxNote.trim() || null,
          ddx_note: caseRadiologyDdxNote.trim() || null,
        };
        if (caseEditingMedicalId) {
          await api.medicalUpdate(
            selectedRequest.pet_id,
            caseEditingMedicalId,
            radInput,
          );
          setCaseEditingMedicalId(null);
        } else {
          await api.medicalAdd(selectedRequest.pet_id, radInput);
        }
        setCaseRadiologyPath("");
        setCaseRadiologyWeight("");
        setCaseRadiologyPaths([]);
        setCaseRadiologyRemark("");
        setCaseRadiologyDxItems([]);
        setCaseRadiologyDdxItems([]);
        setCaseRadiologyDxNote("");
        setCaseRadiologyDdxNote("");
      } else if (caseTab === "ultrasonography" && caseUltraPaths.length > 0) {
        const prevU = caseEditingMedicalId
          ? caseMedical.find((x) => x.id === caseEditingMedicalId)
          : null;
        const ultraInput = {
          entry_type: "ultrasonography",
          title: prevU?.title?.trim() || "Ultrasonography report",
          body: caseUltraRemark.trim() || null,
          body_weight: caseUltraWeight.trim() || null,
          external_file_path: caseUltraPaths[0],
          external_file_paths: caseUltraPaths,
          dx_items: caseUltraDxItems,
          ddx_items: caseUltraDdxItems,
          dx_note: caseUltraDxNote.trim() || null,
          ddx_note: caseUltraDdxNote.trim() || null,
        };
        if (caseEditingMedicalId) {
          await api.medicalUpdate(
            selectedRequest.pet_id,
            caseEditingMedicalId,
            ultraInput,
          );
          setCaseEditingMedicalId(null);
        } else {
          await api.medicalAdd(selectedRequest.pet_id, ultraInput);
        }
        setCaseUltraPath("");
        setCaseUltraWeight("");
        setCaseUltraPaths([]);
        setCaseUltraRemark("");
        setCaseUltraDxItems([]);
        setCaseUltraDdxItems([]);
        setCaseUltraDxNote("");
        setCaseUltraDdxNote("");
      }
      await reloadCaseSections(selectedRequest.pet_id);
    } catch (e) {
      setErr(String(e));
    }
  }

  const printable =
    savedConsultation ?? (petHistory.length > 0 ? petHistory[0] : null);

  return (
    <div className="page opd-page">
      <div className="page-head">
        <div>
          <h1 className="no-print">OPD</h1>
          <p className="muted no-print">
            Queue, assign consultation, write prescription, and print.
          </p>
        </div>
      </div>
      {err && <p className="error">{err}</p>}

      {summary && (
        <div className="grid2" style={{ marginBottom: "1rem" }}>
          <div className="card">
            <h3>Checked pets</h3>
            <p className="muted">
              Today: <strong>{summary.checked_today}</strong>
            </p>
            <p className="muted">
              This week: <strong>{summary.checked_week}</strong>
            </p>
            <p className="muted">
              This month: <strong>{summary.checked_month}</strong>
            </p>
          </div>
          <div className="card">
            <h3>Next visits</h3>
            <p className="muted">
              Also visible on <Link href="/">Dashboard</Link>.
            </p>
          </div>
        </div>
      )}

      <div className="grid2">
        <div className="card">
          <h2>OPD request queue</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Pet</th>
                <th>Status</th>
                <th>Assigned</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div>
                      <strong>{formatOpdPetName(r, duplicateOpdNames)}</strong>
                    </div>
                    <div className="small muted">
                      {r.owner_name ?? "Owner"} · {r.owner_phone ?? "No phone"}
                    </div>
                  </td>
                  <td>{r.status}</td>
                  <td>{r.assigned_vet_name ?? "Unassigned"}</td>
                  <td className="right">
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => void openRequest(r)}
                    >
                      Open case
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {requests.length === 0 && (
            <p className="muted">No OPD requests yet.</p>
          )}
        </div>

        <div className="card">
          <h2>Selected pet</h2>
          {!selectedRequest ? (
            <p className="muted">Choose a case from the queue.</p>
          ) : (
            <div>
              <p>
                <strong>
                  {formatOpdPetName(selectedRequest, duplicateOpdNames)}
                </strong>{" "}
                (<code>{selectedRequest.pet_card_id}</code>)
              </p>
              <p className="muted">
                Owner: {selectedRequest.owner_name ?? "—"} ·{" "}
                {selectedRequest.owner_phone ?? "—"}
              </p>
              <p className="muted">
                Requested by {selectedRequest.requested_by_name} on{" "}
                {new Date(selectedRequest.created_at).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      </div>

      {selectedRequest && (
        <div className="stack opd-case-stack" style={{ marginTop: "1rem" }}>
          <div
            className="no-print"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "1rem",
              marginBottom: "1rem",
            }}
          >
            <div className="tabs" style={{ marginBottom: 0 }}>
              {(
                [
                  ["prescription", "Prescription"],
                  ["vaccinations", "Vaccinations"],
                  ["deworming", "Deworming"],
                  ["grooming", "Grooming"],
                  ["surgery", "Surgery"],
                  ["radiology", "Radiology"],
                  ["ultrasonography", "Ultrasonography"],
                  ["lab_test", "Lab Test"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={`tab ${caseTab === k ? "active" : ""}`}
                  onClick={() => setCaseTab(k)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="row-actions" style={{ marginBottom: 0 }}>
              {editingConsultationId && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => cancelConsultationEdit()}
                >
                  Cancel edit
                </button>
              )}
              <button
                type="button"
                className="btn ghost"
                disabled={!isVet}
                onClick={() => saveDraft()}
              >
                Save draft
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!isVet || busy}
                onClick={() => void submitConsultation()}
              >
                {busy
                  ? "Saving..."
                  : editingConsultationId
                    ? "Save changes"
                    : "Close OPD"}
              </button>
            </div>
          </div>
          {draftSavedAt && (
            <p
              className="muted small no-print"
              style={{ marginBottom: "1rem", marginTop: "-0.5rem" }}
            >
              Draft saved at{" "}
              {new Date(draftSavedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
          {caseTab !== "prescription" && caseTab !== "lab_test" && (
            <>
              {printingItem && printingItem.entry_type === "surgery" && (
                <div
                  className="only-print print-area opd-case-tab-print"
                  style={{ padding: "1.5rem" }}
                >
                  <ReportPrintHeader
                    clinic={clinic}
                    pet={opdRequestToPetPrint(selectedRequest!)}
                  />
                  <h2
                    style={{
                      textAlign: "center",
                      textTransform: "uppercase",
                      marginBottom: "1.5rem",
                    }}
                  >
                    Surgery Report
                  </h2>
                  <div style={{ marginBottom: "1rem" }}>
                    <strong>Date:</strong>{" "}
                    {new Date(printingItem.created_at).toLocaleString()}
                  </div>
                  <div style={{ marginBottom: "1rem" }}>
                    <strong>Surgery:</strong> {printingItem.title}
                  </div>
                  {printingItem.dx_note && (
                    <div style={{ marginBottom: "1rem" }}>
                      <strong>Dx:</strong> {printingItem.dx_note}
                    </div>
                  )}
                  {printingItem.ddx_note && (
                    <div style={{ marginBottom: "1rem" }}>
                      <strong>D.D:</strong> {printingItem.ddx_note}
                    </div>
                  )}
                  <div style={{ marginBottom: "1rem" }}>
                    <strong>Remarks:</strong> {printingItem.body ?? "—"}
                  </div>
                </div>
              )}
              {printingItem && printingItem.entry_type === "radiology" && (
                <div
                  className="only-print print-area opd-case-tab-print"
                  style={{ padding: "1.5rem" }}
                >
                  <ReportPrintHeader
                    clinic={clinic}
                    pet={opdRequestToPetPrint(selectedRequest!)}
                  />
                  <h2
                    style={{
                      textAlign: "center",
                      textTransform: "uppercase",
                      marginBottom: "1.5rem",
                    }}
                  >
                    Radiology Report
                  </h2>
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
                            alt={`${printingItem.entry_type} ${i + 1}`}
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
                        alt={printingItem.entry_type}
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
                    <div style={{ marginBottom: "1rem" }}>
                      <strong>Dx:</strong> {printingItem.dx_note}
                    </div>
                  )}
                  {printingItem.ddx_note && (
                    <div style={{ marginBottom: "1rem" }}>
                      <strong>D.D:</strong> {printingItem.ddx_note}
                    </div>
                  )}
                  <div style={{ marginBottom: "1rem" }}>
                    <strong>Remarks:</strong> {printingItem.body ?? "—"}
                  </div>
                </div>
              )}
              {printingItem &&
                printingItem.entry_type === "ultrasonography" && (
                  <div
                    className="only-print print-area opd-case-tab-print"
                    style={{ padding: "1.5rem" }}
                  >
                    <ReportPrintHeader
                      clinic={clinic}
                      pet={opdRequestToPetPrint(selectedRequest!)}
                    />
                    <h2
                      style={{
                        textAlign: "center",
                        textTransform: "uppercase",
                        marginBottom: "1.5rem",
                      }}
                    >
                      Ultrasonography Report
                    </h2>
                    <div style={{ marginBottom: "1rem" }}>
                      <strong>Date:</strong>{" "}
                      {new Date(printingItem.created_at).toLocaleString()}
                    </div>
                    <div style={{ marginBottom: "1rem" }}>
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
                      <div style={{ marginBottom: "1rem" }}>
                        <strong>Dx:</strong> {printingItem.dx_note}
                      </div>
                    )}
                    {printingItem.ddx_note && (
                      <div style={{ marginBottom: "1rem" }}>
                        <strong>D.D:</strong> {printingItem.ddx_note}
                      </div>
                    )}
                    <div style={{ marginBottom: "1rem" }}>
                      <strong>Remarks:</strong> {printingItem.body ?? "—"}
                    </div>
                  </div>
                )}
              <div
                className={`card print-area opd-case-tab-print ${printingItem ? "no-print" : ""}`}
              >
                <h2 className="no-print" style={{ marginBottom: "0.75rem" }}>
                  {OPD_CASE_TAB_WEB[caseTab as OpdCaseSectionTab].screenTitle}
                </h2>
                {caseTab === "vaccinations" && (
                  <>
                    <div className="no-print">
                      <div className="grid2">
                        <input
                          placeholder="Vaccine name"
                          value={caseVaccineName}
                          onChange={(e) => setCaseVaccineName(e.target.value)}
                        />
                        <input
                          placeholder="Weight"
                          value={caseVaxWeight}
                          onChange={(e) => setCaseVaxWeight(e.target.value)}
                        />
                        <input
                          type="date"
                          value={caseVaxGiven}
                          onChange={(e) => setCaseVaxGiven(e.target.value)}
                        />
                        <input
                          type="date"
                          value={caseVaxDue}
                          placeholder="Due date"
                          onChange={(e) => setCaseVaxDue(e.target.value)}
                        />
                        <input
                          type="number"
                          placeholder="Reminder (days)"
                          value={caseVaxReminder}
                          onChange={(e) =>
                            setCaseVaxReminder(Number(e.target.value))
                          }
                        />
                      </div>
                      <input
                        placeholder="Notes"
                        value={caseVaxNotes}
                        onChange={(e) => setCaseVaxNotes(e.target.value)}
                      />
                      <div
                        className="no-print row-actions"
                        style={{ marginTop: "0.5rem" }}
                      >
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => void addCaseSectionData()}
                        >
                          {caseEditingVaccId ? "Save changes" : "Add"}
                        </button>
                        {caseEditingVaccId && (
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => cancelCaseSectionEdit()}
                          >
                            Cancel edit
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
                {caseTab === "grooming" && (
                  <>
                    <div className="no-print">
                      <div className="grid2">
                        <input
                          placeholder="Service"
                          value={caseGroomingService}
                          onChange={(e) =>
                            setCaseGroomingService(e.target.value)
                          }
                        />
                        <input
                          placeholder="Weight"
                          value={caseGroomingWeight}
                          onChange={(e) =>
                            setCaseGroomingWeight(e.target.value)
                          }
                        />
                        <input
                          type="date"
                          value={caseGroomingGiven}
                          onChange={(e) => setCaseGroomingGiven(e.target.value)}
                        />
                        <input
                          type="date"
                          placeholder="Due date"
                          value={caseGroomingDue}
                          onChange={(e) => setCaseGroomingDue(e.target.value)}
                        />
                        <input
                          type="number"
                          placeholder="Reminder (days)"
                          value={caseGroomingReminder}
                          onChange={(e) =>
                            setCaseGroomingReminder(Number(e.target.value))
                          }
                        />
                      </div>
                      <input
                        placeholder="Notes"
                        value={caseGroomingNote}
                        onChange={(e) => setCaseGroomingNote(e.target.value)}
                      />
                      <div
                        className="no-print row-actions"
                        style={{ marginTop: "0.5rem" }}
                      >
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => void addCaseSectionData()}
                        >
                          {caseEditingGroomId ? "Save changes" : "Add"}
                        </button>
                        {caseEditingGroomId && (
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => cancelCaseSectionEdit()}
                          >
                            Cancel edit
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
                {caseTab === "deworming" && (
                  <>
                    <div className="no-print">
                      <div className="grid2">
                        <input
                          placeholder="Deworming name"
                          value={caseDewormingName}
                          onChange={(e) => setCaseDewormingName(e.target.value)}
                        />
                        <input
                          placeholder="Weight"
                          value={caseDewormWeight}
                          onChange={(e) => setCaseDewormWeight(e.target.value)}
                        />
                        <input
                          type="date"
                          value={caseDewormGiven}
                          onChange={(e) => setCaseDewormGiven(e.target.value)}
                        />
                        <input
                          type="date"
                          value={caseDewormDue}
                          placeholder="Due date"
                          onChange={(e) => setCaseDewormDue(e.target.value)}
                        />
                        <input
                          type="number"
                          placeholder="Reminder (days)"
                          value={caseDewormReminder}
                          onChange={(e) =>
                            setCaseDewormReminder(Number(e.target.value))
                          }
                        />
                      </div>
                      <input
                        placeholder="Notes"
                        value={caseDewormNotes}
                        onChange={(e) => setCaseDewormNotes(e.target.value)}
                      />
                      <div
                        className="no-print row-actions"
                        style={{ marginTop: "0.5rem" }}
                      >
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => void addCaseSectionData()}
                        >
                          {caseEditingMedicalId ? "Save changes" : "Add"}
                        </button>
                        {caseEditingMedicalId && (
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => cancelCaseSectionEdit()}
                          >
                            Cancel edit
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
                {caseTab === "surgery" && (
                  <>
                    <div className="no-print">
                      <div className="grid2">
                        <input
                          placeholder="Surgery name"
                          value={caseSurgeryName}
                          onChange={(e) => setCaseSurgeryName(e.target.value)}
                        />
                        <input
                          placeholder="Weight"
                          value={caseSurgeryWeight}
                          onChange={(e) => setCaseSurgeryWeight(e.target.value)}
                        />
                      </div>
                      <div style={{ display: "none" }}>
                        <p
                          className="small muted"
                          style={{ marginBottom: "0.4rem" }}
                        >
                          Dx
                        </p>
                        <div className="row-actions">
                          {surgeryDxCatalog.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={`btn small ${caseSurgeryDxItems.includes(item.name) ? "primary" : "ghost"}`}
                              onClick={() =>
                                toggleChip(
                                  item.name,
                                  setCaseSurgeryDxItems,
                                  caseSurgeryDxItems,
                                )
                              }
                            >
                              {item.name}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="btn ghost small"
                            onClick={() =>
                              void addCatalogChip("surgery_dx", "Surgery Dx")
                            }
                          >
                            + Add New
                          </button>
                        </div>
                      </div>
                      <div style={{ display: "none" }}>
                        <p
                          className="small muted"
                          style={{ marginBottom: "0.4rem" }}
                        >
                          D.D
                        </p>
                        <div className="row-actions">
                          {surgeryDdxCatalog.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={`btn small ${caseSurgeryDdxItems.includes(item.name) ? "primary" : "ghost"}`}
                              onClick={() =>
                                toggleChip(
                                  item.name,
                                  setCaseSurgeryDdxItems,
                                  caseSurgeryDdxItems,
                                )
                              }
                            >
                              {item.name}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="btn ghost small"
                            onClick={() =>
                              void addCatalogChip("surgery_ddx", "Surgery D.Dx")
                            }
                          >
                            + Add New
                          </button>
                        </div>
                      </div>
                      <div className="grid2" style={{ marginTop: "0.5rem" }}>
                        <input
                          placeholder="Dx"
                          value={caseSurgeryDxNote}
                          onChange={(e) => setCaseSurgeryDxNote(e.target.value)}
                        />
                        <input
                          placeholder="D.D"
                          value={caseSurgeryDdxNote}
                          onChange={(e) =>
                            setCaseSurgeryDdxNote(e.target.value)
                          }
                        />
                      </div>
                      <div style={{ marginTop: "1rem" }}>
                        <input
                          placeholder="Remarks"
                          value={caseSurgeryRemark}
                          onChange={(e) => setCaseSurgeryRemark(e.target.value)}
                        />
                      </div>
                      <div
                        className="no-print row-actions"
                        style={{ marginTop: "0.75rem" }}
                      >
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => void addCaseSectionData()}
                        >
                          {caseEditingMedicalId ? "Save changes" : "Add"}
                        </button>
                        {caseEditingMedicalId && (
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => cancelCaseSectionEdit()}
                          >
                            Cancel edit
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
                {caseTab === "radiology" && (
                  <>
                    <div className="no-print">
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
                                  setCaseRadiologyPaths((prev) => [
                                    ...prev,
                                    ...encodedList,
                                  ]),
                                )
                                .catch((err) => setErr(String(err)));
                            }}
                          />
                        </label>
                      </div>
                      {caseRadiologyPaths.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "8px",
                            marginTop: "1rem",
                          }}
                        >
                          {caseRadiologyPaths.map((p, idx) => (
                            <div key={idx} style={{ position: "relative" }}>
                              <img
                                src={p}
                                alt="Radiology preview"
                                style={{
                                  maxWidth: 100,
                                  maxHeight: 100,
                                  objectFit: "cover",
                                  borderRadius: 4,
                                }}
                              />
                              <button
                                type="button"
                                className="btn danger small"
                                style={{
                                  position: "absolute",
                                  top: -5,
                                  right: -5,
                                  padding: "2px 6px",
                                  borderRadius: "50%",
                                  minWidth: 0,
                                }}
                                onClick={() =>
                                  setCaseRadiologyPaths((prev) =>
                                    prev.filter((_, i) => i !== idx),
                                  )
                                }
                              >
                                &times;
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: "none" }}>
                        <p
                          className="small muted"
                          style={{ marginBottom: "0.4rem" }}
                        >
                          Dx
                        </p>
                        <div className="row-actions">
                          {radiologyDxCatalog.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={`btn small ${caseRadiologyDxItems.includes(item.name) ? "primary" : "ghost"}`}
                              onClick={() =>
                                toggleChip(
                                  item.name,
                                  setCaseRadiologyDxItems,
                                  caseRadiologyDxItems,
                                )
                              }
                            >
                              {item.name}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="btn ghost small"
                            onClick={() =>
                              void addCatalogChip(
                                "radiology_dx",
                                "Radiology Dx",
                              )
                            }
                          >
                            + Add New
                          </button>
                        </div>
                      </div>
                      <div style={{ display: "none" }}>
                        <p
                          className="small muted"
                          style={{ marginBottom: "0.4rem" }}
                        >
                          D.D
                        </p>
                        <div className="row-actions">
                          {radiologyDdxCatalog.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={`btn small ${caseRadiologyDdxItems.includes(item.name) ? "primary" : "ghost"}`}
                              onClick={() =>
                                toggleChip(
                                  item.name,
                                  setCaseRadiologyDdxItems,
                                  caseRadiologyDdxItems,
                                )
                              }
                            >
                              {item.name}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="btn ghost small"
                            onClick={() =>
                              void addCatalogChip(
                                "radiology_ddx",
                                "Radiology D.Dx",
                              )
                            }
                          >
                            + Add New
                          </button>
                        </div>
                      </div>
                      <div className="grid2" style={{ marginTop: "0.5rem" }}>
                        <input
                          placeholder="Dx"
                          value={caseRadiologyDxNote}
                          onChange={(e) =>
                            setCaseRadiologyDxNote(e.target.value)
                          }
                        />
                        <input
                          placeholder="D.D"
                          value={caseRadiologyDdxNote}
                          onChange={(e) =>
                            setCaseRadiologyDdxNote(e.target.value)
                          }
                        />
                      </div>
                      <div style={{ marginTop: "1rem" }}>
                        <input
                          placeholder="Remark"
                          value={caseRadiologyRemark}
                          onChange={(e) =>
                            setCaseRadiologyRemark(e.target.value)
                          }
                        />
                      </div>
                      <div
                        className="no-print row-actions"
                        style={{ marginTop: "0.75rem" }}
                      >
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => void addCaseSectionData()}
                        >
                          {caseEditingMedicalId ? "Save changes" : "Add"}
                        </button>
                        {caseEditingMedicalId && (
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => cancelCaseSectionEdit()}
                          >
                            Cancel edit
                          </button>
                        )}
                      </div>
                      {canPreviewImage(caseRadiologyPath) && (
                        <img
                          src={caseRadiologyPath}
                          alt="Radiology preview"
                          style={{ maxWidth: 220, marginTop: 8 }}
                        />
                      )}
                    </div>
                  </>
                )}
                {caseTab === "ultrasonography" && (
                  <>
                    <div className="no-print">
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
                                  setCaseUltraPaths((prev) => [
                                    ...prev,
                                    ...encodedList,
                                  ]),
                                )
                                .catch((err) => setErr(String(err)));
                            }}
                          />
                        </label>
                        <label>
                          Weight
                          <input
                            placeholder="e.g. 5kg"
                            value={caseUltraWeight}
                            onChange={(e) => setCaseUltraWeight(e.target.value)}
                          />
                        </label>
                      </div>
                      {caseUltraPaths.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "8px",
                            marginTop: "1rem",
                          }}
                        >
                          {caseUltraPaths.map((p, idx) => (
                            <div key={idx} style={{ position: "relative" }}>
                              <img
                                src={p}
                                alt="Ultrasonography preview"
                                style={{
                                  maxWidth: 100,
                                  maxHeight: 100,
                                  objectFit: "cover",
                                  borderRadius: 4,
                                }}
                              />
                              <button
                                type="button"
                                className="btn danger small"
                                style={{
                                  position: "absolute",
                                  top: -5,
                                  right: -5,
                                  padding: "2px 6px",
                                  borderRadius: "50%",
                                  minWidth: 0,
                                }}
                                onClick={() =>
                                  setCaseUltraPaths((prev) =>
                                    prev.filter((_, i) => i !== idx),
                                  )
                                }
                              >
                                &times;
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: "none" }}>
                        <p
                          className="small muted"
                          style={{ marginBottom: "0.4rem" }}
                        >
                          Dx
                        </p>
                        <div className="row-actions">
                          {ultraDxCatalog.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={`btn small ${caseUltraDxItems.includes(item.name) ? "primary" : "ghost"}`}
                              onClick={() =>
                                toggleChip(
                                  item.name,
                                  setCaseUltraDxItems,
                                  caseUltraDxItems,
                                )
                              }
                            >
                              {item.name}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="btn ghost small"
                            onClick={() =>
                              void addCatalogChip(
                                "ultrasonography_dx",
                                "Ultrasonography Dx",
                              )
                            }
                          >
                            + Add New
                          </button>
                        </div>
                      </div>
                      <div style={{ display: "none" }}>
                        <p
                          className="small muted"
                          style={{ marginBottom: "0.4rem" }}
                        >
                          D.D
                        </p>
                        <div className="row-actions">
                          {ultraDdxCatalog.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={`btn small ${caseUltraDdxItems.includes(item.name) ? "primary" : "ghost"}`}
                              onClick={() =>
                                toggleChip(
                                  item.name,
                                  setCaseUltraDdxItems,
                                  caseUltraDdxItems,
                                )
                              }
                            >
                              {item.name}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="btn ghost small"
                            onClick={() =>
                              void addCatalogChip(
                                "ultrasonography_ddx",
                                "Ultrasonography D.Dx",
                              )
                            }
                          >
                            + Add New
                          </button>
                        </div>
                      </div>
                      <div className="grid2" style={{ marginTop: "0.5rem" }}>
                        <input
                          placeholder="Dx"
                          value={caseUltraDxNote}
                          onChange={(e) => setCaseUltraDxNote(e.target.value)}
                        />
                        <input
                          placeholder="D.D"
                          value={caseUltraDdxNote}
                          onChange={(e) => setCaseUltraDdxNote(e.target.value)}
                        />
                      </div>
                      <div style={{ marginTop: "1rem" }}>
                        <input
                          placeholder="Remark"
                          value={caseUltraRemark}
                          onChange={(e) => setCaseUltraRemark(e.target.value)}
                        />
                      </div>
                      <div
                        className="no-print row-actions"
                        style={{ marginTop: "0.75rem" }}
                      >
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => void addCaseSectionData()}
                        >
                          {caseEditingMedicalId ? "Save changes" : "Add"}
                        </button>
                        {caseEditingMedicalId && (
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => cancelCaseSectionEdit()}
                          >
                            Cancel edit
                          </button>
                        )}
                      </div>
                      {canPreviewImage(caseUltraPath) && (
                        <img
                          src={caseUltraPath}
                          alt="Ultrasonography preview"
                          style={{ maxWidth: 220, marginTop: 8 }}
                        />
                      )}
                    </div>
                  </>
                )}
                <div
                  className="no-print row-actions"
                  style={{ marginTop: "1rem" }}
                >
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => void appPrint({ opdPrintMode: "case-tab" })}
                  >
                    Print{" "}
                    {OPD_CASE_TAB_WEB[caseTab as OpdCaseSectionTab].tabLabel}
                  </button>
                </div>
                <div className="opd-print-preview">
                  <p
                    className="muted small no-print"
                    style={{ marginBottom: "0.5rem" }}
                  >
                    Print preview
                  </p>
                  <ReportPrintHeader
                    clinic={clinic}
                    pet={opdRequestToPetPrint(selectedRequest)}
                  />
                  <h2
                    style={{
                      textAlign: "center",
                      textTransform: "uppercase",
                      marginBottom: "1rem",
                      fontSize: "1rem",
                    }}
                  >
                    {OPD_CASE_TAB_WEB[caseTab as OpdCaseSectionTab].printTitle}
                  </h2>
                  {renderCaseTabDataPreview()}
                </div>
              </div>
            </>
          )}
          {caseTab === "prescription" && (
            <form
              className="card print-area opd-case-tab-print"
              onSubmit={submitConsultation}
            >
              <div className="no-print">
                <h2>Prescription / examination</h2>
                {!isVet && (
                  <p className="muted">
                    Only vet accounts can submit consultations. You can still
                    review the queue and history.
                  </p>
                )}
                <div className="grid2">
                  <label>
                    Temperature
                    <input
                      value={temperature}
                      onChange={(e) => setTemperature(e.target.value)}
                      placeholder="e.g. 102 F"
                    />
                  </label>
                  <label>
                    Body Weight
                    <input
                      value={prescriptionWeight}
                      onChange={(e) => setPrescriptionWeight(e.target.value)}
                      placeholder="e.g. 5kg"
                    />
                  </label>
                </div>
                <label>
                  Physical Exam
                  <textarea
                    rows={2}
                    value={physicalExam}
                    onChange={(e) => setPhysicalExam(e.target.value)}
                    placeholder="e.g. Normal heart sounds, clear lungs..."
                  />
                </label>
                <div>
                  <p className="small muted" style={{ marginBottom: "0.4rem" }}>
                    History / Observation
                  </p>
                  <div className="row-actions no-print">
                    {historyCatalog.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`btn small ${historyObservations.includes(item.name) ? "primary" : "ghost"}`}
                        onClick={() =>
                          toggleChip(
                            item.name,
                            setHistoryObservations,
                            historyObservations,
                          )
                        }
                      >
                        {item.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() =>
                        void addCatalogChip(
                          "history_observation",
                          "history/observation tab",
                        )
                      }
                    >
                      + Add New
                    </button>
                  </div>
                </div>
                <div>
                  <p className="small muted" style={{ marginBottom: "0.4rem" }}>
                    Dx
                  </p>
                  <div className="row-actions no-print">
                    {dxCatalog.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`btn small ${dxItems.includes(item.name) ? "primary" : "ghost"}`}
                        onClick={() =>
                          toggleChip(item.name, setDxItems, dxItems)
                        }
                      >
                        {item.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => void addCatalogChip("dx", "Dx tab")}
                    >
                      + Add New
                    </button>
                  </div>
                </div>
                <div>
                  <p className="small muted" style={{ marginBottom: "0.4rem" }}>
                    D.D
                  </p>
                  <div className="row-actions no-print">
                    {ddxCatalog.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`btn small ${ddxItems.includes(item.name) ? "primary" : "ghost"}`}
                        onClick={() =>
                          toggleChip(item.name, setDdxItems, ddxItems)
                        }
                      >
                        {item.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => void addCatalogChip("ddx", "D.Dx tab")}
                    >
                      + Add New
                    </button>
                  </div>
                </div>
                <label>
                  Dx note
                  <textarea
                    rows={2}
                    value={dxNote}
                    onChange={(e) => setDxNote(e.target.value)}
                  />
                </label>
                <label>
                  D.D note
                  <textarea
                    rows={2}
                    value={ddNote}
                    onChange={(e) => setDdNote(e.target.value)}
                  />
                </label>
                <div>
                  <p className="small muted" style={{ marginBottom: "0.4rem" }}>
                    Symptoms
                  </p>
                  <div className="row-actions no-print">
                    {symptomCatalog.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`btn small ${
                          symptoms.includes(item.name) ? "primary" : "ghost"
                        }`}
                        onClick={() =>
                          toggleChip(item.name, setSymptoms, symptoms)
                        }
                      >
                        {item.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => void addCatalogChip("symptom", "symptom")}
                    >
                      + Add New
                    </button>
                  </div>
                </div>

                <div>
                  <p className="small muted" style={{ marginBottom: "0.4rem" }}>
                    Recommended lab tests (from Laboratory)
                  </p>
                  <div className="grid2">
                    {labTests.map((t) => (
                      <label key={t.id} className="check-label">
                        <input
                          type="checkbox"
                          checked={labTestIds.includes(t.id)}
                          onChange={() => toggleLabTest(t.id)}
                        />
                        <span>{t.name}</span>
                      </label>
                    ))}
                  </div>
                  <label>
                    Other tests (comma separated)
                    <input
                      value={otherTests}
                      onChange={(e) => setOtherTests(e.target.value)}
                      placeholder="Culture, Skin scraping, ..."
                    />
                  </label>
                </div>

                <div>
                  <h3>Medicines</h3>
                  <div
                    className="row-actions no-print"
                    style={{ marginBottom: "0.6rem" }}
                  >
                    {medCatalog.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`btn small ${medicines.some((x) => x.name === m.name) ? "primary" : "ghost"}`}
                        onClick={() => toggleMedicine(m.name)}
                      >
                        {m.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() =>
                        void addCatalogChip("medicine", "medicine")
                      }
                    >
                      + Add New
                    </button>
                  </div>
                  {medicines.map((m, i) => (
                    <div className="grid2" key={`${m.name}-${i}`}>
                      <label>
                        {m.name} dosage
                        <input
                          value={m.dosage}
                          onChange={(e) =>
                            updateMedicine(i, { dosage: e.target.value })
                          }
                          placeholder="e.g. 20ml"
                        />
                      </label>
                      <label>
                        {m.name} instruction
                        <input
                          value={m.instruction}
                          onChange={(e) =>
                            updateMedicine(i, { instruction: e.target.value })
                          }
                          placeholder="e.g. BID after food"
                        />
                      </label>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn ghost small no-print"
                    onClick={() =>
                      setMedicines((prev) => [
                        ...prev,
                        { name: "", dosage: "", instruction: "" },
                      ])
                    }
                  >
                    + Add other medicine
                  </button>
                  <label>
                    Treatment remark
                    <textarea
                      rows={2}
                      value={treatmentRemark}
                      onChange={(e) => setTreatmentRemark(e.target.value)}
                      placeholder="Patient is not cooperating for treatment."
                    />
                  </label>
                  <label>
                    Home Medication
                    <textarea
                      rows={4}
                      value={inHousePrescription}
                      onChange={(e) => setInHousePrescription(e.target.value)}
                      placeholder="Enter Home Medication notes, instructions, etc."
                    />
                  </label>
                </div>

                <label>
                  Recommended food
                  <input
                    list="opd-food-list"
                    value={food}
                    onChange={(e) => setFood(e.target.value)}
                  />
                  <datalist id="opd-food-list">
                    {foodCatalog.map((f) => (
                      <option key={f.id} value={f.name} />
                    ))}
                  </datalist>
                </label>

                <div className="grid2">
                  <label>
                    Next visit
                    <input
                      type="date"
                      value={nextVisit}
                      onChange={(e) => setNextVisit(e.target.value)}
                    />
                  </label>
                  <label>
                    Doctor name
                    <input
                      value={doctorName}
                      onChange={(e) => setDoctorName(e.target.value)}
                    />
                  </label>
                </div>
              </div>

              <div
                className="no-print row-actions"
                style={{ marginTop: "1rem" }}
              >
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void appPrint({ opdPrintMode: "case-tab" })}
                >
                  Print Prescription
                </button>
              </div>
              <div className="opd-print-preview">
                <p
                  className="muted small no-print"
                  style={{ marginBottom: "0.5rem" }}
                >
                  Print preview
                </p>
                {renderPrescriptionDraftPrintBody()}
              </div>
            </form>
          )}

          {caseTab === "lab_test" && selectedRequest && (
            <div className="stack opd-case-tab-print">
              {labTabErr && <p className="error">{labTabErr}</p>}

              {/* Saved Report Print View */}
              {labSavedReport && (
                <div className="card print-area opd-case-tab-print">
                  <div id="lab-report-print" className="receipt">
                    <div className="only-print">
                      <ReportPrintHeader
                        clinic={clinic}
                        pet={opdRequestToPetPrint(selectedRequest)}
                      />
                    </div>
                    <h2>Laboratory report</h2>
                    <p>
                      <strong>Date:</strong>{" "}
                      {new Date(labSavedReport.created_at).toLocaleString()}
                    </p>
                    {labSavedReport.notes && (
                      <p>
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
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Analyte</th>
                              {hasUnit && <th>Unit</th>}
                              {hasRange && <th>Reference</th>}
                              <th>Result</th>
                              {hasRemarks && <th>Value</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {labSavedReport.values.map((v) => {
                              const h = valueHighlight(
                                Number(v.observed_value),
                                v.normal_min,
                                v.normal_max,
                              );
                              return (
                                <tr key={v.id}>
                                  <td>{v.analyte_name}</td>
                                  {hasUnit && <td>{v.unit ?? "—"}</td>}
                                  {hasRange && (
                                    <td>
                                      {v.normal_min ?? "—"} –{" "}
                                      {v.normal_max ?? "—"}
                                    </td>
                                  )}
                                  <td
                                    className={h !== "ok" ? `hl-${h}-text` : ""}
                                  >
                                    {v.observed_value}
                                  </td>
                                  {hasRemarks && <td>{v.remarks ?? "—"}</td>}
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
                      <strong>Pet:</strong> {selectedRequest.pet_name} (
                      {selectedRequest.species ?? "—"})
                    </p>
                    <p>
                      <strong>Owner:</strong>{" "}
                      {selectedRequest.owner_name ?? "—"}
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
                      Ordered:{" "}
                      {new Date(lastLabOrder.created_at).toLocaleString()}
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
                        value={`${selectedRequest.pet_name} (${selectedRequest.pet_card_id})`}
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
                        disabled={labOrders.length === 0}
                      >
                        <option value="">
                          {labOrders.length === 0
                            ? "No pending orders"
                            : "Choose…"}
                        </option>
                        {labOrders.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.receipt_number} —{" "}
                            {new Date(o.created_at).toLocaleString()}
                          </option>
                        ))}
                      </select>
                    </label>

                    {labAnalytes.length > 0 && (
                      <div style={{ marginTop: "1rem" }}>
                        <h3>Results</h3>
                        <p className="muted small">
                          Values outside the reference range are highlighted.
                        </p>
                        {(() => {
                          const hasUnit = labAnalytes.some(
                            (a) => a.unit && a.unit.trim(),
                          );
                          const hasRange = labAnalytes.some(
                            (a) => a.normal_min != null || a.normal_max != null,
                          );
                          const hasRemarks = labAnalytes.some(
                            (a) => a.remarks && a.remarks.trim(),
                          );

                          return (
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>Analyte</th>
                                  {hasUnit && <th>Unit</th>}
                                  {hasRange && <th>Reference</th>}
                                  <th>Result</th>
                                  {hasRemarks && <th>Value</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {labAnalytes.map((a) => {
                                  const v = labValues[a.id];
                                  const num = v === "" ? NaN : Number(v);
                                  const h =
                                    !Number.isNaN(num) && v !== ""
                                      ? valueHighlight(
                                          num,
                                          a.normal_min,
                                          a.normal_max,
                                        )
                                      : "ok";
                                  return (
                                    <tr key={a.id}>
                                      <td>{a.name}</td>
                                      {hasUnit && <td>{a.unit ?? "—"}</td>}
                                      {hasRange && (
                                        <td>
                                          {a.normal_min ?? "—"} –{" "}
                                          {a.normal_max ?? "—"}
                                        </td>
                                      )}
                                      <td>
                                        <input
                                          className={`narrow ${
                                            h !== "ok" ? `hl-${h}` : ""
                                          }`}
                                          value={v ?? ""}
                                          onChange={(e) =>
                                            setLabValues({
                                              ...labValues,
                                              [a.id]: e.target.value,
                                            })
                                          }
                                        />
                                      </td>
                                      {hasRemarks && (
                                        <td>{a.remarks ?? "—"}</td>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          );
                        })()}
                        <label style={{ marginTop: "1rem" }}>
                          Notes
                          <textarea
                            rows={2}
                            value={labNotes}
                            onChange={(e) => setLabNotes(e.target.value)}
                          />
                        </label>
                        <button
                          type="submit"
                          className="btn primary"
                          style={{ marginTop: "1rem" }}
                        >
                          Save report
                        </button>
                      </div>
                    )}
                  </form>
                </div>
              )}
            </div>
          )}

          <div className="card">
            <h2>Pet OPD history</h2>
            {petHistory.length === 0 ? (
              <p className="muted">
                No OPD consultation saved yet for this pet.
              </p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Vet</th>
                    <th>Dx</th>
                    <th>Next visit</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {petHistory.map((h) => (
                    <tr key={h.id}>
                      <td>{new Date(h.created_at).toLocaleString()}</td>
                      <td>{h.vet_name}</td>
                      <td>
                        {h.dx_items.length > 0
                          ? h.dx_items.join(", ")
                          : (h.diagnosis_note ?? "—")}
                      </td>
                      <td>{h.next_visit_at ?? "—"}</td>
                      <td className="right">
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() => setSavedConsultation(h)}
                          style={{ marginRight: "0.35rem" }}
                        >
                          View
                        </button>
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() => startEditConsultation(h)}
                          style={{ marginRight: "0.35rem" }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn danger ghost small"
                          onClick={() => void deleteHistoryEntry(h)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {printable && (
            <>
              <OpdPrescriptionPrint
                clinic={clinic}
                pet={{
                  name: printable.pet_name,
                  species: printable.species,
                  breed: printable.breed,
                  age: printable.age,
                  date_of_birth: printable.date_of_birth,
                  sex: printable.sex,
                  weight: printable.weight,
                  owner_name: printable.owner_name,
                  owner_phone: printable.owner_phone,
                  card_id: printable.pet_card_id,
                }}
                consultation={printable}
              />
              <div
                className="no-print row-actions"
                style={{ marginTop: "1.5rem" }}
              >
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void printPrescription()}
                >
                  Print saved consultation
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
