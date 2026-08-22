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
import {
  DUPLICATE_INVOICE_ERROR,
  DUPLICATE_INVOICE_MESSAGE,
  EXPENSE_MONEY_EPSILON,
} from "@/lib/constants/expense-constants";
import { logAuditTrail } from "@/lib/supabase/auditService";
import {
  generateDraftDocumentNo,
  isTemporaryDraftDocNo,
} from "@/lib/utils/draft-document-no";
import {
  EXPENSE_APPROVAL_THRESHOLD,
  PENDING_APPROVAL_TOAST_MESSAGE,
  requiresExpenseApproval,
} from "@/lib/approval/approval-rules";
import { revalidateApprovalCenterIfPending } from "@/lib/approval/revalidate-approval";
import type {
  CreateDraftExpenseInput,
  CreateDraftExpenseResult,
  CreateExpenseCategoryResult,
  ExpenseBankAccountOption,
  ExpenseCategory,
  ExpenseDetail,
  ExpenseInstallmentInput,
  ExpenseInstallmentRow,
  ExpenseListItem,
  ExpenseRecord,
  ExpenseVendorOption,
  GetExpenseBankAccountsResult,
  GetExpenseByIdResult,
  GetExpenseCategoriesResult,
  GetExpensesResult,
  GetExpenseVendorsResult,
  MutateExpenseResult,
  PayExpenseInstallmentPayload,
  PayExpenseInstallmentResult,
  UpdateDraftExpenseInput,
  UpdateDraftExpenseResult,
  UploadExpenseReceiptResult,
} from "@/types/expense";
import { generateDocumentNumber } from "@/lib/actions/document-actions";

/**
 * Purge Next.js Router Cache for Expense routes after mutations.
 * Call immediately after a successful INSERT/UPDATE — before return.
 * - `/expenses` page + layout (list must show new DRAFT rows)
 * - detail segment when an id is known
 */
function revalidateExpenseCaches(expenseId?: string | null) {
  revalidatePath("/expenses");
  revalidatePath("/expenses", "layout");
  if (expenseId) {
    revalidatePath(`/expenses/${expenseId}`);
    revalidatePath("/expenses/[id]", "page");
  }
}

const EXPENSE_ROW_SELECT =
  "id, document_no, expense_date, category_id, vendor_id, vendor_doc_no, bank_account_id, net_amount, vat_amount, grand_total, wht_type, wht_rate, wht_amount, net_payable, payment_method, receipt_url, payment_slip_url, status, approval_status, remark, recorded_by, is_installment, total_interest_amount, created_at, updated_at";

function mapDuplicateExpenseError(error: {
  code?: string;
  message?: string;
}): MutateExpenseResult | null {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (
    code === "23505" ||
    /idx_expenses_duplicate_prevent|duplicate key/i.test(message)
  ) {
    return {
      data: null,
      error: DUPLICATE_INVOICE_ERROR,
      message: DUPLICATE_INVOICE_MESSAGE,
    };
  }
  return null;
}

/**
 * Early Warning — same composite key as `idx_expenses_duplicate_prevent`:
 * vendor_id + expense_date + vendor_doc_no (exclude VOID + current row on edit).
 */
async function findDuplicateExpense(
  supabaseAdmin: SupabaseClient,
  params: {
    vendorId: string;
    expenseDate: string;
    vendorDocNo: string | null;
    excludeId?: string | null;
  },
): Promise<{ isDuplicate: boolean; error: string | null }> {
  const vendorId = params.vendorId.trim();
  const expenseDate = params.expenseDate.trim();
  const vendorDocNo = (params.vendorDocNo ?? "").trim();

  // Incomplete identity — skip (matches partial unique index WHERE clause).
  if (!vendorId || !expenseDate || !vendorDocNo) {
    return { isDuplicate: false, error: null };
  }

  let query = supabaseAdmin
    .from("expenses")
    .select("id")
    .eq("vendor_id", vendorId)
    .eq("expense_date", expenseDate)
    .eq("vendor_doc_no", vendorDocNo)
    .neq("status", "VOID")
    .limit(1);

  const excludeId = params.excludeId?.trim();
  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const { data, error } = await query;
  if (error) {
    return { isDuplicate: false, error: error.message };
  }

  const rows = data ?? [];
  return { isDuplicate: rows.length > 0, error: null };
}

function duplicateInvoiceResult(): MutateExpenseResult {
  return {
    data: null,
    error: DUPLICATE_INVOICE_ERROR,
    message: DUPLICATE_INVOICE_MESSAGE,
  };
}

const EXPENSE_DOCUMENTS_BUCKET = "expense_documents";

const ALLOWED_EXPENSE_ATTACHMENT_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

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
    vendor_doc_no:
      row.vendor_doc_no == null || String(row.vendor_doc_no).trim() === ""
        ? null
        : String(row.vendor_doc_no).trim(),
    bank_account_id:
      row.bank_account_id == null ? null : String(row.bank_account_id),
    net_amount: Number(row.net_amount ?? 0),
    vat_amount: Number(row.vat_amount ?? 0),
    grand_total: Number(row.grand_total ?? 0),
    wht_type:
      row.wht_type == null || String(row.wht_type).trim() === ""
        ? null
        : String(row.wht_type).trim(),
    wht_rate: Number(row.wht_rate ?? 0),
    wht_amount: Number(row.wht_amount ?? 0),
    net_payable: Number(row.net_payable ?? 0),
    payment_method:
      row.payment_method == null ? null : String(row.payment_method),
    receipt_url: row.receipt_url == null ? null : String(row.receipt_url),
    payment_slip_url:
      row.payment_slip_url == null ? null : String(row.payment_slip_url),
    status: String(row.status ?? "DRAFT"),
    approval_status: String(row.approval_status ?? "APPROVED"),
    remark: row.remark == null ? null : String(row.remark),
    recorded_by:
      row.recorded_by == null ? null : String(row.recorded_by),
    is_installment: Boolean(row.is_installment),
    total_interest_amount: Number(row.total_interest_amount ?? 0),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function mapInstallmentRow(row: Record<string, unknown>): ExpenseInstallmentRow {
  const principal = Number(row.principal_amount ?? 0);
  const interest = Number(row.interest_amount ?? 0);
  return {
    id: String(row.id),
    expense_id: String(row.expense_id ?? ""),
    installment_period: Number(row.installment_period ?? 0),
    due_date: String(row.due_date ?? ""),
    principal_amount: principal,
    interest_amount: interest,
    total_installment: Number(
      row.total_installment ?? toMoney(principal + interest),
    ),
    is_paid: Boolean(row.is_paid),
    paid_date: row.paid_date == null ? null : String(row.paid_date),
    payment_transaction_id:
      row.payment_transaction_id == null
        ? null
        : String(row.payment_transaction_id),
    slip_url: row.slip_url == null ? null : String(row.slip_url),
  };
}

