"use server";

/**
 * Phase 5 — AP Payment (จ่ายชำระหนี้ซัพพลายเออร์) Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 *
 * Ledger source: Phase 4/5 `documents` (internal doc_no).
 * Payables: AP_TAX / AP_INV (บิลซัพพลายเออร์) + TB (สรุปวางบิลช่าง).
 * Vendor invoice ref lives in `notes` — no dedicated reference_no column yet.
 */

import { revalidatePath } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateDocumentNumber } from "@/lib/actions/document-actions";
import { syncBillingNotesAfterInvoicePayment } from "@/lib/actions/finance/billing-note-status";
import { roundMoney } from "@/lib/utils/payment-fifo";
import {
  isOverdue,
  resolveDueDate,
  todayIsoDate,
} from "@/lib/utils/outstanding-summary";
import type {
  ApAllocationInput,
  ApVendorOption,
  DepositAllocationInput,
  OutstandingApInvoice,
  SubmitAPPaymentResult,
  VendorPaymentContext,
} from "@/types/ap-payment";
import { AP_PAYABLE_DOC_TYPES } from "@/lib/constants/document";
import { getAvailableDepositsForContact } from "@/lib/actions/finance/available-deposits";

const OPEN_PAYMENT_STATUSES = ["UNPAID", "PARTIAL", "Pending"] as const;
const MONEY_EPS = 0.02;
const DOCUMENT_ATTACHMENTS_BUCKET = "document_attachments";
const ALLOWED_SLIP_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);
const CASH_ACCOUNT_SENTINEL = "CASH";


/**
 * Raw service-role client — bypasses RLS.
 * Never falls back to anon / SSR cookie clients.
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

type ContactJoin = {
  id?: string;
  company_name?: string | null;
  credit_days?: number | null;
};

type ApDocRow = {
  id: string;
  contact_id: string | null;
  doc_no: string | null;
  notes?: string | null;
  doc_date: string | null;
  due_date?: string | null;
  grand_total: number | string | null;
  total_amount?: number | string | null;
  paid_amount?: number | string | null;
  payment_status: string | null;
  doc_type: string | null;
  contacts?: ContactJoin | ContactJoin[] | null;
};

type SummaryBucket = {
  name: string;
  outstanding_total: number;
  overdue_amount: number;
  invoice_count: number;
  oldest_invoice_date: string | null;
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

function minDate(
  current: string | null,
  next: string,
): string | null {
  if (!next) return current;
  if (!current) return next;
  return next < current ? next : current;
}

/** Extract vendor invoice no from Goods Receipt notes pattern. */
function extractVendorReference(notes: string | null | undefined): string | null {
  const raw = notes?.trim() ?? "";
  if (!raw) return null;
  const match = raw.match(/อ้างอิงบิลซัพพลายเออร์:\s*(.+)$/m);
  const value = match?.[1]?.trim() ?? "";
  return value || null;
}

/**
 * Outstanding AP summary by vendor (Server-calculated overdue + oldest invoice).
 * Alias used by Outstanding Summary Table / Smart Combobox.
 */
export async function getOutstandingSummary(): Promise<ApVendorOption[]> {
  return getVendors();
}

/**
 * Vendors / technicians with outstanding AP > 0 (from `documents`).
 * Includes AP_TAX, AP_INV, and TB (Technician Bill).
 */
