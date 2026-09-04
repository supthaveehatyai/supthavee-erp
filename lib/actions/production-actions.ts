'use server';

/**
 * Production Kanban (MTO) Server Actions.
 * Zero Client-Side Fetching — Service Role (`supabaseAdmin`) only.
 *
 * Next.js rule: a `"use server"` file may ONLY export async functions.
 * Types live in `@/types/production` — do NOT export type from this file.
 *
 * Cloud schema assumptions (do NOT invent migrations here):
 * - production_jobs.finished_model_id → product_models.id
 * - production_jobs.status is VARCHAR (not ENUM)
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server-admin";
import {
  emptyProductionBoard,
  isProductionKanbanStatus,
  type CreateProductionJobFromSOPayload,
  type CreateProductionJobFromSOResult,
  type CreateProductionJobPayload,
  type CreateProductionJobResult,
  type GetProductionJobDetailResult,
  type GetProductionJobsResult,
  type ManufacturedModelOption,
  type ProductionJobCard,
  type ProductionJobDetail,
  type ProductionJobDetailItem,
  type ProductionJobDetailMaterial,
  type ProductionKanbanStatus,
  type SearchManufacturedModelsResult,
  type UpdateJobStatusResult,
} from "@/types/production";

const KANBAN_PATH = "/production/kanban";
const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_UNDEFINED_TABLE = "42P01";
const POSTGRES_FOREIGN_KEY_VIOLATION = "23503";
const JOB_NO_MAX_RETRIES = 5;

/** Untyped admin client — cloud schema may differ from generated Database types. */
function getSupabaseAdmin(): SupabaseClient {
  return createClient() as unknown as SupabaseClient;
}

function toQty(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function toPositiveQty(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function toWastePercent(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toCostPrice(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/** planned_qty = (quantity_required × target_quantity) × (1 + waste%/100) */
function calculatePlannedQty(
  quantityRequired: number,
  targetQuantity: number,
  wastePercent: number,
): number {
  const raw =
    quantityRequired * targetQuantity * (1 + wastePercent / 100);
  return Math.round((raw + Number.EPSILON) * 10000) / 10000;
}

function bangkokYyMm(): { yy: string; mm: string } {
  const ymd = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Bangkok",
  });
  return { yy: ymd.slice(2, 4), mm: ymd.slice(5, 7) };
}

function isYmdDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function escapeIlikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * MTO-YYMM-XXXX — running number ต่อเดือน (Asia/Bangkok)
 */
async function nextMtoJobNo(supabase: SupabaseClient): Promise<string> {
  const { yy, mm } = bangkokYyMm();
  const prefix = `MTO-${yy}${mm}-`;

  const { data, error } = await supabase
    .from("production_jobs")
    .select("job_no")
    .like("job_no", `${prefix}%`)
    .order("job_no", { ascending: false })
    .limit(1);

  if (error) {
    const suffix = crypto
      .randomUUID()
      .replace(/-/g, "")
      .slice(0, 4)
      .toUpperCase();
    return `${prefix}${suffix}`;
  }

  let seq = 1;
  const latest = data?.[0]?.job_no ?? "";
  const match = String(latest).match(/MTO-\d{4}-(\d+)$/i);
  if (match?.[1]) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > 0) seq = n + 1;
  }

  return `${prefix}${String(seq).padStart(4, "0")}`;
}

type BomSnapshotRow = {
  id: string;
  raw_material_model_id: string;
  uom_id: string;
  quantity_required: number | string | null;
  waste_percent: number | string | null;
};

async function rollbackCreatedJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<void> {
  // Compensating rollback (PostgREST ไม่มี multi-statement transaction)
  await supabase
    .from("production_job_materials")
    .delete()
    .eq("job_id", jobId);
  await supabase.from("production_job_items").delete().eq("job_id", jobId);
  await supabase.from("production_jobs").delete().eq("id", jobId);
}

type MaterialInsertRow = {
  raw_material_model_id: string;
  uom_id: string;
  planned_qty: number;
  cost_price_snapshot: number;
};

/**
 * ดึง BOM ของ finished_model_id แล้วคำนวณ planned_qty รวม %เผื่อเสีย
 * planned_qty = (quantity_required × target_quantity) × (1 + waste%/100)
 */
async function buildBomMaterialRows(
  supabase: SupabaseClient,
  finishedModelId: string,
  targetQuantity: number,
): Promise<
  | { success: true; rows: MaterialInsertRow[] }
  | { success: false; error: string }
