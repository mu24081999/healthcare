import type {
  AnalyteInput,
  AnalyteRow,
  ClinicInput,
  ClinicRow,
  GroomingInput,
  GroomingRow,
  LabOrderInput,
  LabOrderRow,
  LabResultDetail,
  LabResultSummaryRow,
  LabResultValueInput,
  LabResultValuePatch,
  LabTestInput,
  LabTestRow,
  MedicalInput,
  MedicalRow,
  PetInput,
  PetListRow,
  PetRow,
  SessionUser,
  StaffUserRow,
  CreateStaffUserInput,
  VaccinationInput,
  VaccinationReminder,
  VaccinationRow,
  HospitalizationInput,
  HospitalizationRow,
  OpdCatalogItemRow,
  OpdCatalogType,
  OpdConsultationInput,
  OpdConsultationRow,
  OpdDashboardSummary,
  OpdRequestRow,
} from "@/lib/types";

async function parseError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    const json = JSON.parse(text);
    return ((json as any)?.error ?? text.slice(0, 200)) || res.statusText;
  } catch {
    return res.statusText;
  }
}

async function j<T>(res: Promise<Response>): Promise<T> {
  const r = await res;
  if (!r.ok) throw new Error(await parseError(r));
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}

const cred: RequestInit = { credentials: "include" };

