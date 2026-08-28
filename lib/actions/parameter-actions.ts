/**
 * Phase 15 — System Parameters Maker-Checker Server Actions.
 * Zero Client-Side Fetching: supabaseAdmin (Service Role) + Auth Session for actor/PIN.
 */

"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import { isAdminRoleCode } from "@/lib/auth/module-access";
import { logAuditTrail } from "@/lib/supabase/auditService";
import { createClient as createSupabaseAdmin } from "@/lib/supabase/server-admin";
import type { Json } from "@/src/types/supabase";
import type {
  GetParameterSettingsPageDataResult,
  KnownSystemParameterKey,
  ParameterActionResult,
  PendingParameterChangeRequest,
  SystemParameterValueMap,
  SystemParameterView,
} from "@/types/parameter";

const SETTINGS_PARAMETERS_PATH = "/settings/parameters";
const MANAGED_PARAM_KEYS = ["NAS_BACKUP_PATH", "WHT_RATE"] as const;

const SYSTEM_PARAMETER_DEFAULTS: SystemParameterValueMap = {
  WHT_RATE: 3,
  NAS_BACKUP_PATH: "nas_storage",
  ARCHIVE_COLD_AGE_DAYS: 365,
  MANUAL_BACKUP_ENABLED: true,
};

const PARAM_KEY_RE = /^[A-Z][A-Z0-9_]{1,98}$/;
const PIN_RE = /^\d{6}$/;

type AdminClient = ReturnType<typeof createSupabaseAdmin>;

function pinAsString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function pinsMatch(pinInput: string, dbPin: string): boolean {
  return pinAsString(pinInput) === pinAsString(dbPin);
}

function toJsonValue(value: unknown): Json {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as Json;
}

function normalizeParamKey(paramKey: string): string {
  return paramKey.trim().toUpperCase();
}

function isKnownSystemParameterKey(
  key: string,
): key is KnownSystemParameterKey {
  return key in SYSTEM_PARAMETER_DEFAULTS;
}

function getSystemParameterDefault(
  key: string,
): SystemParameterValueMap[KnownSystemParameterKey] | null {
  if (!isKnownSystemParameterKey(key)) {
    return null;
  }
  return SYSTEM_PARAMETER_DEFAULTS[key];
}

function castSystemParameterValue<K extends KnownSystemParameterKey>(
  key: K,
  raw: Json,
): SystemParameterValueMap[K] {
  const fallback = SYSTEM_PARAMETER_DEFAULTS[key];

  switch (key) {
    case "WHT_RATE":
    case "ARCHIVE_COLD_AGE_DAYS": {
      const num = typeof raw === "number" ? raw : Number(raw);
      return (Number.isFinite(num) ? num : fallback) as SystemParameterValueMap[K];
    }
    case "NAS_BACKUP_PATH": {
      if (typeof raw === "string") {
        const trimmed = raw.trim();
        return (trimmed || fallback) as SystemParameterValueMap[K];
      }
      if (typeof raw === "number" || typeof raw === "boolean") {
        return String(raw) as SystemParameterValueMap[K];
      }
      return fallback as SystemParameterValueMap[K];
    }
    case "MANUAL_BACKUP_ENABLED": {
      if (typeof raw === "boolean") {
        return raw as SystemParameterValueMap[K];
      }
      if (typeof raw === "string") {
        const normalized = raw.trim().toLowerCase();
        if (normalized === "true") return true as SystemParameterValueMap[K];
        if (normalized === "false") return false as SystemParameterValueMap[K];
      }
      if (typeof raw === "number") {
        return (raw !== 0) as SystemParameterValueMap[K];
      }
      return fallback as SystemParameterValueMap[K];
    }
    default:
      return fallback as SystemParameterValueMap[K];
  }
}

/**
 * อ่านค่า runtime จาก system_parameters (Service Role).
 * คืนค่าแบบ type-safe ตาม param_key พร้อม fallback เมื่อไม่พบหรือ error.
 */
