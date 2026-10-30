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

function billingNoteRunningPrefix(docType: BillingNoteDocType, documentDate: string): string {
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
function normalizeBillingDocType(value: string | null | undefined): BillingNoteDocType {
  if (value === "BR" || value === "TB") return value;
  return "BN";
}

async function allocateBillingNoteDocNo(
  supabase: SupabaseAdmin,
  docType: BillingNoteDocType,
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
          doc_type: normalizeBillingDocType(row.doc_type),
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
    const supabase = createClient();
    const noteId = billingNoteId.trim();
    const { data: note, error: noteError } = await supabase
      .from("doc_headers")
      .select("id, contact_id, doc_date, doc_type")
      .eq("id", noteId)
      .maybeSingle();
    if (noteError) return { data: [], error: noteError.message };
    if (!note || (note.doc_type !== "BN" && note.doc_type !== "BR")) {
      return { data: [], error: null };
    }

    const { data: items, error: itemsError } = await supabase
      .from("billing_note_items")
      .select("invoice_id, invoice:doc_headers!billing_note_items_invoice_id_fkey(doc_no)")
      .eq("billing_note_id", noteId);
    if (itemsError) return { data: [], error: itemsError.message };

    const invoiceIds = new Set<string>();
    const docNos = new Set<string>();
    for (const row of items ?? []) {
      const invoiceId = String(row.invoice_id ?? "").trim();
      if (invoiceId) invoiceIds.add(invoiceId);
      const invoice = Array.isArray(row.invoice) ? row.invoice[0] : row.invoice;
      const docNo = String(invoice?.doc_no ?? "").trim();
      if (docNo) docNos.add(docNo);
    }
    if (docNos.size > 0) {
      const { data: ledgerDocs, error: ledgerError } = await supabase
        .from("documents")
        .select("id")
        .in("doc_no", Array.from(docNos));
      if (ledgerError) return { data: [], error: ledgerError.message };
      for (const row of ledgerDocs ?? []) invoiceIds.add(String(row.id));
    }

    let receiptIds: string[] = [];
    if (invoiceIds.size > 0) {
      const { data: allocations, error } = await supabase
        .from("document_allocations")
        .select("receipt_doc_id")
        .in("invoice_doc_id", Array.from(invoiceIds));
      if (error) return { data: [], error: error.message };
      receiptIds = Array.from(
        new Set((allocations ?? []).map((row) => String(row.receipt_doc_id ?? "")).filter(Boolean)),
      );
    }

    if (receiptIds.length === 0 && note.contact_id) {
      const { data: payDocs, error: payError } = await supabase
        .from("documents")
        .select("id")
        .eq("contact_id", note.contact_id)
        .eq("doc_type", "PAY")
        .gte("doc_date", note.doc_date ? String(note.doc_date).slice(0, 10) : "2000-01-01");
      if (payError) return { data: [], error: payError.message };
      receiptIds = (payDocs ?? []).map((row) => String(row.id)).filter(Boolean);
    }
    if (receiptIds.length === 0) return { data: [], error: null };

    const { data: payments, error: paymentError } = await supabase
      .from("documents")
      .select("id, doc_no, doc_type, grand_total, attachment_url, attached_file_url, original_receipt_url")
      .in("id", receiptIds)
      .eq("doc_type", "PAY");
    if (paymentError) return { data: [], error: paymentError.message };

    const payIds = (payments ?? []).map((row) => String(row.id));
    const { data: transactions, error: txError } = payIds.length
      ? await supabase
          .from("payment_transactions")
          .select(
            "document_id, payment_date, payment_method, bank_account_id, reference_no, attachment_url, amount, is_voided",
          )
          .in("document_id", payIds)
      : { data: [], error: null };
    if (txError) return { data: [], error: txError.message };

    const bankIds = Array.from(
      new Set(
        (transactions ?? [])
          .map((row) => row.bank_account_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const bankById = new Map<string, string>();
    if (bankIds.length > 0) {
      const { data: banks, error: bankError } = await supabase
        .from("mst_bank_accounts")
        .select("id, bank_name, account_no")
        .in("id", bankIds);
      if (bankError) return { data: [], error: bankError.message };
      for (const bank of banks ?? []) {
        const name = String(bank.bank_name ?? "").trim();
        const accountNo = String(bank.account_no ?? "").trim();
        bankById.set(String(bank.id), name && accountNo ? `${name} • ${accountNo}` : name || "บัญชีธนาคาร");
      }
    }
    const txByDoc = new Map(
      (transactions ?? [])
        .filter((row) => row.is_voided !== true)
        .map((row) => [String(row.document_id), row]),
    );

    return {
      data: (payments ?? []).map((row) => {
        const tx = txByDoc.get(String(row.id));
        const bankLabel = tx?.bank_account_id ? bankById.get(String(tx.bank_account_id)) : null;
        const method = String(tx?.payment_method ?? "").toUpperCase();
        return {
          doc_no: String(row.doc_no ?? ""),
          paid_at: tx?.payment_date ? String(tx.payment_date) : null,
          channel_label: bankLabel || (method === "CASH" || !tx?.bank_account_id ? "เงินสด (Cash)" : "บัญชีธนาคาร"),
          reference_no: tx?.reference_no?.trim() || null,
          amount: roundMoney(toMoney((tx?.amount as number | string | null) ?? row.grand_total)),
          slip_urls: [tx?.attachment_url, row.attachment_url, row.attached_file_url, row.original_receipt_url]
            .map((url) => String(url ?? "").trim())
            .filter((url, index, all) => Boolean(url) && all.indexOf(url) === index),
        };
      }),
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
      return loadTechnicianBillById(supabase, trimmedId);
    }

    const docType = String(header.doc_type ?? "");
    if (docType === "TB") {
      return loadTechnicianBillById(supabase, trimmedId);
    }
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
    const invoicesWithRefs = await attachInvoiceReferences(supabase, invoices);

    return {
      data: {
        id: String(header.id),
        doc_no: String(header.doc_no ?? "—"),
        doc_type: normalizeBillingDocType(docType),
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
        invoices: invoicesWithRefs,
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

function isOpenBillingStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? "").trim().toUpperCase();
  return normalized === "PENDING" || normalized === "UNPAID";
}

function isMissingBillingNoteRpc(message: string): boolean {
  return /delete_billing_note_transaction|update_billing_note_transaction|PGRST202|schema cache|does not exist|could not find the function/i.test(
    message,
  );
}

function billingNoteMonthToken(docNo: string): string | null {
  const match = /^(?:BN|BR|TB)-(\d{4})-\d{1,4}$/i.exec(docNo.trim());
  return match?.[1] ?? null;
}

function vendorRefFromNotes(notes: string | null | undefined): string | null {
  const match = String(notes ?? "").match(/อ้างอิงบิลซัพพลายเออร์:\s*(.+)$/m);
  const value = match?.[1]?.trim();
  return value || null;
}

async function attachInvoiceReferences(
  supabase: SupabaseAdmin,
  lines: BillingNoteInvoiceLine[],
): Promise<BillingNoteInvoiceLine[]> {
  const docNos = Array.from(
    new Set(lines.map((line) => line.invoice_doc_no.trim()).filter((no) => no && no !== "—")),
  );
  const ids = Array.from(new Set(lines.map((line) => line.invoice_id.trim()).filter(Boolean)));
  if (docNos.length === 0 && ids.length === 0) return lines;

  type RefRow = {
    id: string;
    doc_no: string | null;
    reference_no: string | null;
    notes: string | null;
  };
  const rows: RefRow[] = [];
  if (docNos.length > 0) {
    const byNo = await supabase
      .from("documents")
      .select("id, doc_no, reference_no, notes")
      .in("doc_no", docNos);
    if (!byNo.error) rows.push(...((byNo.data ?? []) as RefRow[]));
  }
  const foundIds = new Set(rows.map((row) => String(row.id)));
  const missingIds = ids.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) {
    const byId = await supabase
      .from("documents")
      .select("id, doc_no, reference_no, notes")
      .in("id", missingIds);
    if (!byId.error) rows.push(...((byId.data ?? []) as RefRow[]));
  }
  if (rows.length === 0) return lines;

  const byNo = new Map<string, RefRow>();
  const byId = new Map<string, RefRow>();
  for (const row of rows) {
    const docNo = String(row.doc_no ?? "").trim();
    if (docNo) byNo.set(docNo, row);
    byId.set(String(row.id), row);
  }
  const taxById = await loadTaxInvoiceNumbers(
    supabase,
    rows.map((row) => String(row.id)),
  );
  return lines.map((line) => {
    const match = byNo.get(line.invoice_doc_no.trim()) ?? byId.get(line.invoice_id);
    const reference =
      match?.reference_no?.trim() ||
      vendorRefFromNotes(match?.notes) ||
      line.reference_no ||
      null;
    return {
      ...line,
      reference_no: reference,
      tax_invoice_no: match ? (taxById.get(String(match.id)) ?? line.tax_invoice_no ?? null) : (line.tax_invoice_no ?? null),
    };
  });
}

async function loadTechnicianBillById(
  supabase: SupabaseAdmin,
  id: string,
): Promise<GetBillingNoteByIdResult> {
  const { data: header, error } = await supabase
    .from("documents")
    .select(
      `
      id,
      doc_no,
      doc_type,
      doc_date,
      due_date,
      grand_total,
      payment_status,
      notes,
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
    .eq("id", id)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!header || String(header.doc_type ?? "") !== "TB") return { data: null, error: null };

  const { data: itemRows, error: itemsError } = await supabase
    .from("document_items")
    .select("id, description, line_total, sort_order")
    .eq("document_id", id)
    .order("sort_order", { ascending: true });
  if (itemsError) return { data: null, error: itemsError.message };

  const contact = unwrapContact(
    (header as { contacts?: ContactJoin | ContactJoin[] | null }).contacts,
  );
  const invoices: BillingNoteInvoiceLine[] = (itemRows ?? []).map((row) => ({
    id: String(row.id),
    invoice_id: String(row.id),
    billed_amount: roundMoney(toMoney(row.line_total)),
    invoice_doc_no: String(row.description ?? "—").trim() || "—",
    invoice_doc_type: "TB",
    invoice_doc_date: header.doc_date ? String(header.doc_date) : "",
    invoice_due_date: header.due_date ? String(header.due_date) : null,
    invoice_grand_total: roundMoney(toMoney(row.line_total)),
  }));

  return {
    data: {
      id: String(header.id),
      doc_no: String(header.doc_no ?? "—"),
      doc_type: "TB",
      doc_date: header.doc_date ? String(header.doc_date) : "",
      due_date: header.due_date ? String(header.due_date) : null,
      grand_total: roundMoney(toMoney(header.grand_total)),
      payment_status: String(header.payment_status ?? "UNPAID"),
      notes: header.notes?.trim() || null,
      contact: contact
        ? {
            id: contact.id ?? "",
            company_name: contact.company_name?.trim() || "ไม่ระบุชื่อคู่ค้า",
            tax_id: contact.tax_id ?? null,
            address: contact.address ?? null,
            phone: contact.phone ?? null,
            branch_code: contact.branch_code ?? null,
            contact_roles: Array.isArray(contact.contact_roles) ? contact.contact_roles : null,
          }
        : null,
      invoices,
    },
    error: null,
  };
}

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
    const billingDate = documentDate.slice(0, 10);
    let docNo = "";
    let header: { id: string } | null = null;
    let bnHeaderError: { message?: string } | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const allocated = await allocateBillingNoteDocNo(supabase, docType, billingDate);
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
          doc_date: billingDate,
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

export async function getIssuedTechnicianBills(): Promise<GetBillingNotesResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: [], error: owner.error };
    const supabase = createClient();
    const { data, error } = await supabase
      .from("documents")
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
      .eq("doc_type", "TB")
      .order("doc_date", { ascending: false });
    if (error) return { data: [], error: error.message };

    const rows = (data ?? []).map((row) => {
      const contact = unwrapContact(
        (row as { contacts?: ContactJoin | ContactJoin[] | null }).contacts,
      );
      return {
        id: String(row.id),
        doc_no: String(row.doc_no ?? "—"),
        doc_type: "TB" as const,
        doc_date: row.doc_date ? String(row.doc_date) : "",
        due_date: row.due_date ? String(row.due_date) : null,
        contact_id: String(row.contact_id ?? contact?.id ?? ""),
        contact_name: contact?.company_name?.trim() || "ไม่ระบุชื่อช่าง",
        grand_total: roundMoney(toMoney(row.grand_total)),
        payment_status: String(row.payment_status ?? "UNPAID"),
        invoice_count: 0,
      };
    });
    const ids = rows.map((row) => row.id);
    if (ids.length > 0) {
      const counts = new Map<string, number>();
      for (let index = 0; index < ids.length; index += 200) {
        const chunk = ids.slice(index, index + 200);
        const { data: items } = await supabase
          .from("document_items")
          .select("document_id")
          .in("document_id", chunk);
        for (const item of items ?? []) {
          const id = String(item.document_id ?? "");
          if (!id) continue;
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
      for (const row of rows) row.invoice_count = counts.get(row.id) ?? 0;
    }
    return { data: rows, error: null };
  } catch (error: unknown) {
    if (isRedirectError(error)) throw error;
    const message = error instanceof Error ? error.message : "ดึงใบสรุปวางบิลช่างไม่สำเร็จ";
    return { data: [], error: message };
  }
}

async function unlockTechnicianBill(supabase: SupabaseAdmin, billingNoteId: string): Promise<void> {
  await supabase
    .from("document_items")
    .update({ technician_bill_id: null })
    .eq("technician_bill_id", billingNoteId);
  await supabase
    .from("production_jobs")
    .update({ technician_bill_id: null })
    .eq("technician_bill_id", billingNoteId);
  const operations = supabase as unknown as {
    from: (table: "production_job_operations") => {
      update: (values: { technician_bill_id: null }) => {
        eq: (column: "technician_bill_id", value: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
  await operations
    .from("production_job_operations")
    .update({ technician_bill_id: null })
    .eq("technician_bill_id", billingNoteId);
}

async function readBillingNoteRelease(
  supabase: SupabaseAdmin,
  billingNoteId: string,
): Promise<{ docNo: string; releasedCount: number } | null> {
  const { data: header } = await supabase
    .from("doc_headers")
    .select("doc_no, doc_type")
    .eq("id", billingNoteId)
    .maybeSingle();
  if (header && (header.doc_type === "BN" || header.doc_type === "BR")) {
    const { count } = await supabase
      .from("billing_note_items")
      .select("id", { count: "exact", head: true })
      .eq("billing_note_id", billingNoteId);
    return {
      docNo: String(header.doc_no ?? ""),
      releasedCount: count ?? 0,
    };
  }

  const { data: document } = await supabase
    .from("documents")
    .select("doc_no, doc_type")
    .eq("id", billingNoteId)
    .maybeSingle();
  if (!document || document.doc_type !== "TB") return null;
  const linked = await supabase
    .from("document_items")
    .select("id", { count: "exact", head: true })
    .eq("technician_bill_id", billingNoteId);
  if ((linked.count ?? 0) > 0) {
    return { docNo: String(document.doc_no ?? ""), releasedCount: linked.count ?? 0 };
  }
  const own = await supabase
    .from("document_items")
    .select("id", { count: "exact", head: true })
    .eq("document_id", billingNoteId);
  return { docNo: String(document.doc_no ?? ""), releasedCount: own.count ?? 0 };
}

async function fallbackDeleteBillingNote(
  supabase: SupabaseAdmin,
  billingNoteId: string,
): Promise<{ success: boolean; error: string | null }> {
  const { data: header } = await supabase
    .from("doc_headers")
    .select("id, doc_type, payment_status")
    .eq("id", billingNoteId)
    .maybeSingle();
  if (header && (header.doc_type === "BN" || header.doc_type === "BR")) {
    if (!isOpenBillingStatus(header.payment_status)) {
      return { success: false, error: "ลบได้เฉพาะใบวางบิลที่ยังไม่ชำระ (PENDING/UNPAID)" };
    }
    const { error: itemsError } = await supabase
      .from("billing_note_items")
      .delete()
      .eq("billing_note_id", billingNoteId);
    if (itemsError) return { success: false, error: itemsError.message };
    const { error: headerError } = await supabase.from("doc_headers").delete().eq("id", billingNoteId);
    if (headerError) return { success: false, error: headerError.message };
    return { success: true, error: null };
  }

  const { data: document } = await supabase
    .from("documents")
    .select("id, doc_type, payment_status, paid_amount")
    .eq("id", billingNoteId)
    .maybeSingle();
  if (!document || document.doc_type !== "TB") {
    return { success: false, error: "ไม่พบใบวางบิล" };
  }
  if (!isOpenBillingStatus(document.payment_status) || toMoney(document.paid_amount) > MONEY_EPS) {
    return { success: false, error: "ลบได้เฉพาะใบสรุปช่างที่ยังไม่ชำระ" };
  }
  await unlockTechnicianBill(supabase, billingNoteId);
  const { error: linesError } = await supabase.from("document_items").delete().eq("document_id", billingNoteId);
  if (linesError) return { success: false, error: linesError.message };
  const { error: docError } = await supabase.from("documents").delete().eq("id", billingNoteId);
  if (docError) return { success: false, error: docError.message };
  return { success: true, error: null };
}

async function rewriteBillingNoteItems(
  supabase: SupabaseAdmin,
  noteId: string,
  contactId: string,
  category: BillingCategory,
  invoiceIds: string[],
): Promise<{ total: number | null; error: string | null }> {
  const ids = Array.from(new Set(invoiceIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) return { total: null, error: "ต้องมีอย่างน้อย 1 บิลในใบวางบิล" };
  const expected = category === "AR" ? AR_INVOICE_TYPES : AP_INVOICE_TYPES;
  const { data: ownRows, error: ownError } = await supabase
    .from("billing_note_items")
    .select("invoice_id, billed_amount")
    .eq("billing_note_id", noteId);
  if (ownError) return { total: null, error: ownError.message };
  const ownAmount = new Map(
    (ownRows ?? []).map((row) => [String(row.invoice_id), roundMoney(toMoney(row.billed_amount))]),
  );
  const billed = await loadBilledInvoiceKeys(supabase);
  if (billed.error) return { total: null, error: billed.error };

  const additions: { invoice_id: string; billed_amount: number }[] = [];
  for (const id of ids) {
    if (ownAmount.has(id)) continue;
    if (billed.ids.has(id)) {
      return { total: null, error: "มีบิลที่อยู่ในใบวางบิลใบอื่นแล้ว" };
    }
    const { data: header } = await supabase
      .from("doc_headers")
      .select("id, doc_no, doc_type, contact_id, grand_total, doc_date, due_date")
      .eq("id", id)
      .maybeSingle();
    let invoiceId = header?.id ? String(header.id) : "";
    let docNo = String(header?.doc_no ?? "");
    let docType = String(header?.doc_type ?? "");
    let ownerId = String(header?.contact_id ?? "");
    let grand = toMoney(header?.grand_total);
    if (!header) {
      const { data: doc } = await supabase
        .from("documents")
        .select("id, doc_no, doc_type, contact_id, grand_total, doc_date, due_date, payment_status")
        .eq("id", id)
        .maybeSingle();
      if (!doc?.doc_no || !doc.doc_type) return { total: null, error: "ไม่พบบิลที่เลือก" };
      const ensured = await ensureDocHeaderForDocument(supabase, {
        id: String(doc.id),
        doc_no: String(doc.doc_no),
        doc_type: String(doc.doc_type),
        doc_date: doc.doc_date ? String(doc.doc_date) : new Date().toISOString().slice(0, 10),
        due_date: doc.due_date ? String(doc.due_date) : null,
        grand_total: roundMoney(toMoney(doc.grand_total)),
        payment_status: doc.payment_status,
        contact_id: String(doc.contact_id ?? contactId),
      });
      if (!ensured.headerId) return { total: null, error: ensured.error ?? "สร้างหัวบิลอ้างอิงไม่สำเร็จ" };
      invoiceId = ensured.headerId;
      docNo = String(doc.doc_no);
      docType = String(doc.doc_type);
      ownerId = String(doc.contact_id ?? "");
      grand = toMoney(doc.grand_total);
    }
    if (ownerId !== contactId) return { total: null, error: "เลือกได้เฉพาะบิลของคู่ค้ารายนี้" };
    if (!(expected as readonly string[]).includes(docType)) {
      return { total: null, error: `ประเภทบิล ${docNo} ไม่ตรงกับใบวางบิล` };
    }
    if (billed.docNos.has(docNo)) return { total: null, error: `บิล ${docNo} ถูกวางบิลแล้ว` };
    const { data: ledger } = await supabase
      .from("documents")
      .select("paid_amount, grand_total")
      .eq("doc_no", docNo)
      .maybeSingle();
    const outstanding = roundMoney(
      toMoney(ledger?.grand_total ?? grand) - toMoney(ledger?.paid_amount),
    );
    if (outstanding <= MONEY_EPS) return { total: null, error: `บิล ${docNo} ไม่มียอดค้างชำระแล้ว` };
    additions.push({ invoice_id: invoiceId || id, billed_amount: outstanding });
  }

  const removeIds = Array.from(ownAmount.keys()).filter((id) => !ids.includes(id));
  if (removeIds.length > 0) {
    const { error } = await supabase
      .from("billing_note_items")
      .delete()
      .eq("billing_note_id", noteId)
      .in("invoice_id", removeIds);
    if (error) return { total: null, error: error.message };
  }
  if (additions.length > 0) {
    const { error } = await supabase.from("billing_note_items").insert(
      additions.map((line) => ({
        billing_note_id: noteId,
        invoice_id: line.invoice_id,
        billed_amount: line.billed_amount,
        updated_at: new Date().toISOString(),
      })),
    );
    if (error) return { total: null, error: error.message };
  }
  const total = roundMoney(
    ids.reduce((sum, id) => sum + (ownAmount.get(id) ?? 0), 0) +
      additions.reduce((sum, line) => sum + line.billed_amount, 0),
  );
  return { total, error: null };
}

async function fallbackUpdateBillingNote(
  supabase: SupabaseAdmin,
  payload: {
    billingNoteId: string;
    docDate: string;
    dueDate: string;
    notes?: string;
    invoiceIds?: string[];
    autoRenumber?: boolean;
  },
): Promise<{ success: boolean; error: string | null; docNo: string | null }> {
  const noteId = payload.billingNoteId.trim();
  const { data: header } = await supabase
    .from("doc_headers")
    .select("id, doc_no, doc_type, doc_date, payment_status, contact_id")
    .eq("id", noteId)
    .maybeSingle();

  if (header && (header.doc_type === "BN" || header.doc_type === "BR")) {
    if (!isOpenBillingStatus(header.payment_status)) {
      return { success: false, error: "แก้ไขได้เฉพาะใบวางบิลที่ยังไม่ชำระ", docNo: null };
    }
    let total: number | null = null;
    if (payload.invoiceIds) {
      const rewritten = await rewriteBillingNoteItems(
        supabase,
        noteId,
        String(header.contact_id),
        header.doc_type === "BN" ? "AR" : "AP",
        payload.invoiceIds,
      );
      if (rewritten.error || rewritten.total == null) {
        return { success: false, error: rewritten.error ?? "แก้รายการบิลไม่สำเร็จ", docNo: null };
      }
      total = rewritten.total;
    }
    let docNo = String(header.doc_no ?? "");
    const nextMonth = `${payload.docDate.slice(2, 4)}${payload.docDate.slice(5, 7)}`;
    if (payload.autoRenumber !== false && billingNoteMonthToken(docNo) !== nextMonth) {
      const allocated = await allocateBillingNoteDocNo(supabase, header.doc_type, payload.docDate);
      if (!allocated.docNo) return { success: false, error: allocated.error, docNo: null };
      docNo = allocated.docNo;
    }
    const patch: Record<string, string | number | null> = {
      doc_date: payload.docDate,
      due_date: payload.dueDate,
      doc_no: docNo,
    };
    if (total != null) {
      patch.sub_total = total;
      patch.grand_total = total;
    }
    if (payload.notes !== undefined) patch.notes = payload.notes.trim() || null;
    let { error } = await supabase.from("doc_headers").update(patch as never).eq("id", noteId);
    if (error && /notes|42703|schema cache/i.test(error.message)) {
      delete patch.notes;
      const retry = await supabase.from("doc_headers").update(patch as never).eq("id", noteId);
      error = retry.error;
    }
    if (error) return { success: false, error: error.message, docNo: null };
    return { success: true, error: null, docNo };
  }

  const { data: document } = await supabase
    .from("documents")
    .select("id, doc_no, doc_type, payment_status, paid_amount")
    .eq("id", noteId)
    .maybeSingle();
  if (!document || document.doc_type !== "TB") {
    return { success: false, error: "ไม่พบใบวางบิล", docNo: null };
  }
  if (!isOpenBillingStatus(document.payment_status) || toMoney(document.paid_amount) > MONEY_EPS) {
    return { success: false, error: "แก้ไขได้เฉพาะใบสรุปช่างที่ยังไม่ชำระ", docNo: null };
  }
  let docNo = String(document.doc_no ?? "");
  const nextMonth = `${payload.docDate.slice(2, 4)}${payload.docDate.slice(5, 7)}`;
  if (payload.autoRenumber !== false && billingNoteMonthToken(docNo) !== nextMonth) {
    const allocated = await allocateBillingNoteDocNo(supabase, "TB", payload.docDate);
    if (!allocated.docNo) return { success: false, error: allocated.error, docNo: null };
    docNo = allocated.docNo;
  }
  const { error } = await supabase
    .from("documents")
    .update({
      doc_no: docNo,
      doc_date: payload.docDate,
      due_date: payload.dueDate,
      notes: payload.notes?.trim() || null,
    })
    .eq("id", noteId);
  if (error) return { success: false, error: error.message, docNo: null };
  return { success: true, error: null, docNo };
}

export async function deleteBillingNoteAction(
  billingNoteId: string,
): Promise<{
  success: boolean;
  error: string | null;
  docNo: string | null;
  releasedCount: number;
}> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { success: false, error: owner.error, docNo: null, releasedCount: 0 };
  const userId = owner.userId;
  const id = billingNoteId.trim();
  if (!id) return { success: false, error: "ไม่พบใบวางบิล", docNo: null, releasedCount: 0 };

  try {
    const supabase = createClient();
    const release = await readBillingNoteRelease(supabase, id);
    const rpc = supabase as unknown as {
      rpc: (
        fn: "delete_billing_note_transaction",
        args: { p_billing_note_id: string; p_actor_id: string },
      ) => Promise<{ error: { code?: string; message?: string } | null }>;
    };
    const { error } = await rpc.rpc("delete_billing_note_transaction", {
      p_billing_note_id: id,
      p_actor_id: userId,
    });
    if (error && !isMissingBillingNoteRpc(error.message ?? "")) {
      return {
        success: false,
        error: error.message ?? "ลบใบวางบิลไม่สำเร็จ",
        docNo: null,
        releasedCount: 0,
      };
    }
    if (error) {
      const fallback = await fallbackDeleteBillingNote(supabase, id);
      if (!fallback.success) {
        return { success: false, error: fallback.error, docNo: null, releasedCount: 0 };
      }
    }
    revalidatePath("/finance/billing-notes");
    revalidatePath("/finance/billing-notes/create");
    return {
      success: true,
      error: null,
      docNo: release?.docNo || null,
      releasedCount: release?.releasedCount ?? 0,
    };
  } catch (error: unknown) {
    if (isRedirectError(error)) throw error;
    const message = error instanceof Error ? error.message : "ลบใบวางบิลไม่สำเร็จ";
    return { success: false, error: message, docNo: null, releasedCount: 0 };
  }
}

export async function updateBillingNoteAction(payload: {
  billingNoteId: string;
  docDate: string;
  dueDate: string;
  notes?: string;
  invoiceIds?: string[];
  autoRenumber?: boolean;
}): Promise<{ success: boolean; error: string | null; docNo: string | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { success: false, error: owner.error, docNo: null };
  const userId = owner.userId;
  const billingNoteId = payload.billingNoteId?.trim() ?? "";
  const docDate = payload.docDate?.trim() ?? "";
  const dueDate = payload.dueDate?.trim() ?? "";
  if (!billingNoteId) return { success: false, error: "ไม่พบใบวางบิล", docNo: null };
  if (!isIsoDate(docDate) || !isIsoDate(dueDate)) {
    return { success: false, error: "วันที่เอกสารและวันครบกำหนดต้องเป็น YYYY-MM-DD", docNo: null };
  }
  if (dueDate < docDate) {
    return { success: false, error: "วันครบกำหนดต้องไม่ก่อนวันที่วางบิล", docNo: null };
  }

  try {
    const supabase = createClient();
    const rpc = supabase as unknown as {
      rpc: (
        fn: "update_billing_note_transaction",
        args: {
          p_billing_note_id: string;
          p_doc_date: string;
          p_due_date: string;
          p_notes: string | null;
          p_invoice_ids: string[] | null;
          p_auto_renumber_if_month_changed: boolean;
          p_actor_id: string;
        },
      ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
    };
    const { data, error } = await rpc.rpc("update_billing_note_transaction", {
      p_billing_note_id: billingNoteId,
      p_doc_date: docDate,
      p_due_date: dueDate,
      p_notes: payload.notes?.trim() || null,
      p_invoice_ids: payload.invoiceIds ?? null,
      p_auto_renumber_if_month_changed: payload.autoRenumber !== false,
      p_actor_id: userId,
    });
    let docNo: string | null = typeof data === "string" ? data : null;
    if (error && !isMissingBillingNoteRpc(error.message ?? "")) {
      return { success: false, error: error.message ?? "แก้ไขใบวางบิลไม่สำเร็จ", docNo: null };
    }
    if (error) {
      const fallback = await fallbackUpdateBillingNote(supabase, {
        billingNoteId,
        docDate,
        dueDate,
        notes: payload.notes,
        invoiceIds: payload.invoiceIds,
        autoRenumber: payload.autoRenumber,
      });
      if (!fallback.success) return fallback;
      docNo = fallback.docNo;
    }
    revalidatePath("/finance/billing-notes");
    revalidatePath(`/finance/billing-notes/${billingNoteId}`);
    return { success: true, error: null, docNo };
  } catch (error: unknown) {
    if (isRedirectError(error)) throw error;
    const message = error instanceof Error ? error.message : "แก้ไขใบวางบิลไม่สำเร็จ";
    return { success: false, error: message, docNo: null };
  }
}
