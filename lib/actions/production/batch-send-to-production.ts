"use server";

/**
 * Batch MTO Engine — group SO document_items by product_models.id
 * One production_jobs per Model + all sizes as production_job_items + BOM explode.
 *
 * Zero Client-Side Fetching — supabaseAdmin (Service Role) only.
 * Types: `@/types/production`
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server-admin";
import { createProductionJobFromSO } from "@/lib/actions/production-actions";
import type {
  BatchSendToProductionJobResult,
  BatchSendToProductionResult,
  UploadBatchModelMockupResult,
} from "@/types/production";

const KANBAN_PATH = "/production/kanban";
const PRODUCTION_ATTACHMENTS_BUCKET = "production_attachments";
const MAX_MOCKUP_BYTES = 10 * 1024 * 1024;
const ALLOWED_MOCKUP_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const POSTGRES_UNDEFINED_COLUMN = "42703";

function getSupabaseAdmin(): SupabaseClient {
  return createClient() as unknown as SupabaseClient;
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof File !== "undefined" &&
    value instanceof File &&
    value.size > 0 &&
    Boolean(value.name)
  );
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^\w.\-ก-๙]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

type PendingGroup = {
  finished_model_id: string;
  model_code: string;
  model_name: string;
  document_item_ids: string[];
  items: { product_id: string; quantity: number }[];
};

/**
 * อัปโหลด Mockup หนึ่งรูปต่อรุ่น (ครอบคลุมทุกไซส์ในกลุ่ม)
 * Path: batch/{documentId}/{modelId}/{timestamp}-{name}
 */
export async function uploadBatchModelMockup(
  documentId: string,
  finishedModelId: string,
  formData: FormData,
): Promise<UploadBatchModelMockupResult> {
  try {
    const docId = String(documentId ?? "").trim();
    const modelId = String(finishedModelId ?? "").trim();
    const fileEntry = formData.get("file") ?? formData.get("mockup");

    if (!docId) {
      return { success: false, error: "ไม่พบรหัสเอกสารขาย", data: null };
    }
    if (!modelId) {
      return { success: false, error: "ไม่พบรหัสรุ่นสินค้า", data: null };
    }
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
      return { success: false, error: "ไฟล์ใหญ่เกิน 10MB", data: null };
    }

    const supabase = getSupabaseAdmin();
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, doc_type, status")
      .eq("id", docId)
      .maybeSingle();

    if (docError) {
      return {
        success: false,
        error: docError.message ?? "ตรวจสอบเอกสารไม่สำเร็จ",
        data: null,
      };
    }
    if (!doc) {
      return { success: false, error: "ไม่พบเอกสารขายในระบบ", data: null };
    }
    if (String(doc.doc_type ?? "").toUpperCase() !== "SO") {
      return {
        success: false,
        error: "อัปโหลด Mockup Batch ได้เฉพาะใบสั่งขาย (SO)",
        data: null,
      };
    }

    const safeName = sanitizeFileName(fileEntry.name || "mockup.webp");
    const objectPath = `batch/${docId}/${modelId}/${Date.now()}-${safeName}`;
    const buffer = Buffer.from(await fileEntry.arrayBuffer());

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
    console.error("[uploadBatchModelMockup]", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "อัปโหลด Mockup ไม่สำเร็จ",
      data: null,
    };
  }
}

