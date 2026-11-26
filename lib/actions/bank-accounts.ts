"use server";

/**
 * Phase 5 — Bank Accounts (mst_bank_accounts) Server Actions.
 *
 * Zero Client-Side Fetching: Service Role via `createSupabaseServerClient` only.
 * Soft-disable via `is_active` — never hard-delete (preserve payment history).
 * Never throw to the UI — always return a safe empty list on failure.
 */

import { revalidatePath } from "next/cache";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import { isAdminRoleCode } from "@/lib/auth/module-access";
import { getSuperAdminStatus } from "@/lib/holding/workspace-access";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type {
  BankAccount,
  BankQrSettingsInput,
  GetBankAccountsResult,
  MutateBankAccountResult,
} from "@/types/bank-account";

const BANK_ACCOUNTS_PATH = "/finance/bank-accounts";

function revalidateBankAccountPages() {
  revalidatePath(BANK_ACCOUNTS_PATH);
  revalidatePath("/sales/create");
  revalidatePath("/sales");
  revalidatePath("/sales", "layout");
}
/** Strict table target — never `bank_accounts` / never `account_number`. */
const MST_BANK_ACCOUNTS_TABLE = "mst_bank_accounts" as const;
const POSTGRES_UNIQUE_VIOLATION = "23505";
const DUPLICATE_ACCOUNT_NO_ERROR = "เลขที่บัญชีซ้ำ";

const EMPTY_LIST: GetBankAccountsResult = { data: [], error: null };
const BANK_LIST_COLUMNS =
  "id, bank_name, account_no, account_name, branch_name, is_active, created_at, updated_at";
const BANK_LIST_COLUMNS_WITH_QR =
  `${BANK_LIST_COLUMNS}, qr_image_url, qr_storage_path, qr_label, promptpay_note, is_qr_customer_visible`;
const QR_COLUMN_MISSING =
  "ยังไม่มีคอลัมน์ qr_label หรือ is_qr_customer_visible บน mst_bank_accounts — เพิ่มคอลัมน์บน Cloud ก่อนตั้งค่า QR";

function isMissingQrColumn(error: { message?: string; code?: string } | null): boolean {
  const message = String(error?.message ?? "");
  return /qr_image_url|qr_storage_path|qr_label|promptpay_note|is_qr_customer_visible|PGRST204|schema cache/i.test(message);
}

function isUniqueViolation(error: {
  code?: string;
  message?: string;
}): boolean {
  const code = String(error.code ?? "").trim();
  const message = String(error.message ?? "");
  return (
    code === POSTGRES_UNIQUE_VIOLATION ||
    /duplicate key|unique constraint/i.test(message)
  );
}

function toBankAccountList(data: unknown): BankAccount[] {
  if (!Array.isArray(data) || data.length === 0) return [];

  return data
    .filter(
      (row): row is Record<string, unknown> =>
        row != null && typeof row === "object",
    )
    .map((row) => ({
      id: String(row.id ?? "").trim(),
      bank_name: String(row.bank_name ?? "").trim(),
      account_no: String(row.account_no ?? "").trim(),
      account_name: String(row.account_name ?? "").trim(),
      branch_name:
        row.branch_name == null || String(row.branch_name).trim() === ""
          ? null
          : String(row.branch_name).trim(),
      is_active: Boolean(row.is_active),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
      qr_image_url: row.qr_image_url == null ? null : String(row.qr_image_url),
      qr_storage_path: row.qr_storage_path == null ? null : String(row.qr_storage_path),
      qr_label: row.qr_label == null ? null : String(row.qr_label),
      promptpay_note: row.promptpay_note == null ? null : String(row.promptpay_note),
      is_qr_customer_visible: row.is_qr_customer_visible === true,
    }))
    .filter((row) => Boolean(row.id));
}

/**
 * List all company bank books (active + inactive), oldest first.
 * Always returns `data: []` — never null / never throws.
 */
export async function getBankAccounts(): Promise<GetBankAccountsResult> {
  try {
    const supabase = createSupabaseServerClient();
    const extended = await supabase
      .from(MST_BANK_ACCOUNTS_TABLE)
      .select(BANK_LIST_COLUMNS_WITH_QR)
      .order("created_at", { ascending: true });
    const fallback = extended.error && isMissingQrColumn(extended.error)
      ? await supabase
          .from(MST_BANK_ACCOUNTS_TABLE)
          .select(BANK_LIST_COLUMNS)
          .order("created_at", { ascending: true })
      : null;
    const data = fallback ? fallback.data : extended.data;
    const error = fallback ? fallback.error : extended.error;

    if (error) {
      console.error("[getBankAccounts]", error.message, error);
      return { data: [], error: error.message ?? "ไม่สามารถดึงข้อมูลสมุดบัญชีได้" };
    }

    return {
      data: toBankAccountList(data),
      error: null,
    };
  } catch (err) {
    console.error("[getBankAccounts]", err);
    return EMPTY_LIST;
  }
}