function parseInstallmentsFromFormData(
  formData: FormData,
): {
  isInstallment: boolean;
  installments: ExpenseInstallmentInput[];
  error: string | null;
} {
  const isInstallment =
    String(formData.get("is_installment") ?? "") === "1" ||
    String(formData.get("is_installment") ?? "").toLowerCase() === "true";

  if (!isInstallment) {
    return { isInstallment: false, installments: [], error: null };
  }

  const raw = String(formData.get("installments_json") ?? "").trim();
  if (!raw) {
    return {
      isInstallment: true,
      installments: [],
      error: "กรุณาระบุงวดผ่อนชำระอย่างน้อย 1 งวด",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      isInstallment: true,
      installments: [],
      error: "รูปแบบงวดผ่อนชำระไม่ถูกต้อง",
    };
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return {
      isInstallment: true,
      installments: [],
      error: "กรุณาระบุงวดผ่อนชำระอย่างน้อย 1 งวด",
    };
  }

  const installments: ExpenseInstallmentInput[] = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const row = parsed[i] as Record<string, unknown>;
    const period = Number(row.installment_period ?? i + 1);
    const dueDate = String(row.due_date ?? "").trim();
    const principal = toMoney(Number(row.principal_amount ?? 0));
    const interest = toMoney(Number(row.interest_amount ?? 0));

    if (!Number.isInteger(period) || period <= 0) {
      return {
        isInstallment: true,
        installments: [],
        error: `งวดที่ ${i + 1}: เลขงวดไม่ถูกต้อง`,
      };
    }
    if (!isIsoDate(dueDate)) {
      return {
        isInstallment: true,
        installments: [],
        error: `งวดที่ ${period}: วันครบกำหนดไม่ถูกต้อง`,
      };
    }
    if (!Number.isFinite(principal) || principal < 0) {
      return {
        isInstallment: true,
        installments: [],
        error: `งวดที่ ${period}: เงินต้นไม่ถูกต้อง`,
      };
    }
    if (!Number.isFinite(interest) || interest < 0) {
      return {
        isInstallment: true,
        installments: [],
        error: `งวดที่ ${period}: ดอกเบี้ยไม่ถูกต้อง`,
      };
    }

    installments.push({
      installment_period: period,
      due_date: dueDate,
      principal_amount: principal,
      interest_amount: interest,
    });
  }

  return { isInstallment: true, installments, error: null };
}

