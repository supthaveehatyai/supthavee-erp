"use server";

/**
 * Phase 5 — Accounts Receivable (AR) Server Actions.
 *
 * Zero Client-Side Fetching: Service Role via `createSupabaseServerClient` only.
 * Groups open sales invoices (INV_DO / TAX_INV) by customer (`contact_id`).
 */

import { createSupabaseServerClient } from "@/lib/supabase-server";
import type {
  AccountReceivableGroup,
  ArDocument,
  GetAccountReceivablesResult,
} from "@/types/account-receivable";

/** Open AR statuses — UNPAID/PARTIAL (+ legacy Pending). */
const OPEN_PAYMENT_STATUSES = ["UNPAID", "PARTIAL", "Pending"] as const;

/** Credit sales invoices only (cash CS_TAX / ABB are PAID on issue). */
const AR_DOC_TYPES = ["INV_DO", "TAX_INV"] as const;

type ContactJoin = {
  id: string;
  company_name: string;
};

type ArDocumentRow = {
  id: string;
  doc_no: string;
  doc_date: string;
  due_date: string | null;
  doc_type: string;
  grand_total: number | string | null;
  paid_amount: number | string | null;
  payment_status: string;
  contact_id: string | null;
  contacts: ContactJoin | ContactJoin[] | null;
};

function unwrapContact(
  value: ContactJoin | ContactJoin[] | null,
): ContactJoin | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Debt base — prefer `grand_total` (VAT-inclusive), then legacy fields.
 */
function resolveDocumentDebtAmount(doc: {
  grand_total?: number | string | null;
  net_amount?: number | string | null;
  total_amount?: number | string | null;
}): number {
  if (doc.grand_total != null && Number.isFinite(Number(doc.grand_total))) {
    return toMoney(doc.grand_total);
  }
  return toMoney(doc.net_amount ?? doc.total_amount);
}

/**
 * Load open AR invoices and group remaining balances by customer.
 * Only ISSUED sales bills that are still UNPAID / PARTIAL (or legacy Pending).
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
        paid_amount,
        payment_status,
        contact_id,
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

    const grouped = new Map<string, AccountReceivableGroup>();

    for (const raw of (data ?? []) as ArDocumentRow[]) {
      const contact = unwrapContact(raw.contacts);
      const contactId = raw.contact_id?.trim() || contact?.id || "unknown";
      const contactName =
        contact?.company_name?.trim() || "ลูกค้าทั่วไป (ไม่มีชื่อ)";

      const grandTotal = resolveDocumentDebtAmount(raw);
      const paidAmount = toMoney(raw.paid_amount);
      const remaining = grandTotal - paidAmount;

      // Skip fully settled rows that slipped through status filters.
      if (remaining <= 0) continue;

      const doc: ArDocument = {
        id: raw.id,
        doc_no: raw.doc_no,
        doc_date: String(raw.doc_date),
        due_date: raw.due_date ? String(raw.due_date) : null,
        doc_type: raw.doc_type,
        grand_total: grandTotal,
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
          total_debt: grandTotal,
          total_paid: paidAmount,
          remaining_balance: remaining,
          documents: [doc],
        });
        continue;
      }

      existing.total_invoices += 1;
      existing.total_debt += grandTotal;
      existing.total_paid += paidAmount;
      existing.remaining_balance += remaining;
      existing.documents.push(doc);
    }

    const result = Array.from(grouped.values()).sort(
      (a, b) => b.remaining_balance - a.remaining_balance,
    );

    return { data: result, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถดึงข้อมูลลูกหนี้ได้";
    return { data: [], error: message };
  }
}
