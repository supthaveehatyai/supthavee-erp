"use server";

/**
 * Shared helper: available DEP_IN / DEP_OUT balances for payment knock-off.
 * Remaining = grand_total − Σ(document_allocations.allocated_amount where invoice_doc_id = deposit).
 * Falls back to documents.deposit_deducted when no allocation rows exist yet.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { roundMoney } from "@/lib/utils/payment-fifo";
import type { AvailableDeposit } from "@/types/available-deposit";

type DepositDocRow = {
  id: string;
  doc_no: string | null;
  doc_date: string | null;
  doc_type: string | null;
  grand_total: number | string | null;
  deposit_deducted: number | string | null;
  contact_id: string | null;
  status?: string | null;
  is_voided?: boolean | null;
};

type AllocRow = {
  invoice_doc_id: string;
  allocated_amount: number | string | null;
};

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * List deposits with remaining balance > 0 for a contact.
 */
export async function getAvailableDepositsForContact(
  contactId: string,
  docType: "DEP_IN" | "DEP_OUT",
  client?: SupabaseClient,
): Promise<AvailableDeposit[]> {
  const trimmed = contactId?.trim() ?? "";
  if (!trimmed) return [];

  try {
    const supabase = client ?? createSupabaseServerClient();

    const { data, error } = await supabase
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_date,
        doc_type,
        grand_total,
        deposit_deducted,
        contact_id,
        status,
        is_voided
      `,
      )
      .eq("contact_id", trimmed)
      .eq("doc_type", docType)
      .in("status", ["ISSUED", "COMPLETED"])
      .or("is_voided.is.null,is_voided.eq.false")
      .order("doc_date", { ascending: true });

    if (error) {
      console.error("Error fetching available deposits:", error.message);
      return [];
    }

    const deposits = ((data ?? []) as DepositDocRow[]).filter(
      (row) => row.is_voided !== true,
    );
    if (deposits.length === 0) return [];

    const depositIds = deposits.map((d) => d.id);
    const { data: allocRows, error: allocError } = await supabase
      .from("document_allocations")
      .select("invoice_doc_id, allocated_amount")
      .in("invoice_doc_id", depositIds);

    if (allocError) {
      console.error(
        "Error fetching deposit allocations:",
        allocError.message,
      );
      return [];
    }

    const usedByDeposit = new Map<string, number>();
    for (const row of (allocRows ?? []) as AllocRow[]) {
      const id = row.invoice_doc_id;
      const prev = usedByDeposit.get(id) ?? 0;
      usedByDeposit.set(
        id,
        roundMoney(prev + toMoney(row.allocated_amount)),
      );
    }

    return deposits
      .map((doc) => {
        const grandTotal = roundMoney(toMoney(doc.grand_total));
        const usedFromAlloc = usedByDeposit.get(doc.id) ?? 0;
        const usedFromField = roundMoney(toMoney(doc.deposit_deducted));
        const usedAmount = roundMoney(Math.max(usedFromAlloc, usedFromField));
        const remaining = roundMoney(grandTotal - usedAmount);

        return {
          id: doc.id,
          doc_no: doc.doc_no?.trim() || "ไม่ระบุ",
          document_date: doc.doc_date ? String(doc.doc_date) : "",
          doc_type: docType,
          grand_total: grandTotal,
          used_amount: usedAmount,
          remaining_balance: remaining,
          contact_id: doc.contact_id?.trim() || trimmed,
        } satisfies AvailableDeposit;
      })
      .filter((row) => row.remaining_balance > 0.02);
  } catch (err) {
    console.error("Error fetching available deposits:", err);
    return [];
  }
}