async function replaceExpenseInstallments(
  supabaseAdmin: SupabaseClient,
  expenseId: string,
  installments: ExpenseInstallmentInput[],
): Promise<{ error: string | null }> {
  const { error: deleteError } = await supabaseAdmin
    .from("expense_installments")
    .delete()
    .eq("expense_id", expenseId);

  if (deleteError) {
    console.error("[replaceExpenseInstallments][delete]", deleteError.message);
    return { error: deleteError.message };
  }

  if (installments.length === 0) {
    return { error: null };
  }

  // `total_installment` is a GENERATED column — never send it in INSERT.
  const rows = installments.map((row) => ({
    expense_id: expenseId,
    installment_period: row.installment_period,
    due_date: row.due_date,
    principal_amount: row.principal_amount,
    interest_amount: row.interest_amount,
    is_paid: false,
  }));

  const { error: insertError } = await supabaseAdmin
    .from("expense_installments")
    .insert(rows);

  if (insertError) {
    console.error("[replaceExpenseInstallments][insert]", insertError.message);
    return { error: insertError.message };
  }

  return { error: null };
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
  /** Business event for change details — not the actor display name */
  auditEvent: "ISSUE" | "VOID" | "UPDATE" | "DELETE";
}): void {
  void (async () => {
    const newDataWithEvent: Record<string, unknown> = {
      ...(params.newData ?? {}),
      audit_event: params.auditEvent,
    };

    // Actor resolved inside logAuditTrail via server-side auth.getUser()
    const result = await logAuditTrail(
      "expenses",
      params.recordId,
      params.auditEvent === "DELETE" ? "DELETE" : "UPDATE",
      params.oldData,
      newDataWithEvent,
    );

    if (!result.success) {
      console.error(
        "[fireExpenseAuditLog]",
        params.auditEvent,
        result.error,
      );
    }
  })();
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
 * Sorted by Posting Date (`created_at` DESC) so new DRAFTs stay on top,
 * even when Document Date (`expense_date`) is a prior month.
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
        created_at,
        category_id,
        remark,
        grand_total,
        status,
        mst_expense_categories (
          category_name
        )
      `,
      )
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
        created_at: String(raw.created_at ?? ""),
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
 * Filter: `contacts.contact_roles @> ARRAY['Vendor']`
 * (legacy `contact_type` column was dropped — never query it).
 * Mirrors procurement `getActiveVendors` — kept in this module for Expense UI.
 */
export async function getExpenseVendors(): Promise<GetExpenseVendorsResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select("id, company_name")
      .contains("contact_roles", ["Vendor"])
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
 * Cross-realm safe File check — Next.js Server Actions may wrap uploads so
 * `instanceof File` is unreliable.
 */
function isReceiptUploadFile(value: unknown): value is File {
  if (value == null || typeof value !== "object") return false;
  const candidate = value as {
    size?: unknown;
    name?: unknown;
    arrayBuffer?: unknown;
    type?: unknown;
  };
  // Duck-type File/Blob — `instanceof File` can fail across Node/undici realms.
  const hasBuffer = typeof candidate.arrayBuffer === "function";
  const hasSize = typeof candidate.size === "number" && candidate.size > 0;
  if (!hasBuffer || !hasSize) return false;
  if (typeof candidate.name === "string" && candidate.name.length > 0) {
    return true;
  }
  // Blob-only payloads may omit `name` — still treat as uploadable file.
  return typeof candidate.type === "string";
}

function sanitizeReceiptFileName(fileName: string): string {
  return fileName
    .replace(/[^\w.\-ก-๙]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

type ExpenseAttachmentKind = "receipt" | "payment_slip";

function extensionForExpenseAttachment(
  file: File,
  mimeType: string,
): string {
  const fromName = file.name?.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "application/pdf") return "pdf";
  return "jpg";
}

/**
 * Upload raw File to `expense_documents` via supabaseAdmin only.
 * - receipt: `EXP-{timestamp}-{safeFileName}`
 * - payment_slip: `SLIP-{timestamp}.{ext}`
 */
async function uploadExpenseFileToStorage(
  file: File,
  kind: ExpenseAttachmentKind = "receipt",
): Promise<UploadExpenseReceiptResult> {
  try {
    const mimeType = (file.type || "").toLowerCase();
    if (mimeType && !ALLOWED_EXPENSE_ATTACHMENT_MIME.has(mimeType)) {
      return {
        data: null,
        error: `ประเภทไฟล์ไม่รองรับ (${mimeType || "unknown"}) — ใช้ JPG/PNG/WEBP/PDF`,
      };
    }

    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      return { data: null, error: "ไฟล์ใหญ่เกิน 10MB" };
    }

    const objectPath =
      kind === "payment_slip"
        ? `SLIP-${Date.now()}.${extensionForExpenseAttachment(file, mimeType)}`
        : `EXP-${Date.now()}-${sanitizeReceiptFileName(file.name || "receipt.jpg")}`;

    const supabaseAdmin = createSupabaseAdminClient();
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabaseAdmin.storage
      .from(EXPENSE_DOCUMENTS_BUCKET)
      .upload(objectPath, buffer, {
        contentType: mimeType || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      console.error("[uploadExpenseFileToStorage]", uploadError.message);
      return {
        data: null,
        error: uploadError.message ?? "อัปโหลดไฟล์ภาพขึ้น Storage ไม่สำเร็จ",
      };
    }

    const { data: publicData } = supabaseAdmin.storage
      .from(EXPENSE_DOCUMENTS_BUCKET)
      .getPublicUrl(objectPath);

    const url = publicData?.publicUrl?.trim();
    if (!url) {
      return {
        data: null,
        error: "อัปโหลดสำเร็จ แต่สร้าง URL ของไฟล์ไม่ได้",
      };
    }

    return { data: { url, path: objectPath }, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "อัปโหลดไฟล์ค่าใช้จ่ายไม่สำเร็จ";
    console.error("[uploadExpenseFileToStorage]", message);
    return { data: null, error: message };
  }
}

/** @deprecated Prefer uploadExpenseFileToStorage — kept for receipt callers. */
async function uploadReceiptFileToStorage(
  file: File,
): Promise<UploadExpenseReceiptResult> {
  return uploadExpenseFileToStorage(file, "receipt");
}

/**
 * Upload an expense receipt image to Storage bucket `expense_documents`.
 * Service Role only — Zero Client-Side Fetching.
 *
 * FormData keys: `receipt_file` (preferred) or `file`
 */
export async function uploadExpenseReceipt(
  formData: FormData,
): Promise<UploadExpenseReceiptResult> {
  const file =
    formData.get("receipt_file") ?? formData.get("file");
  if (!isReceiptUploadFile(file)) {
    return { data: null, error: "ไม่พบไฟล์ภาพสำหรับอัปโหลด" };
  }
  return uploadReceiptFileToStorage(file);
}

type ParsedExpenseDraftForm = {
  input: CreateDraftExpenseInput;
  receiptFile: File | null;
  /** When true, clear receipt_url even if no new file is provided. */
  clearReceipt: boolean;
  paymentSlipFile: File | null;
  /** When true, clear payment_slip_url even if no new file is provided. */
  clearPaymentSlip: boolean;
};

/**
 * Parse Manual Expense FormData (fields + optional receipt / payment slip files).
 */
function parseExpenseDraftFormData(formData: FormData): ParsedExpenseDraftForm {
  const receiptEntry =
    formData.get("receipt_file") ?? formData.get("file");
  const receiptFile = isReceiptUploadFile(receiptEntry) ? receiptEntry : null;
  const existingUrl = String(formData.get("receipt_url") ?? "").trim();
  const clearReceipt = String(formData.get("clear_receipt") ?? "") === "1";

  const slipEntry = formData.get("payment_slip_file");
  const paymentSlipFile = isReceiptUploadFile(slipEntry) ? slipEntry : null;
  const existingSlipUrl = String(
    formData.get("payment_slip_url") ?? "",
  ).trim();
  const clearPaymentSlip =
    String(formData.get("clear_payment_slip") ?? "") === "1";

  const paymentMethod = String(formData.get("payment_method") ?? "").trim();
  const bankAccountId = String(formData.get("bank_account_id") ?? "").trim();

  return {
    receiptFile,
    clearReceipt,
    paymentSlipFile,
    clearPaymentSlip,
    input: {
      category_id: String(formData.get("category_id") ?? "").trim(),
      vendor_id: String(formData.get("vendor_id") ?? "").trim(),
      expense_date: String(formData.get("expense_date") ?? "").trim(),
      net_amount: Number(formData.get("net_amount") ?? 0),
      vat_amount: Number(formData.get("vat_amount") ?? 0),
      payment_method: paymentMethod || null,
      bank_account_id:
        paymentMethod === "TRANSFER" && bankAccountId ? bankAccountId : null,
      remark: String(formData.get("remark") ?? "").trim() || null,
      // Prefer vendor_doc_no; accept document_number alias (OCR / form label).
      vendor_doc_no:
        String(
          formData.get("vendor_doc_no") ??
            formData.get("document_number") ??
            "",
        ).trim() || null,
      wht_type: String(formData.get("wht_type") ?? "").trim() || null,
      wht_rate: Number(formData.get("wht_rate") ?? 0),
      wht_amount: Number(formData.get("wht_amount") ?? 0),
      // Optional client-supplied value — verified server-side against grand_total - wht_amount
      net_payable:
        formData.get("net_payable") == null ||
        String(formData.get("net_payable")).trim() === ""
          ? undefined
          : Number(formData.get("net_payable")),
      receipt_url: existingUrl || null,
      payment_slip_url: existingSlipUrl || null,
      recorded_by: String(formData.get("recorded_by") ?? "").trim() || null,
    },
  };
}

/**
 * Resolve final receipt_url: upload new file → keep existing → or clear.
 */
async function resolveReceiptUrlFromForm(
  parsed: ParsedExpenseDraftForm,
): Promise<{ url: string | null; error: string | null }> {
  if (parsed.receiptFile) {
    const uploaded = await uploadExpenseFileToStorage(
      parsed.receiptFile,
      "receipt",
    );
    if (uploaded.error || !uploaded.data?.url) {
      return {
        url: null,
        error: uploaded.error ?? "อัปโหลดใบเสร็จขึ้น Storage ไม่สำเร็จ",
      };
    }
    return { url: uploaded.data.url, error: null };
  }

  if (parsed.clearReceipt) {
    return { url: null, error: null };
  }

  return { url: parsed.input.receipt_url ?? null, error: null };
}

/**
 * Resolve final payment_slip_url: upload SLIP-* → keep existing → or clear.
 */
async function resolvePaymentSlipUrlFromForm(
  parsed: ParsedExpenseDraftForm,
): Promise<{ url: string | null; error: string | null }> {
  if (parsed.paymentSlipFile) {
    const uploaded = await uploadExpenseFileToStorage(
      parsed.paymentSlipFile,
      "payment_slip",
    );
    if (uploaded.error || !uploaded.data?.url) {
      return {
        url: null,
        error: uploaded.error ?? "อัปโหลดสลิปโอนเงินขึ้น Storage ไม่สำเร็จ",
      };
    }
    return { url: uploaded.data.url, error: null };
  }

  if (parsed.clearPaymentSlip) {
    return { url: null, error: null };
  }

  return { url: parsed.input.payment_slip_url ?? null, error: null };
}

/**
 * Create a DRAFT expense from FormData (Late Numbering `DRAFT-…`).
 * Uploads `receipt_file` to `expense_documents` and persists `receipt_url`.
 */
export async function createDraftExpense(
  formData: FormData,
): Promise<CreateDraftExpenseResult> {
  try {
    const parsed = parseExpenseDraftFormData(formData);
    const plan = parseInstallmentsFromFormData(formData);
    if (plan.error) {
      return { data: null, error: plan.error };
    }

    const receipt = await resolveReceiptUrlFromForm(parsed);
    if (receipt.error) {
      return { data: null, error: receipt.error };
    }
    const paymentSlip = await resolvePaymentSlipUrlFromForm(parsed);
    if (paymentSlip.error) {
      return { data: null, error: paymentSlip.error };
    }

    // Authoritative URLs from Storage resolve — assign BEFORE validate/insert.
    const receiptUrl = receipt.url;
    const paymentSlipUrl = paymentSlip.url;

    if (parsed.paymentSlipFile && !paymentSlipUrl) {
      return {
        data: null,
        error: "อัปโหลดสลิปโอนเงินสำเร็จ แต่ไม่ได้ URL สำหรับบันทึก",
      };
    }

    const data: CreateDraftExpenseInput = {
      ...parsed.input,
      receipt_url: receiptUrl,
      payment_slip_url: paymentSlipUrl,
    };

    const supabaseAdmin = createSupabaseAdminClient();
    const validated = await validateExpenseDraftPayload(supabaseAdmin, data);
    if (validated.error || !validated.data) {
      return { data: null, error: validated.error ?? "ข้อมูลไม่ถูกต้อง" };
    }

    const v = validated.data;

    // Duplicate Invoice Early Warning (before INSERT)
    const dup = await findDuplicateExpense(supabaseAdmin, {
      vendorId: v.vendorId,
      expenseDate: v.expenseDate,
      vendorDocNo: v.vendorDocNo,
    });
    if (dup.error) {
      return { data: null, error: dup.error };
    }
    if (dup.isDuplicate) {
      return duplicateInvoiceResult();
    }

    // Late Numbering — Draft ID from CURRENT system time only.
    // Never pass v.expenseDate (receipt date) into the Draft number generator.
    const documentNo = generateDraftDocumentNo();

    const insertPayload = {
      document_no: documentNo,
      expense_date: v.expenseDate,
      category_id: v.categoryId,
      vendor_id: v.vendorId,
      vendor_doc_no: v.vendorDocNo,
      bank_account_id: v.bankAccountId,
      net_amount: v.netAmount,
      vat_amount: v.vatAmount,
      wht_type: v.whtType,
      wht_rate: v.whtRate,
      wht_amount: v.whtAmount,
      net_payable: v.netPayable,
      payment_method: v.paymentMethod,
      receipt_url: receiptUrl,
      // Strict write: use Storage-resolved URL (not a stale form field).
      payment_slip_url: paymentSlipUrl,
      status: "DRAFT" as const,
      remark: v.remark,
      recorded_by: data.recorded_by ?? null,
      is_installment: plan.isInstallment,
      total_interest_amount: plan.isInstallment
        ? toMoney(
            plan.installments.reduce(
              (sum, row) => sum + row.interest_amount,
              0,
            ),
          )
        : 0,
    };

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("expenses")
      .insert(insertPayload)
      .select(EXPENSE_ROW_SELECT)
      .single();

    if (insertError) {
      console.error("[createDraftExpense]", insertError.message);
      return (
        mapDuplicateExpenseError(insertError) ?? {
          data: null,
          error: insertError.message,
        }
      );
    }

    if (!inserted) {
      return { data: null, error: "insert returned no row" };
    }

    const mapped = mapExpenseRow(inserted as Record<string, unknown>);

    if (plan.isInstallment) {
      const sync = await replaceExpenseInstallments(
        supabaseAdmin,
        mapped.id,
        plan.installments,
      );
      if (sync.error) {
        return {
          data: null,
          error: `บันทึกบิลแล้ว แต่บันทึกงวดผ่อนไม่สำเร็จ: ${sync.error}`,
        };
      }
    }

    revalidateExpenseCaches(mapped.id);
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
  whtType: string | null;
  whtRate: number;
  whtAmount: number;
  /** Server-authoritative: grand_total - wht_amount */
  netPayable: number;
  paymentMethod: string | null;
  bankAccountId: string | null;
  remark: string | null;
  vendorDocNo: string | null;
  receiptUrl: string | null;
  paymentSlipUrl: string | null;
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

  const whtType =
    data.wht_type == null || !String(data.wht_type).trim()
      ? null
      : String(data.wht_type).trim();

  const whtRate = toMoney(data.wht_rate ?? 0);
  if (!Number.isFinite(whtRate) || whtRate < 0 || whtRate > 100) {
    return {
      data: null,
      error: "wht_rate must be a number between 0 and 100",
    };
  }

  const whtAmount = toMoney(data.wht_amount ?? 0);
  if (!Number.isFinite(whtAmount) || whtAmount < 0) {
    return {
      data: null,
      error: "wht_amount must be a number >= 0",
    };
  }

  // Mirror DB generated grand_total (= net_amount + vat_amount) for WHT guardrail
  const grandTotal = toMoney(netAmount + vatAmount);
  if (whtAmount > grandTotal + EXPENSE_MONEY_EPSILON) {
    return {
      data: null,
      error: "wht_amount ต้องไม่เกินยอดรวม (grand_total)",
    };
  }

  const expectedNetPayable = toMoney(grandTotal - whtAmount);

  // Guardrail: client net_payable (if provided) must equal grand_total - wht_amount
  if (data.net_payable != null && Number.isFinite(Number(data.net_payable))) {
    const clientNetPayable = toMoney(Number(data.net_payable));
    if (
      Math.abs(clientNetPayable - expectedNetPayable) > EXPENSE_MONEY_EPSILON
    ) {
      return {
        data: null,
        error: `net_payable ไม่ตรงกับ grand_total - wht_amount (คาดหวัง ${expectedNetPayable.toFixed(2)})`,
      };
    }
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
    .contains("contact_roles", ["Vendor"])
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

  const receiptUrl =
    data.receipt_url == null || !String(data.receipt_url).trim()
      ? null
      : String(data.receipt_url).trim();

  const paymentSlipUrl =
    data.payment_slip_url == null || !String(data.payment_slip_url).trim()
      ? null
      : String(data.payment_slip_url).trim();

  // TEXT column — trim only; empty → null (partial unique index skips null/blank)
  const vendorDocNo =
    data.vendor_doc_no == null || !String(data.vendor_doc_no).trim()
      ? null
      : String(data.vendor_doc_no).trim();

  return {
    data: {
      categoryId,
      vendorId,
      expenseDate,
      netAmount,
      vatAmount,
      whtType,
      whtRate,
      whtAmount,
      netPayable: expectedNetPayable,
      paymentMethod,
      bankAccountId:
        paymentMethod === "TRANSFER" ? bankAccountId : null,
      remark,
      vendorDocNo,
      receiptUrl,
      paymentSlipUrl,
    },
    error: null,
  };
}

/**
 * Update an existing DRAFT expense from FormData.
 * Uploads `receipt_file` (if present) and persists `receipt_url`.
 */
export async function updateDraftExpense(
  id: string,
  formData: FormData,
): Promise<UpdateDraftExpenseResult> {
  try {
    const expenseId = id?.trim() ?? "";
    if (!expenseId) {
      return { data: null, error: "ไม่พบรหัสเอกสารค่าใช้จ่าย" };
    }

    const parsed = parseExpenseDraftFormData(formData);
    const plan = parseInstallmentsFromFormData(formData);
    if (plan.error) {
      return { data: null, error: plan.error };
    }

    const receipt = await resolveReceiptUrlFromForm(parsed);
    if (receipt.error) {
      return { data: null, error: receipt.error };
    }
    const paymentSlip = await resolvePaymentSlipUrlFromForm(parsed);
    if (paymentSlip.error) {
      return { data: null, error: paymentSlip.error };
    }

    // Authoritative URLs from Storage resolve — assign BEFORE validate/update.
    const receiptUrl = receipt.url;
    const paymentSlipUrl = paymentSlip.url;

    if (parsed.paymentSlipFile && !paymentSlipUrl) {
      return {
        data: null,
        error: "อัปโหลดสลิปโอนเงินสำเร็จ แต่ไม่ได้ URL สำหรับบันทึก",
      };
    }

    const payload: UpdateDraftExpenseInput = {
      ...parsed.input,
      receipt_url: receiptUrl,
      payment_slip_url: paymentSlipUrl,
    };

    const supabaseAdmin = createSupabaseAdminClient();

    const { data: before, error: beforeError } = await supabaseAdmin
      .from("expenses")
      .select(EXPENSE_ROW_SELECT)
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

    // Duplicate Invoice Early Warning (before UPDATE) — exclude self
    const dup = await findDuplicateExpense(supabaseAdmin, {
      vendorId: v.vendorId,
      expenseDate: v.expenseDate,
      vendorDocNo: v.vendorDocNo,
      excludeId: expenseId,
    });
    if (dup.error) {
      return { data: null, error: dup.error };
    }
    if (dup.isDuplicate) {
      return duplicateInvoiceResult();
    }

    const nowIso = new Date().toISOString();

    const updatePayload = {
      expense_date: v.expenseDate,
      category_id: v.categoryId,
      vendor_id: v.vendorId,
      vendor_doc_no: v.vendorDocNo,
      bank_account_id: v.bankAccountId,
      net_amount: v.netAmount,
      vat_amount: v.vatAmount,
      wht_type: v.whtType,
      wht_rate: v.whtRate,
      wht_amount: v.whtAmount,
      net_payable: v.netPayable,
      payment_method: v.paymentMethod,
      remark: v.remark,
      receipt_url: receiptUrl,
      // Strict write: use Storage-resolved URL (not a stale form field).
      payment_slip_url: paymentSlipUrl,
      is_installment: plan.isInstallment,
      total_interest_amount: plan.isInstallment
        ? toMoney(
            plan.installments.reduce(
              (sum, row) => sum + row.interest_amount,
              0,
            ),
          )
        : 0,
      updated_at: nowIso,
    };

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("expenses")
      .update(updatePayload)
      .eq("id", expenseId)
      .eq("status", "DRAFT")
      .select(EXPENSE_ROW_SELECT)
      .maybeSingle();

    if (updateError) {
      console.error("[updateDraftExpense]", updateError.message);
      return (
        mapDuplicateExpenseError(updateError) ?? {
          data: null,
          error: updateError.message,
        }
      );
    }
    if (!updated) {
      return {
        data: null,
        error: "อัปเดต Draft ไม่สำเร็จ (อาจถูก Issue/Void ไปแล้ว)",
      };
    }

    const sync = await replaceExpenseInstallments(
      supabaseAdmin,
      expenseId,
      plan.isInstallment ? plan.installments : [],
    );
    if (sync.error) {
      return {
        data: null,
        error: `อัปเดตบิลแล้ว แต่บันทึกงวดผ่อนไม่สำเร็จ: ${sync.error}`,
      };
    }

    const mapped = mapExpenseRow(updated as Record<string, unknown>);
    fireExpenseAuditLog({
      recordId: expenseId,
      auditEvent: "UPDATE",
      oldData: before as Record<string, unknown>,
      newData: mapped as unknown as Record<string, unknown>,
    });

    revalidateExpenseCaches(expenseId);
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
    // Must include payment_slip_url (+ WHT) — explicit column lists strip omitted fields.
    const { data, error } = await supabaseAdmin
      .from("expenses")
      .select(
        `
        ${EXPENSE_ROW_SELECT},
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

    const { data: installmentRows, error: installmentError } =
      await supabaseAdmin
        .from("expense_installments")
        .select(
          "id, expense_id, installment_period, due_date, principal_amount, interest_amount, total_installment, is_paid, paid_date, payment_transaction_id",
        )
        .eq("expense_id", expenseId)
        .order("installment_period", { ascending: true });

    if (installmentError) {
      console.error("[getExpenseById][installments]", installmentError.message);
      return { data: null, error: installmentError.message };
    }

    const txIds = Array.from(
      new Set(
        (installmentRows ?? [])
          .map((row) =>
            row.payment_transaction_id == null
              ? ""
              : String(row.payment_transaction_id),
          )
          .filter((id) => id.length > 0),
      ),
    );

    const slipByTxId = new Map<string, string | null>();
    if (txIds.length > 0) {
      const { data: txRows, error: txError } = await supabaseAdmin
        .from("payment_transactions")
        .select("id, attachment_url")
        .in("id", txIds);

      if (txError) {
        console.error("[getExpenseById][payment_tx]", txError.message);
        return { data: null, error: txError.message };
      }

      for (const tx of txRows ?? []) {
        slipByTxId.set(
          String(tx.id),
          tx.attachment_url == null ? null : String(tx.attachment_url),
        );
      }
    }

    return {
      data: {
        ...base,
        category_name: category?.category_name?.trim() || "—",
        vendor_name: vendor?.company_name?.trim() || "—",
        bank_account_label: bankLabel,
        installments: (installmentRows ?? []).map((row) => {
          const mapped = mapInstallmentRow(row as Record<string, unknown>);
          const txId = mapped.payment_transaction_id;
          return {
            ...mapped,
            slip_url: txId ? (slipByTxId.get(txId) ?? null) : null,
          };
        }),
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
 * Maker — ส่ง Expense เข้าคิวอนุมัติ (grand_total > threshold).
 * คง status = DRAFT · ตั้ง approval_status = PENDING เท่านั้น (ไม่ ISSUED / ไม่รันเลข)
 */
export async function sendExpenseForApproval(
  id: string,
): Promise<MutateExpenseResult> {
  try {
    const expenseId = id?.trim() ?? "";
    if (!expenseId) {
      return { data: null, error: "ไม่พบรหัสเอกสารค่าใช้จ่าย" };
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: before, error: beforeError } = await supabaseAdmin
      .from("expenses")
      .select(
        "id, document_no, expense_date, grand_total, status, approval_status, remark",
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
        error: `ส่งขออนุมัติได้เฉพาะสถานะ DRAFT (ปัจจุบัน: ${before.status})`,
      };
    }
    if (!requiresExpenseApproval(before.grand_total)) {
      return {
        data: null,
        error: `ยอดไม่เกิน ${EXPENSE_APPROVAL_THRESHOLD.toLocaleString("th-TH")} บาท — ใช้ออกเอกสาร (Issue) ได้โดยตรง`,
      };
    }

    const currentApproval = String(before.approval_status ?? "APPROVED");
    if (currentApproval === "PENDING") {
      return {
        data: null,
        error: "เอกสารนี้อยู่ในคิวรออนุมัติแล้ว",
      };
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("expenses")
      .update({
        approval_status: "PENDING",
        approved_by: null,
        approved_at: null,
        updated_at: nowIso,
      })
      .eq("id", expenseId)
      .eq("status", "DRAFT")
      .select(EXPENSE_ROW_SELECT)
      .maybeSingle();

    if (updateError) {
      return { data: null, error: updateError.message };
    }
    if (!updated) {
      return {
        data: null,
        error: "ส่งขออนุมัติไม่สำเร็จ (อาจถูกแก้ไขไปแล้ว)",
      };
    }

    const mapped = mapExpenseRow(updated as Record<string, unknown>);
    fireExpenseAuditLog({
      recordId: expenseId,
      auditEvent: "UPDATE",
      oldData: before as Record<string, unknown>,
      newData: {
        ...mapped,
        status: "DRAFT",
        approval_status: "PENDING",
        audit_event_detail: "SEND_FOR_APPROVAL",
      },
    });

    revalidateExpenseCaches(expenseId);
    revalidateApprovalCenterIfPending(true);

    return {
      data: mapped,
      error: null,
      pending_approval: true,
      successMessage: PENDING_APPROVAL_TOAST_MESSAGE,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ส่งขออนุมัติไม่สำเร็จ";
    console.error("[sendExpenseForApproval]", message);
    return { data: null, error: message };
  }
}

/**
 * Confirm DRAFT → ISSUED and assign EXP-YYMM-XXXX via generate_expense_no.
 * YYMM bucket uses CURRENT_DATE at ISSUE time (not expense_date) — see RPC.
 * Guardrail: grand_total > threshold ต้องใช้ sendExpenseForApproval แทน
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
        "id, document_no, expense_date, category_id, vendor_id, bank_account_id, net_amount, vat_amount, grand_total, payment_method, status, approval_status, remark",
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

    if (requiresExpenseApproval(before.grand_total)) {
      return {
        data: null,
        error:
          "ยอดเกินเกณฑ์อนุมัติ — กรุณาใช้ปุ่ม ส่งขออนุมัติ แทนการออกเอกสารโดยตรง",
      };
    }

    const approvalStatus = String(before.approval_status ?? "APPROVED");
    if (approvalStatus === "PENDING" || approvalStatus === "REJECTED") {
      return {
        data: null,
        error:
          approvalStatus === "PENDING"
            ? "เอกสารรออนุมัติอยู่ — ยังออกเอกสารไม่ได้"
            : "เอกสารถูกปฏิเสธ — กรุณาส่งขออนุมัติใหม่ก่อนออกเอกสาร",
      };
    }

    const nowIso = new Date().toISOString();
    let officialNo = String(before.document_no ?? "");
    const expenseDate = String(before.expense_date ?? "").slice(0, 10);

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

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("expenses")
      .update({
        document_no: officialNo,
        status: "ISSUED",
        approval_status: "APPROVED",
        approved_by: null,
        approved_at: null,
        updated_at: nowIso,
      })
      .eq("id", expenseId)
      .eq("status", "DRAFT")
      .select(EXPENSE_ROW_SELECT)
      .maybeSingle();

    if (updateError) {
      return (
        mapDuplicateExpenseError(updateError) ?? {
          data: null,
          error: updateError.message,
        }
      );
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
      auditEvent: "ISSUE",
      oldData: before as Record<string, unknown>,
      newData: {
        ...mapped,
        status: "ISSUED",
        document_no: officialNo,
        approval_status: "APPROVED",
      },
    });

    revalidateExpenseCaches(expenseId);

    return {
      data: mapped,
      error: null,
      pending_approval: false,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ออกเอกสารค่าใช้จ่ายไม่สำเร็จ";
    console.error("[issueExpense]", message);
    return { data: null, error: message };
  }
}

/**
 * Hard-delete a DRAFT expense row (Late Numbering cleanup).
 * ISSUED documents must use `voidExpense` instead — never hard-delete.
 */
export async function deleteDraftExpense(
  id: string,
): Promise<MutateExpenseResult> {
  try {
    const expenseId = id?.trim() ?? "";
    if (!expenseId) {
      return { data: null, error: "ไม่พบรหัสเอกสารค่าใช้จ่าย" };
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: before, error: beforeError } = await supabaseAdmin
      .from("expenses")
      .select(EXPENSE_ROW_SELECT)
      .eq("id", expenseId)
      .maybeSingle();

    if (beforeError) {
      return { data: null, error: beforeError.message };
    }
    if (!before) {
      return { data: null, error: "ไม่พบเอกสารค่าใช้จ่าย" };
    }
    if (String(before.status).toUpperCase() !== "DRAFT") {
      return {
        data: null,
        error: `ลบได้เฉพาะสถานะ DRAFT (ปัจจุบัน: ${before.status}) — เอกสาร ISSUED ต้องใช้ยกเลิก (Void)`,
      };
    }

    const mapped = mapExpenseRow(before as Record<string, unknown>);

    const { error: deleteError } = await supabaseAdmin
      .from("expenses")
      .delete()
      .eq("id", expenseId)
      .eq("status", "DRAFT");

    if (deleteError) {
      console.error("[deleteDraftExpense]", deleteError.message);
      return { data: null, error: deleteError.message };
    }

    fireExpenseAuditLog({
      recordId: expenseId,
      auditEvent: "DELETE",
      oldData: before as Record<string, unknown>,
      newData: { deleted: true, document_no: mapped.document_no },
    });

    revalidateExpenseCaches(expenseId);
    return { data: mapped, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ลบเอกสารร่างค่าใช้จ่ายไม่สำเร็จ";
    console.error("[deleteDraftExpense]", message);
    return { data: null, error: message };
  }
}

/**
 * Void an ISSUED expense → VOID (row retained for audit).
 * DRAFT documents must use `deleteDraftExpense` (hard delete) instead.
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
    if (String(before.status).toUpperCase() !== "ISSUED") {
      return {
        data: null,
        error: `ยกเลิกได้เฉพาะสถานะ ISSUED (ปัจจุบัน: ${before.status}) — เอกสาร DRAFT ต้องใช้ลบเอกสารร่าง`,
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
      .eq("status", "ISSUED")
      .select(EXPENSE_ROW_SELECT)
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
      auditEvent: "VOID",
      oldData: before as Record<string, unknown>,
      newData: { ...mapped, status: "VOID" },
    });

    revalidateExpenseCaches(expenseId);
    return { data: mapped, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ยกเลิกเอกสารค่าใช้จ่ายไม่สำเร็จ";
    console.error("[voidExpense]", message);
    return { data: null, error: message };
  }
}

/**
 * Record payout for one expense installment (simulated transaction).
 *
 * Cloud schema has no PAYOUT / COMPLETED columns on `payment_transactions`.
 * Mapping:
 * - payout type → PAY document + `reference_no = PAYOUT`
 * - slip_url → `attachment_url`
 * - amount → `expense_installments.total_installment`
 */
export async function payExpenseInstallment(
  installmentId: string,
  payload: PayExpenseInstallmentPayload,
): Promise<PayExpenseInstallmentResult> {
  try {
    const id = installmentId?.trim() ?? "";
    if (!id) {
      return { success: false, error: "ไม่พบรหัสงวดผ่อนชำระ" };
    }

    const paidDate = String(payload?.paid_date ?? "").trim();
    const bankAccountId = String(payload?.bank_account_id ?? "").trim();
    let slipUrl = String(payload?.slip_url ?? "").trim() || null;

    if (!slipUrl && isReceiptUploadFile(payload?.slip_file)) {
      const uploaded = await uploadExpenseFileToStorage(
        payload.slip_file,
        "payment_slip",
      );
      if (uploaded.error || !uploaded.data) {
        return {
          success: false,
          error: uploaded.error ?? "อัปโหลดสลิปโอนเงินไม่สำเร็จ",
        };
      }
      slipUrl = uploaded.data.url;
    }

    if (!isIsoDate(paidDate)) {
      return { success: false, error: "วันที่จ่ายไม่ถูกต้อง" };
    }
    if (!bankAccountId) {
      return { success: false, error: "กรุณาเลือกสมุดบัญชีธนาคาร" };
    }

    const supabaseAdmin = createSupabaseAdminClient();

    const { data: installment, error: installmentError } = await supabaseAdmin
      .from("expense_installments")
      .select(
        "id, expense_id, installment_period, total_installment, is_paid, payment_transaction_id",
      )
      .eq("id", id)
      .maybeSingle();

    if (installmentError) {
      return { success: false, error: installmentError.message };
    }
    if (!installment) {
      return { success: false, error: "ไม่พบงวดผ่อนชำระ" };
    }
    if (Boolean(installment.is_paid) || installment.payment_transaction_id) {
      return { success: false, error: "งวดนี้ชำระแล้ว" };
    }

    const expenseId = String(installment.expense_id);
    const amount = toMoney(Number(installment.total_installment ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: "ยอดรวมงวดไม่ถูกต้อง" };
    }

    const { data: expense, error: expenseError } = await supabaseAdmin
      .from("expenses")
      .select("id, document_no, status, vendor_id")
      .eq("id", expenseId)
      .maybeSingle();

    if (expenseError) {
      return { success: false, error: expenseError.message };
    }
    if (!expense) {
      return { success: false, error: "ไม่พบเอกสารค่าใช้จ่าย" };
    }
    if (String(expense.status).toUpperCase() !== "ISSUED") {
      return {
        success: false,
        error: "บันทึกจ่ายได้เฉพาะเอกสารสถานะ ISSUED",
      };
    }

    const { data: bank, error: bankError } = await supabaseAdmin
      .from("mst_bank_accounts")
      .select("id")
      .eq("id", bankAccountId)
      .eq("is_active", true)
      .maybeSingle();

    if (bankError) {
      return { success: false, error: bankError.message };
    }
    if (!bank) {
      return { success: false, error: "ไม่พบสมุดบัญชีธนาคารที่เลือก" };
    }

    const numberResult = await generateDocumentNumber("PAY", paidDate);
    if (!numberResult.data) {
      return {
        success: false,
        error: numberResult.error ?? "สร้างเลขที่เอกสาร PAY ไม่สำเร็จ",
      };
    }

    const nowIso = new Date().toISOString();
    const paymentDateIso = `${paidDate}T00:00:00.000Z`;
    const period = Number(installment.installment_period ?? 0);
    const notes = `PAYOUT | Expense ${String(expense.document_no)} | งวดที่ ${period}`;

    const { data: payDoc, error: payDocError } = await supabaseAdmin
      .from("documents")
      .insert({
        doc_no: numberResult.data,
        doc_type: "PAY",
        status: "COMPLETED",
        doc_date: paidDate,
        contact_id: expense.vendor_id,
        sub_total: amount,
        discount_amount: 0,
        tax_rate: 0,
        tax_amount: 0,
        wht_rate: 0,
        wht_amount: 0,
        grand_total: amount,
        total_amount: amount,
        net_before_vat: amount,
        vat_amount: 0,
        vat_rate: 0,
        vat_type: "NONE",
        paid_amount: amount,
        payment_status: "PAID",
        attachment_url: slipUrl,
        attached_file_url: slipUrl,
        notes,
        updated_at: nowIso,
      })
      .select("id")
      .single();

    if (payDocError || !payDoc) {
      return {
        success: false,
        error: payDocError?.message ?? "สร้างเอกสารจ่าย (PAY) ไม่สำเร็จ",
      };
    }

    const payDocId = String(payDoc.id);

    const { data: tx, error: txError } = await supabaseAdmin
      .from("payment_transactions")
      .insert({
        document_id: payDocId,
        payment_method: "BANK_TRANSFER",
        bank_account_id: bankAccountId,
        amount,
        reference_no: "PAYOUT",
        payment_date: paymentDateIso,
        attachment_url: slipUrl,
        is_reconciled: false,
        is_voided: false,
      })
      .select("id")
      .single();

    if (txError || !tx) {
      await supabaseAdmin.from("documents").delete().eq("id", payDocId);
      return {
        success: false,
        error: txError?.message ?? "บันทึก payment_transactions ไม่สำเร็จ",
      };
    }

    const txId = String(tx.id);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("expense_installments")
      .update({
        is_paid: true,
        paid_date: paidDate,
        payment_transaction_id: txId,
      })
      .eq("id", id)
      .eq("is_paid", false)
      .select("id")
      .maybeSingle();

    if (updateError || !updated) {
      await supabaseAdmin.from("payment_transactions").delete().eq("id", txId);
      await supabaseAdmin.from("documents").delete().eq("id", payDocId);
      return {
        success: false,
        error:
          updateError?.message ??
          "อัปเดตสถานะงวดไม่สำเร็จ (อาจถูกจ่ายไปแล้ว)",
      };
    }

    revalidateExpenseCaches(expenseId);
    revalidatePath("/finance");
    revalidatePath("/finance/ap-payment");

    return { success: true, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "บันทึกจ่ายงวดผ่อนไม่สำเร็จ";
    console.error("[payExpenseInstallment]", message);
    return { success: false, error: message };
  }
}
