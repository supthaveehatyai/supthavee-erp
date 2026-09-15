"use server";

/**
 * Refund Management — คืนเงินมัดจำ (AR_REFUND / AP_REFUND).
 * Zero Client-Side Fetching: Service Role via `createSupabaseServerClient()`.
 *
 * Schema mapping (do not invent columns):
 * - Header → `documents` (`doc_type` = AR_REFUND | AP_REFUND)
 * - ไม่บันทึก `document_items` (FINANCE_HEADER_ONLY)
 * - Link  → `document_allocations`
 *     receipt_doc_id  = ใบ Refund
 *     invoice_doc_id  = บิลมัดจำต้นทาง (DEP_IN / DEP_OUT)
 *       หมายเหตุ: ตารางนี้ไม่มีคอลัมน์ `document_id` — ใช้ `invoice_doc_id`
 * - ยอดคงเหลือมัดจำ = documents.grand_total − Σ allocated_amount
 *   (`documents` ไม่มีคอลัมน์ allocated_amount)
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { exceedsApprovalLimit } from "@/lib/approval/approval-rules";
import { revalidateApprovalCenterIfPending } from "@/lib/approval/revalidate-approval";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import { generateDocumentNumber } from "@/lib/actions/document-actions";
import { resolveIssuedDocumentStatus } from "@/lib/constants/document";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { generateDraftDocumentNo } from "@/lib/utils/draft-document-no";
import type { Json } from "@/src/types/supabase";
import type { DocumentType } from "@/types/document";
import {
  calculateDocumentSummary,
  isVatCalculationType,
  type VatCalculationType,
} from "@/lib/utils/document-summary";
import { todayIsoDate } from "@/lib/utils/outstanding-summary";
import { roundMoney } from "@/lib/utils/payment-fifo";
import {
  CASH_ACCOUNT_SENTINEL,
  createRefundDocumentSchema,
} from "@/lib/validations/refund";
import type {
  CreateRefundDocumentPayload,
  CreateRefundDocumentResult,
  GetAvailableDepositsResult,
  GetRefundPartiesResult,
  RefundDocType,
  RefundPartyOption,
  RefundableDeposit,
  RefundSide,
} from "@/types/refund";

const MONEY_EPS = 0.02;
const DEFAULT_VAT_RATE = 7;
const REFUND_ADJUSTMENT_REASON = "REFUND";
const DOCUMENT_ATTACHMENTS_BUCKET = "document_attachments";
const ALLOWED_SLIP_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

const DEPOSIT_ALLOCATION_EMBED = `
  allocations:document_allocations!document_allocations_invoice_doc_id_fkey (
    allocated_amount
  )
`;

type NestedAllocationRow = {
  allocated_amount?: number | string | null;
};

type ContactJoin = {
  id?: string;
  company_name?: string | null;
};

type DepositDocRow = {
  id: string;
  doc_no: string | null;
  doc_date: string | null;
  doc_type: string | null;
  contact_id: string | null;
  grand_total: number | string | null;
  deposit_deducted: number | string | null;
  vat_type: string | null;
  vat_rate: number | string | null;
  status: string | null;
  is_voided: boolean | null;
  allocations?: NestedAllocationRow[] | NestedAllocationRow | null;
  contacts?: ContactJoin | ContactJoin[] | null;
};

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function unwrapContact(
  value: ContactJoin | ContactJoin[] | null | undefined,
): ContactJoin | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function coerceCreatePayload(raw: unknown): {
  fields: unknown;
  slipFile: File | null;
} {
  if (raw instanceof FormData) {
    const slip = raw.get("slip_file");
    return {
      fields: {
        type: String(raw.get("type") ?? "").trim(),
        contact_id: String(raw.get("contact_id") ?? "").trim(),
        deposit_id: String(raw.get("deposit_id") ?? "").trim(),
        amount: raw.get("amount"),
        remark: String(raw.get("remark") ?? "").trim() || null,
        document_date: String(raw.get("document_date") ?? "").trim() || null,
        bank_account_id: String(raw.get("bank_account_id") ?? "").trim(),
      },
      slipFile: slip instanceof File && slip.size > 0 ? slip : null,
    };
  }

  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const slip = obj.slip_file;
    return {
      fields: {
        type: obj.type,
        contact_id: obj.contact_id,
        deposit_id: obj.deposit_id,
        amount: obj.amount,
        remark: obj.remark,
        document_date: obj.document_date,
        bank_account_id: obj.bank_account_id,
      },
      slipFile: slip instanceof File && slip.size > 0 ? slip : null,
    };
  }

  return { fields: raw, slipFile: null };
}

async function uploadRefundSlip(
  supabase: SupabaseClient,
  file: File,
): Promise<{ url: string; path: string } | { error: string }> {
  const mimeType = (file.type || "").toLowerCase();
  if (mimeType && !ALLOWED_SLIP_MIME_TYPES.has(mimeType)) {
    return {
      error: `ประเภทไฟล์ไม่รองรับ (${mimeType || "unknown"}) — ใช้ JPG/PNG/WEBP/GIF/PDF`,
    };
  }

  const maxBytes = 10 * 1024 * 1024;
  if (file.size > maxBytes) {
    return { error: "ไฟล์สลิปใหญ่เกิน 10MB" };
  }

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const safeName = file.name
    .replace(/[^\w.\-ก-๙]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
  const extFromName = safeName.includes(".")
    ? safeName.slice(safeName.lastIndexOf("."))
    : mimeType === "application/pdf"
      ? ".pdf"
      : mimeType === "image/png"
        ? ".png"
        : mimeType === "image/webp"
          ? ".webp"
          : mimeType === "image/gif"
            ? ".gif"
            : ".jpg";
  const objectPath = `refunds/${yyyy}/${mm}/${crypto.randomUUID()}${extFromName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_ATTACHMENTS_BUCKET)
    .upload(objectPath, buffer, {
      contentType: mimeType || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return {
      error: uploadError.message ?? "อัปโหลดสลิปขึ้น Storage ไม่สำเร็จ",
    };
  }

  const { data: publicData } = supabase.storage
    .from(DOCUMENT_ATTACHMENTS_BUCKET)
    .getPublicUrl(objectPath);

  const url = publicData?.publicUrl?.trim();
  if (!url) {
    return { error: "อัปโหลดสลิปสำเร็จ แต่สร้าง URL ไม่ได้" };
  }

  return { url, path: objectPath };
}

function firstZodMessage(error: {
  issues: Array<{ message: string }>;
}): string {
  return error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง";
}

function resolveDepositDocType(side: RefundSide): "DEP_IN" | "DEP_OUT" {
  return side === "AR" ? "DEP_IN" : "DEP_OUT";
}

function resolveRefundDocType(side: RefundSide): RefundDocType {
  return side === "AR" ? "AR_REFUND" : "AP_REFUND";
}

function normalizeVatType(raw: string | null | undefined): VatCalculationType {
  const value = String(raw ?? "NONE").trim();
  return isVatCalculationType(value) ? value : "NONE";
}

function normalizeVatRate(
  raw: number | string | null | undefined,
  vatType: VatCalculationType,
): number {
  if (vatType === "NONE") return 0;
  const n = Number(raw ?? DEFAULT_VAT_RATE);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_VAT_RATE;
  return n;
}

function unwrapAllocations(
  rows: NestedAllocationRow[] | NestedAllocationRow | null | undefined,
): NestedAllocationRow[] {
  if (rows == null) return [];
  return Array.isArray(rows) ? rows : [rows];
}

function sumAllocatedAmount(
  rows: NestedAllocationRow[] | NestedAllocationRow | null | undefined,
  depositDeducted: number,
): number {
  const fromAlloc = roundMoney(
    unwrapAllocations(rows).reduce(
      (sum, row) => sum + toMoney(row.allocated_amount),
      0,
    ),
  );
  return roundMoney(Math.max(fromAlloc, depositDeducted));
}

/**
 * ยอดคืนเงิน = grand_total ของใบ Refund
 * สืบทอด vat_type / vat_rate จากมัดจำต้นทาง แล้วถอด VAT จากยอดรวมอัตโนมัติ
 * (ยอดคงเหลือมัดจำเป็นยอดรวมภาษีแล้ว — ใช้สูตร INCLUSIVE ในการแยกฐาน)
 */
