"use server";

/**
 * Phase 5 — Document allocations for PAY / REC detail views.
 * Zero Client-Side Fetching: Service Role only.
 *
 * Schema: document_allocations.receipt_doc_id = PAY/REC (source)
 *         document_allocations.invoice_doc_id = AP/AR invoice (target)
 */

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { roundMoney } from "@/lib/utils/payment-fifo";
import type {
  DocumentAllocationRow,
  GetDocumentAllocationsResult,
  UpdateReceiptStatusResult,
} from "@/types/document-allocation";

type InvoiceJoin = {
  id?: string;
  doc_no?: string | null;
  notes?: string | null;
  contact_id?: string | null;
  doc_date?: string | null;
};

type AllocationQueryRow = {
  id: string;
  allocated_amount: number | string | null;
  wht_amount: number | string | null;
  invoice_doc_id: string;
  original_receipt_received?: boolean | null;
  invoice: InvoiceJoin | InvoiceJoin[] | null;
};

function unwrapInvoice(
  value: InvoiceJoin | InvoiceJoin[] | null,
): InvoiceJoin | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function extractVendorReference(notes: string | null | undefined): string | null {
  const raw = notes?.trim() ?? "";
  if (!raw) return null;
  const match = raw.match(/อ้างอิงบิลซัพพลายเออร์:\s*(.+)$/m);
  const value = match?.[1]?.trim() ?? "";
  return value || null;
}

/**
 * Allocations where `receipt_doc_id` = PAY/REC document id.
 */
export async function getDocumentAllocationsByReceiptId(
  receiptDocId: string,
): Promise<GetDocumentAllocationsResult> {
  const trimmed = receiptDocId?.trim() ?? "";
  if (!trimmed) return { data: [], error: null };

  try {
    const supabase = createSupabaseServerClient();
    const selectWithStatus = `
        id,
        allocated_amount,
        wht_amount,
        invoice_doc_id,
        original_receipt_received,
        invoice:invoice_doc_id (
          id,
          doc_no,
          notes,
          contact_id,
          doc_date
        )
      `;
    const selectLegacy = `
        id,
        allocated_amount,
        wht_amount,
        invoice_doc_id,
        invoice:invoice_doc_id (
          id,
          doc_no,
          notes,
          contact_id,
          doc_date
        )
      `;

    let { data, error } = await supabase
      .from("document_allocations")
      .select(selectWithStatus)
      .eq("receipt_doc_id", trimmed)
      .order("created_at", { ascending: true });

    // Fallback before migration `original_receipt_received` is applied
    if (
      error &&
      /original_receipt_received/i.test(error.message ?? "")
    ) {
      const legacy = await supabase
        .from("document_allocations")
        .select(selectLegacy)
        .eq("receipt_doc_id", trimmed)
        .order("created_at", { ascending: true });
      data = legacy.data;
      error = legacy.error;
    }

    if (error) {
      return { data: [], error: error.message };
    }

    const rows = (data ?? []) as AllocationQueryRow[];
    const contactIds = [
      ...new Set(
        rows
          .map((row) => unwrapInvoice(row.invoice)?.contact_id?.trim() || "")
          .filter(Boolean),
      ),
    ];

    const headerRefsByContact = new Map<string, Set<string>>();
    if (contactIds.length > 0) {
      const { data: headers } = await supabase
        .from("doc_headers")
        .select("contact_id, doc_no")
        .in("contact_id", contactIds)
        .neq("doc_type", "PAY");

      for (const header of headers ?? []) {
        const contactId = String(header.contact_id ?? "").trim();
        const docNo = String(header.doc_no ?? "").trim();
        if (!contactId || !docNo) continue;
        const set = headerRefsByContact.get(contactId) ?? new Set<string>();
        set.add(docNo);
        headerRefsByContact.set(contactId, set);
      }
    }

    const mapped: DocumentAllocationRow[] = rows.map((row) => {
      const invoice = unwrapInvoice(row.invoice);
      const targetDocNo = invoice?.doc_no?.trim() || "ไม่ระบุ";
      const fromNotes = extractVendorReference(invoice?.notes);
      const contactId = invoice?.contact_id?.trim() || "";
      const headerSet = contactId
        ? headerRefsByContact.get(contactId)
        : undefined;

      let referenceNo = fromNotes;
      if (!referenceNo && headerSet && headerSet.size > 0) {
        const candidates = [...headerSet].filter((no) => no !== targetDocNo);
        referenceNo = candidates[0] ?? [...headerSet][0] ?? null;
      }

      return {
        id: row.id,
        invoice_doc_id: row.invoice_doc_id,
        target_doc_no: targetDocNo,
        reference_no: referenceNo,
        allocated_amount: roundMoney(toMoney(row.allocated_amount)),
        wht_amount: roundMoney(toMoney(row.wht_amount)),
        original_receipt_received: row.original_receipt_received === true,
      };
    });

    return { data: mapped, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "โหลดรายการตัดยอดไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/**
 * Toggle whether the original paper receipt was received for an allocation line.
 */
export async function updateReceiptStatus(
  allocationId: string,
  isReceived: boolean,
): Promise<UpdateReceiptStatusResult> {
  const id = allocationId?.trim() ?? "";
  if (!id) {
    return { success: false, error: "ไม่พบรหัสรายการตัดยอด" };
  }

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("document_allocations")
      .update({
        original_receipt_received: Boolean(isReceived),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, receipt_doc_id")
      .maybeSingle();

    if (error) {
      if (/original_receipt_received/i.test(error.message ?? "")) {
        return {
          success: false,
          error:
            "ยังไม่ได้รัน migration คอลัมน์ original_receipt_received — รันไฟล์ supabase/migrations/20260729200000_document_allocations_original_receipt.sql ก่อน",
        };
      }
      return { success: false, error: error.message };
    }
    if (!data) {
      return { success: false, error: "ไม่พบรายการตัดยอดที่ต้องการอัปเดต" };
    }

    revalidatePath("/purchases");
    revalidatePath("/sales");
    revalidatePath("/finance/ap-payment");
    revalidatePath("/finance/payments");
    revalidatePath("/finance/ap-ar");

    return { success: true, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "อัปเดตสถานะใบเสร็จไม่สำเร็จ";
    return { success: false, error: message };
  }
}
