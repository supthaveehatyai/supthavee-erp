"use server";

/**
 * Phase 5 — AR / AP Dashboard Server Actions.
 * Zero Client-Side Fetching: Service Role via `createSupabaseServerClient`.
 */

import { AP_PAYABLE_DOC_TYPES } from "@/lib/constants/document";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type {
  AccountPayableGroup,
  AccountReceivableGroup,
  ArDocument,
  GetAccountPayablesResult,
  GetAccountReceivablesResult,
} from "@/types/account-receivable";

const OPEN_PAYMENT_STATUSES = ["UNPAID", "PARTIAL", "Pending"] as const;
const AR_DOC_TYPES = ["INV_DO", "TAX_INV"] as const;

type ContactJoin = {
  id?: string;
  company_name?: string | null;
};

type LedgerDocRow = {
  id: string;
  doc_no: string | null;
  document_no?: string | null;
  document_number?: string | null;
  doc_date: string | null;
  due_date?: string | null;
  doc_type: string | null;
  grand_total?: number | string | null;
  net_amount?: number | string | null;
  total_amount?: number | string | null;
  amount?: number | string | null;
  paid_amount?: number | string | null;
  payment_status?: string | null;
  contact_id?: string | null;
  status?: string | null;
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

/**
 * Debt base amount — always prefer `grand_total` (incl. VAT).
 * Fallback chain only when grand_total is missing/zero-ish and legacy fields exist.
 */
function resolveDocumentDebtAmount(doc: LedgerDocRow): number {
  const grand = toMoney(doc.grand_total);
  if (doc.grand_total != null && Number.isFinite(Number(doc.grand_total))) {
    return grand;
  }
  return toMoney(doc.net_amount ?? doc.total_amount ?? doc.amount);
}

function displayDocNo(doc: LedgerDocRow): string {
  return (
    doc.doc_no?.trim() ||
    doc.document_no?.trim() ||
    doc.document_number?.trim() ||
    "ไม่ระบุ"
  );
}

function groupByContact(
  rows: LedgerDocRow[],
  fallbackName: string,
): AccountReceivableGroup[] {
  const grouped = new Map<string, AccountReceivableGroup>();

  for (const raw of rows) {
    const contact = unwrapContact(raw.contacts);
    const contactId = raw.contact_id?.trim() || contact?.id || "unknown";
    const contactName =
      contact?.company_name?.trim() || fallbackName;

    const debtAmount = resolveDocumentDebtAmount(raw);
    const paidAmount = toMoney(raw.paid_amount);
    const remaining = debtAmount - paidAmount;
    if (remaining <= 0) continue;

    const doc: ArDocument = {
      id: raw.id,
      doc_no: displayDocNo(raw),
      doc_date: raw.doc_date ? String(raw.doc_date) : "",
      due_date: raw.due_date ? String(raw.due_date) : null,
      doc_type: String(raw.doc_type ?? ""),
      grand_total: debtAmount,
      paid_amount: paidAmount,
      remaining_balance: remaining,
      payment_status: String(raw.payment_status ?? "UNPAID"),
      contact_id: contactId,
    };

    const existing = grouped.get(contactId);
    if (!existing) {
      grouped.set(contactId, {
        contact_id: contactId,
        contact_name: contactName,
        total_invoices: 1,
        total_debt: debtAmount,
        total_paid: paidAmount,
        remaining_balance: remaining,
        documents: [doc],
      });
      continue;
    }

    existing.total_invoices += 1;
    existing.total_debt += debtAmount;
    existing.total_paid += paidAmount;
    existing.remaining_balance += remaining;
    existing.documents.push(doc);
  }

  return Array.from(grouped.values()).sort(
    (a, b) => b.remaining_balance - a.remaining_balance,
  );
}

/**
 * Open AR invoices grouped by customer.
 * Debt uses `grand_total` (VAT-inclusive) first.
 */
export async function getAccountReceivables(): Promise<GetAccountReceivablesResult> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_date,
        due_date,
        doc_type,
        grand_total,
        total_amount,
        paid_amount,
        payment_status,
        contact_id,
        status,
        is_voided,
        contacts:contact_id (
          id,
          company_name
        )
      `,
      )
      .in("doc_type", [...AR_DOC_TYPES])
      .in("payment_status", [...OPEN_PAYMENT_STATUSES])
      .in("status", ["ISSUED", "COMPLETED"])
      .or("is_voided.is.null,is_voided.eq.false")
      .order("doc_date", { ascending: true });

    if (error) {
      return {
        data: [],
        error: error.message ?? "ไม่สามารถดึงข้อมูลลูกหนี้ได้",
      };
    }

    return {
      data: groupByContact(
        (data ?? []) as LedgerDocRow[],
        "ลูกค้าทั่วไป (ไม่มีชื่อ)",
      ),
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถดึงข้อมูลลูกหนี้ได้";
    return { data: [], error: message };
  }
}

/**
 * Open AP invoices grouped by vendor / technician.
 * Sources Phase 4 `documents` (AP_TAX / AP_INV / TB) — same ledger as PAY knock-off.
 */
export async function getAccountPayables(): Promise<GetAccountPayablesResult> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_date,
        due_date,
        doc_type,
        grand_total,
        total_amount,
        paid_amount,
        payment_status,
        contact_id,
        status,
        is_voided,
        contacts:contact_id (
          id,
          company_name
        )
      `,
      )
      .in("doc_type", [...AP_PAYABLE_DOC_TYPES])
      .in("payment_status", [...OPEN_PAYMENT_STATUSES])
      .in("status", ["ISSUED", "COMPLETED"])
      .or("is_voided.is.null,is_voided.eq.false")
      .order("doc_date", { ascending: true });

    if (error) {
      return {
        data: [],
        error: error.message ?? "ไม่สามารถดึงข้อมูลเจ้าหนี้ได้",
      };
    }

    const grouped = groupByContact(
      (data ?? []) as LedgerDocRow[],
      "ผู้จำหน่ายทั่วไป (ไม่มีชื่อ)",
    ) as AccountPayableGroup[];

    return { data: grouped, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถดึงข้อมูลเจ้าหนี้ได้";
    return { data: [], error: message };
  }
}
