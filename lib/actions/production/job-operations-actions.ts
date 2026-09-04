"use server";

/**
 * In-house Routing — production_job_operations CRUD
 * แยกจาก Service Assignment (document_items.technician_id / wage_cost)
 *
 * Zero Client-Side Fetching — supabaseAdmin (Service Role) only.
 * Types: `@/types/production`
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server-admin";
import type {
  DeleteJobOperationResult,
  GetJobOperationsResult,
  ProductionJobOperation,
  ProductionOperationStatus,
  UpsertJobOperationPayload,
  UpsertJobOperationResult,
} from "@/types/production";
import { isProductionOperationStatus } from "@/types/production";

export const maxDuration = 60;

const KANBAN_PATH = "/production/kanban";

function getSupabaseAdmin(): SupabaseClient {
  return createClient() as unknown as SupabaseClient;
}

/** DECIMAL(precision) — 4dp ให้สอดคล้องต้นทุน/ค่าแรงทั้งระบบ */
function toWageCost(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function normalizeStatus(value: unknown): ProductionOperationStatus {
  const raw = String(value ?? "PENDING").trim().toUpperCase();
  return isProductionOperationStatus(raw) ? raw : "PENDING";
}

function mapOperationRow(
  row: {
    id?: string;
    job_id?: string;
    operation_name?: string | null;
    technician_id?: string | null;
    wage_cost?: number | string | null;
    technician_bill_id?: string | null;
    status?: string | null;
  },
  technicianNameById: Map<string, string>,
): ProductionJobOperation | null {
  const id = String(row.id ?? "").trim();
  const jobId = String(row.job_id ?? "").trim();
  if (!id || !jobId) return null;

  const technicianId = String(row.technician_id ?? "").trim() || null;
  const wage = toWageCost(row.wage_cost) ?? 0;

  return {
    id,
    job_id: jobId,
    operation_name: String(row.operation_name ?? "").trim(),
    technician_id: technicianId,
    technician_name: technicianId
      ? (technicianNameById.get(technicianId) ?? null)
      : null,
    wage_cost: wage,
    technician_bill_id: String(row.technician_bill_id ?? "").trim() || null,
    status: normalizeStatus(row.status),
  };
}

async function loadTechnicianNames(
  supabase: SupabaseClient,
  technicianIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(technicianIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return map;

  const { data, error } = await supabase
    .from("contacts")
    .select("id, company_name")
    .in("id", ids);

  if (error) {
    console.warn("[job-operations] contacts lookup:", error.message);
    return map;
  }

  for (const row of data ?? []) {
    const id = String(row.id ?? "").trim();
    if (!id) continue;
    map.set(id, String(row.company_name ?? "").trim() || "ไม่ระบุชื่อ");
  }
  return map;
}

/**
 * ดึงขั้นตอนผลิตของใบงาน + ชื่อช่างจาก contacts
 */
export async function getJobOperations(
  jobId: string,
): Promise<GetJobOperationsResult> {
  const id = String(jobId ?? "").trim();
  if (!id) {
    return {
      success: false,
      error: "ไม่พบรหัสงาน (jobId)",
      data: [],
    };
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: job, error: jobError } = await supabase
      .from("production_jobs")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (jobError) {
      return {
        success: false,
        error: jobError.message ?? "ตรวจสอบใบสั่งผลิตไม่สำเร็จ",
        data: [],
      };
    }
    if (!job) {
      return { success: false, error: "ไม่พบใบสั่งผลิตในระบบ", data: [] };
    }

    const { data: rows, error } = await supabase
      .from("production_job_operations")
      .select(
        `
        id,
        job_id,
        operation_name,
        technician_id,
        wage_cost,
        technician_bill_id,
        status
      `,
      )
      .eq("job_id", id)
      .order("id", { ascending: true });

    if (error) {
      return {
        success: false,
        error: error.message ?? "ดึงขั้นตอนการผลิตไม่สำเร็จ",
        data: [],
      };
    }

    const technicianIds = (rows ?? [])
      .map((row) => String(row.technician_id ?? "").trim())
      .filter(Boolean);
    const technicianNameById = await loadTechnicianNames(
      supabase,
      technicianIds,
    );

    const data: ProductionJobOperation[] = [];
    for (const row of rows ?? []) {
      const mapped = mapOperationRow(row, technicianNameById);
      if (mapped) data.push(mapped);
    }

    return { success: true, error: null, data };
  } catch (err) {
    console.error("[getJobOperations]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ดึงขั้นตอนการผลิตไม่สำเร็จ",
      data: [],
    };
  }
}

/**
 * Insert หรือ Update ขั้นตอนผลิต 1 แถว
 * (ห้ามแก้เมื่อถูกวางบิลช่างแล้ว — technician_bill_id IS NOT NULL)
 */
export async function upsertJobOperation(
  payload: UpsertJobOperationPayload,
): Promise<UpsertJobOperationResult> {
  try {
    const jobId = String(payload?.job_id ?? "").trim();
    const existingId = String(payload?.id ?? "").trim() || null;
    const operationName = String(payload?.operation_name ?? "").trim();
    const technicianId = String(payload?.technician_id ?? "").trim() || null;
    const wageCost = toWageCost(payload?.wage_cost);
    const status = normalizeStatus(payload?.status);

    if (!jobId) {
      return { success: false, error: "ไม่พบรหัสงาน (job_id)", data: null };
    }
    if (!operationName) {
      return {
        success: false,
        error: "กรุณาระบุชื่อขั้นตอน (operation_name)",
        data: null,
      };
    }
    if (wageCost == null) {
      return {
        success: false,
        error: "ค่าแรง (wage_cost) ต้องเป็นตัวเลข ≥ 0 (ทศนิยมได้)",
        data: null,
      };
    }

    const supabase = getSupabaseAdmin();

    const { data: job, error: jobError } = await supabase
      .from("production_jobs")
      .select("id")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) {
      return {
        success: false,
        error: jobError.message ?? "ตรวจสอบใบสั่งผลิตไม่สำเร็จ",
        data: null,
      };
    }
    if (!job) {
      return { success: false, error: "ไม่พบใบสั่งผลิตในระบบ", data: null };
    }

    if (technicianId) {
      const { data: tech, error: techError } = await supabase
        .from("contacts")
        .select("id, contact_roles, is_active")
        .eq("id", technicianId)
        .maybeSingle();

      if (techError) {
        return {
          success: false,
          error: techError.message ?? "ตรวจสอบช่างไม่สำเร็จ",
          data: null,
        };
      }
      if (!tech || tech.is_active === false) {
        return {
          success: false,
          error: "ไม่พบช่างในระบบ หรือสถานะไม่ใช้งาน",
          data: null,
        };
      }
      const roles = Array.isArray(tech.contact_roles) ? tech.contact_roles : [];
      const isTechnician = roles.some(
        (role) => String(role).trim().toLowerCase() === "technician",
      );
      if (!isTechnician) {
        return {
          success: false,
          error: "ผู้ติดต่อที่เลือกต้องมี role Technician",
          data: null,
        };
      }
    }

    if (existingId) {
      const { data: existing, error: existingError } = await supabase
        .from("production_job_operations")
        .select("id, job_id, technician_bill_id")
        .eq("id", existingId)
        .maybeSingle();

      if (existingError) {
        return {
          success: false,
          error: existingError.message ?? "ตรวจสอบขั้นตอนผลิตไม่สำเร็จ",
          data: null,
        };
      }
      if (!existing || String(existing.job_id) !== jobId) {
        return {
          success: false,
          error: "ไม่พบขั้นตอนผลิตในใบงานนี้",
          data: null,
        };
      }
      if (existing.technician_bill_id) {
        return {
          success: false,
          error: "ขั้นตอนนี้ถูกวางบิลช่างแล้ว — ห้ามแก้ไข",
          data: null,
        };
      }

      const { data: updated, error: updateError } = await supabase
        .from("production_job_operations")
        .update({
          operation_name: operationName,
          technician_id: technicianId,
          wage_cost: wageCost,
          status,
        })
        .eq("id", existingId)
        .eq("job_id", jobId)
        .select(
          "id, job_id, operation_name, technician_id, wage_cost, technician_bill_id, status",
        )
        .maybeSingle();

      if (updateError || !updated) {
        return {
          success: false,
          error: updateError?.message ?? "อัปเดตขั้นตอนผลิตไม่สำเร็จ",
          data: null,
        };
      }

      const names = await loadTechnicianNames(
        supabase,
        updated.technician_id ? [String(updated.technician_id)] : [],
      );
      const mapped = mapOperationRow(updated, names);
      if (!mapped) {
        return {
          success: false,
          error: "อัปเดตสำเร็จแต่แปลงข้อมูลไม่สำเร็จ",
          data: null,
        };
      }

      revalidatePath(KANBAN_PATH);
      return { success: true, error: null, data: mapped };
    }

    const { data: inserted, error: insertError } = await supabase
      .from("production_job_operations")
      .insert({
        job_id: jobId,
        operation_name: operationName,
        technician_id: technicianId,
        wage_cost: wageCost,
        status,
      })
      .select(
        "id, job_id, operation_name, technician_id, wage_cost, technician_bill_id, status",
      )
      .maybeSingle();

    if (insertError || !inserted) {
      return {
        success: false,
        error: insertError?.message ?? "สร้างขั้นตอนผลิตไม่สำเร็จ",
        data: null,
      };
    }

    const names = await loadTechnicianNames(
      supabase,
      inserted.technician_id ? [String(inserted.technician_id)] : [],
    );
    const mapped = mapOperationRow(inserted, names);
    if (!mapped) {
      return {
        success: false,
        error: "สร้างสำเร็จแต่แปลงข้อมูลไม่สำเร็จ",
        data: null,
      };
    }

    revalidatePath(KANBAN_PATH);
    return { success: true, error: null, data: mapped };
  } catch (err) {
    console.error("[upsertJobOperation]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "บันทึกขั้นตอนผลิตไม่สำเร็จ",
      data: null,
    };
  }
}