function inheritVatFromDeposit(params: {
  refundGrand: number;
  vatType: VatCalculationType;
  vatRate: number;
}): {
  net_before_vat: number;
  vat_amount: number;
  grand_total: number;
  vat_type: VatCalculationType;
  vat_rate: number;
} {
  const { refundGrand, vatType, vatRate } = params;
  if (vatType === "NONE" || vatRate <= 0) {
    return {
      net_before_vat: refundGrand,
      vat_amount: 0,
      grand_total: refundGrand,
      vat_type: "NONE",
      vat_rate: 0,
    };
  }

  const summary = calculateDocumentSummary({
    lineTotals: [refundGrand],
    discountText: null,
    vatType: "INCLUSIVE",
    vatRate,
  });

  return {
    net_before_vat: summary.net_before_vat,
    vat_amount: summary.vat_amount,
    grand_total: refundGrand,
    vat_type: vatType,
    vat_rate: vatRate,
  };
}

function mapRefundableDeposit(
  row: DepositDocRow,
  contactId: string,
  expectedDocType: "DEP_IN" | "DEP_OUT",
): RefundableDeposit | null {
  if (row.is_voided === true) return null;
  const vatType = normalizeVatType(row.vat_type);
  const allocatedAmount = sumAllocatedAmount(
    row.allocations,
    toMoney(row.deposit_deducted),
  );
  const grandTotal = roundMoney(toMoney(row.grand_total));
  const remaining = roundMoney(grandTotal - allocatedAmount);
  if (remaining <= MONEY_EPS) return null;

  return {
    id: String(row.id),
    doc_no: row.doc_no?.trim() || "ไม่ระบุ",
    document_date: row.doc_date ? String(row.doc_date) : "",
    doc_type: expectedDocType,
    contact_id: row.contact_id?.trim() || contactId,
    grand_total: grandTotal,
    allocated_amount: allocatedAmount,
    remaining_balance: remaining,
    vat_type: vatType,
    vat_rate: normalizeVatRate(row.vat_rate, vatType),
  };
}