export async function getSystemParameter<K extends KnownSystemParameterKey>(
  paramKey: K,
): Promise<SystemParameterValueMap[K]>;
export async function getSystemParameter(
  paramKey: string,
): Promise<string | number | boolean | null>;
export async function getSystemParameter(
  paramKey: string,
): Promise<string | number | boolean | null> {
  const key = normalizeParamKey(paramKey);
  const knownDefault = getSystemParameterDefault(key);

  try {
    const supabaseAdmin = createSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("system_parameters")
      .select("param_value")
      .eq("param_key", key)
      .maybeSingle();

    if (error) {
      console.error("[getSystemParameter]", key, error);
      return knownDefault;
    }

    if (data?.param_value === null || data?.param_value === undefined) {
      return knownDefault;
    }

    if (isKnownSystemParameterKey(key)) {
      return castSystemParameterValue(key, data.param_value);
    }

    const raw = data.param_value;
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
    ) {
      return raw;
    }

    return JSON.stringify(raw);
  } catch (error: unknown) {
    console.error("[getSystemParameter]", key, error);
    return knownDefault;
  }
}

async function assertAdminActor(
  supabaseAdmin: AdminClient,
): Promise<{ ok: true; actorId: string } | { ok: false; error: string }> {
  const actor = await getCurrentAuthUser();
  if (!actor?.userId) {
    return { ok: false, error: "Forbidden" };
  }

  const { data: profile, error } = await supabaseAdmin
    .from("user_profiles")
    .select("id, role_code, is_active")
    .eq("id", actor.userId)
    .maybeSingle();

  if (error || !profile) {
    return { ok: false, error: "Forbidden" };
  }
  if (profile.is_active === false) {
    return { ok: false, error: "Forbidden" };
  }
  if (!isAdminRoleCode(profile.role_code)) {
    return { ok: false, error: "Forbidden" };
  }

  return { ok: true, actorId: actor.userId };
}

async function verifySessionPin(
  supabaseAdmin: AdminClient,
  userId: string,
  pinCode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pinInput = pinAsString(pinCode);
  if (!PIN_RE.test(pinInput)) {
    return {
      ok: false,
      error: "รหัส PIN ต้องเป็นตัวเลข 6 หลัก",
    };
  }

  const { data: profile, error } = await supabaseAdmin
    .from("user_profiles")
    .select("id, pin_code, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (error || !profile) {
    return { ok: false, error: "ไม่พบโปรไฟล์ผู้ใช้" };
  }
  if (profile.is_active === false) {
    return { ok: false, error: "บัญชีนี้ถูกระงับการใช้งาน" };
  }

  const dbPin = pinAsString(profile.pin_code);
  if (!dbPin || !pinsMatch(pinInput, dbPin)) {
    return { ok: false, error: "รหัส PIN ไม่ถูกต้อง" };
  }

  return { ok: true };
}

/**
 * โหลดค่าพารามิเตอร์ + คิวรออนุมัติ สำหรับหน้า Settings (Service Role).
 */