> {
  const { data: bomRows, error: bomError } = await supabase
    .from("product_boms")
    .select(
      "id, raw_material_model_id, uom_id, quantity_required, waste_percent",
    )
    .eq("finished_model_id", finishedModelId);

  if (bomError) {
    if (bomError.code === POSTGRES_UNDEFINED_TABLE) {
      return {
        success: false,
        error: "ยังไม่มีตาราง product_boms — ตั้งค่าสูตรการผลิตก่อน",
      };
    }
    return {
      success: false,
      error: bomError.message ?? "ดึงสูตรการผลิต (BOM) ไม่สำเร็จ",
    };
  }

  const bomList = (bomRows as BomSnapshotRow[] | null) ?? [];
  if (bomList.length === 0) {
    return {
      success: false,
      error:
        "ยังไม่มีสูตรการผลิต (BOM) สำหรับรุ่นนี้ — กรุณาตั้งค่า BOM ก่อนเปิดใบสั่งผลิต",
    };
  }

  const rawMaterialIds = [
    ...new Set(
      bomList
        .map((row) => String(row.raw_material_model_id ?? "").trim())
        .filter(Boolean),
    ),
  ];

  const costByModelId = new Map<string, number | null>();
  if (rawMaterialIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("model_id, cost_price, created_at")
      .in("model_id", rawMaterialIds)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (productsError) {
      return {
        success: false,
        error: productsError.message ?? "ดึงต้นทุนวัตถุดิบไม่สำเร็จ",
      };
    }

    for (const product of products ?? []) {
      const modelKey = String(product.model_id ?? "").trim();
      if (!modelKey || costByModelId.has(modelKey)) continue;
      costByModelId.set(modelKey, toCostPrice(product.cost_price));
    }
  }

  const rows: MaterialInsertRow[] = bomList.map((bom) => {
    const rawMaterialId = String(bom.raw_material_model_id).trim();
    const quantityRequired = toPositiveQty(bom.quantity_required) ?? 0;
    const wastePercent = toWastePercent(bom.waste_percent);
    const plannedQty = calculatePlannedQty(
      quantityRequired,
      targetQuantity,
      wastePercent,
    );
    const costSnapshot = costByModelId.get(rawMaterialId) ?? null;

    return {
      raw_material_model_id: rawMaterialId,
      uom_id: String(bom.uom_id),
      planned_qty: plannedQty,
      cost_price_snapshot: costSnapshot ?? 0,
    };
  });

  return { success: true, rows };
}

type ProductModelJoin =
  | { id: string; name: string | null; model_code: string | null; short_name: string | null }
  | { id: string; name: string | null; model_code: string | null; short_name: string | null }[]
  | null;

type JobQueryRow = {
  id: string;
  job_no: string;
  status: string | null;
  finished_model_id: string | null;
  target_quantity: number | string | null;
  estimated_completion_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  product_models?: ProductModelJoin;
};

function unwrapModel(
  join: ProductModelJoin | undefined,
): { name: string; model_code: string } | null {
  if (!join) return null;
  const row = Array.isArray(join) ? join[0] : join;
  if (!row) return null;
  const name =
    String(row.name ?? "").trim() || String(row.short_name ?? "").trim();
  const model_code = String(row.model_code ?? "").trim();
  return { name, model_code };
}

function parseBoardStatus(
  raw: string | null | undefined,
): ProductionKanbanStatus | null {
  const status = String(raw ?? "").trim().toUpperCase();
  if (!isProductionKanbanStatus(status)) return null;
  return status;
}