export const api = {
  authLogin: (username: string, password: string) =>
    j<SessionUser>(
      fetch("/api/auth/login", {
        ...cred,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      }),
    ),
  authLogout: () =>
    fetch("/api/auth/logout", { ...cred, method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
    }),
  authSession: () => j<SessionUser | null>(fetch("/api/auth/session", cred)),

  petsList: (query?: string) =>
    j<PetListRow[]>(
      fetch(
        `/api/pets${query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`,
        cred,
      ),
    ),
  petsGet: (id: string) => j<PetRow>(fetch(`/api/pets/${id}`, cred)),
  petsCreate: (input: PetInput) =>
    j<PetRow>(
      fetch("/api/pets", {
        ...cred,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      }),
    ),
  petsUpdate: (id: string, input: PetInput) =>
    j<PetRow>(
      fetch(`/api/pets/${id}`, {
        ...cred,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      }),
    ),
  petsDelete: (id: string) =>
    fetch(`/api/pets/${id}`, { ...cred, method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
    }),

  medicalList: (petId: string) =>
    j<MedicalRow[]>(fetch(`/api/pets/${petId}/medical`, cred)),
  medicalAdd: (petId: string, input: MedicalInput) =>
    j<MedicalRow>(
      fetch(`/api/pets/${petId}/medical`, {
        ...cred,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      }),
    ),
  medicalUpdate: (petId: string, entryId: string, input: MedicalInput) =>
    j<MedicalRow>(
      fetch(`/api/pets/${petId}/medical/${entryId}`, {
        ...cred,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      }),
    ),
  medicalDelete: (petId: string, entryId: string) =>
    fetch(`/api/pets/${petId}/medical/${entryId}`, {
      ...cred,
      method: "DELETE",
    }).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
    }),

  vaccinationsList: (petId: string) =>
    j<VaccinationRow[]>(fetch(`/api/pets/${petId}/vaccinations`, cred)),
  vaccinationsUpsert: (
    petId: string,
    input: VaccinationInput,
    id?: string | null,
  ) =>
    j<VaccinationRow>(
      fetch(`/api/pets/${petId}/vaccinations`, {
        ...cred,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id ?? null, input }),
      }),
    ),
  vaccinationsDelete: (petId: string, vaccinationId: string) =>
    fetch(`/api/pets/${petId}/vaccinations/${vaccinationId}`, {
      ...cred,
      method: "DELETE",
    }).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
    }),

  hospitalizationsList: () =>
    j<HospitalizationRow[]>(fetch(`/api/hospitalizations`, cred)),
  hospitalizationsUpsert: (input: HospitalizationInput, id?: string | null) =>
    j<HospitalizationRow>(
      fetch(`/api/hospitalizations`, {
        ...cred,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id ?? null, input }),
      }),
    ),
  hospitalizationsDelete: (id: string) =>
    fetch(`/api/hospitalizations/${id}`, {
      ...cred,
      method: "DELETE",
    }).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
    }),

  groomingList: (petId: string) =>
    j<GroomingRow[]>(fetch(`/api/pets/${petId}/grooming`, cred)),
  groomingAdd: (petId: string, input: GroomingInput) =>
    j<GroomingRow>(
      fetch(`/api/pets/${petId}/grooming`, {
        ...cred,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      }),
    ),
  groomingUpdate: (petId: string, groomingId: string, input: GroomingInput) =>
    j<GroomingRow>(
      fetch(`/api/pets/${petId}/grooming/${groomingId}`, {
        ...cred,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      }),
    ),
  groomingDelete: (petId: string, groomingId: string) =>
    fetch(`/api/pets/${petId}/grooming/${groomingId}`, {
      ...cred,
      method: "DELETE",
    }).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
    }),

  labTestsList: () => j<LabTestRow[]>(fetch("/api/lab/tests", cred)),
  labTestsListAll: () => j<LabTestRow[]>(fetch("/api/lab/tests?all=1", cred)),
  labTestCreate: (input: LabTestInput) =>
    j<LabTestRow>(
      fetch("/api/lab/tests", {
        ...cred,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      }),
    ),
  labTestUpdate: (id: string, input: LabTestInput) =>
    j<LabTestRow>(
      fetch(`/api/lab/tests/${id}`, {
        ...cred,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      }),
    ),
  labTestDelete: (id: string) =>
    fetch(`/api/lab/tests/${id}`, { ...cred, method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
    }),

  labAnalytesList: (labTestId: string) =>
    j<AnalyteRow[]>(fetch(`/api/lab/tests/${labTestId}/analytes`, cred)),
  labAnalyteUpsert: (
    labTestId: string,
    input: AnalyteInput,
    id?: string | null,
  ) =>
    j<AnalyteRow>(
      fetch("/api/lab/analytes", {
        ...cred,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labTestId, id: id ?? null, input }),
      }),
    ),
  labAnalyteDelete: (id: string) =>
    fetch(`/api/lab/analytes/${id}`, { ...cred, method: "DELETE" }).then(
      (r) => {
        if (!r.ok) throw new Error(r.statusText);
      },
    ),

  labOrderCreate: (input: LabOrderInput) =>
    j<LabOrderRow>(
      fetch("/api/lab/orders", {
        ...cred,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      }),
    ),
  labOrdersForPet: (petId: string) =>
    j<LabOrderRow[]>(fetch(`/api/pets/${petId}/lab-orders`, cred)),

  labResultSave: (
    labOrderId: string,
    values: LabResultValueInput[],
    notes?: string | null,
  ) =>
    j<LabResultDetail>(
      fetch("/api/lab/results", {
        ...cred,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labOrderId,
          values,
          notes: notes ?? null,
        }),
      }),
    ),
  labResultGet: (id: string) =>
    j<LabResultDetail>(fetch(`/api/lab/results/${id}`, cred)),
  labResultsHistory: (petId?: string, labTestId?: string) => {
    const qp = new URLSearchParams();
    if (petId) qp.set("petId", petId);
    if (labTestId) qp.set("labTestId", labTestId);
    const suffix = qp.toString();
    return j<LabResultDetail[] | LabResultSummaryRow[]>(
      fetch(`/api/lab/results${suffix ? `?${suffix}` : ""}`, cred),
    );
  },
  labResultsForHistory: (petId: string, labTestId: string) =>
    j<LabResultDetail[]>(
      fetch(
        `/api/lab/results?petId=${encodeURIComponent(petId)}&labTestId=${encodeURIComponent(labTestId)}`,
        cred,
      ),
    ),
  labResultUpdate: (
    labResultId: string,
    values: LabResultValuePatch[],
    notes?: string | null,
  ) =>
    j<LabResultDetail>(
      fetch(`/api/lab/results/${labResultId}`, {
        ...cred,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values,
          notes: notes ?? null,
        }),
      }),
    ),

  dashboardVaccinationReminders: (withinDays: number) =>
    j<VaccinationReminder[]>(
      fetch(`/api/dashboard/vaccination-reminders?within=${withinDays}`, cred),
    ),

  usersList: () => j<StaffUserRow[]>(fetch("/api/users", cred)),
  usersCreate: (input: CreateStaffUserInput) =>
    j<StaffUserRow>(
      fetch("/api/users", {
        ...cred,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      }),
    ),
  usersSetActive: (id: string, active: boolean) =>
    j<StaffUserRow>(
      fetch(`/api/users/${id}`, {
        ...cred,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      }),
    ),

  opdRequestsList: (
    status?: "open" | "pending" | "in_progress" | "completed",
  ) =>
    j<OpdRequestRow[]>(
      fetch(`/api/opd/requests${status ? `?status=${status}` : ""}`, cred),
    ),
  opdRequestCreate: (petId: string) =>
    j<OpdRequestRow>(
      fetch("/api/opd/requests", {
        ...cred,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ petId }),
      }),
    ),
  opdRequestClaim: (id: string) =>
    j<OpdRequestRow>(
      fetch(`/api/opd/requests/${id}/claim`, {
        ...cred,
        method: "PATCH",
      }),
    ),
  opdRequestReopen: (id: string) =>
    j<OpdRequestRow>(
      fetch(`/api/opd/requests/${id}/reopen`, {
        ...cred,
        method: "PATCH",
      }),
    ),
  opdConsultationsList: (petId?: string, mine?: boolean) => {
    const qp = new URLSearchParams();
    if (petId) qp.set("petId", petId);
    if (mine) qp.set("mine", "1");
    const suffix = qp.toString();
    return j<OpdConsultationRow[]>(
      fetch(`/api/opd/consultations${suffix ? `?${suffix}` : ""}`, cred),
    );
  },
  opdConsultationCreate: (input: OpdConsultationInput) =>
    j<OpdConsultationRow>(
      fetch("/api/opd/consultations", {
        ...cred,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      }),
    ),
  opdConsultationUpdate: (id: string, input: OpdConsultationInput) =>
    j<OpdConsultationRow>(
      fetch(`/api/opd/consultations/${id}`, {
        ...cred,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      }),
    ),
  opdConsultationDelete: (id: string) =>
    fetch(`/api/opd/consultations/${id}`, {
      ...cred,
      method: "DELETE",
    }).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
    }),
  opdDashboard: () => j<OpdDashboardSummary>(fetch("/api/opd/dashboard", cred)),
  opdCatalogList: (type?: OpdCatalogType) =>
    j<OpdCatalogItemRow[]>(
      fetch(`/api/opd/catalog${type ? `?type=${type}` : ""}`, cred),
    ),
  opdCatalogCreate: (type: OpdCatalogType, name: string) =>
    j<OpdCatalogItemRow>(
      fetch("/api/opd/catalog", {
        ...cred,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, name }),
      }),
    ),
  opdCatalogDelete: (id: string) =>
    fetch(`/api/opd/catalog/${id}`, { ...cred, method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
    }),

  clinicGet: () => j<ClinicRow>(fetch("/api/clinic", cred)),

  clinicUpdate: (input: ClinicInput) =>
    j<ClinicRow>(
      fetch("/api/clinic", {
        ...cred,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    ),
};

export { valueHighlight } from "@/lib/types";
