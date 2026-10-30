"use server";

/**
 * Phase 5 — Billing Note (BN / BR) Server Actions.
 * Zero Client-Side Fetching: Service Role via `@/utils/supabase/server`.
 *
 * Ledger for Billing Note header + lines: `doc_headers` + `billing_note_items`.
 * Outstanding balance may be enriched from `documents.paid_amount` by `doc_no`
 * (doc_headers has no paid_amount column).
 */

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import { createClient } from "@/utils/supabase/server";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { roundMoney } from "@/lib/utils/payment-fifo";
import { resolveDueDate } from "@/lib/utils/outstanding-summary";
import type {
  ApPeriodInvoice,
  ApPeriodVendorSummary,
  CreateBatchBillingNotesResult,
  GetUnbilledApSummaryResult,
  BillingCategory,
  BillingNoteDocType,
  BillingNoteInvoiceLine,
  BillingNoteLinkedInvoice,
  BillingNoteListItem,
  CreateBillingNoteInput,
  CreateBillingNoteResult,
  GetBillingNoteByIdResult,
  BillingNoteSettlement,
  GetBillingNotesResult,
  PendingBillReceipt,
  GetInvoicesByBillingNoteResult,
  GetOpenBillingNotesResult,
  GetOutstandingContactsSummaryResult,
  GetUnbilledApVendorQueueResult,
  GetUnbilledInvoicesResult,
  OutstandingContactSummary,
  UnbilledApVendorQueueItem,
  UnbilledInvoice,
} from "@/types/billing";

const AR_INVOICE_TYPES = ["INV_DO", "TAX_INV"] as const;
const AP_INVOICE_TYPES = ["AP_INV", "AP_TAX"] as const;
/** document_status ENUM — billable invoices must be ISSUED only. */
const BILLABLE_DOC_STATUS = "ISSUED" as const;
const ACTIVE_BN_PAYMENT_STATUSES = [
  "PENDING",
  "Pending",
  "UNPAID",
  "PARTIAL",
] as const;
const MONEY_EPS = 0.02;

type DocHeaderRow = {
  id: string;
  doc_no: string;
  doc_type: string;
  doc_date: string;
  due_date: string | null;
  grand_total: number | string | null;
  payment_status: string | null;
  contact_id: string;
};

type ContactJoin = {
  id?: string;
  company_name?: string | null;
  tax_id?: string | null;
  address?: string | null;
  phone?: string | null;
  branch_code?: string | null;
  contact_roles?: string[] | null;
};

type LedgerInvoiceRow = {
  id: string;
  doc_no: string | null;
  doc_type: string | null;
  doc_date: string | null;
  due_date: string | null;
  reference_no?: string | null;
  grand_total: number | string | null;
  paid_amount: number | string | null;
  payment_status: string | null;
  status: string | null;
  contact_id: string | null;
  is_voided?: boolean | null;
  contacts?: ContactJoin | ContactJoin[] | null;
};

