#!/usr/bin/env python3
"""One-off port of Next.js page components to Vite/Tauri (imports + router)."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def port_pet_detail(s: str) -> str:
    s = s.replace('"use client";\n\n', "")
    s = s.replace(
        'import Link from "next/link";\n'
        'import { useParams, useRouter, useSearchParams } from "next/navigation";\n'
        'import { FormEvent, useEffect, useState } from "react";\n'
        'import { useAuth } from "@/components/auth-provider";\n'
        'import { api, valueHighlight } from "@/lib/api";\n'
        'import { appPrint } from "@/lib/print";\n'
        'import type {\n'
        "  ClinicRow,\n"
        "  GroomingInput,\n"
        "  GroomingRow,\n"
        "  LabResultDetail,\n"
        "  MedicalInput,\n"
        "  MedicalRow,\n"
        "  OpdConsultationInput,\n"
        "  PetInput,\n"
        "  VaccinationInput,\n"
        "  VaccinationRow,\n"
        '} from "@/lib/types";\n'
        'import { canManageClinic } from "@/lib/permissions";\n',
        'import { FormEvent, useEffect, useState } from "react";\n'
        'import {\n'
        '  Link,\n'
        '  useNavigate,\n'
        '  useParams,\n'
        '  useSearchParams,\n'
        '} from "react-router-dom";\n'
        'import {\n'
        "  api,\n"
        "  valueHighlight,\n"
        "  type ClinicRow,\n"
        "  type GroomingInput,\n"
        "  type GroomingRow,\n"
        "  type LabResultDetail,\n"
        "  type MedicalInput,\n"
        "  type MedicalRow,\n"
        "  type OpdConsultationInput,\n"
        "  type PetInput,\n"
        "  type VaccinationInput,\n"
        "  type VaccinationRow,\n"
        '} from "../api";\n'
        'import { appPrint } from "../print";\n'
        'import { useAuth } from "../auth";\n'
        'import { canManageClinic } from "../permissions";\n',
    )
    s = s.replace("export default function PetDetailPage()", "export default function PetDetail()")
    s = s.replace(
        "  const params = useParams<{ id: string }>();\n  const id = params.id;\n  const router = useRouter();",
        "  const { id } = useParams<{ id: string }>();\n  const navigate = useNavigate();",
    )
    s = s.replace("router.replace(", "navigate(")
    s = s.replace("router.push(", "navigate(")
    # Next.js navigate second arg was { scroll: false }; React Router uses { replace: true } for replace
    s = s.replace(", { scroll: false }", ", { replace: true }")
    s = s.replace("href=", "to=")
    return s


def port_opd(s: str) -> str:
    s = s.replace('"use client";\n\n', "")
    s = s.replace(
        'import Link from "next/link";\n'
        'import { FormEvent, useEffect, useMemo, useState } from "react";\n'
        'import { useAuth } from "@/components/auth-provider";\n'
        'import { api } from "@/lib/api";\n'
        'import { canManageStaffAccounts } from "@/lib/permissions";\n'
        'import { appPrint } from "@/lib/print";\n'
        'import type {\n'
        "  ClinicRow,\n"
        "  GroomingRow,\n"
        "  LabTestRow,\n"
        "  MedicalRow,\n"
        "  OpdCatalogItemRow,\n"
        "  OpdCatalogType,\n"
        "  OpdConsultationInput,\n"
        "  OpdConsultationRow,\n"
        "  OpdRequestRow,\n"
        "  VaccinationRow,\n"
        '} from "@/lib/types";\n',
        'import { FormEvent, useEffect, useMemo, useState } from "react";\n'
        'import { Link } from "react-router-dom";\n'
        'import {\n'
        "  api,\n"
        "  type ClinicRow,\n"
        "  type GroomingRow,\n"
        "  type LabTestRow,\n"
        "  type MedicalRow,\n"
        "  type OpdCatalogItemRow,\n"
        "  type OpdCatalogType,\n"
        "  type OpdConsultationInput,\n"
        "  type OpdConsultationRow,\n"
        "  type OpdRequestRow,\n"
        "  type VaccinationRow,\n"
        '} from "../api";\n'
        'import { useAuth } from "../auth";\n'
        'import { canManageStaffAccounts } from "../permissions";\n'
        'import { appPrint } from "../print";\n',
    )
    s = s.replace("export default function OpdPage()", "export default function Opd()")
    s = s.replace("api.opdDashboard()", "api.opdDashboardSummary()")
    s = s.replace("href=", "to=")
    return s


def port_opd_settings(s: str) -> str:
    s = s.replace('"use client";\n\n', "")
    s = s.replace(
        'import { FormEvent, useEffect, useState } from "react";\n'
        'import { useAuth } from "@/components/auth-provider";\n'
        'import { api } from "@/lib/api";\n'
        'import { canManageClinic } from "@/lib/permissions";\n'
        'import type { OpdCatalogItemRow, OpdCatalogType } from "@/lib/types";\n',
        'import { FormEvent, useEffect, useState } from "react";\n'
        'import { api, type OpdCatalogItemRow, type OpdCatalogType } from "../api";\n'
        'import { useAuth } from "../auth";\n'
        'import { canManageClinic } from "../permissions";\n',
    )
    s = s.replace("export default function OpdSettingsPage()", "export default function OpdSettings()")
    return s


def main() -> None:
    pet_src = ROOT / "web/src/components/pages/pet-detail-page.tsx"
    pet_dst = ROOT / "src/pages/PetDetail.tsx"
    pet_dst.write_text(port_pet_detail(pet_src.read_text()), encoding="utf-8")
    print(f"Wrote {pet_dst.relative_to(ROOT)}")

    opd_src = ROOT / "web/src/components/pages/opd-page.tsx"
    opd_dst = ROOT / "src/pages/Opd.tsx"
    opd_dst.write_text(port_opd(opd_src.read_text()), encoding="utf-8")
    print(f"Wrote {opd_dst.relative_to(ROOT)}")

    settings_src = ROOT / "web/src/components/pages/opd-settings-page.tsx"
    settings_dst = ROOT / "src/pages/OpdSettings.tsx"
    settings_dst.write_text(port_opd_settings(settings_src.read_text()), encoding="utf-8")
    print(f"Wrote {settings_dst.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
