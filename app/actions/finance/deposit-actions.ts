"use server";

/**
 * Phase 5 — Deposit Management (DEP_IN / DEP_OUT) Server Actions.
 * Zero Client-Side Fetching: Service Role via `createSupabaseServerClient` only.
 *
 * Ledger source: `documents` (Phase 4/5 primary) — same as AR/AP.
 * Legacy mirror: `doc_headers` (same dual-write pattern as PAY).
 * Running number: reuse `generateDocumentNumber` — do NOT alter RPC architecture.
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateDocumentNumber } from "@/lib/actions/document-actions";
import { getCurrentAuthUser, requireSessionUserId } from "@/lib/auth/current-user";
import { canAccessCustomerDeposits, canAccessVendorDeposits } from "@/lib/auth/module-access";
import {
  resolveInitialPaymentStatus,
  resolveIssuedDocumentStatus,
} from "@/lib/constants/document";
import { revalidateApprovalCenterIfPending } from "@/lib/approval/revalidate-approval";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { generateDraftDocumentNo } from "@/lib/utils/draft-document-no";
import {
  calculateDocumentSummary,
  isVatCalculationType,
  type VatCalculationType,
} from "@/lib/utils/document-summary";
import { todayIsoDate } from "@/lib/utils/outstanding-summary";
import { roundMoney } from "@/lib/utils/payment-fifo";
import type { Json } from "@/src/types/supabase";
import type {
  CreateDepositDocumentResult,
  DepositBalanceActionType,
  DepositDocument,
  DepositTab,
  GetDepositDocumentsResult,
  ManageDepositBalanceResult,
} from "@/types/deposit";
import type { DocumentType } from "@/types/document";

const PENDING_DEPOSIT_BALANCE_MESSAGE = "เอกสารเข้าสู่ระบบรออนุมัติแล้ว";

const DEFAULT_DEPOSIT_VAT_RATE = 7;

const MONEY_EPS = 0.02;

/** Map deposit source + action → AR/AP settlement document type. */
function resolveSettlementDocType(
  depositDocType: string,
  actionType: DepositBalanceActionType,
): DocumentType | null {
  if (depositDocType === "DEP_IN") {
    return actionType === "REFUND" ? "AR_REFUND" : "AR_WRITEOFF";
  }
  if (depositDocType === "DEP_OUT") {
    return actionType === "REFUND" ? "AP_REFUND" : "AP_WRITEOFF";
  }
  return null;
}

const DOCUMENT_ATTACHMENTS_BUCKET = "document_attachments";
const ALLOWED_SLIP_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

type ContactJoin = {
  id?: string;
  company_name?: string | null;
};

type DepositDocRow = {
  id: string;
  doc_no: string | null;
  doc_date: string | null;
  created_at: string | null;
  grand_total: number | string | null;
  deposit_deducted: number | string | null;
  payment_status: string | null;
  contact_id: string | null;
  is_voided?: boolean | null;
  contacts?: ContactJoin | ContactJoin[] | null;
};

function unwrapContact(
  value: ContactJoin | ContactJoin[] | null | undefined,
): ContactJoin | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function resolveDepositStatusLabel(
  grandTotal: number,
  allocatedAmount: number,
): string {
  if (grandTotal > 0 && allocatedAmount >= grandTotal - 0.02) {
    return "นำไปตัดชำระครบแล้ว";
  }
  if (allocatedAmount > 0.02) {
    return "ตัดชำระบางส่วน";
  }
  return "รอนำไปตัดชำระ";
}

function sanitizeSearch(raw: string): string {
  return raw.replace(/[%_,.()]/g, " ").trim();
}

/**
 * List deposit documents for the Deposit Dashboard.
 * Sorted by document date then created_at (newest first).
 */