async function loadAllocatedMap(
  supabaseAdmin: SupabaseClient,
  depositIds: string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (depositIds.length === 0) return totals;

  const { data, error } = await supabaseAdmin
    .from("document_allocations")
    .select("invoice_doc_id, allocated_amount")
    .in("invoice_doc_id", depositIds);

  if (error) {
    throw new Error(error.message);
  }

  for (const row of data ?? []) {
    const id = String(row.invoice_doc_id ?? "").trim();
    if (!id) continue;
    totals.set(
      id,
      roundMoney((totals.get(id) ?? 0) + toMoney(row.allocated_amount)),
    );
  }
  return totals;
}

async function loadMakerApprovalLimit(
  supabaseAdmin: SupabaseClient,
  actorId: string,
): Promise<{ ok: true; approvalLimit: number } | { ok: false; error: string }> {
  const { data: profile, error } = await supabaseAdmin
    .from("user_profiles")
    .select("id, approval_limit")
    .eq("id", actorId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!profile) {
    return { ok: false, error: "ไม่พบโปรไฟล์ผู้ใช้งาน" };
  }

  const limit = Number(profile.approval_limit ?? 0);
  return {
    ok: true,
    approvalLimit: Number.isFinite(limit) && limit >= 0 ? limit : 0,
  };
}

async function rollbackRefund(
  supabaseAdmin: SupabaseClient,
  refundId: string,
  depositId: string | null,
  previousDepositDeducted: number | null,
  slipStoragePath?: string | null,
): Promise<void> {
  const nowIso = new Date().toISOString();
  if (depositId && previousDepositDeducted != null) {
    await supabaseAdmin
      .from("documents")
      .update({
        deposit_deducted: previousDepositDeducted,
        updated_at: nowIso,
      })
      .eq("id", depositId);
  }
  await supabaseAdmin
    .from("payment_transactions")
    .delete()
    .eq("document_id", refundId);
  await supabaseAdmin
    .from("document_allocations")
    .delete()
    .eq("receipt_doc_id", refundId);
  await supabaseAdmin.from("documents").delete().eq("id", refundId);
  if (slipStoragePath) {
    await supabaseAdmin.storage
      .from(DOCUMENT_ATTACHMENTS_BUCKET)
      .remove([slipStoragePath]);
  }
}

function toAuditJson(
  value: Record<string, unknown> | null | undefined,
): Json | null {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as Json;
  } catch {
    return null;
  }
}

/**
 * บันทึก `audit_logs` สำหรับตาราง `documents`
 * คอลัมน์ผู้ใช้ใน schema คือ `changed_by` (ไม่มี `user_id`) — ใส่ Auth Session ปัจจุบันเสมอ
 */
async function writeDocumentsAuditLog(
  supabaseAdmin: SupabaseClient,
  params: {
    actorUserId: string;
    actorName?: string | null;
    recordId: string;
    action: "INSERT" | "UPDATE";
    oldData?: Record<string, unknown> | null;
    newData: Record<string, unknown>;
  },
): Promise<{ error: string | null }> {
  const recordId = params.recordId.trim();
  const actorUserId = params.actorUserId.trim();
  if (!recordId) return { error: "record_id is required" };
  if (!actorUserId) {
    return { error: "ไม่พบ user จาก Auth Session สำหรับ audit_logs" };
  }

  const newData = toAuditJson(params.newData);
  if (newData == null) {
    return { error: "new_data ของ audit_logs ไม่สามารถแปลงเป็น JSON ได้" };
  }

  const { error } = await supabaseAdmin.from("audit_logs").insert({
    table_name: "documents",
    record_id: recordId,
    action: params.action,
    old_data: toAuditJson(params.oldData ?? null),
    new_data: newData,
    changed_by: actorUserId,
    changed_by_name: params.actorName?.trim()?.slice(0, 100) || null,
  });

  if (error) {
    console.error("[createRefundDocument][audit_logs]", error.message);
    return { error: error.message };
  }

  return { error: null };
}

