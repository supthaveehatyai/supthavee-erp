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

/**
 * List all company bank books (active + inactive), oldest first.
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
      return { data: [], error: error.message ?? "ไม่สามารถดึงข้อมูลสมุดบัญชีได้" };
    }

    return {
      data: (data ?? []) as BankAccount[],
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