/**
 * Create a new bank account from FormData.
 *
 * Table: `mst_bank_accounts` only
 * Column: `account_no` (never `account_number`)
 * Unique Violation (23505) → soft `{ success: false, error }` for Toast — never throw.
 */
export async function createBankAccount(
  formData: FormData,
): Promise<MutateBankAccountResult> {
  try {
    const bank_name = String(formData.get("bank_name") ?? "").trim();
    const account_no = String(formData.get("account_no") ?? "").trim();
    const account_name = String(formData.get("account_name") ?? "").trim();
    const branch_name = String(formData.get("branch_name") ?? "").trim() || null;

    if (!bank_name) {
      return { success: false, error: "กรุณาระบุชื่อธนาคาร" };
    }
    if (!account_no) {
      return { success: false, error: "กรุณาระบุเลขที่บัญชี" };
    }
    if (!account_name) {
      return { success: false, error: "กรุณาระบุชื่อบัญชี" };
    }

    const payload = {
      bank_name,
      account_no,
      account_name,
      branch_name,
      is_active: true,
    };

    try {
      const supabase = createSupabaseServerClient();
      const { error } = await supabase
        .from(MST_BANK_ACCOUNTS_TABLE)
        .insert(payload);

      if (error) {
        if (error.code === POSTGRES_UNIQUE_VIOLATION) {
          return { success: false, error: DUPLICATE_ACCOUNT_NO_ERROR };
        }
        if (isUniqueViolation(error)) {
          return { success: false, error: DUPLICATE_ACCOUNT_NO_ERROR };
        }
        console.error("[createBankAccount]", error.message, error);
        return {
          success: false,
          error: error.message ?? "ไม่สามารถสร้างบัญชีได้",
        };
      }
    } catch (insertErr) {
      const maybeCode =
        insertErr && typeof insertErr === "object" && "code" in insertErr
          ? String((insertErr as { code?: unknown }).code ?? "")
          : "";
      const maybeMessage =
        insertErr instanceof Error
          ? insertErr.message
          : String(insertErr ?? "");

      if (
        maybeCode === POSTGRES_UNIQUE_VIOLATION ||
        isUniqueViolation({ code: maybeCode, message: maybeMessage })
      ) {
        return { success: false, error: DUPLICATE_ACCOUNT_NO_ERROR };
      }

      console.error("[createBankAccount] insert", insertErr);
      return { success: false, error: "ไม่สามารถสร้างบัญชีได้" };
    }

    revalidateBankAccountPages();
    return { success: true, error: null };
  } catch (err) {
    console.error("[createBankAccount]", err);
    return { success: false, error: "ไม่สามารถสร้างบัญชีได้" };
  }
}

/** Form action — must return void for Next.js <form action>. */
export async function createBankAccountFormAction(
  formData: FormData,
): Promise<void> {
  try {
    await createBankAccount(formData);
  } catch (err) {
    console.error("[createBankAccountFormAction]", err);
  }
}

/**
 * Toggle active/inactive — soft disable only (never delete).
 * Compatible with `<form action={toggleBankAccountStatusFormAction.bind(null, id, isActive)}>`
 */