async function loadTaxInvoiceNumbers(
  supabase: SupabaseAdmin,
  documentIds: string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const ids = documentIds.filter(Boolean);
  if (ids.length === 0) return found;
  const loose = supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        in: (
          column: string,
          values: string[],
        ) => Promise<{
          data: { id: string; tax_invoice_no?: string | null }[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  for (let index = 0; index < ids.length; index += 200) {
    const chunk = ids.slice(index, index + 200);
    const { data, error } = await loose
      .from("documents")
      .select("id, tax_invoice_no")
      .in("id", chunk);
    if (error) return found;
    for (const row of data ?? []) {
      const number = String(row.tax_invoice_no ?? "").trim();
      if (number) found.set(row.id, number);
    }
  }
  return found;
}

function isMissingPeriodRpc(message: string): boolean {
  return /get_unbilled_ap_summary_by_period|PGRST202|schema cache|does not exist|could not find the function/i.test(
    message,
  );
}

function isMissingVendorQueueRpc(message: string): boolean {
  return /get_unbilled_ap_vendor_queue|PGRST202|schema cache|does not exist|could not find the function/i.test(
    message,
  );
}

function normalizeVendorQueue(data: unknown): UnbilledApVendorQueueItem[] | null {
  if (!Array.isArray(data)) return null;
  const items: UnbilledApVendorQueueItem[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const contactId = String(row.contact_id ?? row.vendor_id ?? "").trim();
    if (!contactId) continue;
    items.push({
      contact_id: contactId,
      contact_name: String(row.contact_name ?? row.company_name ?? "ไม่ระบุชื่อคู่ค้า").trim() || "ไม่ระบุชื่อคู่ค้า",
      invoice_count: Math.max(0, Number(row.invoice_count ?? row.bill_count ?? 0) || 0),
      unbilled_count:
        row.unbilled_count == null || row.unbilled_count === ""
          ? null
          : Math.max(0, Number(row.unbilled_count) || 0),
      total_outstanding: roundMoney(toMoney(row.total_outstanding as number | string | null)),
    });
  }
  if (items.length === 0 && data.length > 0) return null;
  return items;
}

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function resolveInvoiceDocTypes(
  category: BillingCategory,
): readonly string[] {
  return category === "AR" ? AR_INVOICE_TYPES : AP_INVOICE_TYPES;
}

function resolveBillingDocType(category: BillingCategory): "BN" | "BR" {
  return category === "AR" ? "BN" : "BR";
}

function billingNoteRunningPrefix(docType: "BN" | "BR", documentDate: string): string {
  const yymm = `${documentDate.slice(2, 4)}${documentDate.slice(5, 7)}`;
  return `${docType}-${yymm}-`;
}

/** Last 1–4 digits of a `PREFIX-YYMM-XXXX` number. Non-matching tails do not vote. */
function billingNoteSequence(docNo: string, runningPrefix: string): number {
  if (!docNo.startsWith(runningPrefix)) return 0;
  const tail = docNo.slice(runningPrefix.length);
  const match = tail.match(/^(\d{1,4})$/);
  return match ? Number(match[1]) : 0;
}

function isDuplicateDocNo(error: { code?: string; message?: string } | null): boolean {
  const message = error?.message ?? "";
  return error?.code === "23505" || /duplicate key|unique constraint/i.test(message);
}

/**
 * Next BN/BR number from the highest 4-digit tail in BOTH ledgers.
 * The scan is company-wide: never filter by contact_id.
 */
async function allocateBillingNoteDocNo(
  supabase: SupabaseAdmin,
  docType: "BN" | "BR",
  documentDate: string,
): Promise<{ docNo: string | null; error: string | null }> {
  const runningPrefix = billingNoteRunningPrefix(docType, documentDate);
  const pattern = `${runningPrefix}%`;

  async function listDocNos(table: "doc_headers" | "documents") {
    return fetchAllPages<{ doc_no: string | null }>((from, to) =>
      supabase
        .from(table)
        .select("doc_no")
        .like("doc_no", pattern)
        .order("doc_no", { ascending: true })
        .range(from, to),
    );
  }

  const [headers, documents] = await Promise.all([
    listDocNos("doc_headers"),
    listDocNos("documents"),
  ]);
  if (headers.error) return { docNo: null, error: headers.error.message };
  if (documents.error) return { docNo: null, error: documents.error.message };

  let maxSeq = 0;
  for (const row of [...headers.data, ...documents.data]) {
    maxSeq = Math.max(maxSeq, billingNoteSequence(String(row.doc_no ?? "").trim(), runningPrefix));
  }
  const nextSeq = maxSeq + 1;
  if (nextSeq > 9999) {
    return { docNo: null, error: `เลขที่เอกสาร ${runningPrefix} เกิน 9999` };
  }
  return {
    docNo: `${runningPrefix}${String(nextSeq).padStart(4, "0")}`,
    error: null,
  };
}

function sanitizeSearch(raw: string): string {
  return raw.replace(/[%_,.()]/g, " ").trim();
}

function invoiceKey(docType: string, docNo: string): string {
  return `${docType}::${docNo}`;
}

function unwrapContact(
  value: ContactJoin | ContactJoin[] | null | undefined,
): ContactJoin | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

type BillingNoteHeaderRow = {
  id: string;
  doc_no: string | null;
  doc_type: string | null;
  doc_date: string | null;
  due_date: string | null;
  grand_total: number | string | null;
  payment_status: string | null;
  contact_id: string | null;
  contacts?: ContactJoin | ContactJoin[] | null;
};

/**
 * List Billing Notes (BN) / Bill Receipts (BR) from `doc_headers`.
 * Optional search filters by document no or contact name.
 */
export async function getBillingNotes(
  type: BillingNoteDocType,
  search?: string,
): Promise<GetBillingNotesResult> {
  try {
    if (type !== "BN" && type !== "BR") {
      return { data: [], error: `ประเภทเอกสารไม่ถูกต้อง: ${String(type)}` };
    }

    const supabase = createClient();
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
      .from("doc_headers")
      .select(
        `
        id,
        doc_no,
        doc_type,
        doc_date,
        due_date,
        grand_total,
        payment_status,
        contact_id,
        contacts:contact_id (
          id,
          company_name
        )
      `,
      )
      .eq("doc_type", type)
      .order("doc_date", { ascending: false });

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

    const { data, error } = await query;

    if (error) {
      return {
        data: [],
        error: error.message ?? "ดึงรายการใบวางบิลไม่สำเร็จ",
      };
    }

    const rows: BillingNoteListItem[] = ((data ?? []) as BillingNoteHeaderRow[])
      .map((row) => {
        const contact = unwrapContact(row.contacts);
        return {
          id: row.id,
          doc_no: row.doc_no?.trim() || "—",
          doc_type: (row.doc_type === "BR" ? "BR" : "BN") as BillingNoteDocType,
          doc_date: row.doc_date ? String(row.doc_date) : "",
          due_date: row.due_date ? String(row.due_date) : null,
          contact_id: row.contact_id ?? contact?.id ?? "",
          contact_name:
            contact?.company_name?.trim() || "ไม่ระบุชื่อคู่ค้า",
          grand_total: roundMoney(toMoney(row.grand_total)),
          payment_status: String(row.payment_status ?? "PENDING"),
          invoice_count: 0,
        };
      });

    const noteIds = rows.map((row) => row.id).filter(Boolean);
    if (noteIds.length > 0) {
      const counts = new Map<string, number>();
      for (let index = 0; index < noteIds.length; index += 200) {
        const chunk = noteIds.slice(index, index + 200);
        const { data: itemRows } = await supabase
          .from("billing_note_items")
          .select("billing_note_id")
          .in("billing_note_id", chunk);
        for (const item of itemRows ?? []) {
          const noteId = String(item.billing_note_id ?? "");
          if (!noteId) continue;
          counts.set(noteId, (counts.get(noteId) ?? 0) + 1);
        }
      }
      for (const row of rows) {
        row.invoice_count = counts.get(row.id) ?? 0;
      }
    }

    return { data: rows, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ดึงรายการใบวางบิลไม่สำเร็จ";
    return { data: [], error: message };
  }
}

export async function getPendingBillReceipts(): Promise<{
  data: PendingBillReceipt[];
  error: string | null;
}> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: [], error: owner.error };
    const supabase = createClient();
    const { data, error } = await supabase
      .from("doc_headers")
      .select("id, doc_no, contact_id, grand_total, payment_status")
      .eq("doc_type", "BR")
      .in("payment_status", ["PENDING", "Pending", "UNPAID", "PARTIAL"])
      .order("doc_date", { ascending: false });
    if (error) return { data: [], error: error.message };
    return {
      data: (data ?? []).map((row) => ({
        id: String(row.id),
        doc_no: String(row.doc_no ?? ""),
        contact_id: String(row.contact_id ?? ""),
        grand_total: roundMoney(toMoney(row.grand_total)),
        payment_status: String(row.payment_status ?? "PENDING"),
      })),
      error: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ดึงใบวางบิลรอจ่ายไม่สำเร็จ";
    return { data: [], error: message };
  }
}

export async function getBillingNoteSettlements(billingNoteId: string): Promise<{
  data: BillingNoteSettlement[];
  error: string | null;
}> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: [], error: owner.error };
    const linked = await getInvoicesByBillingNote(billingNoteId);
    if (linked.error) return { data: [], error: linked.error };
    const invoiceIds = linked.data.map((row) => row.id).filter(Boolean);
    if (invoiceIds.length === 0) return { data: [], error: null };

    const supabase = createClient();
    const { data: allocations, error } = await supabase
      .from("document_allocations")
      .select("receipt_doc_id")
      .in("invoice_doc_id", invoiceIds);
    if (error) return { data: [], error: error.message };
    const receiptIds = Array.from(
      new Set((allocations ?? []).map((row) => String(row.receipt_doc_id ?? "")).filter(Boolean)),
    );
    if (receiptIds.length === 0) return { data: [], error: null };

    const { data: payments, error: paymentError } = await supabase
      .from("documents")
      .select("id, doc_no, doc_type, attachment_url, attached_file_url, original_receipt_url")
      .in("id", receiptIds)
      .eq("doc_type", "PAY");
    if (paymentError) return { data: [], error: paymentError.message };

    return {
      data: (payments ?? []).map((row) => ({
        doc_no: String(row.doc_no ?? ""),
        slip_urls: [row.attachment_url, row.attached_file_url, row.original_receipt_url]
          .map((url) => String(url ?? "").trim())
          .filter((url, index, all) => Boolean(url) && all.indexOf(url) === index),
      })),
      error: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ดึงหลักฐานการจ่ายไม่สำเร็จ";
    return { data: [], error: message };
  }
}

type BillingNoteItemJoinRow = {
  id: string;
  invoice_id: string;
  billed_amount: number | string | null;
  invoice:
    | {
        id?: string;
        doc_no?: string | null;
        doc_type?: string | null;
        doc_date?: string | null;
        due_date?: string | null;
        grand_total?: number | string | null;
      }
    | {
        id?: string;
        doc_no?: string | null;
        doc_type?: string | null;
        doc_date?: string | null;
        due_date?: string | null;
        grand_total?: number | string | null;
      }[]
    | null;
};

/**
 * Fetch a single Billing Note (BN/BR) with contact + invoice lines.
 */
