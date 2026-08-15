"use server";

/**
 * Phase 5 — Bank Accounts (mst_bank_accounts) Server Actions.
 *
 * Zero Client-Side Fetching: Service Role via `createSupabaseServerClient` only.
 * Soft-disable via `is_active` — never hard-delete (preserve payment history).
 * Never throw to the UI — always return a safe empty list on failure.
 */

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type {
  BankAccount,
  GetBankAccountsResult,
  MutateBankAccountResult,
} from "@/types/bank-account";

const BANK_ACCOUNTS_PATH = "/finance/bank-accounts";
/** Strict table target — never `bank_accounts` / never `account_number`. */
const MST_BANK_ACCOUNTS_TABLE = "mst_bank_accounts" as const;
const POSTGRES_UNIQUE_VIOLATION = "23505";
const DUPLICATE_ACCOUNT_NO_ERROR = "เลขที่บัญชีซ้ำ";

const EMPTY_LIST: GetBankAccountsResult = { data: [], error: null };

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
    const { data, error } = await supabase
      .from(MST_BANK_ACCOUNTS_TABLE)
      .select(
        "id, bank_name, account_no, account_name, branch_name, is_active, created_at, updated_at",
      )
      .order("created_at", { ascending: true });

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

    revalidatePath(BANK_ACCOUNTS_PATH);
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

    revalidatePath(BANK_ACCOUNTS_PATH);
    return { success: true, error: null };
  } catch (err) {
    console.error("[toggleBankAccountStatus]", err);
    return { success: false, error: "ไม่สามารถเปลี่ยนสถานะบัญชีได้" };
  }
}

/** Form action — must return void for Next.js <form action>. */
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
