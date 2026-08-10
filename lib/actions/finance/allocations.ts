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
  DepositAllocationHistoryRow,
  DocumentAllocationRow,
  GetDepositAllocationHistoryResult,
  GetDocumentAllocationsResult,
  UpdateReceiptStatusResult,
} from "@/types/document-allocation";

type InvoiceJoin = {
  id?: string;
  doc_no?: string | null;
  notes?: string | null;
  contact_id?: string | null;
  doc_date?: string | null;
  doc_type?: string | null;
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
          doc_type,
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
        original_receipt_received,
        invoice:invoice_doc_id (
          id,
          doc_no,
          doc_type,
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
        target_doc_type: String(invoice?.doc_type ?? ""),
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

type ReceiptJoin = {
  id?: string;
  doc_no?: string | null;
  doc_type?: string | null;
  doc_date?: string | null;
  notes?: string | null;
};

type DepositAllocQueryRow = {
  id: string;
  allocated_amount: number | string | null;
  created_at?: string | null;
  adjustment_reason?: string | null;
  receipt_doc_id: string;
  receipt: ReceiptJoin | ReceiptJoin[] | null;
};

function unwrapReceipt(
  value: ReceiptJoin | ReceiptJoin[] | null,
): ReceiptJoin | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function resolveDepositActionType(
  adjustmentReason: string | null | undefined,
  receiptDocType: string,
): DepositAllocationHistoryRow["action_type"] {
  const reason = String(adjustmentReason ?? "").trim().toUpperCase();
  const docType = String(receiptDocType ?? "").trim().toUpperCase();

  if (
    reason.startsWith("WRITE_OFF") ||
    docType === "WRITE_OFF" ||
    docType === "WRITEOFF" ||
    docType === "AR_WRITEOFF" ||
    docType === "AP_WRITEOFF"
  ) {
    return "WRITE_OFF";
  }
  if (
    reason.startsWith("REFUND") ||
    docType === "REFUND" ||
    docType === "AR_REFUND" ||
    docType === "AP_REFUND"
  ) {
    return "REFUND";
  }
  return "APPLY";
}

function extractActionRemark(
  adjustmentReason: string | null | undefined,
  receiptNotes: string | null | undefined,
): string | null {
  const reason = String(adjustmentReason ?? "").trim();
  if (reason.includes(":")) {
    const after = reason.slice(reason.indexOf(":") + 1).trim();
    if (after) return after;
  }

  const notes = String(receiptNotes ?? "").trim();
  if (!notes) return null;
  const match = notes.match(/remark=([^|]+)/i);
  const fromNotes = match?.[1]?.trim() ?? "";
  return fromNotes || null;
}

/**
 * Allocation history for a deposit document (DEP_IN / DEP_OUT).
 * Looks up rows where `invoice_doc_id` = deposit id
 * (DEPOSIT_APPLY / REFUND / WRITE_OFF),
 * then resolves sibling invoice knock-offs on the same REC/PAY.
 */
export async function getDepositAllocationHistory(
  depositDocId: string,
): Promise<GetDepositAllocationHistoryResult> {
  const trimmed = depositDocId?.trim() ?? "";
  if (!trimmed) return { data: [], error: null };

  try {
    const supabase = createSupabaseServerClient();

    const { data, error } = await supabase
      .from("document_allocations")
      .select(
        `
        id,
        allocated_amount,
        created_at,
        adjustment_reason,
        receipt_doc_id,
        receipt:receipt_doc_id (
          id,
          doc_no,
          doc_type,
          doc_date,
          notes
        )
      `,
      )
      .eq("invoice_doc_id", trimmed)
      .order("created_at", { ascending: false });

    if (error) {
      return { data: [], error: error.message };
    }

    const rows = (data ?? []) as DepositAllocQueryRow[];
    if (rows.length === 0) return { data: [], error: null };

    const applyReceiptIds = [
      ...new Set(
        rows
          .filter((row) => {
            const receipt = unwrapReceipt(row.receipt);
            const action = resolveDepositActionType(
              row.adjustment_reason,
              String(receipt?.doc_type ?? ""),
            );
            return action === "APPLY";
          })
          .map((row) => row.receipt_doc_id)
          .filter(Boolean),
      ),
    ];

    const invoicesByReceipt = new Map<string, string[]>();
    if (applyReceiptIds.length > 0) {
      const { data: siblings, error: siblingError } = await supabase
        .from("document_allocations")
        .select(
          `
          receipt_doc_id,
          invoice_doc_id,
          invoice:invoice_doc_id (
            id,
            doc_no,
            doc_type
          )
        `,
        )
        .in("receipt_doc_id", applyReceiptIds);

      if (siblingError) {
        return { data: [], error: siblingError.message };
      }

      for (const sibling of siblings ?? []) {
        const receiptId = String(sibling.receipt_doc_id ?? "");
        const invoice = unwrapInvoice(
          sibling.invoice as InvoiceJoin | InvoiceJoin[] | null,
        );
        const invoiceDocNo = invoice?.doc_no?.trim() || "";
        const invoiceDocType = String(
          (invoice as { doc_type?: string | null } | null)?.doc_type ?? "",
        );
        // Skip the deposit row itself and other deposit / stub types
        if (
          !receiptId ||
          !invoiceDocNo ||
          sibling.invoice_doc_id === trimmed ||
          invoiceDocType === "DEP_IN" ||
          invoiceDocType === "DEP_OUT" ||
          invoiceDocType === "REFUND" ||
          invoiceDocType === "WRITE_OFF" ||
          invoiceDocType === "AR_REFUND" ||
          invoiceDocType === "AR_WRITEOFF" ||
          invoiceDocType === "AP_REFUND" ||
          invoiceDocType === "AP_WRITEOFF"
        ) {
          continue;
        }
        const list = invoicesByReceipt.get(receiptId) ?? [];
        if (!list.includes(invoiceDocNo)) list.push(invoiceDocNo);
        invoicesByReceipt.set(receiptId, list);
      }
    }

    const mapped: DepositAllocationHistoryRow[] = rows.map((row) => {
      const receipt = unwrapReceipt(row.receipt);
      const receiptDocType = String(receipt?.doc_type ?? "");
      const actionType = resolveDepositActionType(
        row.adjustment_reason,
        receiptDocType,
      );
      return {
        id: row.id,
        applied_date: receipt?.doc_date
          ? String(receipt.doc_date)
          : row.created_at
            ? String(row.created_at).slice(0, 10)
            : "",
        receipt_doc_id: row.receipt_doc_id,
        receipt_doc_no: receipt?.doc_no?.trim() || "ไม่ระบุ",
        receipt_doc_type: receiptDocType,
        related_invoice_doc_nos:
          actionType === "APPLY"
            ? (invoicesByReceipt.get(row.receipt_doc_id) ?? [])
            : [],
        allocated_amount: roundMoney(toMoney(row.allocated_amount)),
        action_type: actionType,
        remark: extractActionRemark(row.adjustment_reason, receipt?.notes),
      };
    });

    return { data: mapped, error: null };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "โหลดประวัติการใช้งานมัดจำไม่สำเร็จ";
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
