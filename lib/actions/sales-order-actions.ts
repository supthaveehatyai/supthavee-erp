"use server";

/**
 * Phase 17 — Sales Order (SO) Server Actions.
 * Zero Client-Side Fetching — Service Role only.
 *
 * Next.js: a `"use server"` file may ONLY export async functions.
 * Types live in `@/types/sales-order`.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server-admin";
import {
  createDraftDocument,
  getDocumentById,
  getSalesDocuments,
  issueDocument,
  updateDraftDocument,
} from "@/lib/actions/document-actions";
import { createProductionJobFromSO } from "@/lib/actions/production-actions";
import type {
  GetSalesOrdersResult,
  SaveSalesOrderDraftInput,
  SaveSalesOrderDraftResult,
  SendSalesOrderToProductionInput,
  SendSalesOrderToProductionResult,
  UploadSalesOrderMockupResult,
} from "@/types/sales-order";
import type { DocumentStatus } from "@/types/document";

const PRODUCTION_ATTACHMENTS_BUCKET = "production_attachments";
const MAX_MOCKUP_BYTES = 10 * 1024 * 1024;
const ALLOWED_MOCKUP_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function sanitizeFileName(raw: string): string {
  const base = raw.replace(/\\/g, "/").split("/").pop() ?? "mockup.webp";
  const safe = base.replace(/[^\w.-]+/g, "_").slice(0, 80);
  return safe || "mockup.webp";
}

function isUploadFile(value: unknown): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as File).arrayBuffer === "function" &&
    typeof (value as File).size === "number" &&
    (value as File).size > 0
  );
}

function toDraftItems(payload: SaveSalesOrderDraftInput) {
  return (payload.items ?? []).map((item, index) => ({
    product_id: item.product_id,
    description: item.description,
    qty: item.qty,
    uom_used: item.uom_used,
    unit_price: item.unit_price,
    unit_cost_price: item.unit_cost_price,
    discount_text: item.discount_text,
    discount_amount: item.discount_amount,
    line_total: item.line_total,
    sort_order: item.sort_order ?? index,
  }));
}

async function persistSoMockupAndNotes(
  documentId: string,
  mockupImageUrl: string | null,
  notes: string | null,
): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase
    .from("documents")
    .update({
      attachment_url: mockupImageUrl,
      attached_file_url: mockupImageUrl,
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);

  if (error) {
    return error.message ?? "บันทึกรูป Mockup / หมายเหตุไม่สำเร็จ";
  }
  return null;
}

function revalidateSalesOrderPaths(documentNo?: string | null) {
  revalidatePath("/sales");
  revalidatePath("/sales/orders");
  revalidatePath("/production/kanban");
  if (documentNo) {
    revalidatePath(`/sales/${encodeURIComponent(documentNo)}`);
  }
}

/**
 * บันทึกร่างใบสั่งขาย (doc_type = SO) — Late Numbering DRAFT-…
 * เก็บ Mockup URL ที่ documents.attachment_url (คัดลอกไป production_jobs ตอนส่งผลิต)
 */
export async function saveSalesOrderDraft(
  payload: SaveSalesOrderDraftInput,
): Promise<SaveSalesOrderDraftResult> {
  try {
    const contactId = String(payload?.contact_id ?? "").trim();
    const items = toDraftItems(payload);
    const mockupImageUrl =
      String(payload?.mockup_image_url ?? "").trim() || null;
    const notes = String(payload?.notes ?? "").trim() || null;
    const documentId = String(payload?.document_id ?? "").trim() || null;

    if (!contactId) {
      return { success: false, error: "กรุณาเลือกลูกค้า", data: null };
    }
    if (items.length === 0) {
      return {
        success: false,
        error: "กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ",
        data: null,
      };
    }

    const header = {
      contact_id: contactId,
      contact_person_id: payload.contact_person_id?.trim() || null,
      doc_date: payload.doc_date,
      items,
      discount_text: payload.discount_text,
      vat_type: payload.vat_type,
      vat_rate: payload.vat_rate,
      total_amount: payload.total_amount,
      discount_amount: payload.discount_amount,
      net_before_vat: payload.net_before_vat,
      vat_amount: payload.vat_amount,
      grand_total: payload.grand_total,
    };

    const saved = documentId
      ? await updateDraftDocument({
          document_id: documentId,
          ...header,
          notes,
        })
      : await createDraftDocument({ doc_type: "SO", ...header });

    if (saved.error || !saved.data) {
      return {
        success: false,
        error: saved.error ?? "บันทึกใบสั่งขายไม่สำเร็จ",
        data: null,
      };
    }

    const patchError = await persistSoMockupAndNotes(
      saved.data.document_id,
      mockupImageUrl,
      notes,
    );
    if (patchError) {
      return { success: false, error: patchError, data: null };
    }

    revalidateSalesOrderPaths(saved.data.document_no);

    return {
      success: true,
      error: null,
      data: {
        document_id: saved.data.document_id,
        document_no: saved.data.document_no,
        status: "DRAFT",
      },
    };
  } catch (err) {
    console.error("[saveSalesOrderDraft]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "บันทึกใบสั่งขายไม่สำเร็จ",
      data: null,
    };
  }
}

