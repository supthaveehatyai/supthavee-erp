"use server";

/**
 * Phase 5 — Bank Accounts (mst_bank_accounts) Server Actions.
 *
 * Zero Client-Side Fetching: Service Role via `createSupabaseServerClient` only.
 * Soft-disable via `is_active` — never hard-delete (preserve payment history).
 */

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type {
  BankAccount,
  GetBankAccountsResult,
  MutateBankAccountResult,
} from "@/types/bank-account";

const BANK_ACCOUNTS_PATH = "/finance/bank-accounts";

function toBankAccountList(data: unknown): BankAccount[] {
  if (!Array.isArray(data)) return [];

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
 * Always returns `data: []` — never null — to keep the page Error-Boundary-safe.
 */
export async function getBankAccounts(): Promise<GetBankAccountsResult> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("mst_bank_accounts")
      .select(
        "id, bank_name, account_no, account_name, branch_name, is_active, created_at, updated_at",
      )
      .order("created_at", { ascending: true });

    if (error) {
      return {
        data: [],
        error: error.message ?? "ไม่สามารถดึงข้อมูลสมุดบัญชีได้",
      };
    }

    return {
      data: toBankAccountList(data),
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถดึงข้อมูลสมุดบัญชีได้";
    return { data: [], error: message };
  }
}

/**
 * Create a new bank account from FormData.
 * Fields: bank_name, account_no, account_name, branch_name (optional)
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

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.from("mst_bank_accounts").insert({
      bank_name,
      account_no,
      account_name,
      branch_name,
      is_active: true,
    });

    if (error) {
      return {
        success: false,
        error: error.message ?? "ไม่สามารถสร้างบัญชีได้",
      };
    }

    revalidatePath(BANK_ACCOUNTS_PATH);
    return { success: true, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถสร้างบัญชีได้";
    return { success: false, error: message };
  }
}

/**
 * Toggle active/inactive — soft disable only (never delete).
 * Compatible with `<form action={toggleBankAccountStatus.bind(null, id, isActive)}>`
 * (Next.js may append FormData as the last argument).
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
      .from("mst_bank_accounts")
      .update({ is_active: !currentStatus })
      .eq("id", trimmedId);

    if (error) {
      return {
        success: false,
        error: error.message ?? "ไม่สามารถเปลี่ยนสถานะบัญชีได้",
      };
    }

    revalidatePath(BANK_ACCOUNTS_PATH);
    return { success: true, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถเปลี่ยนสถานะบัญชีได้";
    return { success: false, error: message };
  }
}
