"use server";

/**
 * Phase 14 — Fixed Asset Straight-line Depreciation Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 * Types live in `@/types/depreciation` — never export types from this file.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server-admin";
import type { Database, Json } from "@/src/types/supabase";
import type {
  AssetDepreciationLedgerRow,
  CalculateDepreciationResult,
  GetAssetDepreciationLedgerResult,
} from "@/types/depreciation";

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

type LedgerRow = Database["public"]["Tables"]["asset_depreciation_ledger"]["Row"];
type PeriodEmbed = Pick<
  Database["public"]["Tables"]["accounting_periods"]["Row"],
  "period_month" | "period_year"
>;
type LedgerWithPeriod = LedgerRow & {
  accounting_periods: PeriodEmbed | PeriodEmbed[] | null;
};

const LEDGER_SELECT =
  "id, asset_id, period_id, depreciation_date, depreciation_amount, accumulated_depreciation, net_book_value, accounting_periods!period_id(period_month, period_year)" as const;

function unwrapPeriod(value: unknown): PeriodEmbed | null {
  if (Array.isArray(value)) {
    return unwrapPeriod(value[0] ?? null);
  }
  const record = asRecord(value);
  if (!record) return null;
  const period_month = readNumber(record.period_month);
  const period_year = readNumber(record.period_year);
  if (period_month == null || period_year == null) return null;
  return { period_month, period_year };
}

function mapLedgerRow(row: LedgerWithPeriod): AssetDepreciationLedgerRow {
  const period = unwrapPeriod(row.accounting_periods);
  return {
    id: String(row.id),
    asset_id: String(row.asset_id),
    period_id: String(row.period_id),
    period_year: period?.period_year ?? null,
    period_month: period?.period_month ?? null,
    depreciation_date: String(row.depreciation_date ?? "").slice(0, 10),
    depreciation_amount: Number(row.depreciation_amount ?? 0),
    accumulated_depreciation: Number(row.accumulated_depreciation ?? 0),
    net_book_value: Number(row.net_book_value ?? 0),
  };
}

/**
 * ประวัติการตัดค่าเสื่อมของสินทรัพย์หนึ่งรายการ
 * JOIN `accounting_periods` ผ่าน `period_id` — เรียง `depreciation_date` DESC
 */
export async function getAssetDepreciationLedger(
  asset_id: string,
): Promise<GetAssetDepreciationLedgerResult> {
  try {
    const assetId = String(asset_id ?? "").trim();
    if (!assetId) {
      return { data: [], error: "ไม่พบรหัสสินทรัพย์" };
    }

    const supabaseAdmin = createClient();
    const { data, error } = await supabaseAdmin
      .from("asset_depreciation_ledger")
      .select(LEDGER_SELECT)
      .eq("asset_id", assetId)
      .order("depreciation_date", { ascending: false });

    if (error) {
      console.error("[getAssetDepreciationLedger]", error.message, error);
      return {
        data: [],
        error: error.message ?? "ไม่สามารถดึงประวัติค่าเสื่อมราคาได้",
      };
    }

    return {
      data: (data ?? []).map((row) => mapLedgerRow(row as LedgerWithPeriod)),
      error: null,
    };
  } catch (err) {
    console.error("[getAssetDepreciationLedger]", err);
    const message =
      err instanceof Error ? err.message : "ไม่สามารถดึงประวัติค่าเสื่อมราคาได้";
    return { data: [], error: message };
  }
}