export async function toggleBankAccountStatus(
  id: string,
  currentStatus: boolean,
  _formData?: FormData,
): Promise<MutateBankAccountResult> {
  try {
    const trimmedId = id?.trim() ?? "";
    if (!trimmedId) {
      return { success: false, error: "ไม่พบรหัสบัญชี" };
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase
      .from(MST_BANK_ACCOUNTS_TABLE)
      .update({ is_active: !currentStatus })
      .eq("id", trimmedId);

    if (error) {
      console.error("[toggleBankAccountStatus]", error.message, error);
      return {
        success: false,
        error: error.message ?? "ไม่สามารถเปลี่ยนสถานะบัญชีได้",
      };
    }

    revalidateBankAccountPages();
    return { success: true, error: null };
  } catch (err) {
    console.error("[toggleBankAccountStatus]", err);
    return { success: false, error: "ไม่สามารถเปลี่ยนสถานะบัญชีได้" };
  }
}

/** Form action — must return void for Next.js <form action>. */
async function requireBankAdmin(): Promise<MutateBankAccountResult | null> {
  const user = await getCurrentAuthUser();
  if (!user?.userId) return { success: false, error: "กรุณาเข้าสู่ระบบ" };
  const superAdmin = await getSuperAdminStatus(user.userId, user.displayName);
  if (!isAdminRoleCode(user.roleCode) && !superAdmin) {
    return { success: false, error: "ต้องเป็นผู้ดูแลระบบจึงจะอัปโหลด QR ได้" };
  }
  return null;
}

export async function uploadSupthaveeBankQrAction(
  formData: FormData,
): Promise<MutateBankAccountResult> {
  const denied = await requireBankAdmin();
  if (denied) return denied;
  const bankId = String(formData.get("bank_account_id") ?? "").trim();
  const note = String(formData.get("promptpay_note") ?? "").trim();
  const qrLabel = String(formData.get("qr_label") ?? "").trim();
  const customerVisible = String(formData.get("is_qr_customer_visible") ?? "") === "true";
  const file = formData.get("file");
  if (!bankId) return { success: false, error: "ไม่พบรหัสบัญชี" };
  if (!(file instanceof File) || file.size <= 0) {
    return { success: false, error: "กรุณาเลือกไฟล์รูป QR" };
  }
  if (file.size > 8 * 1024 * 1024) return { success: false, error: "ไฟล์ QR ใหญ่เกิน 8MB" };
  if (!file.type.startsWith("image/")) return { success: false, error: "QR ต้องเป็นไฟล์รูปภาพ" };

  const path = `supthavee/${bankId}_${crypto.randomUUID()}.webp`;
  const admin = schemaAdmin();
  const uploaded = await admin.storage.from("payment_qr_codes").upload(path, Buffer.from(await file.arrayBuffer()), {
    contentType: "image/webp",
    upsert: false,
  });
  if (uploaded.error) return { success: false, error: uploaded.error.message ?? "อัปโหลด QR ไม่สำเร็จ" };

  const { data: publicUrl } = admin.storage.from("payment_qr_codes").getPublicUrl(path);
  const updated = await admin
    .from(MST_BANK_ACCOUNTS_TABLE)
    .update({
      qr_storage_path: path,
      qr_image_url: publicUrl.publicUrl,
      qr_label: qrLabel || null,
      promptpay_note: note || null,
      is_qr_customer_visible: customerVisible,
    })
    .eq("id", bankId);
  if (updated.error) {
    if (isMissingQrColumn(updated.error)) return { success: false, error: QR_COLUMN_MISSING };
    return { success: false, error: updated.error.message ?? "บันทึก QR ไม่สำเร็จ" };
  }
  revalidateBankAccountPages();
  return { success: true, error: null };
}

export async function updateSupthaveeBankQrSettingsAction(
  input: BankQrSettingsInput,
): Promise<MutateBankAccountResult> {
  const denied = await requireBankAdmin();
  if (denied) return denied;
  const id = input.id.trim();
  if (!id) return { success: false, error: "ไม่พบรหัสบัญชี" };
  const updated = await schemaAdmin()
    .from(MST_BANK_ACCOUNTS_TABLE)
    .update({
      qr_label: input.qr_label?.trim() || null,
      promptpay_note: input.promptpay_note?.trim() || null,
      is_qr_customer_visible: Boolean(input.is_qr_customer_visible),
    })
    .eq("id", id);
  if (updated.error) {
    if (isMissingQrColumn(updated.error)) return { success: false, error: QR_COLUMN_MISSING };
    return { success: false, error: updated.error.message ?? "บันทึกตั้งค่า QR ไม่สำเร็จ" };
  }
  revalidateBankAccountPages();
  return { success: true, error: null };
}

export async function clearSupthaveeBankQrAction(
  bankAccountId: string,
): Promise<MutateBankAccountResult> {
  const denied = await requireBankAdmin();
  if (denied) return denied;
  const bankId = bankAccountId.trim();
  if (!bankId) return { success: false, error: "ไม่พบรหัสบัญชี" };
  const admin = schemaAdmin();
  const current = await admin
    .from(MST_BANK_ACCOUNTS_TABLE)
    .select("qr_storage_path")
    .eq("id", bankId)
    .maybeSingle();
  const storagePath = (current.data as { qr_storage_path?: string | null } | null)?.qr_storage_path;
  if (storagePath) await admin.storage.from("payment_qr_codes").remove([storagePath]);
  const updated = await admin
    .from(MST_BANK_ACCOUNTS_TABLE)
    .update({ qr_storage_path: null, qr_image_url: null })
    .eq("id", bankId);
  if (updated.error) {
    if (isMissingQrColumn(updated.error)) return { success: false, error: QR_COLUMN_MISSING };
    return { success: false, error: updated.error.message ?? "ล้าง QR ไม่สำเร็จ" };
  }
  revalidateBankAccountPages();
  return { success: true, error: null };
}

export async function toggleBankAccountStatusFormAction(
  id: string,
  currentStatus: boolean,
  _formData?: FormData,
): Promise<void> {
  try {
    await toggleBankAccountStatus(id, currentStatus, _formData);
  } catch (err) {
    console.error("[toggleBankAccountStatusFormAction]", err);
  }
}