/**
 * อัปโหลดรูป Mockup (WebP) เข้า bucket production_attachments
 * บีบอัดฝั่ง Client ก่อนส่ง — Server ตรวจ MIME/ขนาดแล้วเก็บ Public URL
 */
export async function uploadSalesOrderMockup(
  formData: FormData,
): Promise<UploadSalesOrderMockupResult> {
  try {
    const fileEntry = formData.get("file") ?? formData.get("mockup");
    if (!isUploadFile(fileEntry)) {
      return { success: false, error: "ไม่พบไฟล์รูป Mockup", data: null };
    }

    const mimeType = (fileEntry.type || "").toLowerCase();
    if (mimeType && !ALLOWED_MOCKUP_MIME.has(mimeType)) {
      return {
        success: false,
        error: `ประเภทไฟล์ไม่รองรับ (${mimeType || "unknown"}) — ใช้ JPG/PNG/WEBP`,
        data: null,
      };
    }
    if (fileEntry.size > MAX_MOCKUP_BYTES) {
      return {
        success: false,
        error: "ไฟล์ใหญ่เกิน 10MB",
        data: null,
      };
    }

    const soKey =
      String(formData.get("document_id") ?? "").trim() ||
      `pending-${Date.now()}`;
    const safeName = sanitizeFileName(fileEntry.name || "mockup.webp");
    const objectPath = `so/${soKey}/${Date.now()}-${safeName}`;
    const buffer = Buffer.from(await fileEntry.arrayBuffer());

    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from(PRODUCTION_ATTACHMENTS_BUCKET)
      .upload(objectPath, buffer, {
        contentType: mimeType || "image/webp",
        upsert: false,
      });

    if (uploadError) {
      return {
        success: false,
        error: uploadError.message ?? "อัปโหลด Mockup ไม่สำเร็จ",
        data: null,
      };
    }

    const { data: publicData } = supabase.storage
      .from(PRODUCTION_ATTACHMENTS_BUCKET)
      .getPublicUrl(objectPath);
    const url = publicData?.publicUrl?.trim();
    if (!url) {
      return {
        success: false,
        error: "อัปโหลดสำเร็จแต่ไม่ได้ URL กลับมา",
        data: null,
      };
    }

    return { success: true, error: null, data: { url, path: objectPath } };
  } catch (err) {
    console.error("[uploadSalesOrderMockup]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "อัปโหลด Mockup ไม่สำเร็จ",
      data: null,
    };
  }
}

/**
 * บันทึก SO → ยืนยันออกเอกสาร (ISSUED / Late Numbering) →
 * สร้าง production_jobs + production_job_items + BOM Snapshot
 */