async function loadPendingManufacturedGroups(
  supabase: SupabaseClient,
  documentId: string,
): Promise<{ groups: PendingGroup[]; error: string | null; docNo: string | null }> {
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, doc_no, doc_type, status, notes")
    .eq("id", documentId)
    .maybeSingle();

  if (docError) {
    return {
      groups: [],
      error: docError.message ?? "ตรวจสอบเอกสารขายไม่สำเร็จ",
      docNo: null,
    };
  }
  if (!doc) {
    return { groups: [], error: "ไม่พบเอกสารขายในระบบ", docNo: null };
  }
  if (String(doc.doc_type ?? "").toUpperCase() !== "SO") {
    return {
      groups: [],
      error: "Batch MTO ใช้ได้เฉพาะใบสั่งขาย (SO)",
      docNo: String(doc.doc_no ?? "") || null,
    };
  }
  if (String(doc.status ?? "").toUpperCase() !== "ISSUED") {
    return {
      groups: [],
      error: `ส่งงานผลิตได้เมื่อใบสั่งขายเป็นสถานะ ISSUED (ปัจจุบัน: ${doc.status ?? "—"})`,
      docNo: String(doc.doc_no ?? "") || null,
    };
  }

  const { data: rows, error: itemsError } = await supabase
    .from("document_items")
    .select(
      `
      id,
      product_id,
      qty,
      is_sent_to_production,
      production_status,
      products!document_items_product_id_fkey (
        id,
        model_id,
        product_models!products_model_id_fkey (
          id,
          model_code,
          name,
          short_name,
          is_manufactured,
          is_service,
          is_raw_material
        )
      )
    `,
    )
    .eq("document_id", documentId)
    .order("sort_order", { ascending: true });

  if (itemsError) {
    return {
      groups: [],
      error: itemsError.message ?? "ดึงรายการสินค้าไม่สำเร็จ",
      docNo: String(doc.doc_no ?? "") || null,
    };
  }

  function unwrapOne<T extends object>(
    value: T | T[] | null | undefined,
  ): T | null {
    if (!value) return null;
    return Array.isArray(value) ? (value[0] ?? null) : value;
  }

  const byModel = new Map<string, PendingGroup>();

  for (const row of rows ?? []) {
    const product = unwrapOne(
      row.products as
        | {
            id?: string;
            model_id?: string | null;
            product_models?:
              | {
                  id?: string;
                  model_code?: string | null;
                  name?: string | null;
                  short_name?: string | null;
                  is_manufactured?: boolean | null;
                  is_service?: boolean | null;
                  is_raw_material?: boolean | null;
                }
              | {
                  id?: string;
                  model_code?: string | null;
                  name?: string | null;
                  short_name?: string | null;
                  is_manufactured?: boolean | null;
                  is_service?: boolean | null;
                  is_raw_material?: boolean | null;
                }[]
              | null;
          }
        | null,
    );
    const model = unwrapOne(product?.product_models ?? null);
    if (model?.is_manufactured !== true) continue;
    if (model.is_service === true || model.is_raw_material === true) continue;

    const alreadySent =
      row.is_sent_to_production === true ||
      String(row.production_status ?? "")
        .trim()
        .toUpperCase() === "IN_PRODUCTION" ||
      String(row.production_status ?? "")
        .trim()
        .toUpperCase() === "COMPLETED";
    if (alreadySent) continue;

    const modelId = String(model.id ?? product?.model_id ?? "").trim();
    const productId = String(row.product_id ?? product?.id ?? "").trim();
    const qty = Number(row.qty ?? 0);
    if (!modelId || !productId || !Number.isFinite(qty) || qty <= 0) continue;

    const existing = byModel.get(modelId);
    if (existing) {
      existing.document_item_ids.push(String(row.id));
      existing.items.push({ product_id: productId, quantity: qty });
      continue;
    }

    byModel.set(modelId, {
      finished_model_id: modelId,
      model_code: String(model.model_code ?? "").trim() || "—",
      model_name:
        String(model.name ?? "").trim() ||
        String(model.short_name ?? "").trim() ||
        String(model.model_code ?? "").trim() ||
        "สินค้าผลิตเอง",
      document_item_ids: [String(row.id)],
      items: [{ product_id: productId, quantity: qty }],
    });
  }

  return {
    groups: [...byModel.values()],
    error: null,
    docNo: String(doc.doc_no ?? "") || null,
  };
}

async function markDocumentItemsSent(
  supabase: SupabaseClient,
  documentId: string,
  documentItemIds: string[],
  mockupUrl: string | null,
): Promise<void> {
  if (documentItemIds.length === 0) return;

  const payload: Record<string, unknown> = {
    production_status: "IN_PRODUCTION",
    is_sent_to_production: true,
  };
  if (mockupUrl) {
    payload.mockup_image_url = mockupUrl;
  }

  const full = await supabase
    .from("document_items")
    .update(payload)
    .eq("document_id", documentId)
    .in("id", documentItemIds);

  if (!full.error) return;

  if (full.error.code === POSTGRES_UNDEFINED_COLUMN) {
    const statusOnly = await supabase
      .from("document_items")
      .update({ production_status: "IN_PRODUCTION" })
      .eq("document_id", documentId)
      .in("id", documentItemIds);
    if (statusOnly.error) {
      console.warn(
        "[batchSendToProduction] mark document_items skipped:",
        statusOnly.error.message,
      );
    }
    return;
  }

  console.warn(
    "[batchSendToProduction] mark document_items skipped:",
    full.error.message,
  );
}

