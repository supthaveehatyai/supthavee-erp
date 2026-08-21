"use server";

/**
 * Document Server Actions (sales ledger: `documents` + `document_items`).
 * Zero Client-Side Fetching: Service Role via `createSupabaseServerClient`.
 */

import { revalidatePath } from "next/cache";
import { insertAuditLog } from "@/lib/supabase/auditService";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { DeleteDraftDocumentResult } from "@/types/document";

const SALES_PATH = "/sales";

/**
 * Physically delete a DRAFT document.
 * Only `documents.status === 'DRAFT'` is allowed — no ledger/inventory impact.
 * Line items cascade via `document_items.document_id ON DELETE CASCADE`.
 * Audit actor is resolved server-side inside `insertAuditLog` (auth.getUser).
 */
export async function deleteDraftDocument(
  documentId: string,
): Promise<DeleteDraftDocumentResult> {
  try {
    const id = documentId?.trim() ?? "";
    if (!id) {
      return { success: false, docNo: null, error: "ไม่พบรหัสเอกสาร" };
    }

    const supabase = createSupabaseServerClient();

    const { data: document, error: fetchError } = await supabase
      .from("documents")
      .select("id, doc_no, status, doc_type, contact_id")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) {
      return { success: false, docNo: null, error: fetchError.message };
    }
    if (!document) {
      return { success: false, docNo: null, error: "ไม่พบเอกสาร" };
    }

    if (document.status !== "DRAFT") {
      return {
        success: false,
        docNo: String(document.doc_no ?? ""),
        error: `ลบได้เฉพาะเอกสารสถานะ DRAFT (ปัจจุบัน: ${document.status})`,
      };
    }

    const snapshot = {
      id: document.id,
      doc_no: document.doc_no,
      doc_type: document.doc_type,
      status: document.status,
      contact_id: document.contact_id,
    };

    const { error: deleteError } = await supabase
      .from("documents")
      .delete()
      .eq("id", id)
      .eq("status", "DRAFT");

    if (deleteError) {
      return {
        success: false,
        docNo: String(document.doc_no ?? ""),
        error: deleteError.message,
      };
    }

    void insertAuditLog({
      tableName: "documents",
      recordId: id,
      action: "DELETE",
      oldData: snapshot,
      newData: { deleted: true, audit_event: "DELETE" },
    }).then((result) => {
      if (!result.success) {
        console.error("[deleteDraftDocument] audit:", result.error);
      }
    });

    revalidatePath(SALES_PATH);
    revalidatePath(`${SALES_PATH}/${encodeURIComponent(String(document.doc_no))}`);

    return {
      success: true,
      docNo: String(document.doc_no ?? ""),
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ลบเอกสารร่างไม่สำเร็จ";
    return { success: false, docNo: null, error: message };
  }
}
