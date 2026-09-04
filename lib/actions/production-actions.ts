"use server";

/**
 * Production Kanban (MTO) Server Actions.
 * Zero Client-Side Fetching — Service Role (`supabaseAdmin`) only.
 *
 * Cloud schema assumptions (do NOT invent migrations here):
 * - production_jobs.finished_model_id → product_models.id
 * - production_jobs.status is VARCHAR (not ENUM)
 * Types: `@/types/production`
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server-admin";
import {
  emptyProductionBoard,
  isProductionKanbanStatus,
  type GetProductionJobsResult,
  type ProductionJobCard,
  type ProductionKanbanStatus,
  type UpdateJobStatusResult,
} from "@/types/production";

const KANBAN_PATH = "/production/kanban";

/** Untyped admin client — cloud schema may differ from generated Database types. */
function getSupabaseAdmin(): SupabaseClient {
  return createClient() as unknown as SupabaseClient;
}

function toQty(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
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
  due_date: string | null;
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
    due_date: row.due_date ? String(row.due_date) : null,
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
        due_date,
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
      .order("due_date", { ascending: true, nullsFirst: false })
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
        "id, job_no, status, finished_model_id, target_quantity, due_date, created_at, updated_at",
      )
      .order("due_date", { ascending: true, nullsFirst: false })
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