export async function getParameterSettingsPageData(): Promise<GetParameterSettingsPageDataResult> {
  try {
    const actor = await getCurrentAuthUser();
    if (!actor?.userId) {
      return { success: false, error: "Forbidden" };
    }

    const supabaseAdmin = createSupabaseAdmin();

    const { data: paramRows, error: paramError } = await supabaseAdmin
      .from("system_parameters")
      .select("param_key, param_value, description, data_type, category")
      .in("param_key", [...MANAGED_PARAM_KEYS]);

    if (paramError) {
      return { success: false, error: paramError.message };
    }

    const parameters: SystemParameterView[] = MANAGED_PARAM_KEYS.map((key) => {
      const row = (paramRows ?? []).find((item) => item.param_key === key);
      return {
        param_key: key,
        param_value: row?.param_value ?? null,
        description: row?.description ?? null,
        data_type: row?.data_type ?? (key === "WHT_RATE" ? "number" : "string"),
        category: row?.category ?? "general",
      };
    });

    const { data: pendingRows, error: pendingError } = await supabaseAdmin
      .from("parameter_change_requests")
      .select(
        "id, param_key, old_value, new_value, status, requested_by, created_at",
      )
      .eq("status", "PENDING")
      .order("created_at", { ascending: false });

    if (pendingError) {
      return { success: false, error: pendingError.message };
    }

    const requesterIds = [
      ...new Set(
        (pendingRows ?? [])
          .map((row) => row.requested_by)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];

    const requesterNames = new Map<string, string>();
    if (requesterIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("user_profiles")
        .select("id, full_name, email")
        .in("id", requesterIds);

      for (const profile of profiles ?? []) {
        const label =
          String(profile.full_name ?? "").trim() ||
          String(profile.email ?? "").trim() ||
          profile.id;
        requesterNames.set(profile.id, label);
      }
    }

    const pendingRequests: PendingParameterChangeRequest[] = (
      pendingRows ?? []
    ).map((row) => ({
      id: row.id,
      param_key: String(row.param_key ?? ""),
      old_value: row.old_value,
      new_value: row.new_value,
      status: String(row.status ?? "PENDING"),
      requested_by: row.requested_by,
      requested_by_name: row.requested_by
        ? (requesterNames.get(row.requested_by) ?? row.requested_by)
        : null,
      created_at: row.created_at,
    }));

    const isAdmin = isAdminRoleCode(actor.roleCode);

    return {
      success: true,
      data: {
        parameters,
        pendingRequests,
        isAdmin,
      },
    };
  } catch (error: unknown) {
    console.error("[getParameterSettingsPageData]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Maker — ขอเปลี่ยนค่า system_parameters (ต้องยืนยัน PIN 6 หลัก).
 */
export async function requestParameterChange(
  paramKey: string,
  newValue: unknown,
  pinCode: string,
): Promise<ParameterActionResult> {
  try {
    const key = normalizeParamKey(paramKey);
    if (!PARAM_KEY_RE.test(key)) {
      return {
        success: false,
        error:
          "param_key ไม่ถูกต้อง (ใช้ A-Z, 0-9, _ เริ่มด้วยตัวอักษร เช่น ARCHIVE_COLD_AGE_DAYS)",
      };
    }

    const actor = await getCurrentAuthUser();
    if (!actor?.userId) {
      return { success: false, error: "Forbidden" };
    }

    const supabaseAdmin = createSupabaseAdmin();

    const pinCheck = await verifySessionPin(
      supabaseAdmin,
      actor.userId,
      pinCode,
    );
    if (!pinCheck.ok) {
      return { success: false, error: pinCheck.error };
    }

    const { data: currentParam, error: paramError } = await supabaseAdmin
      .from("system_parameters")
      .select("param_key, param_value, data_type, category, description")
      .eq("param_key", key)
      .maybeSingle();

    if (paramError) {
      return { success: false, error: paramError.message };
    }
    if (!currentParam) {
      return {
        success: false,
        error: `ไม่พบพารามิเตอร์ "${key}" ใน system_parameters`,
      };
    }

    const { data: pendingRow, error: pendingError } = await supabaseAdmin
      .from("parameter_change_requests")
      .select("id")
      .eq("param_key", key)
      .eq("status", "PENDING")
      .maybeSingle();

    if (pendingError) {
      return { success: false, error: pendingError.message };
    }
    if (pendingRow?.id) {
      return {
        success: false,
        error: `มีคำขอแก้ไข "${key}" ที่รออนุมัติอยู่แล้ว`,
      };
    }

    const newJson = toJsonValue(newValue);
    const oldJson = currentParam.param_value ?? null;

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("parameter_change_requests")
      .insert({
        param_key: key,
        old_value: oldJson,
        new_value: newJson,
        requested_by: actor.userId,
        status: "PENDING",
      })
      .select("id")
      .single();

    if (insertError || !inserted?.id) {
      return {
        success: false,
        error: insertError?.message ?? "บันทึกคำขอแก้ไขไม่สำเร็จ",
      };
    }

    const audit = await logAuditTrail(
      "parameter_change_requests",
      inserted.id,
      "INSERT",
      null,
      {
        event: "PARAMETER_CHANGE_REQUESTED",
        param_key: key,
        old_value: oldJson,
        new_value: newJson,
        status: "PENDING",
        requested_by: actor.userId,
      },
    );

    if (!audit.success) {
      console.error("[requestParameterChange] audit:", audit.error);
      return {
        success: false,
        error: `บันทึกคำขอสำเร็จ แต่เขียน audit_logs ไม่สำเร็จ: ${audit.error}`,
      };
    }

    revalidatePath(SETTINGS_PARAMETERS_PATH);

    return {
      success: true,
      requestId: inserted.id,
      message: `ส่งคำขอแก้ไข "${key}" เข้าคิวอนุมัติแล้ว`,
    };
  } catch (error: unknown) {
    console.error("[requestParameterChange]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Checker (Admin) — อนุมัติคำขอ แล้ว UPSERT ค่าใหม่ลง system_parameters.
 */
export async function approveParameterChange(
  requestId: string,
): Promise<ParameterActionResult> {
  try {
    const trimmedId = requestId.trim();
    if (!trimmedId) {
      return { success: false, error: "requestId is required" };
    }

    const supabaseAdmin = createSupabaseAdmin();
    const auth = await assertAdminActor(supabaseAdmin);
    if (!auth.ok) {
      return { success: false, error: auth.error };
    }

    const { data: requestRow, error: fetchError } = await supabaseAdmin
      .from("parameter_change_requests")
      .select(
        "id, param_key, old_value, new_value, status, requested_by, approved_by",
      )
      .eq("id", trimmedId)
      .maybeSingle();

    if (fetchError) {
      return { success: false, error: fetchError.message };
    }
    if (!requestRow) {
      return { success: false, error: "ไม่พบคำขอแก้ไขพารามิเตอร์" };
    }
    if (requestRow.status !== "PENDING") {
      return {
        success: false,
        error: `คำขอนี้ไม่ได้อยู่ในสถานะ PENDING (ปัจจุบัน: ${requestRow.status ?? "—"})`,
      };
    }

    const paramKey = String(requestRow.param_key ?? "").trim();
    if (!paramKey) {
      return { success: false, error: "คำขอไม่มี param_key" };
    }

    const nowIso = new Date().toISOString();

    const { data: updatedRequest, error: updateRequestError } =
      await supabaseAdmin
        .from("parameter_change_requests")
        .update({
          status: "APPROVED",
          approved_by: auth.actorId,
          resolved_at: nowIso,
        })
        .eq("id", trimmedId)
        .eq("status", "PENDING")
        .select("id, param_key, old_value, new_value, status")
        .maybeSingle();

    if (updateRequestError || !updatedRequest) {
      return {
        success: false,
        error:
          updateRequestError?.message ??
          "อัปเดตสถานะคำขอไม่สำเร็จ (อาจถูกอนุมัติไปแล้ว)",
      };
    }

    const { data: existingParam } = await supabaseAdmin
      .from("system_parameters")
      .select("param_key, param_value, data_type, category, description")
      .eq("param_key", paramKey)
      .maybeSingle();

    const { error: upsertError } = await supabaseAdmin
      .from("system_parameters")
      .upsert(
        {
          param_key: paramKey,
          param_value: updatedRequest.new_value,
          data_type: existingParam?.data_type ?? "json",
          category: existingParam?.category ?? "general",
          description: existingParam?.description ?? null,
          updated_by: auth.actorId,
          updated_at: nowIso,
        },
        { onConflict: "param_key" },
      );

    if (upsertError) {
      await supabaseAdmin
        .from("parameter_change_requests")
        .update({
          status: "PENDING",
          approved_by: null,
          resolved_at: null,
        })
        .eq("id", trimmedId);

      return {
        success: false,
        error: `อนุมัติแล้วแต่ UPSERT system_parameters ไม่สำเร็จ: ${upsertError.message}`,
      };
    }

    const requestAudit = await logAuditTrail(
      "parameter_change_requests",
      trimmedId,
      "UPDATE",
      {
        status: "PENDING",
        old_value: requestRow.old_value,
        new_value: requestRow.new_value,
      },
      {
        event: "PARAMETER_CHANGE_APPROVED",
        status: "APPROVED",
        param_key: paramKey,
        old_value: requestRow.old_value,
        new_value: updatedRequest.new_value,
        approved_by: auth.actorId,
        resolved_at: nowIso,
      },
    );

    if (!requestAudit.success) {
      console.error("[approveParameterChange] request audit:", requestAudit.error);
      return {
        success: false,
        error: `อนุมัติสำเร็จ แต่บันทึก audit_logs (คำขอ) ไม่สำเร็จ: ${requestAudit.error}`,
      };
    }

    const paramAudit = await logAuditTrail(
      "system_parameters",
      paramKey,
      existingParam ? "UPDATE" : "INSERT",
      existingParam
        ? {
            param_key: paramKey,
            param_value: existingParam.param_value,
          }
        : null,
      {
        event: "PARAMETER_VALUE_APPLIED",
        param_key: paramKey,
        param_value: updatedRequest.new_value,
        approved_request_id: trimmedId,
        updated_by: auth.actorId,
      },
    );

    if (!paramAudit.success) {
      console.error("[approveParameterChange] param audit:", paramAudit.error);
      return {
        success: false,
        error: `อนุมัติและอัปเดตค่าสำเร็จ แต่บันทึก audit_logs (พารามิเตอร์) ไม่สำเร็จ: ${paramAudit.error}`,
      };
    }

    revalidatePath(SETTINGS_PARAMETERS_PATH);

    return {
      success: true,
      requestId: trimmedId,
      message: `อนุมัติและอัปเดต "${paramKey}" เรียบร้อยแล้ว`,
    };
  } catch (error: unknown) {
    console.error("[approveParameterChange]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Checker (Admin) — ปฏิเสธคำขอ (ไม่อัปเดต system_parameters).
 */
export async function rejectParameterChange(
  requestId: string,
  reviewComment?: string | null,
): Promise<ParameterActionResult> {
  try {
    const trimmedId = requestId.trim();
    if (!trimmedId) {
      return { success: false, error: "requestId is required" };
    }

    const comment = String(reviewComment ?? "").trim();
    if (!comment) {
      return { success: false, error: "กรุณาระบุเหตุผลการปฏิเสธ" };
    }

    const supabaseAdmin = createSupabaseAdmin();
    const auth = await assertAdminActor(supabaseAdmin);
    if (!auth.ok) {
      return { success: false, error: auth.error };
    }

    const { data: requestRow, error: fetchError } = await supabaseAdmin
      .from("parameter_change_requests")
      .select("id, param_key, old_value, new_value, status")
      .eq("id", trimmedId)
      .maybeSingle();

    if (fetchError) {
      return { success: false, error: fetchError.message };
    }
    if (!requestRow) {
      return { success: false, error: "ไม่พบคำขอแก้ไขพารามิเตอร์" };
    }
    if (requestRow.status !== "PENDING") {
      return {
        success: false,
        error: `คำขอนี้ไม่ได้อยู่ในสถานะ PENDING (ปัจจุบัน: ${requestRow.status ?? "—"})`,
      };
    }

    const nowIso = new Date().toISOString();
    const paramKey = String(requestRow.param_key ?? "").trim();

    const { error: updateError } = await supabaseAdmin
      .from("parameter_change_requests")
      .update({
        status: "REJECTED",
        approved_by: auth.actorId,
        resolved_at: nowIso,
        review_comment: comment,
      })
      .eq("id", trimmedId)
      .eq("status", "PENDING");

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    const audit = await logAuditTrail(
      "parameter_change_requests",
      trimmedId,
      "UPDATE",
      {
        status: "PENDING",
        param_key: paramKey,
        old_value: requestRow.old_value,
        new_value: requestRow.new_value,
      },
      {
        event: "PARAMETER_CHANGE_REJECTED",
        status: "REJECTED",
        param_key: paramKey,
        review_comment: comment,
        approved_by: auth.actorId,
        resolved_at: nowIso,
      },
    );

    if (!audit.success) {
      console.error("[rejectParameterChange] audit:", audit.error);
      return {
        success: false,
        error: `ปฏิเสธสำเร็จ แต่บันทึก audit_logs ไม่สำเร็จ: ${audit.error}`,
      };
    }

    revalidatePath(SETTINGS_PARAMETERS_PATH);

    return {
      success: true,
      requestId: trimmedId,
      message: `ปฏิเสธคำขอแก้ไข "${paramKey}" แล้ว`,
    };
  } catch (error: unknown) {
    console.error("[rejectParameterChange]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