export async function getVendors(): Promise<ApVendorOption[]> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const today = todayIsoDate();

    const { data, error } = await supabaseAdmin
      .from("documents")
      .select(
        `
        contact_id,
        doc_date,
        due_date,
        grand_total,
        total_amount,
        paid_amount,
        payment_status,
        contacts:contact_id (
          id,
          company_name,
          credit_days
        )
      `,
      )
      .in("doc_type", [...AP_PAYABLE_DOC_TYPES])
      .in("payment_status", [...OPEN_PAYMENT_STATUSES])
      .in("status", ["ISSUED", "COMPLETED"])
      .or("is_voided.is.null,is_voided.eq.false");

    if (error) {
      console.error("Error fetching AP outstanding summary:", error.message);
      return [];
    }

    const grouped = new Map<string, SummaryBucket>();

    for (const raw of (data ?? []) as ApDocRow[]) {
      const contact = unwrapContact(raw.contacts);
      const vendorId = raw.contact_id?.trim() || contact?.id || "";
      if (!vendorId) continue;

      const grand = toMoney(raw.grand_total ?? raw.total_amount);
      const remaining = roundMoney(grand - toMoney(raw.paid_amount));
      if (remaining <= 0) continue;

      const docDate = raw.doc_date ? String(raw.doc_date) : "";
      const due = resolveDueDate(docDate, raw.due_date, contact?.credit_days);
      const overdue = isOverdue(due, today) ? remaining : 0;

      const existing = grouped.get(vendorId);
      if (!existing) {
        grouped.set(vendorId, {
          name: contact?.company_name?.trim() || "ไม่ระบุชื่อผู้จำหน่าย",
          outstanding_total: remaining,
          overdue_amount: overdue,
          invoice_count: 1,
          oldest_invoice_date: docDate || null,
        });
        continue;
      }

      existing.outstanding_total = roundMoney(
        existing.outstanding_total + remaining,
      );
      existing.overdue_amount = roundMoney(existing.overdue_amount + overdue);
      existing.invoice_count += 1;
      existing.oldest_invoice_date = minDate(
        existing.oldest_invoice_date,
        docDate,
      );
    }

    return Array.from(grouped.entries())
      .map(([id, row]) => ({
        id,
        name: row.name,
        outstanding_total: row.outstanding_total,
        invoice_count: row.invoice_count,
        overdue_amount: row.overdue_amount,
        oldest_invoice_date: row.oldest_invoice_date,
      }))
      .filter((row) => row.outstanding_total > 0)
      .sort((a, b) => b.outstanding_total - a.outstanding_total);
  } catch (err) {
    console.error("Error fetching AP outstanding summary:", err);
    return [];
  }
}

/**
 * Outstanding AP invoices + available DEP_OUT for one vendor (`vendor_id` from URL).
 * Includes AP_TAX, AP_INV, and TB (Technician Bill) for PAY knock-off.
 * Internal `document_no` = documents.doc_no.
 * Vendor ref parsed from `notes` (documents has no reference_no column yet).
 * Sorted by document_date ASC for FIFO.
 */
export async function getOutstandingAP(
  vendorId: string,
): Promise<VendorPaymentContext> {
  const trimmed = vendorId?.trim() ?? "";
  if (!trimmed) {
    return { invoices: [], availableDeposits: [] };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("documents")
      .select(
        `
        id,
        contact_id,
        doc_no,
        notes,
        doc_date,
        grand_total,
        total_amount,
        paid_amount,
        payment_status,
        doc_type
      `,
      )
      .eq("contact_id", trimmed)
      .in("doc_type", [...AP_PAYABLE_DOC_TYPES])
      .in("payment_status", [...OPEN_PAYMENT_STATUSES])
      .in("status", ["ISSUED", "COMPLETED"])
      .or("is_voided.is.null,is_voided.eq.false")
      .order("doc_date", { ascending: true });

    if (error) {
      console.error("Error fetching outstanding AP:", error.message);
      return { invoices: [], availableDeposits: [] };
    }

    const invoices = ((data ?? []) as ApDocRow[])
      .map((doc) => {
        const grandTotal = roundMoney(
          toMoney(doc.grand_total ?? doc.total_amount),
        );
        const paidAmount = roundMoney(toMoney(doc.paid_amount));
        const remaining = roundMoney(grandTotal - paidAmount);
        return {
          id: doc.id,
          contact_id: doc.contact_id?.trim() || trimmed,
          document_no: doc.doc_no?.trim() || "ไม่ระบุ",
          reference_no: extractVendorReference(doc.notes),
          document_date: doc.doc_date ? String(doc.doc_date) : "",
          grand_total: grandTotal,
          paid_amount: paidAmount,
          remaining_balance: remaining,
          payment_status: String(doc.payment_status ?? "UNPAID"),
          doc_type: doc.doc_type ?? "",
        } satisfies OutstandingApInvoice;
      })
      .filter((inv) => inv.remaining_balance > 0);

    const availableDeposits = await getAvailableDepositsForContact(
      trimmed,
      "DEP_OUT",
      supabaseAdmin,
    );

    return { invoices, availableDeposits };
  } catch (err) {
    console.error("Error fetching outstanding AP:", err);
    return { invoices: [], availableDeposits: [] };
  }
}