export async function getBillingNoteById(
  id: string,
): Promise<GetBillingNoteByIdResult> {
  try {
    const trimmedId = id?.trim();
    if (!trimmedId) {
      return { data: null, error: "ต้องระบุรหัสเอกสาร" };
    }

    const supabase = createClient();

    const { data: header, error: headerError } = await supabase
      .from("doc_headers")
      .select(
        `
        id,
        doc_no,
        doc_type,
        doc_date,
        due_date,
        grand_total,
        payment_status,
        contact_id,
        contacts:contact_id (
          id,
          company_name,
          tax_id,
          address,
          phone,
          branch_code,
          contact_roles
        )
      `,
      )
      .eq("id", trimmedId)
      .maybeSingle();

    if (headerError) {
      return {
        data: null,
        error: headerError.message ?? "ดึงเอกสารวางบิลไม่สำเร็จ",
      };
    }

    if (!header) {
      return { data: null, error: null };
    }

    const docType = String(header.doc_type ?? "");
    if (docType !== "BN" && docType !== "BR") {
      return {
        data: null,
        error: "เอกสารนี้ไม่ใช่ใบวางบิล (BN/BR)",
      };
    }

    const { data: itemRows, error: itemsError } = await supabase
      .from("billing_note_items")
      .select(
        `
        id,
        invoice_id,
        billed_amount,
        invoice:doc_headers!billing_note_items_invoice_id_fkey (
          id,
          doc_no,
          doc_type,
          doc_date,
          due_date,
          grand_total
        )
      `,
      )
      .eq("billing_note_id", trimmedId)
      .order("created_at", { ascending: true });

    if (itemsError) {
      return {
        data: null,
        error: itemsError.message ?? "ดึงรายการบิลในใบวางบิลไม่สำเร็จ",
      };
    }

    const contact = unwrapContact(
      (header as BillingNoteHeaderRow).contacts,
    );

    const invoices: BillingNoteInvoiceLine[] = (
      (itemRows ?? []) as BillingNoteItemJoinRow[]
    ).map((row) => {
      const invoice = Array.isArray(row.invoice)
        ? (row.invoice[0] ?? null)
        : row.invoice;
      return {
        id: row.id,
        invoice_id: row.invoice_id,
        billed_amount: roundMoney(toMoney(row.billed_amount)),
        invoice_doc_no: invoice?.doc_no?.trim() || "—",
        invoice_doc_type: invoice?.doc_type?.trim() || "—",
        invoice_doc_date: invoice?.doc_date
          ? String(invoice.doc_date)
          : "",
        invoice_due_date: invoice?.due_date
          ? String(invoice.due_date)
          : null,
        invoice_grand_total: roundMoney(toMoney(invoice?.grand_total)),
      };
    });

    return {
      data: {
        id: String(header.id),
        doc_no: String(header.doc_no ?? "—"),
        doc_type: docType as BillingNoteDocType,
        doc_date: header.doc_date ? String(header.doc_date) : "",
        due_date: header.due_date ? String(header.due_date) : null,
        grand_total: roundMoney(toMoney(header.grand_total)),
        payment_status: String(header.payment_status ?? "PENDING"),
        contact: contact
          ? {
              id: contact.id ?? "",
              company_name: contact.company_name?.trim() || "ไม่ระบุชื่อคู่ค้า",
              tax_id: contact.tax_id ?? null,
              address: contact.address ?? null,
              phone: contact.phone ?? null,
              branch_code: contact.branch_code ?? null,
              contact_roles: Array.isArray(contact.contact_roles)
                ? contact.contact_roles
                : null,
            }
          : null,
        invoices,
      },
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ดึงเอกสารวางบิลไม่สำเร็จ";
    return { data: null, error: message };
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

type SupabaseAdmin = ReturnType<typeof createClient>;

/** Active BN/BR invoice_ids + their doc_nos (for cross-ledger exclusion). */
async function loadBilledInvoiceKeys(
  supabase: SupabaseAdmin,
): Promise<{ ids: Set<string>; docNos: Set<string>; error: string | null }> {
  const ids = new Set<string>();
  const docNos = new Set<string>();

  const { data: activeNotes, error: activeNotesError } = await supabase
    .from("doc_headers")
    .select("id")
    .in("doc_type", ["BN", "BR"])
    .in("payment_status", [...ACTIVE_BN_PAYMENT_STATUSES]);

  if (activeNotesError) {
    return {
      ids,
      docNos,
      error:
        activeNotesError.message ??
        "ตรวจสอบใบวางบิลที่ยังเปิดอยู่ไม่สำเร็จ",
    };
  }

  const activeNoteIds = (activeNotes ?? []).map((n) => String(n.id));
  if (activeNoteIds.length === 0) {
    return { ids, docNos, error: null };
  }

  const { data: billedItems, error: billedError } = await supabase
    .from("billing_note_items")
    .select("invoice_id")
    .in("billing_note_id", activeNoteIds);

  if (billedError) {
    return {
      ids,
      docNos,
      error:
        billedError.message ?? "ตรวจสอบรายการบิลในใบวางบิลไม่สำเร็จ",
    };
  }

  for (const item of billedItems ?? []) {
    if (item.invoice_id) ids.add(String(item.invoice_id));
  }

  if (ids.size > 0) {
    const { data: billedHeaders } = await supabase
      .from("doc_headers")
      .select("id, doc_no")
      .in("id", Array.from(ids));
    for (const row of billedHeaders ?? []) {
      if (row.doc_no) docNos.add(String(row.doc_no));
    }
  }

  return { ids, docNos, error: null };
}

/**
 * Find or create a `doc_headers` mirror for a primary-ledger `documents` row
 * (billing_note_items.invoice_id FK → doc_headers).
 */
async function ensureDocHeaderForDocument(
  supabase: SupabaseAdmin,
  doc: {
    id: string;
    doc_no: string;
    doc_type: string;
    doc_date: string;
    due_date: string | null;
    grand_total: number;
    payment_status: string | null;
    contact_id: string;
  },
): Promise<{ headerId: string | null; error: string | null }> {
  const { data: existing, error: findError } = await supabase
    .from("doc_headers")
    .select("id")
    .eq("contact_id", doc.contact_id)
    .eq("doc_type", doc.doc_type)
    .eq("doc_no", doc.doc_no)
    .limit(1)
    .maybeSingle();

  if (findError) {
    return { headerId: null, error: findError.message };
  }
  if (existing?.id) {
    return { headerId: String(existing.id), error: null };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("doc_headers")
    .insert({
      doc_no: doc.doc_no,
      doc_type: doc.doc_type,
      doc_date: doc.doc_date,
      due_date: doc.due_date,
      contact_id: doc.contact_id,
      sub_total: doc.grand_total,
      discount_amount: 0,
      tax_rate: 0,
      tax_amount: 0,
      grand_total: doc.grand_total,
      deposit_deducted: 0,
      payment_status: doc.payment_status ?? "UNPAID",
    })
    .select("id")
    .single();

  if (insertError || !inserted?.id) {
    return {
      headerId: null,
      error: insertError?.message ?? "สร้างหัวเอกสารอ้างอิง (doc_headers) ไม่สำเร็จ",
    };
  }

  return { headerId: String(inserted.id), error: null };
}

/**
 * Invoices with outstanding balance from primary ledger (`documents`).
 * Includes document status ISSUED only; unpaid/partial via grand_total − paid_amount > 0.
 * IDs prefer matching `doc_headers.id` when present (for billing_note_items FK).
 */
export async function getUnbilledInvoices(
  contactId: string,
  category: BillingCategory,
): Promise<GetUnbilledInvoicesResult> {
  try {
    const trimmedContactId = contactId?.trim();
    if (!trimmedContactId) {
      return { data: [], error: "ต้องระบุผู้ติดต่อ (contactId)", creditDays: 0 };
    }
    if (category !== "AR" && category !== "AP") {
      return { data: [], error: "หมวดหมู่ต้องเป็น AR หรือ AP", creditDays: 0 };
    }

    const supabase = createClient();
    const docTypes = resolveInvoiceDocTypes(category);

    const { data: ledgerRows, error: ledgerError } = await supabase
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_type,
        doc_date,
        due_date,
        reference_no,
        grand_total,
        paid_amount,
        payment_status,
        status,
        contact_id,
        is_voided
      `,
      )
      .eq("contact_id", trimmedContactId)
      .in("doc_type", [...docTypes])
      .eq("status", BILLABLE_DOC_STATUS)
      .or("is_voided.is.null,is_voided.eq.false")
      .order("doc_date", { ascending: true });

    if (ledgerError) {
      return {
        data: [],
        error: ledgerError.message ?? "ดึงรายการบิลค้างวางบิลไม่สำเร็จ",
        creditDays: 0,
      };
    }

    const { data: contactRow } = await supabase
      .from("contacts")
      .select("credit_days")
      .eq("id", trimmedContactId)
      .maybeSingle();
    const creditDays = Math.max(0, Number(contactRow?.credit_days ?? 0) || 0);

    const rows = (ledgerRows ?? []) as LedgerInvoiceRow[];
    const taxInvoiceNoById = await loadTaxInvoiceNumbers(
      supabase,
      rows.map((row) => row.id),
    );
    if (rows.length === 0) {
      return { data: [], error: null, creditDays };
    }

    const billed = await loadBilledInvoiceKeys(supabase);
    if (billed.error) {
      return { data: [], error: billed.error, creditDays };
    }

    const docNos = Array.from(
      new Set(
        rows
          .map((r) => r.doc_no?.trim())
          .filter((v): v is string => Boolean(v)),
      ),
    );

    const headerByKey = new Map<string, string>();
    if (docNos.length > 0) {
      const { data: headers } = await supabase
        .from("doc_headers")
        .select("id, doc_no, doc_type")
        .eq("contact_id", trimmedContactId)
        .in("doc_type", [...docTypes])
        .in("doc_no", docNos);

      for (const h of headers ?? []) {
        const no = String(h.doc_no ?? "");
        const type = String(h.doc_type ?? "");
        if (!no || !type) continue;
        headerByKey.set(invoiceKey(type, no), String(h.id));
      }
    }

    const unbilled: UnbilledInvoice[] = [];
    for (const row of rows) {
      if (row.is_voided === true) continue;

      const docNo = row.doc_no?.trim() || "";
      const docType = row.doc_type?.trim() || "";
      if (!docNo || !docType) continue;

      const headerId = headerByKey.get(invoiceKey(docType, docNo));
      const resolvedId = headerId ?? row.id;

      if (billed.ids.has(resolvedId) || billed.ids.has(row.id)) continue;
      if (billed.docNos.has(docNo)) continue;

      const grandTotal = roundMoney(toMoney(row.grand_total));
      const paidAmount = roundMoney(toMoney(row.paid_amount));
      const outstanding = roundMoney(grandTotal - paidAmount);
      if (outstanding <= MONEY_EPS) continue;

      unbilled.push({
        id: resolvedId,
        doc_no: docNo,
        doc_type: docType,
        doc_date: row.doc_date ? String(row.doc_date).slice(0, 10) : "",
        due_date: resolveDueDate(
          row.doc_date ? String(row.doc_date) : "",
          row.due_date ? String(row.due_date) : null,
          creditDays,
        ) || null,
        grand_total: grandTotal,
        paid_amount: paidAmount,
        outstanding_amount: outstanding,
        payment_status: row.payment_status,
        reference_no: row.reference_no?.trim() || null,
        tax_invoice_no: taxInvoiceNoById.get(row.id) ?? null,
      });
    }

    return { data: unbilled, error: null, creditDays };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "ดึงรายการบิลค้างวางบิลไม่สำเร็จ";
    return { data: [], error: message, creditDays: 0 };
  }
}

/**
 * Contacts that have at least one unbilled outstanding invoice (for picker UI).
 */
export async function getOutstandingContactsSummary(
  type: BillingCategory,
): Promise<GetOutstandingContactsSummaryResult> {
  try {
    if (type !== "AR" && type !== "AP") {
      return { data: [], error: "หมวดหมู่ต้องเป็น AR หรือ AP" };
    }

    const supabase = createClient();
    const docTypes = resolveInvoiceDocTypes(type);

    const { data: ledgerRows, error: ledgerError } = await supabase
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_type,
        grand_total,
        paid_amount,
        payment_status,
        status,
        contact_id,
        is_voided,
        contacts:contact_id (
          id,
          company_name
        )
      `,
      )
      .in("doc_type", [...docTypes])
      .eq("status", BILLABLE_DOC_STATUS)
      .or("is_voided.is.null,is_voided.eq.false")
      .order("doc_date", { ascending: true });

    if (ledgerError) {
      return {
        data: [],
        error: ledgerError.message ?? "ดึงสรุปยอดค้างชำระไม่สำเร็จ",
      };
    }

    const billed = await loadBilledInvoiceKeys(supabase);
    if (billed.error) {
      return { data: [], error: billed.error };
    }

    const grouped = new Map<
      string,
      { contact_name: string; invoice_count: number; total_outstanding: number }
    >();

    for (const raw of (ledgerRows ?? []) as LedgerInvoiceRow[]) {
      if (raw.is_voided === true) continue;

      const docNo = raw.doc_no?.trim() || "";
      if (!docNo) continue;
      if (billed.docNos.has(docNo) || billed.ids.has(raw.id)) continue;

      const outstanding = roundMoney(
        toMoney(raw.grand_total) - toMoney(raw.paid_amount),
      );
      if (outstanding <= MONEY_EPS) continue;

      const contact = unwrapContact(raw.contacts);
      const contactId = raw.contact_id?.trim() || contact?.id || "";
      if (!contactId) continue;

      const contactName =
        contact?.company_name?.trim() || "ไม่ระบุชื่อคู่ค้า";
      const existing = grouped.get(contactId);
      if (!existing) {
        grouped.set(contactId, {
          contact_name: contactName,
          invoice_count: 1,
          total_outstanding: outstanding,
        });
      } else {
        existing.invoice_count += 1;
        existing.total_outstanding = roundMoney(
          existing.total_outstanding + outstanding,
        );
      }
    }

    const data: OutstandingContactSummary[] = Array.from(grouped.entries())
      .map(([contact_id, value]) => ({
        contact_id,
        contact_name: value.contact_name,
        invoice_count: value.invoice_count,
        total_outstanding: value.total_outstanding,
      }))
      .sort((a, b) => b.total_outstanding - a.total_outstanding);

    return { data, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ดึงสรุปยอดค้างชำระไม่สำเร็จ";
    return { data: [], error: message };
  }
}

export async function getUnbilledApVendorQueue(): Promise<GetUnbilledApVendorQueueResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: [], error: owner.error };

    const supabase = createClient();
    const rpc = supabase as unknown as {
      rpc: (fn: "get_unbilled_ap_vendor_queue") => Promise<{
        data: unknown;
        error: { message: string } | null;
      }>;
    };
    const { data, error } = await rpc.rpc("get_unbilled_ap_vendor_queue");
    if (!error) {
      if (Array.isArray(data) && data.length === 0) return { data: [], error: null };
      const parsed = normalizeVendorQueue(data);
      if (parsed) return { data: parsed, error: null };
    } else if (!isMissingVendorQueueRpc(error.message)) {
      return { data: [], error: error.message };
    }

    const fallback = await getOutstandingContactsSummary("AP");
    return {
      data: fallback.data.map((row) => ({
        contact_id: row.contact_id,
        contact_name: row.contact_name,
        invoice_count: row.invoice_count,
        total_outstanding: row.total_outstanding,
      })),
      error: fallback.error,
    };
  } catch (error: unknown) {
    if (isRedirectError(error)) throw error;
    const message = error instanceof Error ? error.message : "ดึงคิวเจ้าหนี้ค้างวางบิลไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/**
 * Create Billing Note (BN) / Bill Receipt (BR) header + junction lines.
 * Resolves invoice IDs from `documents` → `doc_headers` when needed (FK).
 */
export async function createBillingNote(
  data: CreateBillingNoteInput,
): Promise<CreateBillingNoteResult> {
  let createdHeaderId: string | null = null;

  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { success: false, error: owner.error };

    const contactId = data.contactId?.trim();
    if (!contactId) {
      return { success: false, error: "ต้องระบุผู้ติดต่อ (contactId)" };
    }
    if (data.category !== "AR" && data.category !== "AP") {
      return { success: false, error: "หมวดหมู่ต้องเป็น AR หรือ AP" };
    }

    const invoiceIds = Array.from(
      new Set(
        (data.invoiceIds ?? [])
          .map((id) => id?.trim())
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (invoiceIds.length === 0) {
      return { success: false, error: "ต้องเลือกอย่างน้อย 1 บิล" };
    }

    const totalBilledAmount = roundMoney(toMoney(data.totalBilledAmount));
    if (totalBilledAmount <= MONEY_EPS) {
      return { success: false, error: "ยอดวางบิลต้องมากกว่า 0" };
    }

    const documentDate = data.documentDate?.trim();
    const dueDate = data.dueDate?.trim();
    if (!documentDate || !isIsoDate(documentDate)) {
      return {
        success: false,
        error: "วันที่เอกสารต้องเป็นรูปแบบ YYYY-MM-DD",
      };
    }
    if (!dueDate || !isIsoDate(dueDate)) {
      return {
        success: false,
        error: "วันครบกำหนดต้องเป็นรูปแบบ YYYY-MM-DD",
      };
    }

    const supabase = createClient();
    const docType = resolveBillingDocType(data.category);
    const expectedInvoiceTypes = resolveInvoiceDocTypes(data.category);

    // 1) Prefer existing doc_headers rows (already mirrored / AP goods receipt).
    const { data: headerHits, error: headerError } = await supabase
      .from("doc_headers")
      .select(
        "id, doc_no, doc_type, doc_date, due_date, grand_total, payment_status, contact_id",
      )
      .in("id", invoiceIds)
      .eq("contact_id", contactId);

    if (headerError) {
      return {
        success: false,
        error: headerError.message ?? "ตรวจสอบบิลที่เลือกไม่สำเร็จ",
      };
    }

    const resolvedHeaders = new Map<string, DocHeaderRow>();
    for (const row of (headerHits ?? []) as DocHeaderRow[]) {
      resolvedHeaders.set(row.id, row);
    }

    const missingIds = invoiceIds.filter((id) => !resolvedHeaders.has(id));

    // 2) Remaining IDs may be primary-ledger `documents` — mirror to doc_headers.
    if (missingIds.length > 0) {
      const { data: docs, error: docsError } = await supabase
        .from("documents")
        .select(
          "id, doc_no, doc_type, doc_date, due_date, grand_total, paid_amount, payment_status, status, contact_id, is_voided",
        )
        .in("id", missingIds)
        .eq("contact_id", contactId);

      if (docsError) {
        return {
          success: false,
          error: docsError.message ?? "ตรวจสอบบิลจากสมุดบัญชีหลักไม่สำเร็จ",
        };
      }

      const docRows = (docs ?? []) as LedgerInvoiceRow[];
      if (docRows.length !== missingIds.length) {
        return {
          success: false,
          error: "พบบิลที่ไม่ใช่ของผู้ติดต่อนี้หรือไม่มีในระบบ",
        };
      }

      for (const doc of docRows) {
        const docNo = doc.doc_no?.trim() || "";
        const invoiceDocType = doc.doc_type?.trim() || "";
        if (!docNo || !invoiceDocType) {
          return { success: false, error: "พบเอกสารที่ไม่มีเลขที่/ประเภท" };
        }
        if (!expectedInvoiceTypes.includes(invoiceDocType)) {
          return {
            success: false,
            error: `ประเภทบิล ${docNo} ไม่ตรงกับหมวด ${data.category}`,
          };
        }

        const ensured = await ensureDocHeaderForDocument(supabase, {
          id: doc.id,
          doc_no: docNo,
          doc_type: invoiceDocType,
          doc_date: doc.doc_date ? String(doc.doc_date) : documentDate,
          due_date: doc.due_date ? String(doc.due_date) : null,
          grand_total: roundMoney(toMoney(doc.grand_total)),
          payment_status: doc.payment_status,
          contact_id: contactId,
        });

        if (!ensured.headerId) {
          return {
            success: false,
            error:
              ensured.error ??
              `สร้างหัวเอกสารอ้างอิงสำหรับ ${docNo} ไม่สำเร็จ`,
          };
        }

        resolvedHeaders.set(ensured.headerId, {
          id: ensured.headerId,
          doc_no: docNo,
          doc_type: invoiceDocType,
          doc_date: doc.doc_date ? String(doc.doc_date) : documentDate,
          due_date: doc.due_date ? String(doc.due_date) : null,
          grand_total: toMoney(doc.grand_total),
          payment_status: doc.payment_status,
          contact_id: contactId,
        });
      }
    }

    if (resolvedHeaders.size !== invoiceIds.length) {
      return {
        success: false,
        error: "พบบิลที่ไม่ใช่ของผู้ติดต่อนี้หรือไม่มีในระบบ",
      };
    }

    const invoiceRows = Array.from(resolvedHeaders.values());
    for (const inv of invoiceRows) {
      if (!expectedInvoiceTypes.includes(inv.doc_type)) {
        return {
          success: false,
          error: `ประเภทบิล ${inv.doc_no} ไม่ตรงกับหมวด ${data.category}`,
        };
      }
    }

    // Outstanding from primary ledger by doc_no (authoritative paid_amount).
    const docNos = invoiceRows.map((r) => r.doc_no);
    const paidByDocNo = new Map<string, number>();
    const grandByDocNo = new Map<string, number>();
    if (docNos.length > 0) {
      const { data: ledgerDocs } = await supabase
        .from("documents")
        .select("doc_no, paid_amount, grand_total")
        .in("doc_no", docNos);
      for (const doc of ledgerDocs ?? []) {
        const key = String(doc.doc_no ?? "");
        if (!key) continue;
        paidByDocNo.set(key, toMoney(doc.paid_amount));
        grandByDocNo.set(key, toMoney(doc.grand_total));
      }
    }

    const outstandingById = new Map<string, number>();
    for (const inv of invoiceRows) {
      const grand = roundMoney(
        grandByDocNo.get(inv.doc_no) ?? toMoney(inv.grand_total),
      );
      const outstanding = roundMoney(grand - (paidByDocNo.get(inv.doc_no) ?? 0));
      if (outstanding <= MONEY_EPS) {
        return {
          success: false,
          error: `บิล ${inv.doc_no} ไม่มียอดค้างชำระแล้ว`,
        };
      }
      outstandingById.set(inv.id, outstanding);
    }

    const resolvedInvoiceIds = invoiceRows.map((r) => r.id);

    // Reject invoices already on an active/pending BN/BR.
    const billed = await loadBilledInvoiceKeys(supabase);
    if (billed.error) {
      return { success: false, error: billed.error };
    }
    for (const id of resolvedInvoiceIds) {
      if (billed.ids.has(id)) {
        return {
          success: false,
          error: "มีบิลที่ถูกวางบิลไว้ในใบวางบิลที่ยังเปิดอยู่แล้ว",
        };
      }
    }
    for (const inv of invoiceRows) {
      if (billed.docNos.has(inv.doc_no)) {
        return {
          success: false,
          error: "มีบิลที่ถูกวางบิลไว้ในใบวางบิลที่ยังเปิดอยู่แล้ว",
        };
      }
    }

    const nowIso = new Date().toISOString();
    let docNo = "";
    let header: { id: string } | null = null;
    let bnHeaderError: { message?: string } | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const allocated = await allocateBillingNoteDocNo(supabase, docType, documentDate);
      if (!allocated.docNo) {
        return {
          success: false,
          error: allocated.error ?? "ออกเลขที่ใบวางบิลไม่สำเร็จ",
        };
      }
      docNo = allocated.docNo;
      const inserted = await supabase
        .from("doc_headers")
        .insert({
          doc_no: docNo,
          doc_type: docType,
          doc_date: documentDate,
          due_date: dueDate,
          contact_id: contactId,
          sub_total: totalBilledAmount,
          discount_amount: 0,
          tax_rate: 0,
          tax_amount: 0,
          wht_rate: 0,
          wht_amount: 0,
          grand_total: totalBilledAmount,
          deposit_deducted: 0,
          payment_status: "PENDING",
        })
        .select("id")
        .single();
      if (!inserted.error && inserted.data?.id) {
        header = { id: String(inserted.data.id) };
        bnHeaderError = null;
        break;
      }
      bnHeaderError = inserted.error;
      if (!isDuplicateDocNo(inserted.error)) break;
    }

    if (bnHeaderError || !header?.id) {
      return {
        success: false,
        error:
          bnHeaderError?.message ?? "บันทึกหัวเอกสารวางบิลไม่สำเร็จ",
      };
    }

    createdHeaderId = String(header.id);

    const itemRows = resolvedInvoiceIds.map((invoiceId) => ({
      billing_note_id: createdHeaderId!,
      invoice_id: invoiceId,
      billed_amount: outstandingById.get(invoiceId) ?? 0,
      updated_at: nowIso,
    }));

    const { error: itemsError } = await supabase
      .from("billing_note_items")
      .insert(itemRows);

    if (itemsError) {
      await supabase.from("doc_headers").delete().eq("id", createdHeaderId);
      createdHeaderId = null;
      return {
        success: false,
        error:
          itemsError.message ?? "บันทึกรายการบิลในใบวางบิลไม่สำเร็จ",
      };
    }

    let nextVendorId: string | null = null;
    if (data.resolveNextVendor !== false) {
      try {
        const queue =
          data.category === "AP"
            ? await getUnbilledApVendorQueue()
            : await getOutstandingContactsSummary("AR");
        const rows = queue.data;
        const currentIndex = rows.findIndex((row) => row.contact_id === contactId);
        const following =
          currentIndex >= 0
            ? rows.slice(currentIndex + 1).find((row) => row.contact_id !== contactId)
            : undefined;
        nextVendorId =
          following?.contact_id ??
          rows.find((row) => row.contact_id !== contactId)?.contact_id ??
          null;
      } catch (queueError) {
        if (isRedirectError(queueError)) throw queueError;
        nextVendorId = null;
      }
    }

    revalidatePath("/finance/billing-notes");
    revalidatePath("/finance/billing-notes/create");
    return {
      success: true,
      documentId: createdHeaderId,
      billingNoteId: createdHeaderId,
      docNo,
      nextVendorId,
      totalAmount: totalBilledAmount,
    };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    if (createdHeaderId) {
      try {
        const supabase = createClient();
        await supabase.from("doc_headers").delete().eq("id", createdHeaderId);
      } catch {
        // best-effort rollback
      }
    }
    const message =
      err instanceof Error ? err.message : "สร้างใบวางบิลไม่สำเร็จ";
    return { success: false, error: message };
  }
}

/**
 * Open BN (AR) / BR (AP) headers for a contact — Payment form combobox.
 */
export async function getOpenBillingNotesForContact(
  contactId: string,
  category: BillingCategory,
): Promise<GetOpenBillingNotesResult> {
  try {
    const trimmed = contactId?.trim();
    if (!trimmed) return { data: [], error: null };
    if (category !== "AR" && category !== "AP") {
      return { data: [], error: "หมวดหมู่ต้องเป็น AR หรือ AP" };
    }

    const supabase = createClient();
    const noteType = resolveBillingDocType(category);

    const { data: notes, error } = await supabase
      .from("doc_headers")
      .select("id, doc_no, doc_type, doc_date, due_date, grand_total, payment_status")
      .eq("contact_id", trimmed)
      .eq("doc_type", noteType)
      .in("payment_status", [...ACTIVE_BN_PAYMENT_STATUSES])
      .order("doc_date", { ascending: false });

    if (error) {
      return { data: [], error: error.message };
    }

    const noteRows = notes ?? [];
    if (noteRows.length === 0) return { data: [], error: null };

    const noteIds = noteRows.map((n) => String(n.id));
    const { data: items } = await supabase
      .from("billing_note_items")
      .select("billing_note_id")
      .in("billing_note_id", noteIds);

    const countByNote = new Map<string, number>();
    for (const item of items ?? []) {
      const id = String(item.billing_note_id ?? "");
      if (!id) continue;
      countByNote.set(id, (countByNote.get(id) ?? 0) + 1);
    }

    return {
      data: noteRows.map((n) => ({
        id: String(n.id),
        doc_no: String(n.doc_no ?? "—"),
        doc_type: (n.doc_type === "BR" ? "BR" : "BN") as BillingNoteDocType,
        doc_date: n.doc_date ? String(n.doc_date) : "",
        due_date: n.due_date ? String(n.due_date) : null,
        grand_total: roundMoney(toMoney(n.grand_total)),
        payment_status: String(n.payment_status ?? "PENDING"),
        invoice_count: countByNote.get(String(n.id)) ?? 0,
      })),
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ดึงรายการใบวางบิลไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/**
 * Invoices linked to a BN/BR via billing_note_items.
 * Returns primary-ledger `documents` ids for knock-off allocation.
 */
export async function getInvoicesByBillingNote(
  billingNoteId: string,
): Promise<GetInvoicesByBillingNoteResult> {
  try {
    const trimmed = billingNoteId?.trim();
    if (!trimmed) {
      return { data: [], error: "ต้องระบุรหัสใบวางบิล", billing_note: null };
    }

    const supabase = createClient();

    const { data: note, error: noteError } = await supabase
      .from("doc_headers")
      .select("id, doc_no, doc_type, contact_id")
      .eq("id", trimmed)
      .maybeSingle();

    if (noteError) {
      return { data: [], error: noteError.message, billing_note: null };
    }
    if (!note) {
      return { data: [], error: "ไม่พบใบวางบิล", billing_note: null };
    }

    const noteType = String(note.doc_type ?? "");
    if (noteType !== "BN" && noteType !== "BR") {
      return {
        data: [],
        error: "เอกสารนี้ไม่ใช่ใบวางบิล (BN/BR)",
        billing_note: null,
      };
    }

    const { data: items, error: itemsError } = await supabase
      .from("billing_note_items")
      .select(
        `
        id,
        invoice_id,
        billed_amount,
        invoice:doc_headers!billing_note_items_invoice_id_fkey (
          id,
          doc_no,
          doc_type,
          doc_date,
          due_date,
          grand_total,
          payment_status,
          contact_id
        )
      `,
      )
      .eq("billing_note_id", trimmed)
      .order("created_at", { ascending: true });

    if (itemsError) {
      return { data: [], error: itemsError.message, billing_note: null };
    }

    type ItemRow = {
      invoice_id: string;
      invoice:
        | {
            id?: string;
            doc_no?: string | null;
            doc_type?: string | null;
            doc_date?: string | null;
            due_date?: string | null;
            grand_total?: number | string | null;
            payment_status?: string | null;
            contact_id?: string | null;
          }
        | {
            id?: string;
            doc_no?: string | null;
            doc_type?: string | null;
            doc_date?: string | null;
            due_date?: string | null;
            grand_total?: number | string | null;
            payment_status?: string | null;
            contact_id?: string | null;
          }[]
        | null;
    };

    const headers = ((items ?? []) as ItemRow[])
      .map((row) => {
        const inv = Array.isArray(row.invoice)
          ? (row.invoice[0] ?? null)
          : row.invoice;
        if (!inv?.doc_no || !inv.doc_type) return null;
        return {
          header_id: String(inv.id ?? row.invoice_id),
          doc_no: String(inv.doc_no).trim(),
          doc_type: String(inv.doc_type).trim(),
          doc_date: inv.doc_date ? String(inv.doc_date) : "",
          due_date: inv.due_date ? String(inv.due_date) : null,
          header_grand: toMoney(inv.grand_total),
          header_payment_status: inv.payment_status ?? null,
          contact_id: String(inv.contact_id ?? note.contact_id ?? ""),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);

    if (headers.length === 0) {
      return {
        data: [],
        error: null,
        billing_note: {
          id: String(note.id),
          doc_no: String(note.doc_no ?? ""),
          doc_type: noteType as BillingNoteDocType,
          contact_id: String(note.contact_id ?? ""),
        },
      };
    }

    const docNos = Array.from(new Set(headers.map((h) => h.doc_no)));
    const { data: ledgerDocs, error: ledgerError } = await supabase
      .from("documents")
      .select(
        "id, doc_no, doc_type, doc_date, due_date, grand_total, paid_amount, payment_status, contact_id, status, is_voided",
      )
      .in("doc_no", docNos)
      .eq("contact_id", String(note.contact_id));

    if (ledgerError) {
      return { data: [], error: ledgerError.message, billing_note: null };
    }

    const ledgerByKey = new Map<string, LedgerInvoiceRow>();
    for (const doc of (ledgerDocs ?? []) as LedgerInvoiceRow[]) {
      const key = invoiceKey(
        String(doc.doc_type ?? ""),
        String(doc.doc_no ?? ""),
      );
      if (!key.includes("::")) continue;
      ledgerByKey.set(key, doc);
    }

    const data: BillingNoteLinkedInvoice[] = [];
    for (const header of headers) {
      const ledger = ledgerByKey.get(
        invoiceKey(header.doc_type, header.doc_no),
      );
      if (!ledger || ledger.is_voided === true) continue;

      const grandTotal = roundMoney(
        toMoney(ledger.grand_total ?? header.header_grand),
      );
      const paidAmount = roundMoney(toMoney(ledger.paid_amount));
      const outstanding = roundMoney(grandTotal - paidAmount);
      if (outstanding <= MONEY_EPS) continue;

      data.push({
        id: ledger.id,
        header_id: header.header_id,
        doc_no: header.doc_no,
        doc_type: String(ledger.doc_type ?? header.doc_type),
        doc_date: ledger.doc_date
          ? String(ledger.doc_date)
          : header.doc_date,
        due_date: ledger.due_date
          ? String(ledger.due_date)
          : header.due_date,
        grand_total: grandTotal,
        paid_amount: paidAmount,
        outstanding,
        payment_status: String(
          ledger.payment_status ?? header.header_payment_status ?? "UNPAID",
        ),
        contact_id: String(ledger.contact_id ?? header.contact_id),
      });
    }

    return {
      data,
      error: null,
      billing_note: {
        id: String(note.id),
        doc_no: String(note.doc_no ?? ""),
        doc_type: noteType as BillingNoteDocType,
        contact_id: String(note.contact_id ?? ""),
      },
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "ดึงรายการบิลจากใบวางบิลไม่สำเร็จ";
    return { data: [], error: message, billing_note: null };
  }
}

async function queryUnbilledApByPeriod(
  fromDate: string,
  toDate: string,
): Promise<GetUnbilledApSummaryResult> {
  const supabase = createClient();
  const rows: LedgerInvoiceRow[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_type,
        doc_date,
        due_date,
        reference_no,
        grand_total,
        paid_amount,
        payment_status,
        status,
        contact_id,
        is_voided,
        contacts:contact_id (
          id,
          company_name
        )
      `,
      )
      .in("doc_type", [...AP_INVOICE_TYPES])
      .eq("status", BILLABLE_DOC_STATUS)
      .gte("doc_date", fromDate)
      .lte("doc_date", toDate)
      .or("is_voided.is.null,is_voided.eq.false")
      .order("doc_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return { data: [], error: error.message };
    const page = (data ?? []) as LedgerInvoiceRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  const billed = await loadBilledInvoiceKeys(supabase);
  if (billed.error) return { data: [], error: billed.error };

  const openRows = rows.filter((row) => {
    if (row.is_voided === true) return false;
    const docNo = row.doc_no?.trim() || "";
    if (!docNo || billed.docNos.has(docNo) || billed.ids.has(row.id)) return false;
    const outstanding = roundMoney(toMoney(row.grand_total) - toMoney(row.paid_amount));
    return outstanding > MONEY_EPS;
  });

  const contactIds = Array.from(
    new Set(openRows.map((row) => row.contact_id?.trim() || "").filter(Boolean)),
  );
  const creditByContact = new Map<string, number>();
  for (let index = 0; index < contactIds.length; index += 200) {
    const chunk = contactIds.slice(index, index + 200);
    const { data } = await supabase
      .from("contacts")
      .select("id, credit_days")
      .in("id", chunk);
    for (const contact of data ?? []) {
      creditByContact.set(
        String(contact.id),
        Math.max(0, Number(contact.credit_days ?? 0) || 0),
      );
    }
  }

  const headerByKey = new Map<string, string>();
  const docNos = Array.from(
    new Set(openRows.map((row) => row.doc_no?.trim() || "").filter(Boolean)),
  );
  for (let index = 0; index < docNos.length; index += 200) {
    const chunk = docNos.slice(index, index + 200);
    const { data } = await supabase
      .from("doc_headers")
      .select("id, doc_no, doc_type, contact_id")
      .in("doc_type", [...AP_INVOICE_TYPES])
      .in("doc_no", chunk);
    for (const header of data ?? []) {
      const key = `${header.contact_id}::${invoiceKey(String(header.doc_type ?? ""), String(header.doc_no ?? ""))}`;
      headerByKey.set(key, String(header.id));
    }
  }

  const taxInvoiceNoById = await loadTaxInvoiceNumbers(
    supabase,
    openRows.map((row) => row.id),
  );
  const grouped = new Map<string, ApPeriodVendorSummary>();
  for (const row of openRows) {
    const contactId = row.contact_id?.trim() || "";
    const docNo = row.doc_no?.trim() || "";
    const docType = row.doc_type?.trim() || "";
    if (!contactId || !docNo || !docType) continue;
    const headerId = headerByKey.get(`${contactId}::${invoiceKey(docType, docNo)}`);
    const resolvedId = headerId ?? row.id;
    if (billed.ids.has(resolvedId)) continue;
    const contact = unwrapContact(row.contacts);
    const creditDays = creditByContact.get(contactId) ?? 0;
    const docDate = row.doc_date ? String(row.doc_date).slice(0, 10) : "";
    const invoice: ApPeriodInvoice = {
      id: resolvedId,
      doc_no: docNo,
      doc_type: docType,
      doc_date: docDate,
      due_date: resolveDueDate(docDate, row.due_date, creditDays) || null,
      reference_no: row.reference_no?.trim() || null,
      tax_invoice_no: taxInvoiceNoById.get(row.id) ?? null,
      outstanding_amount: roundMoney(toMoney(row.grand_total) - toMoney(row.paid_amount)),
    };
    const existing = grouped.get(contactId);
    if (!existing) {
      grouped.set(contactId, {
        contact_id: contactId,
        contact_name: contact?.company_name?.trim() || "ไม่ระบุชื่อคู่ค้า",
        credit_days: creditDays,
        invoice_count: 1,
        first_doc_date: docDate,
        last_doc_date: docDate,
        total_outstanding: invoice.outstanding_amount,
        invoices: [invoice],
      });
      continue;
    }
    existing.invoices.push(invoice);
    existing.invoice_count += 1;
    existing.total_outstanding = roundMoney(
      existing.total_outstanding + invoice.outstanding_amount,
    );
    if (docDate && (!existing.first_doc_date || docDate < existing.first_doc_date)) {
      existing.first_doc_date = docDate;
    }
    if (docDate && docDate > existing.last_doc_date) existing.last_doc_date = docDate;
  }

  return {
    data: Array.from(grouped.values()).sort((a, b) =>
      a.contact_name.localeCompare(b.contact_name, "th"),
    ),
    error: null,
  };
}

function normalizeApPeriodRpc(value: unknown): ApPeriodVendorSummary[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const vendors: ApPeriodVendorSummary[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const invoicesRaw = row.invoices;
    if (!Array.isArray(invoicesRaw)) return null;
    const invoices: ApPeriodInvoice[] = [];
    for (const item of invoicesRaw) {
      if (!item || typeof item !== "object") return null;
      const invoice = item as Record<string, unknown>;
      const id = String(invoice.id ?? "").trim();
      if (!id) return null;
      invoices.push({
        id,
        doc_no: String(invoice.doc_no ?? ""),
        doc_type: String(invoice.doc_type ?? ""),
        doc_date: String(invoice.doc_date ?? "").slice(0, 10),
        due_date: invoice.due_date ? String(invoice.due_date).slice(0, 10) : null,
        reference_no: invoice.reference_no ? String(invoice.reference_no) : null,
        tax_invoice_no: invoice.tax_invoice_no ? String(invoice.tax_invoice_no) : null,
        outstanding_amount: roundMoney(toMoney(invoice.outstanding_amount as number)),
      });
    }
    vendors.push({
      contact_id: String(row.contact_id ?? ""),
      contact_name: String(row.contact_name ?? "ไม่ระบุชื่อคู่ค้า"),
      credit_days: Math.max(0, Number(row.credit_days ?? 0) || 0),
      invoice_count: invoices.length,
      first_doc_date: String(row.first_doc_date ?? invoices[0]?.doc_date ?? ""),
      last_doc_date: String(row.last_doc_date ?? invoices.at(-1)?.doc_date ?? ""),
      total_outstanding: roundMoney(
        invoices.reduce((sum, invoice) => sum + invoice.outstanding_amount, 0),
      ),
      invoices,
    });
  }
  return vendors.filter((vendor) => vendor.contact_id && vendor.invoices.length > 0);
}

export async function loadUnbilledApSummaryByPeriod(
  fromDate: string,
  toDate: string,
): Promise<GetUnbilledApSummaryResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: [], error: owner.error };
    const from = fromDate.trim();
    const to = toDate.trim();
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
      return { data: [], error: "ช่วงวันที่บิลต้องเป็น YYYY-MM-DD และวันเริ่มไม่เกินวันสิ้นสุด" };
    }

    const supabase = createClient();
    const rpc = supabase as unknown as {
      rpc: (
        fn: string,
        args: { p_from_date: string; p_to_date: string },
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data, error } = await rpc.rpc("get_unbilled_ap_summary_by_period", {
      p_from_date: from,
      p_to_date: to,
    });
    if (!error) {
      if (Array.isArray(data) && data.length === 0) return { data: [], error: null };
      const parsed = normalizeApPeriodRpc(data);
      if (parsed) return { data: parsed, error: null };
    } else if (!isMissingPeriodRpc(error.message)) {
      return { data: [], error: error.message };
    }

    return queryUnbilledApByPeriod(from, to);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ดึงสรุปบิลค้างตามงวดไม่สำเร็จ";
    return { data: [], error: message };
  }
}

export async function createBatchBillingNotesAction(input: {
  billingDate: string;
  remark?: string;
  groups: { contactId: string; invoiceIds: string[]; dueDate: string; totalBilledAmount: number }[];
}): Promise<CreateBatchBillingNotesResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { success: false, created: [], error: owner.error };
    const billingDate = input.billingDate?.trim() ?? "";
    if (!isIsoDate(billingDate)) {
      return { success: false, created: [], error: "วันที่เอกสารวางบิลต้องเป็น YYYY-MM-DD" };
    }
    const groups = (input.groups ?? []).filter(
      (group) => group.contactId?.trim() && group.invoiceIds.length > 0,
    );
    if (groups.length === 0) {
      return { success: false, created: [], error: "ยังไม่ได้เลือกผู้จำหน่ายหรือบิล" };
    }

    const created: CreateBatchBillingNotesResult["created"] = [];
    const supabase = createClient();
    for (const group of groups) {
      const invoiceIds = Array.from(new Set(group.invoiceIds.map((id) => id.trim()).filter(Boolean)));
      const result = await createBillingNote({
        contactId: group.contactId.trim(),
        category: "AP",
        invoiceIds,
        totalBilledAmount: roundMoney(toMoney(group.totalBilledAmount)),
        documentDate: billingDate,
        dueDate: isIsoDate(group.dueDate) ? group.dueDate : billingDate,
        remark: input.remark?.trim() || undefined,
        resolveNextVendor: false,
      });
      if (!result.success || !result.documentId) {
        return {
          success: false,
          created,
          error:
            created.length > 0
              ? `สร้างไปแล้ว ${created.length} ใบ แล้วหยุด: ${result.error ?? "สร้างใบวางบิลไม่สำเร็จ"}`
              : (result.error ?? "สร้างใบวางบิลไม่สำเร็จ"),
        };
      }
      const { data: header } = await supabase
        .from("doc_headers")
        .select("doc_no, grand_total")
        .eq("id", result.documentId)
        .maybeSingle();
      created.push({
        contactId: group.contactId.trim(),
        documentId: result.documentId,
        docNo: String(header?.doc_no ?? result.documentId),
      });
    }

    revalidatePath("/finance/billing-notes");
    revalidatePath("/finance/billing-notes/create");
    return { success: true, created, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ออกใบรับวางบิลแบบกลุ่มไม่สำเร็จ";
    return { success: false, created: [], error: message };
  }
}
