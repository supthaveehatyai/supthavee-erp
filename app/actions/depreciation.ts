"use server";

/**
 * Phase 14 — Fixed Asset Straight-line Depreciation Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 * Types live in `@/types/depreciation` — never export types from this file.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server-admin";
import type { Json } from "@/src/types/supabase";
import type { CalculateDepreciationResult } from "@/types/depreciation";

const PERIOD_LOCK_PATH = "/dashboard/period-lock";
const ACCOUNTING_PERIODS_PATH = "/accounting-periods";
const FIXED_ASSETS_PATH = "/fixed-assets";

function emptyResult(
  error: string,
): CalculateDepreciationResult {
  return {
    success: false,
    error,
    message: null,
    processedCount: null,
    totalAmount: null,
  };
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseRpcPayload(data: Json | null): CalculateDepreciationResult {
  const record = asRecord(data);
  if (!record) {
    return {
      success: true,
      error: null,
      message: "คำนวณค่าเสื่อมราคาสำเร็จ",
      processedCount: null,
      totalAmount: null,
    };
  }

  const error = readString(record.error) ?? readString(record.detail);

  if (record.success === false || record.ok === false) {
    return emptyResult(
      error ?? readString(record.message) ?? "คำนวณค่าเสื่อมราคาไม่สำเร็จ",
    );
  }

  if (error && record.success !== true && record.ok !== true) {
    return emptyResult(error);
  }

  return {
    success: true,
    error: null,
    message:
      readString(record.message) ??
      readString(record.status) ??
      "คำนวณค่าเสื่อมราคาสำเร็จ",
    processedCount:
      readNumber(record.processed_count) ??
      readNumber(record.assets_processed) ??
      readNumber(record.processed) ??
      readNumber(record.count),
    totalAmount:
      readNumber(record.total_amount) ??
      readNumber(record.total_depreciation) ??
      readNumber(record.depreciation_amount),
  };
}

function revalidateDepreciationCaches() {
  revalidatePath(PERIOD_LOCK_PATH);
  revalidatePath(ACCOUNTING_PERIODS_PATH);
  revalidatePath(FIXED_ASSETS_PATH);
}

/**
 * โพสต์ค่าเสื่อมราคาแบบเส้นตรงรายเดือนผ่าน RPC `calculate_monthly_depreciation`.
 * Admin เท่านั้น — ป้องกันการกดซ้ำด้วย isSubmitting ที่ปุ่มฝั่ง Client.
 */
export async function calculateDepreciationAction(
  period_id: string,
): Promise<CalculateDepreciationResult> {
  try {
    const gate = await requireAdmin({
      forbiddenMessage:
        "Forbidden: เฉพาะ Admin เท่านั้นที่คำนวณค่าเสื่อมราคาได้",
    });
    if (!gate.ok) {
      return emptyResult(gate.error);
    }

    const periodId = String(period_id ?? "").trim();
    if (!periodId) {
      return emptyResult("ไม่พบรหัสงวดบัญชี");
    }

    const userId = gate.admin.userId;
    if (!userId) {
      return emptyResult(
        "ไม่พบผู้ใช้งานในเซสชัน — กรุณาเข้าสู่ระบบใหม่ก่อนคำนวณค่าเสื่อม",
      );
    }

    const supabaseAdmin = createClient();
    const { data, error } = await supabaseAdmin.rpc(
      "calculate_monthly_depreciation",
      {
        p_period_id: periodId,
        p_user_id: userId,
      },
    );

    if (error) {
      return emptyResult(error.message || "เรียกคำนวณค่าเสื่อมราคาไม่สำเร็จ");
    }

    const parsed = parseRpcPayload(data);
    if (!parsed.success) {
      return parsed;
    }

    revalidateDepreciationCaches();
    return parsed;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "คำนวณค่าเสื่อมราคาไม่สำเร็จ";
    return emptyResult(message);
  }
}