function parseAllocationsJson(
  raw: FormDataEntryValue | null,
): ApAllocationInput[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          invoice_id: String(item.invoice_id ?? "").trim(),
          allocated_amount: roundMoney(Number(item.allocated_amount ?? 0)),
        };
      })
      .filter((row) => row.invoice_id.length > 0);
  } catch {
    return [];
  }
}

function parseDepositsJson(
  raw: FormDataEntryValue | null,
): DepositAllocationInput[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          deposit_id: String(item.deposit_id ?? "").trim(),
          allocated_amount: roundMoney(Number(item.allocated_amount ?? 0)),
        };
      })
      .filter((row) => row.deposit_id.length > 0 && row.allocated_amount > 0);
  } catch {
    return [];
  }
}

function resolvePaymentStatus(
  grandTotal: number,
  newPaidAmount: number,
): "UNPAID" | "PARTIAL" | "PAID" {
  if (newPaidAmount <= MONEY_EPS) return "UNPAID";
  if (newPaidAmount >= roundMoney(grandTotal) - MONEY_EPS) return "PAID";
  return "PARTIAL";
}

async function uploadPaymentSlip(
  supabaseAdmin: SupabaseClient,
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
  const objectPath = `ap-payment/${yyyy}/${mm}/${crypto.randomUUID()}${extFromName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabaseAdmin.storage
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

  const { data: publicData } = supabaseAdmin.storage
    .from(DOCUMENT_ATTACHMENTS_BUCKET)
    .getPublicUrl(objectPath);

  const url = publicData?.publicUrl?.trim();
  if (!url) {
    return { error: "อัปโหลดสลิปสำเร็จ แต่สร้าง URL ไม่ได้" };
  }

  return { url, path: objectPath };
}

/**
 * Submit AP Payment (Knock-off):
 * A) generate PAY doc no
 * B) upload slip → Storage
 * C) insert PAY header (documents + doc_headers)
 * D) insert document_allocations
 * E) update AP invoice paid_amount / payment_status
 */
export async function submitAPPayment(
  formData: FormData,
): Promise<SubmitAPPaymentResult> {
  const supabaseAdmin = createSupabaseAdminClient();
  let payDocId: string | null = null;
  let payHeaderId: string | null = null;
  let slipStoragePath: string | null = null;

  try {
    const vendorId = String(formData.get("vendor_id") ?? "").trim();
    const paymentDateRaw = String(formData.get("payment_date") ?? "").trim();
    const bankAccountRaw = String(formData.get("bank_account_id") ?? "").trim();
    const referenceNo =
      String(formData.get("reference_no") ?? "").trim() || null;
    const allocations = parseAllocationsJson(formData.get("allocations_json"));
    const depositAllocations = parseDepositsJson(
      formData.get("deposits_json"),
    );
    const slipFile = formData.get("slip_file");

    const paymentDate = /^\d{4}-\d{2}-\d{2}$/.test(paymentDateRaw)
      ? paymentDateRaw
      : todayIsoDate();

    const activeAllocations = allocations.filter(
      (row) => row.allocated_amount > 0,
    );
    const totalInvoicePaid = roundMoney(
      activeAllocations.reduce((sum, row) => sum + row.allocated_amount, 0),
    );
    const depositTotal = roundMoney(
      depositAllocations.reduce((sum, row) => sum + row.allocated_amount, 0),
    );
    // Net cash out = invoices − deposits (floored at 0)
    const totalPaid = roundMoney(Math.max(0, totalInvoicePaid - depositTotal));

    if (!vendorId) {
      return { success: false, error: "ไม่พบรหัสผู้จำหน่าย" };
    }
    if (activeAllocations.length === 0 || totalInvoicePaid <= 0) {
      return {
        success: false,
        error: "ห้ามบันทึก — ผลรวมยอดตัดหนี้ (Allocations) ต้องมากกว่า 0",
      };
    }
    if (depositTotal > totalInvoicePaid + MONEY_EPS) {
      return {
        success: false,
        error: `ยอดมัดจำที่ใช้ (${depositTotal.toFixed(2)}) เกินยอดตัดหนี้ (${totalInvoicePaid.toFixed(2)})`,
      };
    }
    if (!bankAccountRaw) {
      return {
        success: false,
        error: "กรุณาเลือกสมุดบัญชีธนาคาร หรือเงินสด",
      };
    }

    const isCash = bankAccountRaw === CASH_ACCOUNT_SENTINEL;
    let bankAccountId: string | null = null;

    if (!isCash) {
      bankAccountId = bankAccountRaw;
      const { data: bank, error: bankError } = await supabaseAdmin
        .from("mst_bank_accounts")
        .select("id, is_active")
        .eq("id", bankAccountId)
        .maybeSingle();

      if (bankError || !bank) {
        return { success: false, error: "ไม่พบสมุดบัญชีที่เลือก" };
      }
      if (bank.is_active === false) {
        return { success: false, error: "สมุดบัญชีนี้ถูกปิดการใช้งานแล้ว" };
      }
    }

    const invoiceIds = activeAllocations.map((row) => row.invoice_id);
    const { data: invoices, error: invoicesError } = await supabaseAdmin
      .from("documents")
      .select(
        "id, contact_id, grand_total, total_amount, paid_amount, payment_status, doc_type, status, is_voided",
      )
      .in("id", invoiceIds);

    if (invoicesError) {
      return {
        success: false,
        error: invoicesError.message ?? "โหลดบิลต้นทางไม่สำเร็จ",
      };
    }

    const invoiceMap = new Map(
      (invoices ?? []).map((row) => [row.id as string, row]),
    );

    for (const alloc of activeAllocations) {
      const invoice = invoiceMap.get(alloc.invoice_id);
      if (!invoice) {
        return {
          success: false,
          error: `ไม่พบบิลต้นทาง ${alloc.invoice_id}`,
        };
      }
      if (invoice.contact_id !== vendorId) {
        return {
          success: false,
          error: "พบบิลที่ไม่ใช่ของผู้จำหน่ายรายนี้",
        };
      }
      if (invoice.is_voided === true) {
        return { success: false, error: "มีบิลที่ถูกยกเลิก ไม่สามารถตัดยอดได้" };
      }
      if (invoice.status !== "ISSUED" && invoice.status !== "COMPLETED") {
        return {
          success: false,
          error: "ตัดยอดได้เฉพาะบิลที่ออกแล้ว (ISSUED/COMPLETED)",
        };
      }
      if (
        !AP_PAYABLE_DOC_TYPES.includes(
          invoice.doc_type as (typeof AP_PAYABLE_DOC_TYPES)[number],
        )
      ) {
        return {
          success: false,
          error: `ประเภทเอกสารไม่รองรับการตัดหนี้: ${invoice.doc_type}`,
        };
      }

      const grandTotal = toMoney(invoice.grand_total ?? invoice.total_amount);
      const paidAmount = toMoney(invoice.paid_amount);
      const remaining = roundMoney(grandTotal - paidAmount);

      if (alloc.allocated_amount > remaining + MONEY_EPS) {
        return {
          success: false,
          error: `ยอดตัดหนี้เกินยอดค้างของบิล (เหลือ ${remaining.toFixed(2)})`,
        };
      }
    }

    // Validate DEP_OUT deposits
    if (depositAllocations.length > 0) {
      const depositIds = depositAllocations.map((row) => row.deposit_id);
      const { data: deposits, error: depositsError } = await supabaseAdmin
        .from("documents")
        .select(
          "id, contact_id, grand_total, deposit_deducted, doc_type, status, is_voided",
        )
        .in("id", depositIds);

      if (depositsError) {
        return {
          success: false,
          error: depositsError.message ?? "โหลดเอกสารมัดจำไม่สำเร็จ",
        };
      }

      const depositMap = new Map(
        (deposits ?? []).map((row) => [row.id as string, row]),
      );

      const { data: priorDepositAllocs } = await supabaseAdmin
        .from("document_allocations")
        .select("invoice_doc_id, allocated_amount")
        .in("invoice_doc_id", depositIds);

      const usedByDeposit = new Map<string, number>();
      for (const row of priorDepositAllocs ?? []) {
        const id = String(row.invoice_doc_id);
        usedByDeposit.set(
          id,
          roundMoney(
            (usedByDeposit.get(id) ?? 0) + toMoney(row.allocated_amount),
          ),
        );
      }

      for (const alloc of depositAllocations) {
        const deposit = depositMap.get(alloc.deposit_id);
        if (!deposit) {
          return {
            success: false,
            error: `ไม่พบเอกสารมัดจำ ${alloc.deposit_id}`,
          };
        }
        if (deposit.contact_id !== vendorId) {
          return {
            success: false,
            error: "พบมัดจำที่ไม่ใช่ของผู้จำหน่ายรายนี้",
          };
        }
        if (deposit.is_voided === true) {
          return { success: false, error: "มีมัดจำที่ถูกยกเลิก" };
        }
        if (deposit.doc_type !== "DEP_OUT") {
          return {
            success: false,
            error: `ประเภทมัดจำไม่ถูกต้อง: ${deposit.doc_type}`,
          };
        }
        const grand = toMoney(deposit.grand_total);
        const used = roundMoney(
          Math.max(
            usedByDeposit.get(alloc.deposit_id) ?? 0,
            toMoney(deposit.deposit_deducted),
          ),
        );
        const remaining = roundMoney(grand - used);
        if (alloc.allocated_amount > remaining + MONEY_EPS) {
          return {
            success: false,
            error: `ยอดมัดจำเกินคงเหลือ (เหลือ ${remaining.toFixed(2)})`,
          };
        }
      }
    }

    // Step A — PAY running number
    const numberResult = await generateDocumentNumber("PAY", paymentDate);
    if (!numberResult.data) {
      return {
        success: false,
        error: numberResult.error ?? "สร้างเลขที่เอกสาร PAY ไม่สำเร็จ",
      };
    }
    const payDocNo = numberResult.data;
    const nowIso = new Date().toISOString();
    const paymentDateIso = `${paymentDate}T00:00:00.000Z`;

    // Step B — Slip upload (optional)
    let slipUrl: string | null = null;
    if (slipFile instanceof File && slipFile.size > 0) {
      const uploaded = await uploadPaymentSlip(supabaseAdmin, slipFile);
      if ("error" in uploaded) {
        return { success: false, error: uploaded.error };
      }
      slipUrl = uploaded.url;
      slipStoragePath = uploaded.path;
    }

    // Step C — PAY header on documents (ledger used by allocations FK)
    // grand_total = มูลค่าบิลที่ตัดยอด (ไม่หักมัดจำ)
    // cash fields = เงินจ่ายจริงหลังหักมัดจำ (totalPaid)
    const { data: payDoc, error: payDocError } = await supabaseAdmin
      .from("documents")
      .insert({
        doc_no: payDocNo,
        doc_type: "PAY",
        status: "COMPLETED",
        doc_date: paymentDate,
        contact_id: vendorId,
        sub_total: totalPaid,
        discount_amount: 0,
        tax_rate: 0,
        tax_amount: 0,
        wht_rate: 0,
        wht_amount: 0,
        grand_total: totalInvoicePaid,
        total_amount: totalPaid,
        net_before_vat: totalPaid,
        vat_amount: 0,
        vat_rate: 0,
        vat_type: "NONE",
        paid_amount: totalPaid,
        payment_status: "PAID",
        attachment_url: slipUrl,
        attached_file_url: slipUrl,
        original_file_name:
          slipFile instanceof File && slipFile.size > 0
            ? slipFile.name.slice(0, 255)
            : null,
        notes: `AP Knock-off | invoices=${totalInvoicePaid} | deposit=${depositTotal} | cash=${totalPaid}${referenceNo ? ` | ref=${referenceNo}` : ""}`,
        updated_at: nowIso,
      })
      .select("id, doc_no")
      .single();

    if (payDocError || !payDoc) {
      if (slipStoragePath) {
        await supabaseAdmin.storage
          .from(DOCUMENT_ATTACHMENTS_BUCKET)
          .remove([slipStoragePath]);
      }
      return {
        success: false,
        error: payDocError?.message ?? "สร้างเอกสารจ่ายชำระ (PAY) ไม่สำเร็จ",
      };
    }

    payDocId = payDoc.id as string;

    // Legacy mirror on doc_headers (Blueprint Step C)
    const { data: payHeader, error: payHeaderError } = await supabaseAdmin
      .from("doc_headers")
      .insert({
        doc_no: payDocNo,
        doc_type: "PAY",
        doc_date: paymentDate,
        contact_id: vendorId,
        sub_total: totalPaid,
        discount_amount: 0,
        grand_total: totalInvoicePaid,
        payment_status: "PAID",
        attached_file_url: slipUrl,
        original_file_name:
          slipFile instanceof File && slipFile.size > 0
            ? slipFile.name.slice(0, 255)
            : null,
      })
      .select("id")
      .single();

    if (payHeaderError || !payHeader) {
      await supabaseAdmin.from("documents").delete().eq("id", payDocId);
      if (slipStoragePath) {
        await supabaseAdmin.storage
          .from(DOCUMENT_ATTACHMENTS_BUCKET)
          .remove([slipStoragePath]);
      }
      return {
        success: false,
        error:
          payHeaderError?.message ??
          "สร้างหัวเอกสาร PAY (doc_headers) ไม่สำเร็จ",
      };
    }
    payHeaderId = payHeader.id as string;

    const { error: txError } = await supabaseAdmin
      .from("payment_transactions")
      .insert({
        document_id: payDocId,
        payment_method: isCash ? "CASH" : "BANK_TRANSFER",
        bank_account_id: bankAccountId,
        amount: totalPaid,
        reference_no: referenceNo,
        payment_date: paymentDateIso,
        attachment_url: slipUrl,
        is_reconciled: false,
        is_voided: false,
      });

    if (txError) {
      await supabaseAdmin.from("doc_headers").delete().eq("id", payHeaderId);
      await supabaseAdmin.from("documents").delete().eq("id", payDocId);
      if (slipStoragePath) {
        await supabaseAdmin.storage
          .from(DOCUMENT_ATTACHMENTS_BUCKET)
          .remove([slipStoragePath]);
      }
      return {
        success: false,
        error: txError.message ?? "บันทึก payment_transactions ไม่สำเร็จ",
      };
    }

    // Step D — allocations (PAY → AP invoices + DEP_OUT)
    const allocationRows = [
      ...activeAllocations.map((row) => ({
        receipt_doc_id: payDocId,
        invoice_doc_id: row.invoice_id,
        allocated_amount: row.allocated_amount,
        wht_amount: 0,
        adjustment_amount: 0,
        adjustment_reason: null as string | null,
      })),
      ...depositAllocations.map((row) => ({
        receipt_doc_id: payDocId,
        invoice_doc_id: row.deposit_id,
        allocated_amount: row.allocated_amount,
        wht_amount: 0,
        adjustment_amount: 0,
        adjustment_reason: "DEPOSIT_APPLY",
      })),
    ];

    const { error: allocError } = await supabaseAdmin
      .from("document_allocations")
      .insert(allocationRows);

    if (allocError) {
      await supabaseAdmin
        .from("payment_transactions")
        .delete()
        .eq("document_id", payDocId);
      await supabaseAdmin.from("doc_headers").delete().eq("id", payHeaderId);
      await supabaseAdmin.from("documents").delete().eq("id", payDocId);
      if (slipStoragePath) {
        await supabaseAdmin.storage
          .from(DOCUMENT_ATTACHMENTS_BUCKET)
          .remove([slipStoragePath]);
      }
      return {
        success: false,
        error: allocError.message ?? "บันทึก document_allocations ไม่สำเร็จ",
      };
    }

    // Step E — update source AP invoices
    const touchedInvoiceIds: string[] = [];
    for (const alloc of activeAllocations) {
      const invoice = invoiceMap.get(alloc.invoice_id)!;
      const grandTotal = toMoney(invoice.grand_total ?? invoice.total_amount);
      const prevPaid = toMoney(invoice.paid_amount);
      const newPaid = roundMoney(prevPaid + alloc.allocated_amount);
      const nextPaymentStatus = resolvePaymentStatus(grandTotal, newPaid);
      // document_status ENUM has no PARTIAL — COMPLETED only when fully paid.
      const nextDocStatus =
        nextPaymentStatus === "PAID" ? "COMPLETED" : "ISSUED";

      const { error: updateError } = await supabaseAdmin
        .from("documents")
        .update({
          paid_amount: newPaid,
          payment_status: nextPaymentStatus,
          status: nextDocStatus,
          updated_at: nowIso,
        })
        .eq("id", alloc.invoice_id);

      if (updateError) {
        return {
          success: false,
          error: `บันทึก PAY ${payDocNo} แล้ว แต่อัปเดตบิลต้นทางไม่สำเร็จ: ${updateError.message}`,
          payment_doc_no: payDocNo,
        };
      }
      touchedInvoiceIds.push(alloc.invoice_id);
    }

    if (touchedInvoiceIds.length > 0) {
      const bnSync = await syncBillingNotesAfterInvoicePayment(
        supabaseAdmin,
        touchedInvoiceIds,
      );
      if (bnSync.error) {
        return {
          success: false,
          error: `บันทึก PAY ${payDocNo} แล้ว แต่อัปเดตสถานะใบรับวางบิลไม่สำเร็จ: ${bnSync.error}`,
          payment_doc_no: payDocNo,
        };
      }
    }

    // Step F — update deposit_deducted on DEP_OUT
    for (const alloc of depositAllocations) {
      const { data: depositRow, error: depositLoadError } = await supabaseAdmin
        .from("documents")
        .select("id, deposit_deducted, grand_total, doc_no")
        .eq("id", alloc.deposit_id)
        .maybeSingle();

      if (depositLoadError || !depositRow) {
        return {
          success: false,
          error: `บันทึก PAY ${payDocNo} แล้ว แต่อัปเดตมัดจำไม่สำเร็จ`,
          payment_doc_no: payDocNo,
        };
      }

      const prevDeducted = toMoney(depositRow.deposit_deducted);
      const newDeducted = roundMoney(prevDeducted + alloc.allocated_amount);

      const { error: depositUpdateError } = await supabaseAdmin
        .from("documents")
        .update({
          deposit_deducted: newDeducted,
          updated_at: nowIso,
        })
        .eq("id", alloc.deposit_id);

      if (depositUpdateError) {
        return {
          success: false,
          error: `บันทึก PAY ${payDocNo} แล้ว แต่อัปเดตมัดจำไม่สำเร็จ: ${depositUpdateError.message}`,
          payment_doc_no: payDocNo,
        };
      }

      if (depositRow.doc_no) {
        await supabaseAdmin
          .from("doc_headers")
          .update({ deposit_deducted: newDeducted })
          .eq("doc_no", depositRow.doc_no)
          .eq("doc_type", "DEP_OUT");
      }
    }

    revalidatePath("/finance/ap-payment");
    revalidatePath("/finance/ap-ar");
    revalidatePath("/finance/deposits");
    revalidatePath("/finance/billing-notes");
    revalidatePath("/purchases");

    return {
      success: true,
      error: null,
      payment_doc_no: payDocNo,
    };
  } catch (err) {
    if (payDocId) {
      await supabaseAdmin
        .from("document_allocations")
        .delete()
        .eq("receipt_doc_id", payDocId);
      await supabaseAdmin
        .from("payment_transactions")
        .delete()
        .eq("document_id", payDocId);
      await supabaseAdmin.from("documents").delete().eq("id", payDocId);
    }
    if (payHeaderId) {
      await supabaseAdmin.from("doc_headers").delete().eq("id", payHeaderId);
    }
    if (slipStoragePath) {
      await supabaseAdmin.storage
        .from(DOCUMENT_ATTACHMENTS_BUCKET)
        .remove([slipStoragePath]);
    }
    const message =
      err instanceof Error ? err.message : "บันทึกการจ่ายชำระหนี้ไม่สำเร็จ";
    return { success: false, error: message };
  }
}
