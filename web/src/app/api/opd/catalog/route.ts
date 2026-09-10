import { v4 as uuid } from "uuid";
import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { OpdCatalogItem } from "@/lib/models";
import { toOpdCatalogItemRow } from "@/lib/opd";
import { assertCanManageClinic, assertSuperadmin } from "@/lib/permissions";
import type { OpdCatalogItemRow, OpdCatalogType } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await connectDb();
    const session = await requireSession();
    assertCanManageClinic(session.role);
    const typeParam = new URL(req.url).searchParams.get("type");
    const filter: Record<string, string> = {};
    if (
      typeParam === "history_observation" ||
      typeParam === "dx" ||
      typeParam === "ddx" ||
      typeParam === "vaccine" ||
      typeParam === "deworming" ||
      typeParam === "surgery" ||
      typeParam === "surgery_dx" ||
      typeParam === "surgery_ddx" ||
      typeParam === "radiology_dx" ||
      typeParam === "radiology_ddx" ||
      typeParam === "ultrasonography_dx" ||
      typeParam === "ultrasonography_ddx" ||
      typeParam === "medicine" ||
      typeParam === "food" ||
      typeParam === "symptom"
    ) {
      filter.type = typeParam;
    }
    const rows = await OpdCatalogItem.find(filter).sort({ name: 1 }).lean();
    const out: OpdCatalogItemRow[] = rows.map((x) => toOpdCatalogItemRow(x));
    return jsonOk(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}

export async function POST(req: Request) {
  try {
    await connectDb();
    const session = await requireSession();
    assertSuperadmin(session.role);
    const body = (await req.json()) as {
      type?: OpdCatalogType;
      name?: string;
    };
    if (
      body.type !== "history_observation" &&
      body.type !== "dx" &&
      body.type !== "ddx" &&
      body.type !== "vaccine" &&
      body.type !== "deworming" &&
      body.type !== "surgery" &&
      body.type !== "surgery_dx" &&
      body.type !== "surgery_ddx" &&
      body.type !== "radiology_dx" &&
      body.type !== "radiology_ddx" &&
      body.type !== "ultrasonography_dx" &&
      body.type !== "ultrasonography_ddx" &&
      body.type !== "medicine" &&
      body.type !== "food" &&
      body.type !== "symptom"
    ) {
      return jsonError("invalid catalog type", 400);
    }
    const name = body.name?.trim() ?? "";
    if (!name) return jsonError("name is required", 400);
    const exists = await OpdCatalogItem.findOne({
      type: body.type,
      name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    }).lean();
    if (exists) return jsonError("Item already exists", 409);

    const id = uuid();
    const now = new Date().toISOString();
    await OpdCatalogItem.create({
      id,
      type: body.type,
      name,
      active: true,
      created_at: now,
    });
    const created = await OpdCatalogItem.findOne({ id }).lean();
    if (!created) return jsonError("Could not create catalog item", 500);
    return jsonOk(toOpdCatalogItemRow(created));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