export async function getDepositDocuments(
  tab: DepositTab,
  search?: string,
): Promise<GetDepositDocumentsResult> {
  try {
    if (tab !== "DEP_IN" && tab !== "DEP_OUT") {
      return { data: [], error: `แท็บไม่ถูกต้อง: ${String(tab)}` };
    }

    const actor = await getCurrentAuthUser();
    if (!canAccessCustomerDeposits(actor?.accessibleModules, actor?.roleCode)) {
      return {
        data: [],
        error: "Forbidden: ไม่มีสิทธิ์เข้าถึงเอกสารเงินมัดจำ",
      };
    }
    if (
      tab === "DEP_OUT" &&
      !canAccessVendorDeposits(actor?.accessibleModules, actor?.roleCode)
    ) {
      return {
        data: [],
        error: "Forbidden: ไม่มีสิทธิ์ดูจ่ายเงินมัดจำซัพพลายเออร์ (DEP_OUT)",
      };
    }

    const supabase = createSupabaseServerClient();
    const searchTerm = sanitizeSearch(search?.trim() ?? "");

    let contactIds: string[] = [];
    if (searchTerm) {
      const { data: matchedContacts, error: contactError } = await supabase
        .from("contacts")
        .select("id")
        .ilike("company_name", `%${searchTerm}%`)
        .limit(200);

      if (contactError) {
        return { data: [], error: contactError.message };
      }
      contactIds = (matchedContacts ?? []).map((c) => c.id as string);
    }

    let query = supabase
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_date,
        created_at,
        grand_total,
        deposit_deducted,
        payment_status,
        contact_id,
        is_voided,
        contacts:contact_id (
          id,
          company_name
        )
      `,
      )
      .eq("doc_type", tab);

    if (searchTerm) {
      const pattern = `%${searchTerm}%`;
      if (contactIds.length > 0) {
        query = query.or(
          `doc_no.ilike.${pattern},contact_id.in.(${contactIds.join(",")})`,
        );
      } else {
        query = query.ilike("doc_no", pattern);
      }
    }

    const { data, error } = await query
      .order("doc_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return { data: [], error: error.message };
    }

    const depositRows = ((data ?? []) as DepositDocRow[]).filter(
      (raw) => raw.is_voided !== true,
    );
    const depositIds = depositRows.map((row) => row.id);

    const allocatedByDeposit = new Map<string, number>();
    if (depositIds.length > 0) {
      const { data: allocRows, error: allocError } = await supabase
        .from("document_allocations")
        .select("invoice_doc_id, allocated_amount")
        .in("invoice_doc_id", depositIds);

      if (allocError) {
        return { data: [], error: allocError.message };
      }

      for (const row of allocRows ?? []) {
        const id = String(row.invoice_doc_id ?? "");
        if (!id) continue;
        allocatedByDeposit.set(
          id,
          roundMoney(
            (allocatedByDeposit.get(id) ?? 0) + toMoney(row.allocated_amount),
          ),
        );
      }
    }

    const rows: DepositDocument[] = depositRows.map((raw) => {
      const contact = unwrapContact(raw.contacts);
      const grandTotal = toMoney(raw.grand_total);
      const depositDeducted = toMoney(raw.deposit_deducted);
      const allocatedAmount = roundMoney(
        Math.max(allocatedByDeposit.get(raw.id) ?? 0, depositDeducted),
      );
      const availableAmount = roundMoney(
        Math.max(0, grandTotal - allocatedAmount),
      );

      return {
        id: raw.id,
        document_date: raw.doc_date ? String(raw.doc_date) : "",
        doc_no: raw.doc_no?.trim() || "ไม่ระบุ",
        contact_id: raw.contact_id?.trim() || contact?.id || "",
        contact_name:
          contact?.company_name?.trim() ||
          (tab === "DEP_IN" ? "ไม่ระบุลูกค้า" : "ไม่ระบุซัพพลายเออร์"),
        grand_total: grandTotal,
        allocated_amount: allocatedAmount,
        available_amount: availableAmount,
        deposit_deducted: depositDeducted,
        status_label: resolveDepositStatusLabel(grandTotal, allocatedAmount),
        payment_status: String(raw.payment_status ?? "UNPAID"),
        created_at: raw.created_at ? String(raw.created_at) : "",
      };
    });

    return { data: rows, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ดึงรายการเอกสารมัดจำไม่สำเร็จ";
    return { data: [], error: message };
  }
}

async function uploadDepositSlip(
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
  const objectPath = `deposits/${yyyy}/${mm}/${crypto.randomUUID()}${extFromName}`;
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

/**
 * Create DEP_IN / DEP_OUT document (VAT-aware).
 * - Running number via existing `generateDocumentNumber` (RPC untouched)
 * - Primary insert: `documents` (vat_type / vat_rate / net_before_vat / vat_amount)
 * - Legacy mirror: `doc_headers` (sub_total = net, tax_* = VAT, grand_total)
 *
 * Input `amount` semantics by vat_type:
 * - NONE: amount = net = grand
 * - INCLUSIVE: amount = grand (รวม VAT)
 * - EXCLUSIVE: amount = net (ยังไม่รวม VAT)
 */
export async function createDepositDocument(
  formData: FormData,
): Promise<CreateDepositDocumentResult> {
  const supabase = createSupabaseServerClient();
  let documentId: string | null = null;
  let headerId: string | null = null;
  let slipStoragePath: string | null = null;

  try {
    const docTypeRaw = String(formData.get("doc_type") ?? "").trim();
    const contactId = String(formData.get("contact_id") ?? "").trim();
    const documentDateRaw = String(
      formData.get("document_date") ?? "",
    ).trim();
    // Prefer `amount`; keep `grand_total` as legacy form field alias
    const amount = roundMoney(
      Number(formData.get("amount") ?? formData.get("grand_total") ?? 0),
    );
    const vatTypeRaw = String(formData.get("vat_type") ?? "NONE").trim();
    const vatType: VatCalculationType = isVatCalculationType(vatTypeRaw)
      ? vatTypeRaw
      : "NONE";
    const vatRateRaw = Number(formData.get("vat_rate") ?? DEFAULT_DEPOSIT_VAT_RATE);
    const vatRate =
      Number.isFinite(vatRateRaw) && vatRateRaw >= 0
        ? vatRateRaw
        : DEFAULT_DEPOSIT_VAT_RATE;
    const remark = String(formData.get("remark") ?? "").trim() || null;
    const referenceNo =
      String(formData.get("reference_no") ?? "").trim() || null;
    const slipFile = formData.get("slip_file");

    if (docTypeRaw !== "DEP_IN" && docTypeRaw !== "DEP_OUT") {
      return {
        success: false,
        error: "ประเภทเอกสารต้องเป็น DEP_IN หรือ DEP_OUT",
      };
    }
    const docType: DepositTab = docTypeRaw;
    const actor = await getCurrentAuthUser();
    if (!canAccessCustomerDeposits(actor?.accessibleModules, actor?.roleCode)) {
      return {
        success: false,
        error: "Forbidden: ไม่มีสิทธิ์บันทึกเงินมัดจำ",
      };
    }
    if (docType === "DEP_OUT") {
      if (!canAccessVendorDeposits(actor?.accessibleModules, actor?.roleCode)) {
        return {
          success: false,
          error:
            "Forbidden: พนักงานขายสามารถสร้างได้เฉพาะรับเงินมัดจำลูกค้า (DEP_IN)",
        };
      }
    }

    const documentDate = /^\d{4}-\d{2}-\d{2}$/.test(documentDateRaw)
      ? documentDateRaw
      : todayIsoDate();

    if (!contactId) {
      return {
        success: false,
        error:
          docType === "DEP_IN"
            ? "กรุณาเลือกลูกค้า"
            : "กรุณาเลือกซัพพลายเออร์",
      };
    }
    if (!(amount > 0)) {
      return { success: false, error: "ยอดเงินมัดจำต้องมากกว่า 0" };
    }

    const summary = calculateDocumentSummary({
      lineTotals: [amount],
      discountText: null,
      vatType,
      vatRate: vatType === "NONE" ? 0 : vatRate,
    });
    const netTotal = summary.net_before_vat;
    const vatAmount = summary.vat_amount;
    const grandTotal = summary.grand_total;
    const storedVatRate = vatType === "NONE" ? 0 : summary.vat_rate;

    const expectedRole = docType === "DEP_IN" ? "Customer" : "Vendor";
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id, contact_roles, is_active, company_name")
      .eq("id", contactId)
      .maybeSingle();

    if (contactError || !contact) {
      return { success: false, error: "ไม่พบผู้ติดต่อที่เลือก" };
    }
    if (contact.is_active === false) {
      return { success: false, error: "ผู้ติดต่อนี้ถูกปิดการใช้งานแล้ว" };
    }
    const roles = Array.isArray(contact.contact_roles)
      ? contact.contact_roles
      : [];
    if (!roles.includes(expectedRole)) {
      return {
        success: false,
        error:
          docType === "DEP_IN"
            ? "DEP_IN ต้องเลือกลูกค้า (Customer) เท่านั้น"
            : "DEP_OUT ต้องเลือกซัพพลายเออร์ (Vendor) เท่านั้น",
      };
    }

    // Running number — reuse existing helper (RPC architecture untouched)
    const numberResult = await generateDocumentNumber(docType, documentDate);
    if (!numberResult.data) {
      return {
        success: false,
        error: numberResult.error ?? "สร้างเลขที่เอกสารมัดจำไม่สำเร็จ",
      };
    }
    const docNo = numberResult.data;

    let slipUrl: string | null = null;
    if (slipFile instanceof File && slipFile.size > 0) {
      const uploaded = await uploadDepositSlip(supabase, slipFile);
      if ("error" in uploaded) {
        return { success: false, error: uploaded.error };
      }
      slipUrl = uploaded.url;
      slipStoragePath = uploaded.path;
    }

    const nowIso = new Date().toISOString();
    const paymentStatus = resolveInitialPaymentStatus(docType);
    const status = resolveIssuedDocumentStatus(docType);
    const notesParts = [
      docType === "DEP_IN" ? "รับเงินมัดจำลูกค้า" : "จ่ายเงินมัดจำซัพพลายเออร์",
      `amount=${amount.toFixed(2)}`,
      `vat=${vatType}@${storedVatRate}%`,
      `net=${netTotal.toFixed(2)}`,
      `vat_amt=${vatAmount.toFixed(2)}`,
      `grand=${grandTotal.toFixed(2)}`,
      referenceNo ? `ref=${referenceNo}` : null,
      remark ? `remark=${remark}` : null,
    ].filter(Boolean);

    const owner = await requireSessionUserId();
    if (!owner.ok) {
      return { success: false, error: owner.error };
    }

    // 1) Primary ledger — documents
    const { data: document, error: documentError } = await supabase
      .from("documents")
      .insert({
        doc_no: docNo,
        doc_type: docType,
        status,
        doc_date: documentDate,
        contact_id: contactId,
        sub_total: netTotal,
        discount_amount: 0,
        tax_rate: storedVatRate,
        tax_amount: vatAmount,
        wht_rate: 0,
        wht_amount: 0,
        grand_total: grandTotal,
        total_amount: netTotal,
        net_before_vat: netTotal,
        vat_amount: vatAmount,
        vat_rate: storedVatRate,
        vat_type: vatType,
        deposit_deducted: 0,
        paid_amount: 0,
        payment_status: paymentStatus,
        reference_no: referenceNo,
        attachment_url: slipUrl,
        attached_file_url: slipUrl,
        original_file_name:
          slipFile instanceof File && slipFile.size > 0
            ? slipFile.name.slice(0, 255)
            : null,
        notes: notesParts.join(" | "),
        created_by: owner.userId,
        updated_at: nowIso,
      })
      .select("id, doc_no")
      .single();

    if (documentError || !document) {
      if (slipStoragePath) {
        await supabase.storage
          .from(DOCUMENT_ATTACHMENTS_BUCKET)
          .remove([slipStoragePath]);
      }
      return {
        success: false,
        error: documentError?.message ?? "บันทึกเอกสารมัดจำไม่สำเร็จ",
      };
    }

    documentId = document.id as string;

    // 2) Legacy mirror — doc_headers (sub_total = net, tax_* = VAT)
    const { data: header, error: headerError } = await supabase
      .from("doc_headers")
      .insert({
        doc_no: docNo,
        doc_type: docType,
        doc_date: documentDate,
        contact_id: contactId,
        sub_total: netTotal,
        discount_amount: 0,
        tax_rate: storedVatRate,
        tax_amount: vatAmount,
        grand_total: grandTotal,
        deposit_deducted: 0,
        payment_status: paymentStatus,
        attached_file_url: slipUrl,
        original_file_name:
          slipFile instanceof File && slipFile.size > 0
            ? slipFile.name.slice(0, 255)
            : null,
      })
      .select("id")
      .single();

    if (headerError || !header) {
      await supabase.from("documents").delete().eq("id", documentId);
      if (slipStoragePath) {
        await supabase.storage
          .from(DOCUMENT_ATTACHMENTS_BUCKET)
          .remove([slipStoragePath]);
      }
      return {
        success: false,
        error:
          headerError?.message ??
          "บันทึกหัวเอกสารมัดจำ (doc_headers) ไม่สำเร็จ",
      };
    }

    headerId = header.id as string;

    revalidatePath("/finance/deposits");
    revalidatePath("/sales");
    revalidatePath("/purchases");

    return {
      success: true,
      error: null,
      doc_no: String(document.doc_no),
      doc_type: docType,
    };
  } catch (err) {
    if (headerId) {
      await supabase.from("doc_headers").delete().eq("id", headerId);
    }
    if (documentId) {
      await supabase.from("documents").delete().eq("id", documentId);
    }
    if (slipStoragePath) {
      await supabase.storage
        .from(DOCUMENT_ATTACHMENTS_BUCKET)
        .remove([slipStoragePath]);
    }
    const message =
      err instanceof Error ? err.message : "สร้างเอกสารมัดจำไม่สำเร็จ";
    return { success: false, error: message };
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

async function loadMakerApprovalLimit(
  supabaseAdmin: SupabaseClient,
  actorId: string,
): Promise<{ ok: true; approvalLimit: number } | { ok: false; error: string }> {
  const userId = actorId.trim();
  if (!userId) {
    return { ok: false, error: "ไม่พบรหัสผู้ใช้จาก Auth Session" };
  }

  const { data: profile, error } = await supabaseAdmin
    .from("user_profiles")
    .select("id, approval_limit")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: `ดึง approval_limit ไม่สำเร็จ: ${error.message}` };
  }
  if (!profile) {
    return { ok: false, error: "ไม่พบโปรไฟล์ผู้ใช้งานใน user_profiles" };
  }

  const raw = Number(profile.approval_limit ?? 0);
  const approvalLimit = Number.isFinite(raw) && raw >= 0 ? raw : 0;
  return { ok: true, approvalLimit };
}

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

  const { data, error } = await supabaseAdmin
    .from("audit_logs")
    .insert({
      table_name: "documents",
      record_id: recordId,
      action: params.action,
      old_data: toAuditJson(params.oldData ?? null),
      new_data: newData,
      changed_by: actorUserId,
      changed_by_name: params.actorName?.trim()?.slice(0, 100) || null,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    const message =
      error?.message || "insert audit_logs สำเร็จแต่ไม่คืน id";
    console.error("[manageDepositBalance][audit_logs]", message);
    return { error: message };
  }

  return { error: null };
}

async function rollbackDepositBalance(
  supabaseAdmin: SupabaseClient,
  params: {
    stubDocId: string | null;
    stubHeaderId: string | null;
    depositId: string | null;
    previousDepositDeducted: number | null;
    slipStoragePath?: string | null;
  },
): Promise<void> {
  const nowIso = new Date().toISOString();
  if (params.depositId && params.previousDepositDeducted != null) {
    await supabaseAdmin
      .from("documents")
      .update({
        deposit_deducted: params.previousDepositDeducted,
        updated_at: nowIso,
      })
      .eq("id", params.depositId);
  }
  if (params.stubDocId) {
    await supabaseAdmin
      .from("document_allocations")
      .delete()
      .eq("receipt_doc_id", params.stubDocId);
    await supabaseAdmin
      .from("audit_logs")
      .delete()
      .eq("table_name", "documents")
      .eq("record_id", params.stubDocId);
    await supabaseAdmin.from("documents").delete().eq("id", params.stubDocId);
  }
  if (params.stubHeaderId) {
    await supabaseAdmin.from("doc_headers").delete().eq("id", params.stubHeaderId);
  }
  if (params.slipStoragePath) {
    await supabaseAdmin.storage
      .from(DOCUMENT_ATTACHMENTS_BUCKET)
      .remove([params.slipStoragePath]);
  }
}

/**
 * Quick Action: คืนเงินมัดจำ / ตัดเศษ จากหน้ารายละเอียดใบมัดจำ
 * Maker-Checker ตาม `user_profiles.approval_limit` + Late Numbering + บังคับ `audit_logs`
 *
 * Allocations:
 *   invoice_doc_id  = ใบมัดจำต้นทาง (DEP_IN / DEP_OUT)
 *   receipt_doc_id  = ใบ REFUND / WRITE_OFF ที่สร้างใหม่
 */
export async function manageDepositBalance(
  formData: FormData,
): Promise<ManageDepositBalanceResult> {
  const supabase = createSupabaseServerClient();
  let stubDocId: string | null = null;
  let stubHeaderId: string | null = null;
  let slipStoragePath: string | null = null;
  let depositIdForRollback: string | null = null;
  let previousDepositDeducted: number | null = null;

  try {
    const actor = await getCurrentAuthUser();
    if (!actor?.userId) {
      throw new Error("กรุณาเข้าสู่ระบบก่อนทำรายการ");
    }

    const limitResult = await loadMakerApprovalLimit(supabase, actor.userId);
    if (!limitResult.ok) {
      throw new Error(limitResult.error);
    }
    const userProfile = { approval_limit: limitResult.approvalLimit };

    const depositId = String(formData.get("document_id") ?? "").trim();
    const actionTypeRaw = String(formData.get("action_type") ?? "")
      .trim()
      .toUpperCase();
    const actionType: DepositBalanceActionType | null =
      actionTypeRaw === "REFUND" || actionTypeRaw === "WRITE_OFF"
        ? actionTypeRaw
        : null;
    const requestAmount = roundMoney(Number(formData.get("amount") ?? 0));
    const remarkClean =
      String(formData.get("remark") ?? "").trim() || null;
    const slipFile = formData.get("slip_file");

    if (!depositId) {
      return { success: false, error: "ไม่พบรหัสเอกสารมัดจำ" };
    }
    if (!actionType) {
      return {
        success: false,
        error: "ประเภทการทำรายการต้องเป็น REFUND หรือ WRITE_OFF",
      };
    }
    if (!(requestAmount > 0)) {
      return { success: false, error: "ยอดเงินต้องมากกว่า 0" };
    }

    const today = todayIsoDate();
    const { data: periodClosed, error: periodError } = await supabase.rpc(
      "is_period_closed",
      { doc_date: today },
    );
    if (periodError) {
      return { success: false, error: periodError.message };
    }
    if (periodClosed === true) {
      return {
        success: false,
        error: "งวดบัญชีของวันนี้ถูกปิดแล้ว ไม่สามารถคืนเงิน/ตัดเศษมัดจำได้",
      };
    }

    const { data: deposit, error: depositError } = await supabase
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
        status,
        is_voided,
        payment_status,
        vat_type,
        vat_rate
      `,
      )
      .eq("id", depositId)
      .maybeSingle();

    if (depositError || !deposit) {
      return { success: false, error: "ไม่พบเอกสารมัดจำ" };
    }
    if (deposit.is_voided === true || deposit.status === "VOID") {
      return { success: false, error: "เอกสารมัดจำถูกยกเลิกแล้ว" };
    }
    if (deposit.doc_type !== "DEP_IN" && deposit.doc_type !== "DEP_OUT") {
      return {
        success: false,
        error: "เอกสารนี้ไม่ใช่มัดจำ (DEP_IN / DEP_OUT)",
      };
    }
    if (deposit.status !== "ISSUED") {
      return {
        success: false,
        error: `มัดจำ ${deposit.doc_no ?? depositId} ต้องเป็นสถานะ ISSUED`,
      };
    }
    if (!canAccessCustomerDeposits(actor.accessibleModules, actor.roleCode)) {
      return {
        success: false,
        error: "Forbidden: ไม่มีสิทธิ์ทำรายการเงินมัดจำ",
      };
    }
    if (
      deposit.doc_type === "DEP_OUT" &&
      !canAccessVendorDeposits(actor.accessibleModules, actor.roleCode)
    ) {
      return {
        success: false,
        error: "Forbidden: ไม่มีสิทธิ์คืนเงิน/ตัดเศษมัดจำซัพพลายเออร์ (DEP_OUT)",
      };
    }

    const sourceVatType: VatCalculationType = isVatCalculationType(
      String(deposit.vat_type ?? "NONE"),
    )
      ? (String(deposit.vat_type) as VatCalculationType)
      : "NONE";
    const sourceVatRateRaw = Number(deposit.vat_rate ?? 7);
    const sourceVatRate =
      Number.isFinite(sourceVatRateRaw) && sourceVatRateRaw >= 0
        ? sourceVatRateRaw
        : 7;

    const { data: allocRows, error: allocLoadError } = await supabase
      .from("document_allocations")
      .select("allocated_amount")
      .eq("invoice_doc_id", depositId);

    if (allocLoadError) {
      return {
        success: false,
        error: allocLoadError.message ?? "โหลดยอดมัดจำที่ใช้ไปแล้วไม่สำเร็จ",
      };
    }

    const usedFromAlloc = roundMoney(
      (allocRows ?? []).reduce(
        (sum, row) => sum + Number(row.allocated_amount ?? 0),
        0,
      ),
    );
    const usedFromField = roundMoney(Number(deposit.deposit_deducted ?? 0));
    previousDepositDeducted = usedFromField;
    depositIdForRollback = depositId;
    const usedAmount = roundMoney(Math.max(usedFromAlloc, usedFromField));
    const grandTotal = roundMoney(Number(deposit.grand_total ?? 0));
    const remaining = roundMoney(Math.max(0, grandTotal - usedAmount));

    if (remaining <= MONEY_EPS) {
      return { success: false, error: "มัดจำใบนี้ไม่มียอดคงเหลือแล้ว" };
    }
    if (requestAmount > remaining + MONEY_EPS) {
      return {
        success: false,
        error: `ยอดทำรายการ (${requestAmount.toFixed(2)}) เกินยอดคงเหลือ (${remaining.toFixed(2)})`,
      };
    }

    let slipUrl: string | null = null;
    let originalFileName: string | null = null;
    if (slipFile instanceof File && slipFile.size > 0) {
      const uploaded = await uploadDepositSlip(supabase, slipFile);
      if ("error" in uploaded) {
        return { success: false, error: uploaded.error };
      }
      slipUrl = uploaded.url;
      slipStoragePath = uploaded.path;
      originalFileName = slipFile.name.slice(0, 255);
    }

    const applyAmount = roundMoney(Math.min(requestAmount, remaining));
    const requiresApproval =
      applyAmount > (userProfile.approval_limit || 0);

    const settlementVatRate =
      sourceVatType === "NONE" ? 0 : sourceVatRate;
    const vatSummary = calculateDocumentSummary({
      lineTotals: [applyAmount],
      discountText: null,
      vatType: sourceVatType === "NONE" ? "NONE" : "INCLUSIVE",
      vatRate: settlementVatRate,
    });
    const settlementGrand = applyAmount;
    const settlementNet = vatSummary.net_before_vat;
    const settlementVat = vatSummary.vat_amount;
    const storedVatRate = sourceVatType === "NONE" ? 0 : sourceVatRate;

    const stubDocType = resolveSettlementDocType(
      String(deposit.doc_type ?? ""),
      actionType,
    );
    if (!stubDocType) {
      if (slipStoragePath) {
        await supabase.storage
          .from(DOCUMENT_ATTACHMENTS_BUCKET)
          .remove([slipStoragePath]);
      }
      return {
        success: false,
        error: "ไม่สามารถกำหนดประเภทเอกสาร AR/AP จากมัดจำต้นทางได้",
      };
    }

    let stubDocNo = generateDraftDocumentNo();
    if (!requiresApproval) {
      const numberResult = await generateDocumentNumber(stubDocType, today);
      if (numberResult.error || !numberResult.data) {
        if (slipStoragePath) {
          await supabase.storage
            .from(DOCUMENT_ATTACHMENTS_BUCKET)
            .remove([slipStoragePath]);
        }
        return {
          success: false,
          error: numberResult.error ?? "สร้างเลขที่เอกสารไม่สำเร็จ",
        };
      }
      stubDocNo = numberResult.data;
    }

    const headerStatus = requiresApproval ? "DRAFT" : "ISSUED";
    const approvalStatus = requiresApproval ? "PENDING" : "APPROVED";
    const issuedPaid = !requiresApproval;
    const nowIso = new Date().toISOString();
    const actionLabel =
      actionType === "REFUND" ? "คืนเงินมัดจำ" : "ตัดเศษบัญชีมัดจำ";
    const notesParts = [
      `${actionLabel} จาก ${deposit.doc_no ?? depositId}`,
      `amount=${settlementGrand.toFixed(2)}`,
      `approval_limit=${userProfile.approval_limit.toFixed(2)}`,
      `requires_approval=${requiresApproval ? "true" : "false"}`,
      `vat=${sourceVatType}@${storedVatRate}%`,
      `net=${settlementNet.toFixed(2)}`,
      `vat_amt=${settlementVat.toFixed(2)}`,
      `grand=${settlementGrand.toFixed(2)}`,
      remarkClean ? `remark=${remarkClean}` : null,
      slipUrl ? "slip=attached" : null,
    ].filter(Boolean);

    const { data: stubDoc, error: stubError } = await supabase
      .from("documents")
      .insert({
        doc_no: stubDocNo,
        doc_type: stubDocType,
        status: headerStatus,
        doc_date: today,
        contact_id: deposit.contact_id,
        ref_document_id: depositId,
        sub_total: settlementNet,
        discount_amount: 0,
        tax_rate: storedVatRate,
        tax_amount: settlementVat,
        wht_rate: 0,
        wht_amount: 0,
        grand_total: settlementGrand,
        total_amount: settlementNet,
        net_before_vat: settlementNet,
        vat_amount: settlementVat,
        vat_rate: storedVatRate,
        vat_type: sourceVatType,
        deposit_deducted: 0,
        paid_amount: issuedPaid ? settlementGrand : 0,
        payment_status: issuedPaid ? "PAID" : "UNPAID",
        remark: remarkClean,
        attachment_url: slipUrl,
        attached_file_url: slipUrl,
        original_file_name: originalFileName,
        notes: notesParts.join(" | "),
        created_by: actor.userId,
        approval_status: approvalStatus,
        approved_by: requiresApproval ? null : actor.userId,
        approved_at: requiresApproval ? null : nowIso,
        updated_at: nowIso,
      })
      .select("*")
      .single();

    if (stubError || !stubDoc?.id) {
      if (slipStoragePath) {
        await supabase.storage
          .from(DOCUMENT_ATTACHMENTS_BUCKET)
          .remove([slipStoragePath]);
      }
      return {
        success: false,
        error: stubError?.message ?? `สร้างเอกสาร ${stubDocType} ไม่สำเร็จ`,
      };
    }
    stubDocId = String(stubDoc.id);
    stubDocNo = String(stubDoc.doc_no ?? stubDocNo);

    const { data: stubHeader, error: headerError } = await supabase
      .from("doc_headers")
      .insert({
        doc_no: stubDocNo,
        doc_type: stubDocType,
        doc_date: today,
        contact_id: deposit.contact_id,
        sub_total: settlementNet,
        discount_amount: 0,
        tax_rate: storedVatRate,
        tax_amount: settlementVat,
        grand_total: settlementGrand,
        deposit_deducted: 0,
        payment_status: issuedPaid ? "PAID" : "UNPAID",
        ref_doc_id: null,
        attached_file_url: slipUrl,
        original_file_name: originalFileName,
      })
      .select("id")
      .single();

    if (headerError || !stubHeader) {
      await rollbackDepositBalance(supabase, {
        stubDocId,
        stubHeaderId: null,
        depositId: null,
        previousDepositDeducted: null,
        slipStoragePath,
      });
      stubDocId = null;
      return {
        success: false,
        error:
          headerError?.message ??
          `บันทึกหัวเอกสาร ${stubDocType} (doc_headers) ไม่สำเร็จ`,
      };
    }
    stubHeaderId = String(stubHeader.id);

    const adjustmentReason = remarkClean
      ? `${actionType}: ${remarkClean}`
      : actionType;

    const { error: allocInsertError } = await supabase
      .from("document_allocations")
      .insert({
        receipt_doc_id: stubDocId,
        invoice_doc_id: depositId,
        allocated_amount: applyAmount,
        wht_amount: 0,
        adjustment_amount: 0,
        adjustment_reason: adjustmentReason,
      });

    if (allocInsertError) {
      await rollbackDepositBalance(supabase, {
        stubDocId,
        stubHeaderId,
        depositId: null,
        previousDepositDeducted: null,
        slipStoragePath,
      });
      stubDocId = null;
      stubHeaderId = null;
      return {
        success: false,
        error:
          allocInsertError.message ??
          "บันทึก document_allocations ไม่สำเร็จ",
      };
    }

    const documentData: Record<string, unknown> = {
      ...(stubDoc as Record<string, unknown>),
      user_id: actor.userId,
      approval_limit: userProfile.approval_limit,
      requires_approval: requiresApproval,
      deposit_id: depositId,
      deposit_doc_no: deposit.doc_no,
      action_type: actionType,
    };

    const insertAudit = await writeDocumentsAuditLog(supabase, {
      actorUserId: actor.userId,
      actorName: actor.displayName,
      recordId: stubDocId,
      action: "INSERT",
      oldData: null,
      newData: documentData,
    });
    if (insertAudit.error) {
      await rollbackDepositBalance(supabase, {
        stubDocId,
        stubHeaderId,
        depositId: null,
        previousDepositDeducted: null,
        slipStoragePath,
      });
      stubDocId = null;
      stubHeaderId = null;
      return {
        success: false,
        error: `บันทึก audit_logs ไม่สำเร็จ: ${insertAudit.error}`,
      };
    }

    const newDeducted = roundMoney(usedAmount + applyAmount);
    const { error: updateError } = await supabase
      .from("documents")
      .update({
        deposit_deducted: newDeducted,
        updated_at: nowIso,
      })
      .eq("id", depositId);

    if (updateError) {
      await rollbackDepositBalance(supabase, {
        stubDocId,
        stubHeaderId,
        depositId,
        previousDepositDeducted,
        slipStoragePath,
      });
      stubDocId = null;
      stubHeaderId = null;
      return {
        success: false,
        error: `อัปเดตยอดมัดจำไม่สำเร็จ: ${updateError.message}`,
      };
    }

    revalidatePath("/finance/deposits");
    revalidatePath("/sales");
    revalidatePath("/purchases");
    if (deposit.doc_no) {
      revalidatePath(`/sales/${deposit.doc_no}`);
      revalidatePath(`/purchases/${deposit.doc_no}`);
    }
    revalidatePath(`/sales/${stubDocNo}`);
    revalidatePath(`/purchases/${stubDocNo}`);
    revalidateApprovalCenterIfPending(requiresApproval);

    return {
      success: true,
      error: null,
      action_doc_no: stubDocNo,
      pending_approval: requiresApproval,
      successMessage: requiresApproval
        ? PENDING_DEPOSIT_BALANCE_MESSAGE
        : `ทำรายการสำเร็จ — ${stubDocNo}`,
    };
  } catch (err) {
    await rollbackDepositBalance(supabase, {
      stubDocId,
      stubHeaderId,
      depositId: depositIdForRollback,
      previousDepositDeducted,
      slipStoragePath,
    });
    const message =
      err instanceof Error ? err.message : "ทำรายการมัดจำไม่สำเร็จ";
    return { success: false, error: message };
  }
}