function mapJobCard(row: JobQueryRow): ProductionJobCard | null {
  const status = parseBoardStatus(row.status);
  if (!status) return null;

  const model = unwrapModel(row.product_models);
  const productName = model?.name || model?.model_code || "— ยังไม่ผูกสินค้า";

  return {
    id: String(row.id),
    job_no: String(row.job_no ?? "").trim() || "—",
    status,
    finished_model_id: row.finished_model_id
      ? String(row.finished_model_id)
      : null,
    product_name: productName,
    product_model_code: model?.model_code || null,
    target_quantity: toQty(row.target_quantity),
    estimated_completion_date: row.estimated_completion_date
      ? String(row.estimated_completion_date)
      : null,
    created_at: row.created_at ? String(row.created_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

function buildBoard(rows: JobQueryRow[]): {
  data: ReturnType<typeof emptyProductionBoard>;
  flat: ProductionJobCard[];
} {
  const flat: ProductionJobCard[] = [];
  const data = emptyProductionBoard();

  for (const row of rows) {
    const card = mapJobCard(row);
    if (!card) continue;
    flat.push(card);
    data[card.status].push(card);
  }

  return { data, flat };
}

/**
 * ดึงใบสั่งผลิตทั้งหมดสำหรับ Kanban
 * Join product_models.name ผ่าน FK `finished_model_id` เท่านั้น
 */
export async function getProductionJobs(): Promise<GetProductionJobsResult> {
  const empty = emptyProductionBoard();

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // Explicit FK hint — production_jobs.finished_model_id → product_models.id
    const { data, error } = await supabaseAdmin
      .from("production_jobs")
      .select(
        `
        id,
        job_no,
        status,
        finished_model_id,
        target_quantity,
        estimated_completion_date,
        created_at,
        updated_at,
        product_models!production_jobs_finished_model_id_fkey (
          id,
          name,
          model_code,
          short_name
        )
      `,
      )
      .order("estimated_completion_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (!error) {
      const { data: board, flat } = buildBoard(
        (data as JobQueryRow[] | null) ?? [],
      );
      return { success: true, data: board, flat };
    }

    // Fallback: 2-query join when PostgREST embed / FK name differs
    console.warn(
      "[getProductionJobs] embed via finished_model_id failed, fallback:",
      error.message,
    );

    const { data: rows, error: jobsError } = await supabaseAdmin
      .from("production_jobs")
      .select(
        "id, job_no, status, finished_model_id, target_quantity, estimated_completion_date, created_at, updated_at",
      )
      .order("estimated_completion_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (jobsError) {
      return {
        success: false,
        error: jobsError.message ?? "ดึงข้อมูลใบสั่งผลิตไม่สำเร็จ",
        data: empty,
        flat: [],
      };
    }

    const modelIds = [
      ...new Set(
        (rows ?? [])
          .map((r) => String(r.finished_model_id ?? "").trim())
          .filter(Boolean),
      ),
    ];

    const modelById = new Map<
      string,
      { name: string; model_code: string; short_name: string | null }
    >();

    if (modelIds.length > 0) {
      const { data: models, error: modelError } = await supabaseAdmin
        .from("product_models")
        .select("id, name, model_code, short_name")
        .in("id", modelIds);

      if (modelError) {
        return {
          success: false,
          error: modelError.message ?? "ดึงชื่อสินค้ารุ่นไม่สำเร็จ",
          data: empty,
          flat: [],
        };
      }

      for (const m of models ?? []) {
        modelById.set(String(m.id), {
          name: String(m.name ?? "").trim(),
          model_code: String(m.model_code ?? "").trim(),
          short_name: m.short_name ? String(m.short_name) : null,
        });
      }
    }

    const hydrated: JobQueryRow[] = (rows ?? []).map((row) => {
      const finishedId = row.finished_model_id
        ? String(row.finished_model_id)
        : null;
      const model = finishedId ? modelById.get(finishedId) : undefined;
      return {
        ...(row as JobQueryRow),
        finished_model_id: finishedId,
        product_models: model
          ? {
              id: finishedId!,
              name: model.name,
              model_code: model.model_code,
              short_name: model.short_name,
            }
          : null,
      };
    });

    const { data: board, flat } = buildBoard(hydrated);
    return { success: true, data: board, flat };
  } catch (err) {
    console.error("[getProductionJobs]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ดึงข้อมูลใบสั่งผลิตไม่สำเร็จ",
      data: empty,
      flat: [],
    };
  }
}

/**
 * อัปเดตสถานะใบสั่งผลิต
 * status ใน DB เป็น VARCHAR — validate ด้วย TS union เท่านั้น
 */
export async function updateJobStatus(
  jobId: string,
  newStatus: ProductionKanbanStatus | string,
): Promise<UpdateJobStatusResult> {
  try {
    const id = jobId?.trim() ?? "";
    const status = String(newStatus ?? "").trim().toUpperCase();

    if (!id) {
      return { success: false, error: "ไม่พบรหัสงาน (jobId)" };
    }
    if (!isProductionKanbanStatus(status)) {
      return {
        success: false,
        error: `สถานะไม่ถูกต้อง: ${newStatus || "(ว่าง)"} — ใช้ PLANNED / IN_PROGRESS / QA / COMPLETED`,
      };
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: current, error: currentError } = await supabaseAdmin
      .from("production_jobs")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (currentError) {
      return {
        success: false,
        error: currentError.message ?? "ตรวจสอบสถานะงานไม่สำเร็จ",
      };
    }
    if (!current) {
      return { success: false, error: "ไม่พบใบสั่งผลิตในระบบ" };
    }

    const { data, error } = await supabaseAdmin
      .from("production_jobs")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[updateJobStatus]", error.message);
      return {
        success: false,
        error: error.message ?? "อัปเดตสถานะงานไม่สำเร็จ",
      };
    }
    if (!data) {
      return { success: false, error: "ไม่พบใบสั่งผลิตในระบบ" };
    }

    revalidatePath(KANBAN_PATH);
    return { success: true, error: null };
  } catch (err) {
    console.error("[updateJobStatus]", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "อัปเดตสถานะงานไม่สำเร็จ",
    };
  }
}

/**
 * สร้างใบสั่งผลิต MTO (status = PLANNED) + Snapshot สูตรการผลิตลง production_job_materials
 *
 * job_no: MTO-YYMM-XXXX
 * planned_qty = (quantity_required × target_quantity) × (1 + waste_percent/100)
 * cost_price_snapshot = products.cost_price ของ SKU ลูกตัวแรกของวัตถุดิบ
 *
 * Compensating rollback เมื่อ insert materials ล้มเหลว (ลบ job + materials ที่ค้าง)
 */
export async function createProductionJob(
  payload: CreateProductionJobPayload,
): Promise<CreateProductionJobResult> {
  try {
    const finishedModelId = String(payload?.finished_model_id ?? "").trim();
    const targetQuantity = toPositiveQty(payload?.target_quantity);
    const estimatedCompletionDate = String(
      payload?.estimated_completion_date ?? "",
    )
      .trim()
      .slice(0, 10);

    if (!finishedModelId) {
      return {
        success: false,
        error: "กรุณาระบุรุ่นสินค้าสำเร็จรูป (finished_model_id)",
        data: null,
      };
    }
    if (targetQuantity == null) {
      return {
        success: false,
        error: "จำนวนที่สั่งผลิต (target_quantity) ต้องมากกว่า 0",
        data: null,
      };
    }
    if (!isYmdDate(estimatedCompletionDate)) {
      return {
        success: false,
        error: "กรุณาระบุวันกำหนดเสร็จ (estimated_completion_date) เป็น YYYY-MM-DD",
        data: null,
      };
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1) Validate finished goods model
    const { data: finishedModel, error: modelError } = await supabaseAdmin
      .from("product_models")
      .select("id, name, model_code, is_raw_material, is_service, is_manufactured")
      .eq("id", finishedModelId)
      .maybeSingle();

    if (modelError) {
      return {
        success: false,
        error: modelError.message ?? "ตรวจสอบรุ่นสินค้าไม่สำเร็จ",
        data: null,
      };
    }
    if (!finishedModel) {
      return {
        success: false,
        error: "ไม่พบรุ่นสินค้าสำเร็จรูปในระบบ",
        data: null,
      };
    }
    if (finishedModel.is_raw_material === true) {
      return {
        success: false,
        error: "ไม่สามารถเปิดใบสั่งผลิตจากรุ่นวัตถุดิบได้",
        data: null,
      };
    }
    if (finishedModel.is_service === true) {
      return {
        success: false,
        error: "ไม่สามารถเปิดใบสั่งผลิตจากงานบริการได้",
        data: null,
      };
    }

    // 2) BOM Snapshot rows
    const bomBuilt = await buildBomMaterialRows(
      supabaseAdmin,
      finishedModelId,
      targetQuantity,
    );
    if (!bomBuilt.success) {
      return { success: false, error: bomBuilt.error, data: null };
    }
    const materialRows = bomBuilt.rows;

    // 3) Insert job (retry on job_no unique collision) + materials with rollback
    let lastError = "สร้างใบสั่งผลิตไม่สำเร็จ";

    for (let attempt = 0; attempt < JOB_NO_MAX_RETRIES; attempt += 1) {
      const jobNo = await nextMtoJobNo(supabaseAdmin);

      const { data: created, error: insertError } = await supabaseAdmin
        .from("production_jobs")
        .insert({
          job_no: jobNo,
          status: "PLANNED",
          finished_model_id: finishedModelId,
          target_quantity: targetQuantity,
          estimated_completion_date: estimatedCompletionDate,
        })
        .select("id, job_no")
        .maybeSingle();

      if (insertError) {
        lastError = insertError.message ?? "สร้างใบสั่งผลิตไม่สำเร็จ";
        if (insertError.code === POSTGRES_UNIQUE_VIOLATION) {
          continue;
        }
        if (insertError.code === POSTGRES_FOREIGN_KEY_VIOLATION) {
          return {
            success: false,
            error: "รุ่นสินค้าไม่ถูกต้อง หรืออ้างอิงไม่พบในระบบ",
            data: null,
          };
        }
        return { success: false, error: lastError, data: null };
      }

      if (!created?.id) {
        return {
          success: false,
          error: "สร้างใบสั่งผลิตไม่สำเร็จ — ไม่ได้รหัสงานกลับมา",
          data: null,
        };
      }

      const jobId = String(created.id);
      const materialsPayload = materialRows.map((row) => ({
        ...row,
        job_id: jobId,
      }));

      const { error: materialsError } = await supabaseAdmin
        .from("production_job_materials")
        .insert(materialsPayload);

      if (materialsError) {
        await rollbackCreatedJob(supabaseAdmin, jobId);

        if (materialsError.code === POSTGRES_UNDEFINED_TABLE) {
          return {
            success: false,
            error:
              "ยังไม่มีตาราง production_job_materials — ไม่สามารถ Snapshot BOM ได้",
            data: null,
          };
        }
        if (materialsError.code === POSTGRES_FOREIGN_KEY_VIOLATION) {
          return {
            success: false,
            error:
              "บันทึกวัตถุดิบในใบสั่งผลิตไม่สำเร็จ — วัตถุดิบหรือหน่วยนับอ้างอิงไม่ถูกต้อง (Rollback แล้ว)",
            data: null,
          };
        }

        return {
          success: false,
          error: `${materialsError.message ?? "บันทึก production_job_materials ไม่สำเร็จ"} (Rollback แล้ว)`,
          data: null,
        };
      }

      revalidatePath(KANBAN_PATH);
      return {
        success: true,
        error: null,
        data: {
          id: jobId,
          job_no: String(created.job_no ?? jobNo),
          materials_count: materialsPayload.length,
        },
      };
    }

    return { success: false, error: lastError, data: null };
  } catch (err) {
    console.error("[createProductionJob]", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "สร้างใบสั่งผลิตไม่สำเร็จ",
      data: null,
    };
  }
}

/**
 * สร้างใบสั่งผลิตจาก Sales Order (SO) โดยตรง — ลด Human Error
 *
 * 1) production_jobs.ref_document_id = so_id (Audit Trail)
 * 2) production_job_items จากรายการ SKU ที่ลูกค้าสั่ง
 * 3) BOM Snapshot → production_job_materials (รวม %เผื่อเสีย)
 *
 * Compensating rollback หากขั้นตอนใดล้มเหลวหลังสร้าง job
 */
export async function createProductionJobFromSO(
  payload: CreateProductionJobFromSOPayload,
): Promise<CreateProductionJobFromSOResult> {
  try {
    const soId = String(payload?.so_id ?? "").trim();
    const finishedModelId = String(payload?.finished_model_id ?? "").trim();
    const mockupImageUrl = String(payload?.mockup_image_url ?? "").trim() || null;
    const remark = String(payload?.remark ?? "").trim() || null;
    const estimatedRaw = String(payload?.estimated_completion_date ?? "")
      .trim()
      .slice(0, 10);
    const estimatedCompletionDate =
      estimatedRaw && isYmdDate(estimatedRaw) ? estimatedRaw : null;

    const rawItems = Array.isArray(payload?.items) ? payload.items : [];
    const items = rawItems
      .map((item) => ({
        product_id: String(item?.product_id ?? "").trim(),
        quantity: toPositiveQty(item?.quantity),
      }))
      .filter(
        (item): item is { product_id: string; quantity: number } =>
          Boolean(item.product_id) && item.quantity != null,
      );

    if (!soId) {
      return {
        success: false,
        error: "ไม่พบรหัสเอกสารขาย (so_id)",
        data: null,
      };
    }
    if (!finishedModelId) {
      return {
        success: false,
        error: "กรุณาระบุรุ่นสินค้าสำเร็จรูป (finished_model_id)",
        data: null,
      };
    }
    if (items.length === 0) {
      return {
        success: false,
        error: "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ (product_id + quantity > 0)",
        data: null,
      };
    }

    const targetQuantity = toQty(
      items.reduce((sum, item) => sum + item.quantity, 0),
    );
    if (targetQuantity <= 0) {
      return {
        success: false,
        error: "จำนวนรวมจากรายการสินค้าต้องมากกว่า 0",
        data: null,
      };
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1) Validate SO document
    const { data: soDoc, error: soError } = await supabaseAdmin
      .from("documents")
      .select("id, doc_no, doc_type, status")
      .eq("id", soId)
      .maybeSingle();

    if (soError) {
      return {
        success: false,
        error: soError.message ?? "ตรวจสอบเอกสารขายไม่สำเร็จ",
        data: null,
      };
    }
    if (!soDoc) {
      return {
        success: false,
        error: "ไม่พบเอกสารขาย (SO) ในระบบ",
        data: null,
      };
    }
    if (String(soDoc.doc_type ?? "").trim().toUpperCase() !== "SO") {
      return {
        success: false,
        error: `เอกสาร ${soDoc.doc_no ?? soId} ไม่ใช่ใบสั่งขาย (SO)`,
        data: null,
      };
    }
    if (String(soDoc.status ?? "").trim().toUpperCase() !== "ISSUED") {
      return {
        success: false,
        error: `ส่งงานผลิตได้เมื่อใบสั่งขายเป็นสถานะ ISSUED (ปัจจุบัน: ${soDoc.status ?? "—"})`,
        data: null,
      };
    }

    // 1b) Prevent duplicate send — same SO + finished_model already has an active job
    {
      const { data: existingJobs, error: existingError } = await supabaseAdmin
        .from("production_jobs")
        .select("id, job_no, status")
        .eq("ref_document_id", soId)
        .eq("finished_model_id", finishedModelId)
        .neq("status", "CANCELLED")
        .limit(1);

      if (existingError) {
        // If finished_model_id filter unsupported, fallback: any job for this SO
        const fallback = await supabaseAdmin
          .from("production_jobs")
          .select("id, job_no, status")
          .eq("ref_document_id", soId)
          .neq("status", "CANCELLED")
          .limit(1);
        if (!fallback.error && (fallback.data?.length ?? 0) > 0) {
          const jobNo = String(fallback.data?.[0]?.job_no ?? "").trim();
          return {
            success: false,
            error: jobNo
              ? `เอกสารนี้ถูกส่งเข้าผลิตแล้ว (${jobNo}) — ไม่สามารถส่งซ้ำได้`
              : "เอกสารนี้ถูกส่งเข้าผลิตแล้ว — ไม่สามารถส่งซ้ำได้",
            data: null,
          };
        }
      } else if ((existingJobs?.length ?? 0) > 0) {
        const jobNo = String(existingJobs?.[0]?.job_no ?? "").trim();
        return {
          success: false,
          error: jobNo
            ? `รุ่นนี้ถูกส่งเข้าผลิตแล้ว (${jobNo}) — ไม่สามารถส่งซ้ำได้`
            : "รุ่นนี้ถูกส่งเข้าผลิตแล้ว — ไม่สามารถส่งซ้ำได้",
          data: null,
        };
      }
    }

    // 2) Validate finished model
    const { data: finishedModel, error: modelError } = await supabaseAdmin
      .from("product_models")
      .select("id, name, model_code, is_raw_material, is_service, is_manufactured")
      .eq("id", finishedModelId)
      .maybeSingle();

    if (modelError) {
      return {
        success: false,
        error: modelError.message ?? "ตรวจสอบรุ่นสินค้าไม่สำเร็จ",
        data: null,
      };
    }
    if (!finishedModel) {
      return {
        success: false,
        error: "ไม่พบรุ่นสินค้าสำเร็จรูปในระบบ",
        data: null,
      };
    }
    if (finishedModel.is_raw_material === true) {
      return {
        success: false,
        error: "ไม่สามารถเปิดใบสั่งผลิตจากรุ่นวัตถุดิบได้",
        data: null,
      };
    }
    if (finishedModel.is_service === true) {
      return {
        success: false,
        error: "ไม่สามารถเปิดใบสั่งผลิตจากงานบริการได้",
        data: null,
      };
    }

    // 3) Validate SKUs belong to finished_model_id
    const productIds = [...new Set(items.map((item) => item.product_id))];
    const { data: productRows, error: productsError } = await supabaseAdmin
      .from("products")
      .select("id, model_id, sku")
      .in("id", productIds);

    if (productsError) {
      return {
        success: false,
        error: productsError.message ?? "ตรวจสอบรายการสินค้าไม่สำเร็จ",
        data: null,
      };
    }

    const productById = new Map(
      (productRows ?? []).map((row) => [String(row.id), row]),
    );
    for (const item of items) {
      const product = productById.get(item.product_id);
      if (!product) {
        return {
          success: false,
          error: `ไม่พบสินค้า (product_id: ${item.product_id}) ในระบบ`,
          data: null,
        };
      }
      if (String(product.model_id ?? "").trim() !== finishedModelId) {
        return {
          success: false,
          error: `SKU ${product.sku ?? item.product_id} ไม่ได้อยู่ภายใต้รุ่นสินค้าที่เลือก`,
          data: null,
        };
      }
    }

    // 4) BOM Snapshot จากยอดรวมที่ลูกค้าสั่ง
    const bomBuilt = await buildBomMaterialRows(
      supabaseAdmin,
      finishedModelId,
      targetQuantity,
    );
    if (!bomBuilt.success) {
      return { success: false, error: bomBuilt.error, data: null };
    }
    const materialRows = bomBuilt.rows;

    // 5) Insert job + items + materials (compensating rollback)
    let lastError = "สร้างใบสั่งผลิตจาก SO ไม่สำเร็จ";

    for (let attempt = 0; attempt < JOB_NO_MAX_RETRIES; attempt += 1) {
      const jobNo = await nextMtoJobNo(supabaseAdmin);

      const jobInsert: Record<string, unknown> = {
        job_no: jobNo,
        status: "PLANNED",
        finished_model_id: finishedModelId,
        target_quantity: targetQuantity,
        ref_document_id: soId,
        remark,
        mockup_image_url: mockupImageUrl,
      };
      if (estimatedCompletionDate) {
        jobInsert.estimated_completion_date = estimatedCompletionDate;
      }

      const { data: created, error: insertError } = await supabaseAdmin
        .from("production_jobs")
        .insert(jobInsert)
        .select("id, job_no")
        .maybeSingle();

      if (insertError) {
        lastError = insertError.message ?? "สร้างใบสั่งผลิตจาก SO ไม่สำเร็จ";
        if (insertError.code === POSTGRES_UNIQUE_VIOLATION) {
          continue;
        }
        if (insertError.code === POSTGRES_FOREIGN_KEY_VIOLATION) {
          return {
            success: false,
            error:
              "อ้างอิงเอกสารขายหรือรุ่นสินค้าไม่ถูกต้อง (ref_document_id / finished_model_id)",
            data: null,
          };
        }
        return { success: false, error: lastError, data: null };
      }

      if (!created?.id) {
        return {
          success: false,
          error: "สร้างใบสั่งผลิตไม่สำเร็จ — ไม่ได้รหัสงานกลับมา",
          data: null,
        };
      }

      const jobId = String(created.id);

      const itemsPayload = items.map((item) => ({
        job_id: jobId,
        product_id: item.product_id,
        quantity: item.quantity,
      }));

      const { error: itemsError } = await supabaseAdmin
        .from("production_job_items")
        .insert(itemsPayload);

      if (itemsError) {
        await rollbackCreatedJob(supabaseAdmin, jobId);

        if (itemsError.code === POSTGRES_UNDEFINED_TABLE) {
          return {
            success: false,
            error:
              "ยังไม่มีตาราง production_job_items — ไม่สามารถบันทึกรายการไซส์/SKU ได้",
            data: null,
          };
        }
        return {
          success: false,
          error: `${itemsError.message ?? "บันทึก production_job_items ไม่สำเร็จ"} (Rollback แล้ว)`,
          data: null,
        };
      }

      const materialsPayload = materialRows.map((row) => ({
        ...row,
        job_id: jobId,
      }));

      const { error: materialsError } = await supabaseAdmin
        .from("production_job_materials")
        .insert(materialsPayload);

      if (materialsError) {
        await rollbackCreatedJob(supabaseAdmin, jobId);

        if (materialsError.code === POSTGRES_UNDEFINED_TABLE) {
          return {
            success: false,
            error:
              "ยังไม่มีตาราง production_job_materials — ไม่สามารถ Snapshot BOM ได้",
            data: null,
          };
        }
        return {
          success: false,
          error: `${materialsError.message ?? "บันทึก production_job_materials ไม่สำเร็จ"} (Rollback แล้ว)`,
          data: null,
        };
      }

      // Mark SO line items as "กำลังผลิต" (best-effort — column may be cloud-only)
      {
        const productIdsForStatus = items.map((item) => item.product_id);
        const { error: statusError } = await supabaseAdmin
          .from("document_items")
          .update({ production_status: "IN_PRODUCTION" })
          .eq("document_id", soId)
          .in("product_id", productIdsForStatus);

        if (statusError) {
          console.warn(
            "[createProductionJobFromSO] mark production_status skipped:",
            statusError.message,
          );
        }
      }

      revalidatePath(KANBAN_PATH);
      revalidatePath("/sales");
      if (soDoc.doc_no) {
        revalidatePath(`/sales/${encodeURIComponent(String(soDoc.doc_no))}`);
      }

      return {
        success: true,
        error: null,
        data: {
          id: jobId,
          job_no: String(created.job_no ?? jobNo),
          items_count: itemsPayload.length,
          materials_count: materialsPayload.length,
        },
      };
    }

    return { success: false, error: lastError, data: null };
  } catch (err) {
    console.error("[createProductionJobFromSO]", err);
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "สร้างใบสั่งผลิตจาก SO ไม่สำเร็จ",
      data: null,
    };
  }
}

