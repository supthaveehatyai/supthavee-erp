"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase-server";

function readIssuedReceiptNo(payload: unknown): string {
  if (typeof payload === "string") return payload.trim();
  if (Array.isArray(payload)) return readIssuedReceiptNo(payload[0]);
  if (!payload || typeof payload !== "object") return "";
  const row = payload as Record<string, unknown>;
  for (const key of ["doc_no", "receipt_doc_no", "new_doc_no", "rec_doc_no"]) {
    const value = String(row[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

/** ออกใบเสร็จรับเงิน REC จาก TAX_INV / INV_DO ที่รับเงินแล้ว */
export async function issueReceiptForTaxInvoice(input: {
  sourceDocumentId: string;
  receiptDate: string;
}): Promise<{ data: { doc_no: string } | null; error: string | null }> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error };

    const sourceDocumentId = input.sourceDocumentId?.trim() ?? "";
    const receiptDate = input.receiptDate?.trim() ?? "";
    if (!sourceDocumentId) return { data: null, error: "ไม่พบเอกสารต้นทาง" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(receiptDate)) {
      return { data: null, error: "วันที่ใบเสร็จไม่ถูกต้อง" };
    }

    const supabase = createSupabaseServerClient();
    const rpcClient = supabase as unknown as {
      rpc: (
        fn: "issue_receipt_for_tax_invoice",
        args: { p_source_doc_id: string; p_receipt_date: string },
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const issued = await rpcClient.rpc("issue_receipt_for_tax_invoice", {
      p_source_doc_id: sourceDocumentId,
      p_receipt_date: receiptDate,
    });
    if (issued.error) {
      if (/Could not find the function|PGRST202/i.test(issued.error.message)) {
        return {
          data: null,
          error: "ยังไม่พบฟังก์ชันออกใบเสร็จบนฐานข้อมูลที่แอปเชื่อมอยู่",
        };
      }
      return { data: null, error: issued.error.message };
    }

    const docNo = readIssuedReceiptNo(issued.data);
    if (!docNo) {
      return { data: null, error: "ออกใบเสร็จแล้ว แต่ไม่พบเลขที่เอกสาร" };
    }
    revalidatePath("/sales");
    revalidatePath(`/sales/${encodeURIComponent(docNo)}`);
    return { data: { doc_no: docNo }, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "ออกใบเสร็จรับเงินไม่สำเร็จ",
    };
  }
}
