"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isContactBankCategory } from "@/lib/finance/vendor-banks";
import type {
  ContactBankAccount,
  ContactBankCategory,
  UpsertContactBankAccountPayload,
} from "@/types/contact-bank-account";

function revalidateContactBankPages() {
  revalidatePath("/contacts");
  revalidatePath("/finance/billing-notes");
  revalidatePath("/finance/billing-notes", "layout");
  revalidatePath("/finance/ap-payment");
}

function asCategory(value: string): ContactBankCategory {
  return isContactBankCategory(value) ? value : "OTHER";
}

function mapRow(row: Record<string, unknown>): ContactBankAccount {
  return {
    id: String(row.id ?? ""),
    contact_id: String(row.contact_id ?? ""),
    account_category: asCategory(String(row.account_category ?? "OTHER")),
    bank_code: String(row.bank_code ?? ""),
    bank_name: String(row.bank_name ?? ""),
    account_no: String(row.account_no ?? ""),
    account_name: String(row.account_name ?? ""),
    branch_name: row.branch_name ? String(row.branch_name) : null,
    qr_image_url: row.qr_image_url ? String(row.qr_image_url) : null,
    notes: row.notes ? String(row.notes) : null,
    is_default: row.is_default === true,
    is_active: row.is_active !== false,
    created_at: String(row.created_at ?? ""),
  };
}

export async function getContactBankAccountsAction(
  contactId: string,
): Promise<{ data: ContactBankAccount[]; error: string | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { data: [], error: owner.error };
  const id = contactId.trim();
  if (!id) return { data: [], error: "ไม่พบรหัสคู่ค้า" };

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contact_bank_accounts")
    .select(
      "id, contact_id, account_category, bank_code, bank_name, account_no, account_name, branch_name, qr_image_url, notes, is_default, is_active, created_at",
    )
    .eq("contact_id", id)
    .order("is_active", { ascending: false })
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) return { data: [], error: error.message };
  return {
    data: (data ?? []).map((row) => mapRow(row as Record<string, unknown>)),
    error: null,
  };
}

export async function upsertContactBankAccountAction(
  payload: UpsertContactBankAccountPayload,
): Promise<{ success: boolean; error: string | null; accountId: string | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { success: false, error: owner.error, accountId: null };

  const contactId = payload.contactId.trim();
  const accountNo = payload.accountNo.trim();
  if (!contactId) return { success: false, error: "ไม่พบรหัสคู่ค้า", accountId: null };
  if (!accountNo) {
    return { success: false, error: "กรุณาระบุเลขที่บัญชีธนาคาร หรือรหัสพร้อมเพย์", accountId: null };
  }
  if (!isContactBankCategory(payload.accountCategory)) {
    return { success: false, error: "ประเภทบัญชีไม่ถูกต้อง", accountId: null };
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("upsert_contact_bank_account", {
    p_contact_id: contactId,
    p_account_id: payload.accountId?.trim() || null,
    p_account_category: payload.accountCategory,
    p_bank_code: payload.bankCode.trim() || "KBANK",
    p_bank_name: payload.bankName.trim() || "กสิกรไทย",
    p_account_no: accountNo,
    p_account_name: payload.accountName.trim(),
    p_branch_name: payload.branchName?.trim() || null,
    p_notes: payload.notes?.trim() || null,
    p_is_default: payload.isDefault ?? true,
    p_is_active: payload.isActive ?? true,
  });

  if (error) return { success: false, error: error.message, accountId: null };
  const saved = data as { bank_account_id?: string } | null;
  revalidateContactBankPages();
  return {
    success: true,
    error: null,
    accountId: saved?.bank_account_id ? String(saved.bank_account_id) : null,
  };
}

export async function deleteOrToggleContactBankAccountAction(
  accountId: string,
  mode: "DELETE" | "TOGGLE_ACTIVE",
): Promise<{ success: boolean; error: string | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { success: false, error: owner.error };
  const id = accountId.trim();
  if (!id) return { success: false, error: "ไม่พบบัญชีธนาคาร" };
  if (mode !== "DELETE" && mode !== "TOGGLE_ACTIVE") {
    return { success: false, error: "คำสั่งไม่ถูกต้อง" };
  }

  const supabase = createSupabaseServerClient();
  if (mode === "DELETE") {
    const { error } = await supabase.from("contact_bank_accounts").delete().eq("id", id);
    if (error) return { success: false, error: error.message };
    revalidateContactBankPages();
    return { success: true, error: null };
  }

  const { data, error: readError } = await supabase
    .from("contact_bank_accounts")
    .select("is_active")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { success: false, error: readError.message };
  if (!data) return { success: false, error: "ไม่พบบัญชีธนาคารนี้" };

  const { error } = await supabase
    .from("contact_bank_accounts")
    .update({ is_active: data.is_active === false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidateContactBankPages();
  return { success: true, error: null };
}