/**
 * ค้นหารุ่นสินค้าผลิตเอง (is_manufactured = true) สำหรับ Create MTO ComboBox
 */
export async function searchManufacturedModels(
  keyword: string,
): Promise<SearchManufacturedModelsResult> {
  try {
    const trimmed = keyword?.trim() ?? "";
    const supabaseAdmin = getSupabaseAdmin();

    const mapRows = (
      rows: Array<{ id: string; model_code: string | null; name: string | null }>,
    ): ManufacturedModelOption[] =>
      rows.map((row) => ({
        id: String(row.id),
        model_code: String(row.model_code ?? "").trim(),
        name: String(row.name ?? "").trim(),
      }));

    if (trimmed.length > 0) {
      const pattern = `%${escapeIlikePattern(trimmed)}%`;
      const [byName, byCode] = await Promise.all([
        supabaseAdmin
          .from("product_models")
          .select("id, model_code, name")
          .eq("is_manufactured", true)
          .eq("is_active", true)
          .neq("is_raw_material", true)
          .neq("is_service", true)
          .ilike("name", pattern)
          .order("model_code", { ascending: true })
          .limit(20),
        supabaseAdmin
          .from("product_models")
          .select("id, model_code, name")
          .eq("is_manufactured", true)
          .eq("is_active", true)
          .neq("is_raw_material", true)
          .neq("is_service", true)
          .ilike("model_code", pattern)
          .order("model_code", { ascending: true })
          .limit(20),
      ]);

      if (byName.error) {
        return {
          success: false,
          error: byName.error.message ?? "ค้นหารุ่นสินค้าไม่สำเร็จ",
          data: [],
        };
      }
      if (byCode.error) {
        return {
          success: false,
          error: byCode.error.message ?? "ค้นหารุ่นสินค้าไม่สำเร็จ",
          data: [],
        };
      }

      const byId = new Map<string, { id: string; model_code: string | null; name: string | null }>();
      for (const row of [...(byName.data ?? []), ...(byCode.data ?? [])]) {
        if (row?.id) byId.set(String(row.id), row);
      }
      return { success: true, data: mapRows([...byId.values()].slice(0, 20)) };
    }

    const { data, error } = await supabaseAdmin
      .from("product_models")
      .select("id, model_code, name")
      .eq("is_manufactured", true)
      .eq("is_active", true)
      .neq("is_raw_material", true)
      .neq("is_service", true)
      .order("model_code", { ascending: true })
      .limit(20);

    if (error) {
      return {
        success: false,
        error: error.message ?? "ค้นหารุ่นสินค้าไม่สำเร็จ",
        data: [],
      };
    }

    return { success: true, data: mapRows(data ?? []) };
  } catch (err) {
    console.error("[searchManufacturedModels]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ค้นหารุ่นสินค้าไม่สำเร็จ",
      data: [],
    };
  }
}

