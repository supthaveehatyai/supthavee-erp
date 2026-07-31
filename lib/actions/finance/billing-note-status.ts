/**
 * After AR/AP knock-off: sync related Billing Note (BN) / Bill Receipt (BR)
 * payment_status on `doc_headers` based on linked invoice outstanding.
 *
 * Note: `documents.status` is ENUM document_status — never write PARTIAL there.
 * Use payment_status for PAID/PARTIAL and status=COMPLETED when fully paid.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { roundMoney } from "@/lib/utils/payment-fifo";

const MONEY_EPS = 0.02;

export type SyncBillingNotesResult = {
  updated: number;
  error: string | null;
};

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Given primary-ledger invoice document IDs that were just paid (partial/full),
 * find parent BN/BR rows and set payment_status to COMPLETED or PARTIAL.
 */
export async function syncBillingNotesAfterInvoicePayment(
  supabase: SupabaseClient,
  invoiceDocumentIds: string[],
): Promise<SyncBillingNotesResult> {
  try {
    const ids = Array.from(
      new Set(invoiceDocumentIds.map((id) => id?.trim()).filter(Boolean)),
    );
    if (ids.length === 0) return { updated: 0, error: null };

    const { data: invoices, error: invoiceError } = await supabase
      .from("documents")
      .select("id, doc_no, doc_type, contact_id")
      .in("id", ids);

    if (invoiceError) {
      return { updated: 0, error: invoiceError.message };
    }

    const docNos = Array.from(
      new Set(
        (invoices ?? [])
          .map((row) => String(row.doc_no ?? "").trim())
          .filter(Boolean),
      ),
    );
    if (docNos.length === 0) return { updated: 0, error: null };

    const { data: headers, error: headerError } = await supabase
      .from("doc_headers")
      .select("id, doc_no, doc_type, contact_id")
      .in("doc_no", docNos);

    if (headerError) {
      return { updated: 0, error: headerError.message };
    }

    const headerIds = (headers ?? [])
      .filter((h) => {
        const t = String(h.doc_type ?? "");
        return t === "INV_DO" || t === "TAX_INV" || t === "AP_INV" || t === "AP_TAX";
      })
      .map((h) => String(h.id));

    if (headerIds.length === 0) return { updated: 0, error: null };

    const { data: items, error: itemsError } = await supabase
      .from("billing_note_items")
      .select("billing_note_id, invoice_id")
      .in("invoice_id", headerIds);

    if (itemsError) {
      return { updated: 0, error: itemsError.message };
    }

    const billingNoteIds = Array.from(
      new Set(
        (items ?? [])
          .map((row) => String(row.billing_note_id ?? ""))
          .filter(Boolean),
      ),
    );
    if (billingNoteIds.length === 0) return { updated: 0, error: null };

    let updated = 0;
    const nowIso = new Date().toISOString();

    for (const noteId of billingNoteIds) {
      const { data: noteItems, error: noteItemsError } = await supabase
        .from("billing_note_items")
        .select(
          `
          invoice_id,
          invoice:doc_headers!billing_note_items_invoice_id_fkey (
            id,
            doc_no,
            doc_type,
            contact_id
          )
        `,
        )
        .eq("billing_note_id", noteId);

      if (noteItemsError) {
        return { updated, error: noteItemsError.message };
      }

      type NoteItem = {
        invoice:
          | {
              doc_no?: string | null;
              doc_type?: string | null;
              contact_id?: string | null;
            }
          | {
              doc_no?: string | null;
              doc_type?: string | null;
              contact_id?: string | null;
            }[]
          | null;
      };

      const linked: { doc_no: string; doc_type: string; contact_id: string }[] =
        [];
      for (const row of (noteItems ?? []) as NoteItem[]) {
        const inv = Array.isArray(row.invoice)
          ? (row.invoice[0] ?? null)
          : row.invoice;
        const docNo = inv?.doc_no?.trim();
        const docType = inv?.doc_type?.trim();
        if (!docNo || !docType) continue;
        linked.push({
          doc_no: docNo,
          doc_type: docType,
          contact_id: String(inv?.contact_id ?? ""),
        });
      }

      if (linked.length === 0) continue;

      const linkedNos = Array.from(new Set(linked.map((l) => l.doc_no)));
      const { data: ledgerRows, error: ledgerError } = await supabase
        .from("documents")
        .select("doc_no, doc_type, grand_total, paid_amount, contact_id")
        .in("doc_no", linkedNos);

      if (ledgerError) {
        return { updated, error: ledgerError.message };
      }

      let allFullyPaid = linked.length > 0;
      let anyPaid = false;

      for (const link of linked) {
        const ledger = (ledgerRows ?? []).find(
          (row) =>
            String(row.doc_no) === link.doc_no &&
            String(row.doc_type) === link.doc_type,
        );
        const grand = roundMoney(toMoney(ledger?.grand_total));
        const paid = roundMoney(toMoney(ledger?.paid_amount));
        const outstanding = roundMoney(grand - paid);
        if (paid > MONEY_EPS) anyPaid = true;
        if (outstanding > MONEY_EPS) allFullyPaid = false;
      }

      const nextStatus = allFullyPaid
        ? "COMPLETED"
        : anyPaid
          ? "PARTIAL"
          : "PENDING";

      const { error: updateError } = await supabase
        .from("doc_headers")
        .update({ payment_status: nextStatus })
        .eq("id", noteId)
        .in("doc_type", ["BN", "BR"]);

      if (updateError) {
        return { updated, error: updateError.message };
      }
      updated += 1;
      void nowIso;
    }

    return { updated, error: null };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "อัปเดตสถานะใบวางบิลหลังตัดชำระไม่สำเร็จ";
    return { updated: 0, error: message };
  }
}