/**
 * มัดจำคงเหลือของคู่ค้า สำหรับฟอร์มคืนเงิน
 * AR → DEP_IN · AP → DEP_OUT · status = ISSUED · remaining > 0
 */
export async function getAvailableDeposits(
  type: RefundSide,
  contactId: string,
): Promise<GetAvailableDepositsResult> {
  try {
    if (type !== "AR" && type !== "AP") {
      return {
        success: false,
        data: [],
        error: "ประเภทการคืนเงินต้องเป็น AR หรือ AP",
      };
    }

    const trimmed = contactId?.trim() ?? "";
    if (!trimmed) {
      return { success: false, data: [], error: "ต้องระบุรหัสคู่ค้า" };
    }

    const supabaseAdmin = createSupabaseServerClient();
    const depositDocType = resolveDepositDocType(type);
    const selectWithAlloc = `
        id,
        doc_no,
        doc_date,
        doc_type,
        contact_id,
        grand_total,
        deposit_deducted,
        vat_type,
        vat_rate,
        status,
        is_voided,
        ${DEPOSIT_ALLOCATION_EMBED}
      `;

    let { data, error } = await supabaseAdmin
      .from("documents")
      .select(selectWithAlloc)
      .eq("contact_id", trimmed)
      .eq("doc_type", depositDocType)
      .eq("status", "ISSUED")
      .or("is_voided.is.null,is_voided.eq.false")
      .order("doc_date", { ascending: true });

    let rows = (data ?? []) as DepositDocRow[];

    if (error) {
      const fallback = await supabaseAdmin
        .from("documents")
        .select(
          `
          id,
          doc_no,
          doc_date,
          doc_type,
          contact_id,
          grand_total,
          deposit_deducted,
          vat_type,
          vat_rate,
          status,
          is_voided
        `,
        )
        .eq("contact_id", trimmed)
        .eq("doc_type", depositDocType)
        .eq("status", "ISSUED")
        .or("is_voided.is.null,is_voided.eq.false")
        .order("doc_date", { ascending: true });

      if (fallback.error) {
        return { success: false, data: [], error: fallback.error.message };
      }

      rows = (fallback.data ?? []) as DepositDocRow[];
      const allocatedMap = await loadAllocatedMap(
        supabaseAdmin,
        rows.map((row) => String(row.id)),
      );
      rows = rows.map((row) => ({
        ...row,
        allocations: [
          { allocated_amount: allocatedMap.get(String(row.id)) ?? 0 },
        ],
      }));
    }

    const deposits = rows
      .map((row) => mapRefundableDeposit(row, trimmed, depositDocType))
      .filter((row): row is RefundableDeposit => row != null);

    return { success: true, data: deposits, error: null };
  } catch (err) {
    return {
      success: false,
      data: [],
      error:
        err instanceof Error ? err.message : "ดึงรายการมัดจำคงเหลือไม่สำเร็จ",
    };
  }
}

/**
 * คู่ค้าที่มียอดมัดจำคงเหลือ สำหรับ Smart Combobox (Zero Client-Side Fetching)
 */
