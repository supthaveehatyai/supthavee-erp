"use server";

/**
 * Phase 8 — Expense Management Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 *
 * NOTE: After applying the migration, regenerate Database types so
 * `mst_expense_categories` / `expenses` appear on `Database["public"]["Tables"]`.
 * Until then this file uses an untyped admin client + strict local DTOs.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { logAuditTrail } from "@/lib/supabase/auditService";
import {
  generateDraftDocumentNo,
  isTemporaryDraftDocNo,
} from "@/lib/utils/draft-document-no";

/* -------------------------------------------------------------------------- */
/* Strict local types (payload / rows)                                        */
/* -------------------------------------------------------------------------- */

export type ExpenseCategory = {
  id: string;
  category_name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
};

export type ExpenseRecord = {
  id: string;
  document_no: string;
  expense_date: string;
  category_id: string | null;
  vendor_id: string | null;
  bank_account_id: string | null;
  net_amount: number;
  vat_amount: number;
  grand_total: number;
  payment_method: string | null;
  receipt_url: string | null;
  status: "DRAFT" | "ISSUED" | "VOID" | string;
  remark: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ExpenseDetail = ExpenseRecord & {
  category_name: string;
  vendor_name: string;
  bank_account_label: string | null;
};

export type GetExpenseByIdResult = {
  data: ExpenseDetail | null;
  error: string | null;
};

export type MutateExpenseResult = {
  data: ExpenseRecord | null;
  error: string | null;
};

export type ExpenseVendorOption = {
  id: string;
  company_name: string;
};

export type CreateDraftExpenseInput = {
  category_id: string;
  vendor_id: string;
  expense_date: string;
  net_amount: number;
  vat_amount?: number;
  remark?: string | null;
  payment_method?: string | null;
  bank_account_id?: string | null;
  recorded_by?: string | null;
};

/** Same mutable fields as create — used by `updateDraftExpense`. */
export type UpdateDraftExpenseInput = {
  category_id: string;
  vendor_id: string;
  expense_date: string;
  net_amount: number;
  vat_amount?: number;
  remark?: string | null;
  payment_method?: string | null;
  bank_account_id?: string | null;
};

export type ExpenseBankAccountOption = {
  id: string;
  bank_name: string;
  account_no: string;
  account_name: string;
  label: string;
};

export type GetExpenseBankAccountsResult = {
  data: ExpenseBankAccountOption[];
  error: string | null;
};

export type CreateExpenseCategoryResult = {
  data: ExpenseCategory | null;
  error: string | null;
};

export type GetExpenseCategoriesResult = {
  data: ExpenseCategory[];
  error: string | null;
};

export type GetExpenseVendorsResult = {
  data: ExpenseVendorOption[];
  error: string | null;
};

export type CreateDraftExpenseResult = {
  data: ExpenseRecord | null;
  error: string | null;
};

export type UpdateDraftExpenseResult = MutateExpenseResult;

export type ExpenseListItem = {
  id: string;
  document_no: string;
  expense_date: string;
  category_id: string | null;
  category_name: string;
  remark: string | null;
  grand_total: number;
  status: string;
};

export type GetExpensesResult = {
  data: ExpenseListItem[];
  error: string | null;
};

/* -------------------------------------------------------------------------- */
/* Admin client                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Raw service-role client — bypasses RLS.
 * Untyped until `supabase gen types` includes expense tables.
 */
function createSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY (หรือ NEXT_PUBLIC_SUPABASE_URL) — ตั้งค่าใน .env.development แล้วรีสตาร์ท next dev",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function toMoney(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function mapExpenseRow(row: Record<string, unknown>): ExpenseRecord {
  return {
    id: String(row.id),
    document_no: String(row.document_no ?? ""),
    expense_date: String(row.expense_date ?? ""),
    category_id:
      row.category_id == null ? null : String(row.category_id),
    vendor_id: row.vendor_id == null ? null : String(row.vendor_id),
    bank_account_id:
      row.bank_account_id == null ? null : String(row.bank_account_id),
    net_amount: Number(row.net_amount ?? 0),
    vat_amount: Number(row.vat_amount ?? 0),
    grand_total: Number(row.grand_total ?? 0),
    payment_method:
      row.payment_method == null ? null : String(row.payment_method),
    receipt_url: row.receipt_url == null ? null : String(row.receipt_url),
    status: String(row.status ?? "DRAFT"),
    remark: row.remark == null ? null : String(row.remark),
    recorded_by:
      row.recorded_by == null ? null : String(row.recorded_by),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

type NamedJoin = { category_name?: string | null; company_name?: string | null };
type BankJoin = {
  bank_name?: string | null;
  account_no?: string | null;
  account_name?: string | null;
};

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function fireExpenseAuditLog(params: {
  recordId: string;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  changedByName: string;
}): void {
  void logAuditTrail(
    "expenses",
    params.recordId,
    "UPDATE",
    params.oldData,
    params.newData,
    null,
    { changedByName: params.changedByName },
  ).then((result) => {
    if (!result.success) {
      console.error(
        "[fireExpenseAuditLog]",
        params.changedByName,
        result.error,
      );
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Server Actions                                                             */
/* -------------------------------------------------------------------------- */

type CategoryJoin = {
  category_name?: string | null;
};

function unwrapCategoryName(
  value: CategoryJoin | CategoryJoin[] | null | undefined,
): string {
  if (value == null) return "—";
  const row = Array.isArray(value) ? (value[0] ?? null) : value;
  const name = row?.category_name?.trim();
  return name || "—";
}

/**
 * Expense list for UI — joins mst_expense_categories for category_name.
 * Newest expense_date first.
 */
export async function getExpenses(
  limit = 100,
): Promise<GetExpensesResult> {
  try {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("expenses")
      .select(
        `
        id,
        document_no,
        expense_date,
        category_id,
        remark,
        grand_total,
        status,
        mst_expense_categories (
          category_name
        )
      `,
      )
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(safeLimit);

    if (error) {
      console.error("[getExpenses]", error.message);
      return { data: [], error: error.message };
    }

    const rows: ExpenseListItem[] = (data ?? []).map((row) => {
      const raw = row as Record<string, unknown>;
      return {
        id: String(raw.id),
        document_no: String(raw.document_no ?? ""),
        expense_date: String(raw.expense_date ?? ""),
        category_id:
          raw.category_id == null ? null : String(raw.category_id),
        category_name: unwrapCategoryName(
          raw.mst_expense_categories as
            | CategoryJoin
            | CategoryJoin[]
            | null
            | undefined,
        ),
        remark: raw.remark == null ? null : String(raw.remark),
        grand_total: Number(raw.grand_total ?? 0),
        status: String(raw.status ?? "DRAFT"),
      };
    });

    return { data: rows, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load expenses";
    console.error("[getExpenses]", message);
    return { data: [], error: message };
  }
}

/**
 * Active Vendor contacts for expense payee dropdown.
 * Mirrors procurement `getActiveVendors` — kept in this module for Expense UI.
 */
export async function getExpenseVendors(): Promise<GetExpenseVendorsResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select("id, company_name")
      .eq("contact_type", "Vendor")
      .eq("is_active", true)
      .order("company_name", { ascending: true });

    if (error) {
      console.error("[getExpenseVendors]", error.message);
      return { data: [], error: error.message };
    }

    const rows: ExpenseVendorOption[] = (data ?? []).map((row) => ({
      id: String(row.id),
      company_name: String(row.company_name ?? "").trim() || "ไม่ระบุชื่อ",
    }));

    return { data: rows, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load expense vendors";
    console.error("[getExpenseVendors]", message);
    return { data: [], error: message };
  }
}

/**
 * Active expense categories, ordered by category_name.
 */
export async function getExpenseCategories(): Promise<GetExpenseCategoriesResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("mst_expense_categories")
      .select("id, category_name, description, is_active, created_at")
      .eq("is_active", true)
      .order("category_name", { ascending: true });

    if (error) {
      console.error("[getExpenseCategories]", error.message);
      return { data: [], error: error.message };
    }

    const rows: ExpenseCategory[] = (data ?? []).map((row) => ({
      id: String(row.id),
      category_name: String(row.category_name ?? ""),
      description:
        row.description == null ? null : String(row.description),
      is_active: Boolean(row.is_active),
      created_at: String(row.created_at ?? ""),
    }));

    return { data: rows, error: null };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to load expense categories";
    console.error("[getExpenseCategories]", message);
    return { data: [], error: message };
  }
}

/**
 * Active company bank books for TRANSFER expenses.
 */
export async function getBankAccounts(): Promise<GetExpenseBankAccountsResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("mst_bank_accounts")
      .select("id, bank_name, account_no, account_name, is_active")
      .eq("is_active", true)
      .order("bank_name", { ascending: true });

    if (error) {
      console.error("[getBankAccounts]", error.message);
      return { data: [], error: error.message };
    }

    const rows: ExpenseBankAccountOption[] = (data ?? []).map((row) => {
      const bankName = String(row.bank_name ?? "").trim();
      const accountNo = String(row.account_no ?? "").trim();
      const accountName = String(row.account_name ?? "").trim();
      return {
        id: String(row.id),
        bank_name: bankName,
        account_no: accountNo,
        account_name: accountName,
        label: `${bankName} · ${accountNo}${accountName ? ` (${accountName})` : ""}`,
      };
    });

    return { data: rows, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load bank accounts";
    console.error("[getBankAccounts]", message);
    return { data: [], error: message };
  }
}

/**
 * On-the-fly create expense category (active by default).
 */
export async function createExpenseCategory(
  name: string,
): Promise<CreateExpenseCategoryResult> {
  try {
    const categoryName = name?.trim() ?? "";
    if (!categoryName) {
      return { data: null, error: "กรุณาระบุชื่อหมวดหมู่" };
    }
    if (categoryName.length > 100) {
      return { data: null, error: "ชื่อหมวดหมู่ยาวเกิน 100 ตัวอักษร" };
    }

    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("mst_expense_categories")
      .insert({
        category_name: categoryName,
        is_active: true,
      })
      .select("id, category_name, description, is_active, created_at")
      .single();

    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        return { data: null, error: "มีหมวดหมู่นี้อยู่แล้วในระบบ" };
      }
      console.error("[createExpenseCategory]", error.message);
      return { data: null, error: error.message };
    }

    if (!data) {
      return { data: null, error: "สร้างหมวดหมู่ไม่สำเร็จ" };
    }

    return {
      data: {
        id: String(data.id),
        category_name: String(data.category_name ?? ""),
        description:
          data.description == null ? null : String(data.description),
        is_active: Boolean(data.is_active),
        created_at: String(data.created_at ?? ""),
      },
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to create expense category";
    console.error("[createExpenseCategory]", message);
    return { data: null, error: message };
  }
}

/**
 * Create a DRAFT expense with Late Numbering document_no (`DRAFT-YYYYMMDDHHmmss`).
 */
export async function createDraftExpense(
  data: CreateDraftExpenseInput,
): Promise<CreateDraftExpenseResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const validated = await validateExpenseDraftPayload(supabaseAdmin, data);
    if (validated.error || !validated.data) {
      return { data: null, error: validated.error ?? "ข้อมูลไม่ถูกต้อง" };
    }

    const v = validated.data;
    const documentNo = generateDraftDocumentNo();

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("expenses")
      .insert({
        document_no: documentNo,
        expense_date: v.expenseDate,
        category_id: v.categoryId,
        vendor_id: v.vendorId,
        bank_account_id: v.bankAccountId,
        net_amount: v.netAmount,
        vat_amount: v.vatAmount,
        payment_method: v.paymentMethod,
        status: "DRAFT",
        remark: v.remark,
        recorded_by: data.recorded_by ?? null,
      })
      .select(
        "id, document_no, expense_date, category_id, vendor_id, bank_account_id, net_amount, vat_amount, grand_total, payment_method, receipt_url, status, remark, recorded_by, created_at, updated_at",
      )
      .single();

    if (insertError) {
      console.error("[createDraftExpense]", insertError.message);
      return { data: null, error: insertError.message };
    }

    if (!inserted) {
      return { data: null, error: "insert returned no row" };
    }

    const mapped = mapExpenseRow(inserted as Record<string, unknown>);
    revalidatePath("/expenses");
    revalidatePath(`/expenses/${mapped.id}`);
    return {
      data: mapped,
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to create draft expense";
    console.error("[createDraftExpense]", message);
    return { data: null, error: message };
  }
}

type ValidatedExpenseDraft = {
  categoryId: string;
  vendorId: string;
  expenseDate: string;
  netAmount: number;
  vatAmount: number;
  paymentMethod: string | null;
  bankAccountId: string | null;
  remark: string | null;
};

/**
 * Shared validation for create / update draft expense payloads.
 */
async function validateExpenseDraftPayload(
  supabaseAdmin: SupabaseClient,
  data: UpdateDraftExpenseInput,
): Promise<{ data: ValidatedExpenseDraft | null; error: string | null }> {
  const categoryId = data.category_id?.trim() ?? "";
  if (!categoryId) {
    return { data: null, error: "category_id is required" };
  }

  const vendorId = data.vendor_id?.trim() ?? "";
  if (!vendorId) {
    return { data: null, error: "vendor_id is required" };
  }

  const expenseDate = data.expense_date?.trim() ?? "";
  if (!isIsoDate(expenseDate)) {
    return {
      data: null,
      error: "expense_date must be YYYY-MM-DD",
    };
  }

  const netAmount = toMoney(data.net_amount);
  if (!Number.isFinite(netAmount)) {
    return {
      data: null,
      error: "net_amount must be a number >= 0",
    };
  }

  const vatAmount = toMoney(data.vat_amount ?? 0);
  if (!Number.isFinite(vatAmount)) {
    return {
      data: null,
      error: "vat_amount must be a number >= 0",
    };
  }

  const paymentMethod = data.payment_method?.trim() || null;
  const bankAccountId = data.bank_account_id?.trim() || null;

  if (paymentMethod === "TRANSFER" && !bankAccountId) {
    return {
      data: null,
      error: "กรุณาเลือกบัญชีธนาคารเมื่อชำระแบบโอนเงิน",
    };
  }

  const { data: category, error: categoryError } = await supabaseAdmin
    .from("mst_expense_categories")
    .select("id")
    .eq("id", categoryId)
    .eq("is_active", true)
    .maybeSingle();

  if (categoryError) {
    return { data: null, error: categoryError.message };
  }
  if (!category) {
    return {
      data: null,
      error: "ไม่พบหมวดหมู่ค่าใช้จ่ายที่ใช้งานได้",
    };
  }

  const { data: vendor, error: vendorError } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq("id", vendorId)
    .eq("contact_type", "Vendor")
    .eq("is_active", true)
    .maybeSingle();

  if (vendorError) {
    return { data: null, error: vendorError.message };
  }
  if (!vendor) {
    return {
      data: null,
      error: "ไม่พบผู้ให้บริการ (Vendor) ที่ใช้งานได้",
    };
  }

  if (bankAccountId) {
    const { data: bank, error: bankError } = await supabaseAdmin
      .from("mst_bank_accounts")
      .select("id")
      .eq("id", bankAccountId)
      .eq("is_active", true)
      .maybeSingle();

    if (bankError) {
      return { data: null, error: bankError.message };
    }
    if (!bank) {
      return {
        data: null,
        error: "ไม่พบบัญชีธนาคารที่ใช้งานได้",
      };
    }
  }

  const remark =
    data.remark == null || !String(data.remark).trim()
      ? null
      : String(data.remark).trim();

  return {
    data: {
      categoryId,
      vendorId,
      expenseDate,
      netAmount,
      vatAmount,
      paymentMethod,
      bankAccountId:
        paymentMethod === "TRANSFER" ? bankAccountId : null,
      remark,
    },
    error: null,
  };
}

/**
 * Update an existing DRAFT expense only. Audits via `logAuditTrail` (UPDATE).
 */
export async function updateDraftExpense(
  id: string,
  payload: UpdateDraftExpenseInput,
): Promise<UpdateDraftExpenseResult> {
  try {
    const expenseId = id?.trim() ?? "";
    if (!expenseId) {
      return { data: null, error: "ไม่พบรหัสเอกสารค่าใช้จ่าย" };
    }

    const supabaseAdmin = createSupabaseAdminClient();

    const { data: before, error: beforeError } = await supabaseAdmin
      .from("expenses")
      .select(
        "id, document_no, expense_date, category_id, vendor_id, bank_account_id, net_amount, vat_amount, grand_total, payment_method, receipt_url, status, remark, recorded_by, created_at, updated_at",
      )
      .eq("id", expenseId)
      .maybeSingle();

    if (beforeError) {
      return { data: null, error: beforeError.message };
    }
    if (!before) {
      return { data: null, error: "ไม่พบเอกสารค่าใช้จ่าย" };
    }
    if (String(before.status) !== "DRAFT") {
      return {
        data: null,
        error: `แก้ไขได้เฉพาะสถานะ DRAFT (ปัจจุบัน: ${before.status})`,
      };
    }

    const validated = await validateExpenseDraftPayload(
      supabaseAdmin,
      payload,
    );
    if (validated.error || !validated.data) {
      return { data: null, error: validated.error ?? "ข้อมูลไม่ถูกต้อง" };
    }

    const v = validated.data;
    const nowIso = new Date().toISOString();

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("expenses")
      .update({
        expense_date: v.expenseDate,
        category_id: v.categoryId,
        vendor_id: v.vendorId,
        bank_account_id: v.bankAccountId,
        net_amount: v.netAmount,
        vat_amount: v.vatAmount,
        payment_method: v.paymentMethod,
        remark: v.remark,
        updated_at: nowIso,
      })
      .eq("id", expenseId)
      .eq("status", "DRAFT")
      .select(
        "id, document_no, expense_date, category_id, vendor_id, bank_account_id, net_amount, vat_amount, grand_total, payment_method, receipt_url, status, remark, recorded_by, created_at, updated_at",
      )
      .maybeSingle();

    if (updateError) {
      console.error("[updateDraftExpense]", updateError.message);
      return { data: null, error: updateError.message };
    }
    if (!updated) {
      return {
        data: null,
        error: "อัปเดต Draft ไม่สำเร็จ (อาจถูก Issue/Void ไปแล้ว)",
      };
    }

    const mapped = mapExpenseRow(updated as Record<string, unknown>);
    fireExpenseAuditLog({
      recordId: expenseId,
      changedByName: "UPDATE",
      oldData: before as Record<string, unknown>,
      newData: mapped as unknown as Record<string, unknown>,
    });

    revalidatePath("/expenses");
    revalidatePath(`/expenses/${expenseId}`);
    revalidatePath(`/expenses/${expenseId}/edit`);
    return { data: mapped, error: null };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to update draft expense";
    console.error("[updateDraftExpense]", message);
    return { data: null, error: message };
  }
}

/**
 * Fetch one expense with category / vendor / bank labels.
 */
export async function getExpenseById(
  id: string,
): Promise<GetExpenseByIdResult> {
  try {
    const expenseId = id?.trim() ?? "";
    if (!expenseId) {
      return { data: null, error: "ไม่พบรหัสเอกสารค่าใช้จ่าย" };
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("expenses")
      .select(
        `
        id,
        document_no,
        expense_date,
        category_id,
        vendor_id,
        bank_account_id,
        net_amount,
        vat_amount,
        grand_total,
        payment_method,
        receipt_url,
        status,
        remark,
        recorded_by,
        created_at,
        updated_at,
        mst_expense_categories ( category_name ),
        contacts:vendor_id ( company_name ),
        mst_bank_accounts (
          bank_name,
          account_no,
          account_name
        )
      `,
      )
      .eq("id", expenseId)
      .maybeSingle();

    if (error) {
      console.error("[getExpenseById]", error.message);
      return { data: null, error: error.message };
    }
    if (!data) {
      return { data: null, error: "ไม่พบเอกสารค่าใช้จ่าย" };
    }

    const raw = data as Record<string, unknown>;
    const base = mapExpenseRow(raw);
    const category = unwrapJoin(raw.mst_expense_categories as NamedJoin | NamedJoin[] | null);
    const vendor = unwrapJoin(raw.contacts as NamedJoin | NamedJoin[] | null);
    const bank = unwrapJoin(raw.mst_bank_accounts as BankJoin | BankJoin[] | null);

    const bankLabel = bank
      ? `${String(bank.bank_name ?? "").trim()} · ${String(bank.account_no ?? "").trim()}${
          bank.account_name ? ` (${String(bank.account_name).trim()})` : ""
        }`
      : null;

    return {
      data: {
        ...base,
        category_name: category?.category_name?.trim() || "—",
        vendor_name: vendor?.company_name?.trim() || "—",
        bank_account_label: bankLabel,
      },
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load expense";
    console.error("[getExpenseById]", message);
    return { data: null, error: message };
  }
}

/**
 * Confirm DRAFT → ISSUED and assign EXP-YYMM-XXXX via generate_expense_no.
 */
export async function issueExpense(id: string): Promise<MutateExpenseResult> {
  try {
    const expenseId = id?.trim() ?? "";
    if (!expenseId) {
      return { data: null, error: "ไม่พบรหัสเอกสารค่าใช้จ่าย" };
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: before, error: beforeError } = await supabaseAdmin
      .from("expenses")
      .select(
        "id, document_no, expense_date, category_id, vendor_id, bank_account_id, net_amount, vat_amount, grand_total, payment_method, status, remark",
      )
      .eq("id", expenseId)
      .maybeSingle();

    if (beforeError) {
      return { data: null, error: beforeError.message };
    }
    if (!before) {
      return { data: null, error: "ไม่พบเอกสารค่าใช้จ่าย" };
    }
    if (String(before.status) !== "DRAFT") {
      return {
        data: null,
        error: `ออกเอกสารได้เฉพาะสถานะ DRAFT (ปัจจุบัน: ${before.status})`,
      };
    }

    const expenseDate = String(before.expense_date ?? "").slice(0, 10);
    let officialNo = String(before.document_no ?? "");

    if (isTemporaryDraftDocNo(officialNo)) {
      const { data: generated, error: rpcError } = await supabaseAdmin.rpc(
        "generate_expense_no",
        { p_expense_date: expenseDate },
      );

      if (rpcError) {
        console.error("[issueExpense] generate_expense_no", rpcError.message);
        return {
          data: null,
          error:
            rpcError.message ||
            "สร้างเลขที่เอกสาร EXP ไม่สำเร็จ — ตรวจว่า migration generate_expense_no รันแล้ว",
        };
      }
      if (!generated || typeof generated !== "string") {
        return { data: null, error: "RPC generate_expense_no ไม่คืนเลขที่เอกสาร" };
      }
      officialNo = generated;
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("expenses")
      .update({
        document_no: officialNo,
        status: "ISSUED",
        updated_at: nowIso,
      })
      .eq("id", expenseId)
      .eq("status", "DRAFT")
      .select(
        "id, document_no, expense_date, category_id, vendor_id, bank_account_id, net_amount, vat_amount, grand_total, payment_method, receipt_url, status, remark, recorded_by, created_at, updated_at",
      )
      .maybeSingle();

    if (updateError) {
      return { data: null, error: updateError.message };
    }
    if (!updated) {
      return {
        data: null,
        error: "อัปเดตสถานะเป็น ISSUED ไม่สำเร็จ (อาจถูกแก้ไขไปแล้ว)",
      };
    }

    const mapped = mapExpenseRow(updated as Record<string, unknown>);
    fireExpenseAuditLog({
      recordId: expenseId,
      changedByName: "ISSUE",
      oldData: before as Record<string, unknown>,
      newData: {
        ...mapped,
        status: "ISSUED",
        document_no: officialNo,
      },
    });

    revalidatePath("/expenses");
    revalidatePath(`/expenses/${expenseId}`);
    return { data: mapped, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ออกเอกสารค่าใช้จ่ายไม่สำเร็จ";
    console.error("[issueExpense]", message);
    return { data: null, error: message };
  }
}

/**
 * Void a DRAFT expense → VOID (lifecycle cancel before issue).
 */
export async function voidExpense(id: string): Promise<MutateExpenseResult> {
  try {
    const expenseId = id?.trim() ?? "";
    if (!expenseId) {
      return { data: null, error: "ไม่พบรหัสเอกสารค่าใช้จ่าย" };
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: before, error: beforeError } = await supabaseAdmin
      .from("expenses")
      .select(
        "id, document_no, expense_date, category_id, vendor_id, bank_account_id, net_amount, vat_amount, grand_total, payment_method, status, remark",
      )
      .eq("id", expenseId)
      .maybeSingle();

    if (beforeError) {
      return { data: null, error: beforeError.message };
    }
    if (!before) {
      return { data: null, error: "ไม่พบเอกสารค่าใช้จ่าย" };
    }
    if (String(before.status) !== "DRAFT") {
      return {
        data: null,
        error: `ยกเลิกได้เฉพาะสถานะ DRAFT (ปัจจุบัน: ${before.status})`,
      };
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("expenses")
      .update({
        status: "VOID",
        updated_at: nowIso,
      })
      .eq("id", expenseId)
      .eq("status", "DRAFT")
      .select(
        "id, document_no, expense_date, category_id, vendor_id, bank_account_id, net_amount, vat_amount, grand_total, payment_method, receipt_url, status, remark, recorded_by, created_at, updated_at",
      )
      .maybeSingle();

    if (updateError) {
      return { data: null, error: updateError.message };
    }
    if (!updated) {
      return {
        data: null,
        error: "อัปเดตสถานะเป็น VOID ไม่สำเร็จ (อาจถูกแก้ไขไปแล้ว)",
      };
    }

    const mapped = mapExpenseRow(updated as Record<string, unknown>);
    fireExpenseAuditLog({
      recordId: expenseId,
      changedByName: "VOID",
      oldData: before as Record<string, unknown>,
      newData: { ...mapped, status: "VOID" },
    });

    revalidatePath("/expenses");
    revalidatePath(`/expenses/${expenseId}`);
    return { data: mapped, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ยกเลิกเอกสารค่าใช้จ่ายไม่สำเร็จ";
    console.error("[voidExpense]", message);
    return { data: null, error: message };
  }
}
