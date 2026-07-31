"use server";

/**
 * Document Server Actions (sales ledger: `documents` + `document_items`).
 * Zero Client-Side Fetching: Service Role via `createSupabaseServerClient`.
 */

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";

const SALES_PATH = "/sales";

export type DeleteDraftDocumentResult = {
  success: boolean;
  docNo: string | null;
  error: string | null;
};

/**
 * Physically delete a DRAFT document.
 * Only `documents.status === 'DRAFT'` is allowed — no ledger/inventory impact.
 * Line items cascade via `document_items.document_id ON DELETE CASCADE`.
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
      .select("id, doc_no, status")
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