/**
 * Batch Send to Production — 1 Job ต่อรุ่น + ทุกไซส์ในกลุ่ม + BOM จากยอดรวม
 *
 * @param documentId — documents.id (SO ISSUED)
 * @param modelMockups — map finished_model_id → mockup public URL
 * @param estimatedCompletionDate — YYYY-MM-DD → production_jobs.estimated_completion_date
 * @param remark — รายละเอียดคำสั่งทำ → production_jobs.remark
 */
export async function batchSendToProduction(
  documentId: string,
  modelMockups: Record<string, string> = {},
  estimatedCompletionDate?: string | null,
  remark?: string | null,
): Promise<BatchSendToProductionResult> {
  const docId = String(documentId ?? "").trim();
  const emptyJobs: BatchSendToProductionJobResult[] = [];

  if (!docId) {
    return {
      success: false,
      error: "ไม่พบรหัสเอกสารขาย (documentId)",
      data: null,
    };
  }

  const estimatedRaw = String(estimatedCompletionDate ?? "")
    .trim()
    .slice(0, 10);
  if (!estimatedRaw || !/^\d{4}-\d{2}-\d{2}$/.test(estimatedRaw)) {
    return {
      success: false,
      error: "กรุณาระบุวันที่กำหนดเสร็จ (estimated_completion_date) เป็น YYYY-MM-DD",
      data: null,
    };
  }

  const jobRemark = String(remark ?? "").trim() || null;

  try {
    const supabase = getSupabaseAdmin();
    const loaded = await loadPendingManufacturedGroups(supabase, docId);
    if (loaded.error) {
      return {
        success: false,
        error: loaded.error,
        data: { document_id: docId, jobs: emptyJobs, skipped: [] },
      };
    }

    if (loaded.groups.length === 0) {
      return {
        success: false,
        error:
          "ไม่พบรายการผลิตเองที่รอส่ง (is_manufactured และยังไม่ส่งผลิต) — หรือส่งครบทุกรุ่นแล้ว",
        data: { document_id: docId, jobs: emptyJobs, skipped: [] },
      };
    }

    const mockupMap = modelMockups ?? {};
    const jobs: BatchSendToProductionJobResult[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const group of loaded.groups) {
      const mockupUrl =
        String(mockupMap[group.finished_model_id] ?? "").trim() || null;

      const result = await createProductionJobFromSO({
        so_id: docId,
        finished_model_id: group.finished_model_id,
        mockup_image_url: mockupUrl,
        remark: jobRemark,
        estimated_completion_date: estimatedRaw,
        items: group.items,
      });

      if (!result.success || !result.data) {
        const msg =
          result.error ??
          `สร้างใบสั่งผลิตสำหรับรุ่น ${group.model_code} ไม่สำเร็จ`;
        errors.push(`${group.model_code}: ${msg}`);
        skipped.push(group.finished_model_id);
        continue;
      }

      await markDocumentItemsSent(
        supabase,
        docId,
        group.document_item_ids,
        mockupUrl,
      );

      jobs.push({
        finished_model_id: group.finished_model_id,
        model_code: group.model_code,
        job_id: result.data.id,
        job_no: result.data.job_no,
        items_count: result.data.items_count,
        materials_count: result.data.materials_count,
      });
    }

    revalidatePath(KANBAN_PATH);
    revalidatePath("/sales");
    if (loaded.docNo) {
      revalidatePath(`/sales/${encodeURIComponent(loaded.docNo)}`);
    }

    if (jobs.length === 0) {
      return {
        success: false,
        error: errors[0] ?? "ส่งงานผลิตไม่สำเร็จ",
        data: { document_id: docId, jobs, skipped },
      };
    }

    return {
      success: true,
      error: errors.length > 0 ? errors[0] : null,
      data: { document_id: docId, jobs, skipped },
    };
  } catch (err) {
    console.error("[batchSendToProduction]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Batch ส่งงานผลิตไม่สำเร็จ",
      data: null,
    };
  }
}