export async function getRefundParties(
  type: RefundSide,
): Promise<GetRefundPartiesResult> {
  try {
    if (type !== "AR" && type !== "AP") {
      return {
        success: false,
        data: [],
        error: "ประเภทการคืนเงินต้องเป็น AR หรือ AP",
      };
    }

    const supabaseAdmin = createSupabaseServerClient();
    const depositDocType = resolveDepositDocType(type);
    const { data, error } = await supabaseAdmin
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_date,
        doc_type,
        contact_id,
        grand_total,
        deposit_deducted,
        vat_type,
        vat_rate,
        status,
        is_voided,
        contacts:contact_id (
          id,
          company_name
        ),
        ${DEPOSIT_ALLOCATION_EMBED}
      `,
      )
      .eq("doc_type", depositDocType)
      .eq("status", "ISSUED")
      .or("is_voided.is.null,is_voided.eq.false")
      .order("doc_date", { ascending: true });

    let rows = (data ?? []) as DepositDocRow[];
    if (error) {
      const fallback = await supabaseAdmin
        .from("documents")
        .select(
          `
          id,
          doc_no,
          doc_date,
          doc_type,
          contact_id,
          grand_total,
          deposit_deducted,
          vat_type,
          vat_rate,
          status,
          is_voided,
          contacts:contact_id (
            id,
            company_name
          )
        `,
        )
        .eq("doc_type", depositDocType)
        .eq("status", "ISSUED")
        .or("is_voided.is.null,is_voided.eq.false");

      if (fallback.error) {
        return { success: false, data: [], error: fallback.error.message };
      }
      rows = (fallback.data ?? []) as DepositDocRow[];
      const allocatedMap = await loadAllocatedMap(
        supabaseAdmin,
        rows.map((row) => String(row.id)),
      );
      rows = rows.map((row) => ({
        ...row,
        allocations: [
          { allocated_amount: allocatedMap.get(String(row.id)) ?? 0 },
        ],
      }));
    }

    const grouped = new Map<
      string,
      { name: string; outstanding_total: number; invoice_count: number }
    >();

    for (const row of rows) {
      const mapped = mapRefundableDeposit(
        row,
        row.contact_id?.trim() || "",
        depositDocType,
      );
      if (!mapped) continue;
      const contact = unwrapContact(row.contacts);
      const contactId = mapped.contact_id || contact?.id?.trim() || "";
      if (!contactId) continue;
      const existing = grouped.get(contactId);
      const name =
        contact?.company_name?.trim() ||
        existing?.name ||
        (type === "AR" ? "ไม่ระบุลูกค้า" : "ไม่ระบุซัพพลายเออร์");
      if (!existing) {
        grouped.set(contactId, {
          name,
          outstanding_total: mapped.remaining_balance,
          invoice_count: 1,
        });
      } else {
        existing.outstanding_total = roundMoney(
          existing.outstanding_total + mapped.remaining_balance,
        );
        existing.invoice_count += 1;
        if (!existing.name && name) existing.name = name;
      }
    }

    const parties: RefundPartyOption[] = [...grouped.entries()]
      .map(([id, row]) => ({
        id,
        name: row.name,
        outstanding_total: row.outstanding_total,
        invoice_count: row.invoice_count,
      }))
      .filter((row) => row.outstanding_total > MONEY_EPS)
      .sort((a, b) => b.outstanding_total - a.outstanding_total);

    return { success: true, data: parties, error: null };
  } catch (err) {
    return {
      success: false,
      data: [],
      error:
        err instanceof Error ? err.message : "ดึงรายชื่อคู่ค้ามัดจำคงเหลือไม่สำเร็จ",
    };
  }
}

/**
 * สร้างใบคืนเงินมัดจำ (Late Numbering + ABAC approval_limit)
 * - ยอด > approval_limit → DRAFT + PENDING (เลขชั่วคราว)
 * - ยอดไม่เกินวงเงิน (รวม Admin ลิมิต 999,999,999.00) → ISSUED + เลขจริง SRF/PRF
 * ไม่บันทึก document_items — ผูกมัดจำผ่าน document_allocations เท่านั้น
 */
export async function createRefundDocument(
  payload: CreateRefundDocumentPayload | FormData | unknown,
): Promise<CreateRefundDocumentResult> {
  const coerced = coerceCreatePayload(payload);
  const parsed = createRefundDocumentSchema.safeParse(coerced.fields);
  if (!parsed.success) {
    return { success: false, error: firstZodMessage(parsed.error), data: null };
  }

  const side = parsed.data.type;
  const contactId = parsed.data.contact_id;
  const depositId = parsed.data.deposit_id;
  const requestAmount = roundMoney(parsed.data.amount);
  const remark = parsed.data.remark?.trim() || null;
  const docDate =
    parsed.data.document_date &&
    /^\d{4}-\d{2}-\d{2}$/.test(parsed.data.document_date)
      ? parsed.data.document_date
      : todayIsoDate();
  const bankAccountRaw = parsed.data.bank_account_id.trim();
  const isCash = bankAccountRaw === CASH_ACCOUNT_SENTINEL;
  const slipFile = coerced.slipFile;

  const actor = await getCurrentAuthUser();
  if (!actor?.userId) {
    return {
      success: false,
      error: "กรุณาเข้าสู่ระบบก่อนบันทึกเอกสาร",
      data: null,
    };
  }

  const supabaseAdmin = createSupabaseServerClient();
  const refundDocType = resolveRefundDocType(side);
  const expectedDepositType = resolveDepositDocType(side);
  const expectedRole = side === "AR" ? "Customer" : "Vendor";

  let refundId: string | null = null;
  let previousDepositDeducted: number | null = null;
  let slipStoragePath: string | null = null;

  try {
    const { data: periodClosed, error: periodError } = await supabaseAdmin.rpc(
      "is_period_closed",
      { doc_date: docDate },
    );
    if (periodError) {
      return { success: false, error: periodError.message, data: null };
    }
    if (periodClosed === true) {
      return {
        success: false,
        error: "งวดบัญชีของวันที่เอกสารนี้ถูกปิดแล้ว ไม่สามารถคืนเงินมัดจำได้",
        data: null,
      };
    }

    const limitResult = await loadMakerApprovalLimit(
      supabaseAdmin,
      actor.userId,
    );
    if (!limitResult.ok) {
      return { success: false, error: limitResult.error, data: null };
    }

    const { data: contact, error: contactError } = await supabaseAdmin
      .from("contacts")
      .select("id, contact_roles, is_active")
      .eq("id", contactId)
      .maybeSingle();

    if (contactError) {
      return { success: false, error: contactError.message, data: null };
    }
    if (!contact) {
      return { success: false, error: "ไม่พบข้อมูลคู่ค้า", data: null };
    }
    if (contact.is_active === false) {
      return {
        success: false,
        error: "คู่ค้ารายนี้ถูกปิดการใช้งานแล้ว",
        data: null,
      };
    }
    const roles = Array.isArray(contact.contact_roles)
      ? contact.contact_roles
      : [];
    if (!roles.includes(expectedRole)) {
      return {
        success: false,
        error:
          side === "AR"
            ? "AR_REFUND ต้องเลือกลูกค้า (Customer)"
            : "AP_REFUND ต้องเลือกซัพพลายเออร์ (Vendor)",
        data: null,
      };
    }

    let bankAccountId: string | null = null;
    if (!isCash) {
      const { data: bank, error: bankError } = await supabaseAdmin
        .from("mst_bank_accounts")
        .select("id, is_active")
        .eq("id", bankAccountRaw)
        .maybeSingle();

      if (bankError) {
        return { success: false, error: bankError.message, data: null };
      }
      if (!bank) {
        return {
          success: false,
          error: "ไม่พบบัญชีธนาคารที่เลือก",
          data: null,
        };
      }
      if (bank.is_active === false) {
        return {
          success: false,
          error: "บัญชีธนาคารนี้ถูกปิดการใช้งานแล้ว",
          data: null,
        };
      }
      bankAccountId = String(bank.id);
    }

    const { data: deposit, error: depositError } = await supabaseAdmin
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_type,
        doc_date,
        contact_id,
        grand_total,
        deposit_deducted,
        vat_type,
        vat_rate,
        status,
        is_voided,
        ${DEPOSIT_ALLOCATION_EMBED}
      `,
      )
      .eq("id", depositId)
      .maybeSingle();

    let depositRow = (deposit ?? null) as DepositDocRow | null;

    if (depositError) {
      const fallback = await supabaseAdmin
        .from("documents")
        .select(
          `
          id,
          doc_no,
          doc_type,
          doc_date,
          contact_id,
          grand_total,
          deposit_deducted,
          vat_type,
          vat_rate,
          status,
          is_voided
        `,
        )
        .eq("id", depositId)
        .maybeSingle();

      if (fallback.error || !fallback.data) {
        return {
          success: false,
          error: fallback.error?.message ?? "ไม่พบเอกสารมัดจำต้นทาง",
          data: null,
        };
      }

      const allocatedMap = await loadAllocatedMap(supabaseAdmin, [depositId]);
      depositRow = {
        ...(fallback.data as DepositDocRow),
        allocations: [
          { allocated_amount: allocatedMap.get(depositId) ?? 0 },
        ],
      };
    }

    if (!depositRow) {
      return { success: false, error: "ไม่พบเอกสารมัดจำต้นทาง", data: null };
    }
    if (depositRow.is_voided === true || depositRow.status === "VOID") {
      return {
        success: false,
        error: "เอกสารมัดจำถูกยกเลิกแล้ว",
        data: null,
      };
    }
    if (depositRow.doc_type !== expectedDepositType) {
      return {
        success: false,
        error:
          side === "AR"
            ? "AR_REFUND ต้องอ้างอิงมัดจำรับ (DEP_IN) เท่านั้น"
            : "AP_REFUND ต้องอ้างอิงมัดจำจ่าย (DEP_OUT) เท่านั้น",
        data: null,
      };
    }
    if (depositRow.status !== "ISSUED") {
      return {
        success: false,
        error: `มัดจำ ${depositRow.doc_no ?? depositId} ต้องเป็นสถานะ ISSUED`,
        data: null,
      };
    }
    if ((depositRow.contact_id?.trim() || "") !== contactId) {
      return {
        success: false,
        error: "เอกสารมัดจำไม่ได้อยู่ภายใต้คู่ค้าที่เลือก",
        data: null,
      };
    }

    const vatType = normalizeVatType(depositRow.vat_type);
    const vatRate = normalizeVatRate(depositRow.vat_rate, vatType);
    const previousDeducted = roundMoney(toMoney(depositRow.deposit_deducted));
    previousDepositDeducted = previousDeducted;
    const allocatedAmount = sumAllocatedAmount(
      depositRow.allocations,
      previousDeducted,
    );
    const grandTotal = roundMoney(toMoney(depositRow.grand_total));
    const remaining = roundMoney(Math.max(0, grandTotal - allocatedAmount));

    if (remaining <= MONEY_EPS) {
      return {
        success: false,
        error: "มัดจำใบนี้ไม่มียอดคงเหลือแล้ว",
        data: null,
      };
    }
    if (requestAmount > remaining + MONEY_EPS) {
      return {
        success: false,
        error: `ยอดคืนเงิน (${requestAmount.toFixed(2)}) เกินยอดคงเหลือ (${remaining.toFixed(2)})`,
        data: null,
      };
    }

    const applyAmount = roundMoney(Math.min(requestAmount, remaining));
    const vat = inheritVatFromDeposit({
      refundGrand: applyAmount,
      vatType,
      vatRate,
    });

    let slipUrl: string | null = null;
    let originalFileName: string | null = null;
    if (slipFile) {
      const uploaded = await uploadRefundSlip(supabaseAdmin, slipFile);
      if ("error" in uploaded) {
        return { success: false, error: uploaded.error, data: null };
      }
      slipUrl = uploaded.url;
      slipStoragePath = uploaded.path;
      originalFileName = slipFile.name.slice(0, 255);
    }

    const exceedsLimit = exceedsApprovalLimit(
      vat.grand_total,
      limitResult.approvalLimit,
    );
    const pendingApproval = exceedsLimit;
    let documentNo = generateDraftDocumentNo();
    if (!pendingApproval) {
      const numberResult = await generateDocumentNumber(
        refundDocType as DocumentType,
        docDate,
      );
      if (numberResult.error || !numberResult.data) {
        if (slipStoragePath) {
          await supabaseAdmin.storage
            .from(DOCUMENT_ATTACHMENTS_BUCKET)
            .remove([slipStoragePath]);
        }
        return {
          success: false,
          error:
            numberResult.error ??
            "สร้างเลขที่เอกสารคืนเงิน (SRF / PRF) ไม่สำเร็จ",
          data: null,
        };
      }
      documentNo = numberResult.data;
    }
    const headerStatus = pendingApproval
      ? "DRAFT"
      : resolveIssuedDocumentStatus(refundDocType);
    const nowIso = new Date().toISOString();
    const issuedPaid = !pendingApproval;
    const depositDocNo = depositRow.doc_no?.trim() || depositId;
    const notesParts = [
      `คืนเงินมัดจำจาก ${depositDocNo}`,
      `amount=${vat.grand_total.toFixed(2)}`,
      `vat=${vat.vat_type}@${vat.vat_rate}%`,
      `net=${vat.net_before_vat.toFixed(2)}`,
      `vat_amt=${vat.vat_amount.toFixed(2)}`,
      remark ? `remark=${remark}` : null,
    ].filter(Boolean);

    const { data: refundDoc, error: insertError } = await supabaseAdmin
      .from("documents")
      .insert({
        doc_no: documentNo,
        doc_type: refundDocType,
        status: headerStatus,
        doc_date: docDate,
        contact_id: contactId,
        ref_document_id: depositId,
        sub_total: vat.net_before_vat,
        discount_amount: 0,
        tax_rate: vat.vat_rate,
        tax_amount: vat.vat_amount,
        wht_rate: 0,
        wht_amount: 0,
        grand_total: vat.grand_total,
        total_amount: vat.net_before_vat,
        net_before_vat: vat.net_before_vat,
        vat_amount: vat.vat_amount,
        vat_rate: vat.vat_rate,
        vat_type: vat.vat_type,
        deposit_deducted: 0,
        paid_amount: issuedPaid ? vat.grand_total : 0,
        payment_status: issuedPaid ? "PAID" : "UNPAID",
        remark,
        notes: notesParts.join(" | "),
        attachment_url: slipUrl,
        attached_file_url: slipUrl,
        original_file_name: originalFileName,
        created_by: actor.userId,
        approval_status: pendingApproval ? "PENDING" : "APPROVED",
        approved_by: pendingApproval ? null : actor.userId,
        approved_at: pendingApproval ? null : nowIso,
        updated_at: nowIso,
      })
      .select("*")
      .single();

    if (insertError || !refundDoc?.id) {
      if (slipStoragePath) {
        await supabaseAdmin.storage
          .from(DOCUMENT_ATTACHMENTS_BUCKET)
          .remove([slipStoragePath]);
      }
      return {
        success: false,
        error: insertError?.message ?? "บันทึกใบคืนเงินมัดจำไม่สำเร็จ",
        data: null,
      };
    }

    refundId = String(refundDoc.id);
    const refundDocNo = String(refundDoc.doc_no ?? documentNo);
    const refundDocPayload: Record<string, unknown> = {
      ...(refundDoc as Record<string, unknown>),
      audit_event: refundDocType,
      deposit_id: depositId,
      deposit_doc_no: depositDocNo,
      bank_account_id: bankAccountId,
      payment_method: isCash ? "CASH" : "BANK_TRANSFER",
      summary: `สร้างใบคืนเงินมัดจำ ${refundDocNo} จำนวน ${vat.grand_total.toFixed(2)} บาท`,
    };
    const newDeducted = roundMoney(allocatedAmount + applyAmount);
    const depositOldPayload: Record<string, unknown> = {
      id: depositId,
      doc_no: depositDocNo,
      doc_type: depositRow.doc_type,
      deposit_deducted: previousDeducted,
    };

    const [allocResult, txResult, insertAudit] = await Promise.all([
      supabaseAdmin.from("document_allocations").insert({
        receipt_doc_id: refundId,
        invoice_doc_id: depositId,
        allocated_amount: applyAmount,
        wht_amount: 0,
        adjustment_amount: 0,
        adjustment_reason: remark
          ? `${REFUND_ADJUSTMENT_REASON}: ${remark}`
          : REFUND_ADJUSTMENT_REASON,
      }),
      supabaseAdmin.from("payment_transactions").insert({
        document_id: refundId,
        payment_method: isCash ? "CASH" : "BANK_TRANSFER",
        bank_account_id: bankAccountId,
        amount: applyAmount,
        payment_date: docDate,
        attachment_url: slipUrl,
        is_reconciled: false,
        is_voided: false,
      }),
      writeDocumentsAuditLog(supabaseAdmin, {
        actorUserId: actor.userId,
        actorName: actor.displayName,
        recordId: refundId,
        action: "INSERT",
        oldData: null,
        newData: refundDocPayload,
      }),
    ]);

    const relatedError =
      allocResult.error?.message ??
      txResult.error?.message ??
      insertAudit.error;
    if (relatedError) {
      await rollbackRefund(
        supabaseAdmin,
        refundId,
        null,
        null,
        slipStoragePath,
      );
      refundId = null;
      return {
        success: false,
        error: relatedError,
        data: null,
      };
    }

    const { error: updateError } = await supabaseAdmin
      .from("documents")
      .update({
        deposit_deducted: newDeducted,
        updated_at: nowIso,
      })
      .eq("id", depositId);

    if (updateError) {
      await rollbackRefund(
        supabaseAdmin,
        refundId,
        depositId,
        previousDepositDeducted,
        slipStoragePath,
      );
      refundId = null;
      return {
        success: false,
        error: `อัปเดตยอดมัดจำไม่สำเร็จ: ${updateError.message}`,
        data: null,
      };
    }

    const depositAudit = await writeDocumentsAuditLog(supabaseAdmin, {
      actorUserId: actor.userId,
      actorName: actor.displayName,
      recordId: depositId,
      action: "UPDATE",
      oldData: depositOldPayload,
      newData: {
        ...depositOldPayload,
        deposit_deducted: newDeducted,
        audit_event: refundDocType,
        refund_doc_id: refundId,
        refund_doc_no: refundDocNo,
      },
    });
    if (depositAudit.error) {
      await rollbackRefund(
        supabaseAdmin,
        refundId,
        depositId,
        previousDepositDeducted,
        slipStoragePath,
      );
      refundId = null;
      return {
        success: false,
        error: `บันทึก audit_logs ไม่สำเร็จ: ${depositAudit.error}`,
        data: null,
      };
    }

    revalidatePath("/finance/deposits");
    revalidatePath("/finance/refunds/create");
    revalidatePath("/sales");
    revalidatePath("/purchases");
    if (side === "AR") {
      revalidatePath("/finance/payments");
      if (depositDocNo) revalidatePath(`/sales/${depositDocNo}`);
      revalidatePath(`/sales/${refundDocNo}`);
    } else {
      revalidatePath("/finance/ap-payment");
      if (depositDocNo) revalidatePath(`/purchases/${depositDocNo}`);
      revalidatePath(`/purchases/${refundDocNo}`);
    }
    revalidateApprovalCenterIfPending(pendingApproval);

    return {
      success: true,
      error: null,
      data: {
        document_id: refundId,
        document_no: refundDocNo,
        doc_type: refundDocType,
        grand_total: vat.grand_total,
        net_before_vat: vat.net_before_vat,
        vat_amount: vat.vat_amount,
        vat_type: vat.vat_type,
        vat_rate: vat.vat_rate,
        pending_approval: pendingApproval,
        approval_limit: limitResult.approvalLimit,
      },
    };
  } catch (err) {
    if (refundId) {
      await rollbackRefund(
        supabaseAdmin,
        refundId,
        depositId,
        previousDepositDeducted,
        slipStoragePath,
      );
    }
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "บันทึกใบคืนเงินมัดจำไม่สำเร็จ",
      data: null,
    };
  }
}