export async function sendSalesOrderToProduction(
  payload: SendSalesOrderToProductionInput,
): Promise<SendSalesOrderToProductionResult> {
  try {
    const existingId = String(payload?.document_id ?? "").trim();
    let documentId = existingId;
    let documentNo = "";
    let status: DocumentStatus = "DRAFT";

    if (existingId) {
      const existing = await getDocumentById(existingId);
      if (existing.data?.status === "ISSUED") {
        documentId = existing.data.id;
        documentNo = existing.data.doc_no;
        status = existing.data.status;
      }
    }

    if (status !== "ISSUED") {
      const saved = await saveSalesOrderDraft(payload);
      if (!saved.success || !saved.data) {
        return { success: false, error: saved.error, data: null };
      }
      documentId = saved.data.document_id;
      documentNo = saved.data.document_no;
      status = saved.data.status;

      if (status === "DRAFT") {
        const issued = await issueDocument(documentId);
        if (issued.error || !issued.data) {
          return {
            success: false,
            error: issued.error ?? "ยืนยันใบสั่งขายไม่สำเร็จ — ยังไม่ส่งงานผลิต",
            data: null,
          };
        }
        if (issued.data.pending_approval) {
          return {
            success: false,
            error:
              "เอกสารเข้าสู่สถานะรออนุมัติ — ส่งงานผลิตได้หลัง Checker อนุมัติแล้ว",
            data: {
              document_id: documentId,
              document_no: issued.data.document_no,
              status: issued.data.status,
              jobs: [],
            },
          };
        }
        documentNo = issued.data.document_no;
        status = issued.data.status;
      }
    }

    const detail = await getDocumentById(documentId);
    if (detail.error || !detail.data) {
      return {
        success: false,
        error: detail.error ?? "โหลดใบสั่งขายหลังยืนยันไม่สำเร็จ",
        data: null,
      };
    }

    const mockupUrl =
      String(payload.mockup_image_url ?? "").trim() ||
      detail.data.attachment_url?.trim() ||
      detail.data.attached_file_url?.trim() ||
      null;
    const remark = String(payload.notes ?? detail.data.notes ?? "").trim() || null;

    const groups = new Map<
      string,
      { items: { product_id: string; quantity: number }[] }
    >();

    for (const item of detail.data.items) {
      if (!item.is_manufactured) continue;
      const modelId = item.model_id?.trim() ?? "";
      const productId = item.product_id?.trim() ?? "";
      if (!modelId || !productId || item.qty <= 0) continue;
      const existing = groups.get(modelId);
      if (existing) {
        existing.items.push({ product_id: productId, quantity: item.qty });
      } else {
        groups.set(modelId, {
          items: [{ product_id: productId, quantity: item.qty }],
        });
      }
    }

    if (groups.size === 0) {
      return {
        success: false,
        error:
          "ไม่พบสินค้าที่ตั้งค่าผลิตเอง (is_manufactured) — ไม่สามารถส่งงานผลิตได้",
        data: {
          document_id: documentId,
          document_no: documentNo,
          status,
          jobs: [],
        },
      };
    }

    const jobs: {
      id: string;
      job_no: string;
      items_count: number;
      materials_count: number;
    }[] = [];
    const errors: string[] = [];

    for (const [finishedModelId, group] of groups) {
      const result = await createProductionJobFromSO({
        so_id: documentId,
        finished_model_id: finishedModelId,
        mockup_image_url: mockupUrl,
        remark,
        items: group.items,
      });

      if (!result.success || !result.data) {
        errors.push(result.error ?? "สร้างใบสั่งผลิตไม่สำเร็จ");
        continue;
      }

      jobs.push({
        id: result.data.id,
        job_no: result.data.job_no,
        items_count: result.data.items_count,
        materials_count: result.data.materials_count,
      });
    }

    revalidateSalesOrderPaths(documentNo);

    if (jobs.length === 0) {
      return {
        success: false,
        error: errors[0] ?? "ส่งงานผลิตไม่สำเร็จ",
        data: {
          document_id: documentId,
          document_no: documentNo,
          status,
          jobs: [],
        },
      };
    }

    return {
      success: true,
      error: errors.length > 0 ? errors[0] : null,
      data: {
        document_id: documentId,
        document_no: documentNo,
        status,
        jobs,
      },
    };
  } catch (err) {
    console.error("[sendSalesOrderToProduction]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ส่งงานผลิตไม่สำเร็จ",
      data: null,
    };
  }
}

/** รายการใบสั่งขาย (doc_type = SO) สำหรับหน้ารวม */
export async function getSalesOrders(
  filters?: { search?: string; from?: string; to?: string },
): Promise<GetSalesOrdersResult> {
  const result = await getSalesDocuments(filters, 100);
  if (result.error) {
    return { data: [], error: result.error };
  }
  return {
    data: result.data.filter((row) => row.doc_type === "SO"),
    error: null,
  };
}