/**
 * ลบขั้นตอนผลิต (ห้ามลบเมื่อถูกวางบิลแล้ว)
 */
export async function deleteJobOperation(
  id: string,
): Promise<DeleteJobOperationResult> {
  const opId = String(id ?? "").trim();
  if (!opId) {
    return { success: false, error: "ไม่พบรหัสขั้นตอน (id)" };
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: existing, error: existingError } = await supabase
      .from("production_job_operations")
      .select("id, technician_bill_id")
      .eq("id", opId)
      .maybeSingle();

    if (existingError) {
      return {
        success: false,
        error: existingError.message ?? "ตรวจสอบขั้นตอนผลิตไม่สำเร็จ",
      };
    }
    if (!existing) {
      return { success: false, error: "ไม่พบขั้นตอนผลิตในระบบ" };
    }
    if (existing.technician_bill_id) {
      return {
        success: false,
        error: "ขั้นตอนนี้ถูกวางบิลช่างแล้ว — ห้ามลบ",
      };
    }

    const { error: deleteError } = await supabase
      .from("production_job_operations")
      .delete()
      .eq("id", opId);

    if (deleteError) {
      return {
        success: false,
        error: deleteError.message ?? "ลบขั้นตอนผลิตไม่สำเร็จ",
      };
    }

    revalidatePath(KANBAN_PATH);
    return { success: true, error: null };
  } catch (err) {
    console.error("[deleteJobOperation]", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "ลบขั้นตอนผลิตไม่สำเร็จ",
    };
  }
}