/**
 * รายละเอียดใบสั่งผลิตสำหรับ Slide-over (Job Details)
 * — header + production_job_items + production_job_materials
 */
export async function getProductionJobDetails(
  jobId: string,
): Promise<GetProductionJobDetailResult> {
  try {
    const id = jobId?.trim() ?? "";
    if (!id) {
      return { success: false, error: "ไม่พบรหัสงาน (jobId)", data: null };
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: job, error: jobError } = await supabaseAdmin
      .from("production_jobs")
      .select(
        `
        id,
        job_no,
        status,
        finished_model_id,
        target_quantity,
        estimated_completion_date,
        ref_document_id,
        mockup_image_url,
        remark
      `,
      )
      .eq("id", id)
      .maybeSingle();

    if (jobError) {
      return {
        success: false,
        error: jobError.message ?? "ดึงใบสั่งผลิตไม่สำเร็จ",
        data: null,
      };
    }
    if (!job) {
      return { success: false, error: "ไม่พบใบสั่งผลิตในระบบ", data: null };
    }

    const finishedModelId = job.finished_model_id
      ? String(job.finished_model_id)
      : null;
    const refDocumentId = job.ref_document_id
      ? String(job.ref_document_id)
      : null;

    const [modelRes, soRes, itemsRes, materialsRes] = await Promise.all([
      finishedModelId
        ? supabaseAdmin
            .from("product_models")
            .select("id, name, model_code, short_name, image_url")
            .eq("id", finishedModelId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      refDocumentId
        ? supabaseAdmin
            .from("documents")
            .select("id, doc_no, doc_type")
            .eq("id", refDocumentId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabaseAdmin
        .from("production_job_items")
        .select("id, product_id, quantity")
        .eq("job_id", id)
        .order("id", { ascending: true }),
      supabaseAdmin
        .from("production_job_materials")
        .select(
          "id, raw_material_model_id, uom_id, planned_qty, cost_price_snapshot",
        )
        .eq("job_id", id)
        .order("id", { ascending: true }),
    ]);

    if (itemsRes.error) {
      return {
        success: false,
        error: itemsRes.error.message ?? "ดึงรายการ SKU ไม่สำเร็จ",
        data: null,
      };
    }
    if (materialsRes.error) {
      return {
        success: false,
        error: materialsRes.error.message ?? "ดึงรายการวัตถุดิบไม่สำเร็จ",
        data: null,
      };
    }

    const itemRows = itemsRes.data ?? [];
    const materialRows = materialsRes.data ?? [];

    const productIds = [
      ...new Set(
        itemRows
          .map((row) => String(row.product_id ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const rawModelIds = [
      ...new Set(
        materialRows
          .map((row) => String(row.raw_material_model_id ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const uomIds = [
      ...new Set(
        materialRows
          .map((row) => String(row.uom_id ?? "").trim())
          .filter(Boolean),
      ),
    ];

    const [productsRes, rawModelsRes, uomsRes] = await Promise.all([
      productIds.length > 0
        ? supabaseAdmin
            .from("products")
            .select("id, sku, name, size, color")
            .in("id", productIds)
        : Promise.resolve({ data: [], error: null }),
      rawModelIds.length > 0
        ? supabaseAdmin
            .from("product_models")
            .select("id, model_code, name, short_name")
            .in("id", rawModelIds)
        : Promise.resolve({ data: [], error: null }),
      uomIds.length > 0
        ? supabaseAdmin
            .from("mst_uom")
            .select("uom_id, uom_code")
            .in("uom_id", uomIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (productsRes.error) {
      return {
        success: false,
        error: productsRes.error.message ?? "ดึงข้อมูล SKU ไม่สำเร็จ",
        data: null,
      };
    }
    if (rawModelsRes.error) {
      return {
        success: false,
        error: rawModelsRes.error.message ?? "ดึงข้อมูลวัตถุดิบไม่สำเร็จ",
        data: null,
      };
    }
    if (uomsRes.error) {
      return {
        success: false,
        error: uomsRes.error.message ?? "ดึงหน่วยนับไม่สำเร็จ",
        data: null,
      };
    }

    const productById = new Map(
      (productsRes.data ?? []).map((row) => [String(row.id), row]),
    );
    const rawModelById = new Map(
      (rawModelsRes.data ?? []).map((row) => [String(row.id), row]),
    );
    const uomById = new Map(
      (uomsRes.data ?? []).map((row) => [String(row.uom_id), row]),
    );

    const items: ProductionJobDetailItem[] = itemRows.map((row) => {
      const productId = String(row.product_id ?? "");
      const product = productById.get(productId);
      return {
        id: String(row.id),
        product_id: productId,
        sku: String(product?.sku ?? "—").trim() || "—",
        product_name: String(product?.name ?? "—").trim() || "—",
        size: product?.size ? String(product.size) : null,
        color: product?.color ? String(product.color) : null,
        quantity: toQty(row.quantity),
      };
    });

    const materials: ProductionJobDetailMaterial[] = materialRows.map((row) => {
      const rawId = String(row.raw_material_model_id ?? "");
      const raw = rawModelById.get(rawId);
      const uom = uomById.get(String(row.uom_id ?? ""));
      return {
        id: String(row.id),
        raw_material_model_id: rawId,
        raw_material_code: String(raw?.model_code ?? "—").trim() || "—",
        raw_material_name:
          String(raw?.name ?? raw?.short_name ?? "—").trim() || "—",
        uom_id: String(row.uom_id ?? ""),
        uom_code: uom?.uom_code ? String(uom.uom_code) : null,
        planned_qty: toQty(row.planned_qty),
        cost_price_snapshot: toCostPrice(row.cost_price_snapshot) ?? 0,
      };
    });

    const model = modelRes.data;
    const productName =
      String(model?.name ?? "").trim() ||
      String(model?.short_name ?? "").trim() ||
      String(model?.model_code ?? "").trim() ||
      "— ยังไม่ผูกสินค้า";

    const mockupFromCol = String(job.mockup_image_url ?? "").trim();
    const modelImage = String(model?.image_url ?? "").trim();
    const mockupImageUrl = mockupFromCol || modelImage || null;

    const remark = String(job.remark ?? "").trim() || null;

    const detail: ProductionJobDetail = {
      id: String(job.id),
      job_no: String(job.job_no ?? "").trim() || "—",
      status: String(job.status ?? "").trim().toUpperCase(),
      finished_model_id: finishedModelId,
      product_name: productName,
      product_model_code: model?.model_code
        ? String(model.model_code).trim()
        : null,
      target_quantity: toQty(job.target_quantity),
      estimated_completion_date: job.estimated_completion_date
        ? String(job.estimated_completion_date)
        : null,
      ref_document_id: refDocumentId,
      so_doc_no: soRes.data?.doc_no ? String(soRes.data.doc_no) : null,
      mockup_image_url: mockupImageUrl,
      remark,
      items,
      materials,
    };

    return { success: true, data: detail };
  } catch (err) {
    console.error("[getProductionJobDetails]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ดึงรายละเอียดใบสั่งผลิตไม่สำเร็จ",
      data: null,
    };
  }
}
