'use server';

/**
 * Phase 17 — Smart Routing Engine: Sales Order Driven Production
 * Zero Client-Side Fetching — Service Role (`supabaseAdmin`) only.
 *
 * Next.js rule: a `"use server"` file may ONLY export async functions.
 * Do NOT export const / types / sync helpers from this module.
 *
 * Route by product_models flags on a single document_items row:
 *   Flow 1 — is_service      → Kanban service job (technician assignment later)
 *   Flow 2 — is_manufactured → MTO job + BOM Snapshot (WIP)
 *
 * Schema mapping (docs/database-schema.md):
 *   - document_items.mockup_image_url — per-line Mockup (bucket production_attachments)
 *   - document_items.is_sent_to_production + production_status
 *   - Fallback: header documents.attachment_url when line mockup empty
 *   - quantity → document_items.qty
 *
 * Types live in `@/types/production` — this file exports async functions only.
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server-admin";
import type {
  SendToProductionFlow,
  SendToProductionResult,
  UploadDocumentItemMockupResult,
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
const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_UNDEFINED_COLUMN = "42703";
const JOB_NO_MAX_RETRIES = 5;

/** Untyped admin — cloud may have production_status before generated types catch up */
function getSupabaseAdmin(): SupabaseClient {
  return createClient() as unknown as SupabaseClient;
}

function roundQty4(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function toPositiveQty(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return roundQty4(n);
}

function toWastePercent(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toCostPrice(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/** planned_qty = (quantity_required × item_qty) × (1 + waste%/100) */
function calculatePlannedQty(
  quantityRequired: number,
  itemQuantity: number,
  wastePercent: number,
): number {
  return roundQty4(
    quantityRequired * itemQuantity * (1 + wastePercent / 100),
  );
}

function bangkokYyMm(): { yy: string; mm: string } {
  const ymd = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Bangkok",
  });
  return { yy: ymd.slice(2, 4), mm: ymd.slice(5, 7) };
}

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function isAlreadySent(productionStatus: string | null | undefined): boolean {
  const status = String(productionStatus ?? "NONE").trim().toUpperCase();
  return status !== "" && status !== "NONE";
}

async function nextMtoJobNo(supabase: SupabaseClient): Promise<string> {
  const { yy, mm } = bangkokYyMm();
  const prefix = `MTO-${yy}${mm}-`;

  const { data, error } = await supabase
    .from("production_jobs")
    .select("job_no")
    .like("job_no", `${prefix}%`)
    .order("job_no", { ascending: false })
    .limit(1);

  if (error) {
    const suffix = crypto
      .randomUUID()
      .replace(/-/g, "")
      .slice(0, 4)
      .toUpperCase();
    return `${prefix}${suffix}`;
  }

  let seq = 1;
  const latest = data?.[0]?.job_no ?? "";
  const match = String(latest).match(/MTO-\d{4}-(\d+)$/i);
  if (match?.[1]) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > 0) seq = n + 1;
  }

  return `${prefix}${String(seq).padStart(4, "0")}`;
}

async function rollbackJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<void> {
  await supabase
    .from("production_job_materials")
    .delete()
    .eq("job_id", jobId);
  await supabase.from("production_job_items").delete().eq("job_id", jobId);
  await supabase.from("production_jobs").delete().eq("id", jobId);
}

/**
 * Mark line as sent — sets production_status + is_sent_to_production (Phase 17).
 * Falls back if either column is missing on cloud.
 */
async function markItemSentToProduction(
  supabase: SupabaseClient,
  documentItemId: string,
): Promise<string | null> {
  const fullUpdate = await supabase
    .from("document_items")
    .update({
      production_status: "IN_PRODUCTION",
      is_sent_to_production: true,
    })
    .eq("id", documentItemId);

  if (!fullUpdate.error) return null;

  if (fullUpdate.error.code === POSTGRES_UNDEFINED_COLUMN) {
    const statusOnly = await supabase
      .from("document_items")
      .update({ production_status: "IN_PRODUCTION" })
      .eq("id", documentItemId);
    if (!statusOnly.error) {
      console.warn(
        "[sendToProduction] is_sent_to_production missing — used production_status only",
      );
      return null;
    }
    if (statusOnly.error.code === POSTGRES_UNDEFINED_COLUMN) {
      console.warn(
        "[sendToProduction] production_status column missing — skip mark",
      );
      return null;
    }
    return statusOnly.error.message ?? "อัปเดตสถานะส่งผลิตของรายการไม่สำเร็จ";
  }

  return fullUpdate.error.message ?? "อัปเดตสถานะส่งผลิตของรายการไม่สำเร็จ";
}

type FetchedLine = {
  id: string;
  document_id: string;
  product_id: string | null;
  qty: number;
  description: string | null;
  production_status: string | null;
  technician_id: string | null;
  wage_cost: number;
  doc_no: string | null;
  doc_type: string | null;
  doc_status: string | null;
  doc_notes: string | null;
  mockup_image_url: string | null;
  model_id: string | null;
  model_code: string | null;
  model_name: string | null;
  sku: string | null;
  is_service: boolean;
  is_manufactured: boolean;
  is_raw_material: boolean;
};

async function fetchDocumentItemForRouting(
  supabase: SupabaseClient,
  documentItemId: string,
): Promise<{ data: FetchedLine | null; error: string | null }> {
  // Explicit FK hints — products may also join via other paths in PostgREST
  const { data, error } = await supabase
    .from("document_items")
    .select(
      `
      id,
      document_id,
      product_id,
      qty,
      description,
      production_status,
      is_sent_to_production,
      is_service_item,
      mockup_image_url,
      technician_id,
      wage_cost,
      documents!document_items_document_id_fkey (
        id,
        doc_no,
        doc_type,
        status,
        attachment_url,
        attached_file_url,
        notes
      ),
      products!document_items_product_id_fkey (
        id,
        sku,
        model_id,
        cost_price,
        product_models!products_model_id_fkey (
          id,
          model_code,
          name,
          is_service,
          is_manufactured,
          is_raw_material
        )
      )
    `,
    )
    .eq("id", documentItemId)
    .maybeSingle();

  if (error) {
    // Retry without Phase 17 columns if absent on cloud
    if (error.code === POSTGRES_UNDEFINED_COLUMN) {
      const fallback = await supabase
        .from("document_items")
        .select(
          `
          id,
          document_id,
          product_id,
          qty,
          description,
          is_service_item,
          technician_id,
          wage_cost,
          documents!document_items_document_id_fkey (
            id,
            doc_no,
            doc_type,
            status,
            attachment_url,
            attached_file_url,
            notes
          ),
          products!document_items_product_id_fkey (
            id,
            sku,
            model_id,
            cost_price,
            product_models!products_model_id_fkey (
              id,
              model_code,
              name,
              is_service,
              is_manufactured,
              is_raw_material
            )
          )
        `,
        )
        .eq("id", documentItemId)
        .maybeSingle();

      if (fallback.error) {
        return {
          data: null,
          error: fallback.error.message ?? "โหลดรายการเอกสารไม่สำเร็จ",
        };
      }
      if (!fallback.data) {
        return { data: null, error: "ไม่พบรายการสินค้าในเอกสาร" };
      }

      return mapFetchedRow({
        ...fallback.data,
        production_status: "NONE",
        is_sent_to_production: false,
        mockup_image_url: null,
      });
    }

    return { data: null, error: error.message ?? "โหลดรายการเอกสารไม่สำเร็จ" };
  }

  if (!data) {
    return { data: null, error: "ไม่พบรายการสินค้าในเอกสาร" };
  }

  return mapFetchedRow(data);
}

type RoutedDocumentJoin = {
  id: string;
  doc_no: string | null;
  doc_type: string | null;
  status: string | null;
  attachment_url: string | null;
  attached_file_url: string | null;
  notes: string | null;
};

type RoutedProductModelJoin = {
  id: string;
  model_code: string | null;
  name: string | null;
  is_service: boolean | null;
  is_manufactured: boolean | null;
  is_raw_material: boolean | null;
};

type RoutedProductJoin = {
  id: string;
  sku: string | null;
  model_id: string | null;
  cost_price: number | null;
  product_models: RoutedProductModelJoin | RoutedProductModelJoin[] | null;
};

/** Columns selected from `document_items` for Smart Routing. */
type RoutedDocumentItemRow = {
  id: string;
  document_id: string;
  product_id: string | null;
  qty: number | null;
  description: string | null;
  production_status: string | null;
  is_sent_to_production: boolean | null;
  is_service_item?: boolean | null;
  mockup_image_url: string | null;
  technician_id: string | null;
  wage_cost: number | null;
  documents: RoutedDocumentJoin | RoutedDocumentJoin[] | null;
  products: RoutedProductJoin | RoutedProductJoin[] | null;
};

function mapFetchedRow(
  row: RoutedDocumentItemRow,
): { data: FetchedLine | null; error: string | null } {
  const doc = unwrapOne(row.documents);
  const product = unwrapOne(row.products);
  const model = unwrapOne(product?.product_models);

  const productId = String(row.product_id ?? product?.id ?? "").trim();
  const modelId = String(model?.id ?? product?.model_id ?? "").trim();
  const qty = toPositiveQty(row.qty);
  const isService =
    model?.is_service === true || row.is_service_item === true;

  if (!isService && !productId) {
    return { data: null, error: "รายการนี้ไม่มี product_id" };
  }
  if (!isService && !modelId) {
    return { data: null, error: "สินค้านี้ยังไม่ผูกกับรุ่น (product_models)" };
  }
  if (qty == null) {
    return { data: null, error: "จำนวนสินค้าต้องมากกว่า 0" };
  }

  const itemMockup = String(row.mockup_image_url ?? "").trim();
  const headerMockup = String(doc?.attachment_url ?? "").trim();
  const mockup = itemMockup || headerMockup || null;

  const productionStatus =
    row.production_status != null
      ? String(row.production_status)
      : "NONE";
  const alreadySentFlag = row.is_sent_to_production === true;

  return {
    data: {
      id: String(row.id),
      document_id: String(row.document_id),
      product_id: productId || null,
      qty,
      description: row.description != null ? String(row.description) : null,
      production_status: alreadySentFlag
        ? productionStatus === "NONE"
          ? "IN_PRODUCTION"
          : productionStatus
        : productionStatus,
      technician_id: row.technician_id
        ? String(row.technician_id)
        : null,
      wage_cost: toCostPrice(row.wage_cost),
      doc_no: doc?.doc_no != null ? String(doc.doc_no) : null,
      doc_type: doc?.doc_type != null ? String(doc.doc_type) : null,
      doc_status: doc?.status != null ? String(doc.status) : null,
      doc_notes: doc?.notes != null ? String(doc.notes) : null,
      mockup_image_url: mockup,
      model_id: modelId || null,
      model_code: model?.model_code != null ? String(model.model_code) : null,
      model_name: model?.name != null ? String(model.name) : null,
      sku: product?.sku != null ? String(product.sku) : null,
      is_service: isService,
      is_manufactured: model?.is_manufactured === true,
      is_raw_material: model?.is_raw_material === true,
    },
    error: null,
  };
}

async function assertNotDuplicateJob(
  supabase: SupabaseClient,
  documentId: string,
  productId: string | null,
  finishedModelId: string | null,
  documentItemId?: string | null,
): Promise<string | null> {
  // งานบริการ: กันซ้ำเฉพาะบรรทัดนี้ เพื่อให้บิลเดียวกันส่งได้หลายการ์ด
  if (documentItemId) {
    const { data: lineJobs, error: lineError } = await supabase
      .from("production_jobs")
      .select("id, job_no, status")
      .eq("ref_document_item_id", documentItemId)
      .neq("status", "CANCELLED")
      .limit(1);

    if (lineError) {
      console.warn(
        "[sendToProduction] duplicate check service line:",
        lineError.message,
      );
      return lineError.message ?? "ตรวจสอบงานซ้ำของบรรทัดบริการไม่สำเร็จ";
    }

    const existing = lineJobs?.[0];
    if (!existing) return null;
    const jobNo = String(existing.job_no ?? "").trim();
    return jobNo
      ? `บรรทัดนี้ถูกส่งเข้า Kanban แล้ว (${jobNo})`
      : "บรรทัดนี้ถูกส่งเข้า Kanban แล้ว";
  }

  // Active jobs for this SO
  const { data: jobs, error: jobsError } = await supabase
    .from("production_jobs")
    .select("id, job_no, status, finished_model_id, ref_document_item_id")
    .eq("ref_document_id", documentId)
    .neq("status", "CANCELLED");

  if (jobsError) {
    console.warn("[sendToProduction] duplicate check jobs:", jobsError.message);
    return null;
  }

  const activeJobs = (jobs ?? []).filter(
    (job) => !String(job.ref_document_item_id ?? "").trim(),
  );
  if (activeJobs.length === 0) return null;

  if (finishedModelId) {
    const sameModel = activeJobs.find(
      (job) => String(job.finished_model_id ?? "") === finishedModelId,
    );
    if (sameModel) {
      const jobNo = String(sameModel.job_no ?? "").trim();
      return jobNo
        ? `รุ่นนี้ถูกส่งเข้าผลิตแล้ว (${jobNo})`
        : "รุ่นนี้ถูกส่งเข้าผลิตแล้ว";
    }
  }

  const jobIds = activeJobs.map((job) => String(job.id));
  const { data: items, error: itemsError } = await supabase
    .from("production_job_items")
    .select("id, job_id, product_id")
    .in("job_id", jobIds)
    .eq("product_id", productId ?? "")
    .limit(1);

  if (itemsError) {
    console.warn(
      "[sendToProduction] duplicate check items:",
      itemsError.message,
    );
    return null;
  }

  if ((items?.length ?? 0) > 0) {
    const jobId = String(items?.[0]?.job_id ?? "");
    const matched = activeJobs.find((job) => String(job.id) === jobId);
    const jobNo = String(matched?.job_no ?? "").trim();
    return jobNo
      ? `รายการนี้ถูกส่งเข้าผลิตแล้ว (${jobNo})`
      : "รายการนี้ถูกส่งเข้าผลิตแล้ว";
  }

  return null;
}

async function loadSiblingGarmentItems(
  supabase: SupabaseClient,
  documentId: string,
  serviceItemId: string,
): Promise<{ product_id: string; quantity: number }[]> {
  const { data, error } = await supabase
    .from("document_items")
    .select(
      `
      id,
      product_id,
      qty,
      is_service_item,
      products!document_items_product_id_fkey (
        id,
        product_models!products_model_id_fkey ( is_service )
      )
    `,
    )
    .eq("document_id", documentId);

  if (error || !data) {
    if (error) {
      console.warn("[sendToProduction] garment lines:", error.message);
    }
    return [];
  }

  const garments: { product_id: string; quantity: number }[] = [];
  for (const row of data) {
    if (String(row.id) === serviceItemId) continue;
    const productId = String(row.product_id ?? "").trim();
    const qty = Math.round(Number(row.qty ?? 0));
    if (!productId || qty <= 0) continue;
    if (row.is_service_item === true) continue;
    const product = unwrapOne(
      row.products as
        | { product_models?: { is_service?: boolean | null } | { is_service?: boolean | null }[] | null }
        | { product_models?: { is_service?: boolean | null } | { is_service?: boolean | null }[] | null }[]
        | null,
    );
    const model = unwrapOne(product?.product_models ?? null);
    if (model?.is_service === true) continue;
    garments.push({ product_id: productId, quantity: qty });
  }
  return garments;
}

/**
 * Flow 1 — Service (สกรีน/ปัก): สร้างใบงาน Kanban สำหรับมอบหมายช่าง
 * ไม่ Snapshot BOM / ไม่ตัดสต็อกวัตถุดิบ
 */
async function routeServiceFlow(
  supabase: SupabaseClient,
  line: FetchedLine,
): Promise<SendToProductionResult> {
  const duplicate = await assertNotDuplicateJob(
    supabase,
    line.document_id,
    line.product_id,
    null,
    line.id,
  );
  if (duplicate) {
    return { success: false, error: duplicate };
  }

  let lastError = "สร้างใบงานบริการไม่สำเร็จ";

  for (let attempt = 0; attempt < JOB_NO_MAX_RETRIES; attempt += 1) {
    const jobNo = await nextMtoJobNo(supabase);
    const serviceName =
      line.description?.trim() ||
      [line.sku, line.model_code, line.model_name].filter(Boolean).join(" ") ||
      "งานบริการ";
    const remarkHead = `[${line.doc_no?.trim() || "บิล"}] ${serviceName} × ${line.qty}`;
    const billNote = line.doc_notes?.trim() || "";
    const remark = billNote ? `${remarkHead} — ${billNote}` : remarkHead;

    const jobInsert: Record<string, unknown> = {
      job_no: jobNo,
      status: "PLANNED",
      ref_document_id: line.document_id,
      ref_document_item_id: line.id,
      finished_model_id: line.model_id,
      target_quantity: line.qty,
      mockup_image_url: line.mockup_image_url,
      remark,
    };

    const { data: created, error: insertError } = await supabase
      .from("production_jobs")
      .insert(jobInsert)
      .select("id, job_no")
      .maybeSingle();

    if (insertError) {
      lastError = insertError.message ?? lastError;
      if (insertError.code === POSTGRES_UNIQUE_VIOLATION) continue;
      return { success: false, error: lastError };
    }
    if (!created?.id) {
      return { success: false, error: "สร้างใบงานแล้วแต่ไม่ได้รหัสงานกลับมา" };
    }

    const jobId = String(created.id);
    const garmentItems = await loadSiblingGarmentItems(
      supabase,
      line.document_id,
      line.id,
    );

    if (garmentItems.length > 0) {
      const { error: itemsError } = await supabase
        .from("production_job_items")
        .insert(
          garmentItems.map((item) => ({
            job_id: jobId,
            product_id: item.product_id,
            quantity: item.quantity,
          })),
        );

      if (itemsError) {
        await rollbackJob(supabase, jobId);
        return {
          success: false,
          error: `${itemsError.message ?? "บันทึก production_job_items ไม่สำเร็จ"} (Rollback แล้ว)`,
        };
      }
    }

    // Best-effort service_tracking breadcrumb (legacy table; FK may point at doc_headers)
    {
      const { error: trackError } = await supabase
        .from("service_tracking")
        .insert({
          doc_header_id: line.document_id,
          step_status: "PLANNED",
          notes: `document_item_id=${line.id}; product_id=${line.product_id}; job_no=${created.job_no}`,
        });
      if (trackError) {
        console.warn(
          "[sendToProduction] service_tracking skipped:",
          trackError.message,
        );
      }
    }

    const markError = await markItemSentToProduction(supabase, line.id);
    if (markError) {
      await rollbackJob(supabase, jobId);
      return { success: false, error: `${markError} (Rollback แล้ว)` };
    }

    revalidatePaths(line.doc_no);

    return {
      success: true,
      data: {
        flow: "SERVICE",
        document_item_id: line.id,
        document_id: line.document_id,
        job_id: jobId,
        job_no: String(created.job_no ?? jobNo),
        materials_count: 0,
      },
    };
  }

  return { success: false, error: lastError };
}

/**
 * Flow 2 — In-house Manufactured (Sublimations / ตัดเย็บ):
 * production_jobs + production_job_items + BOM → production_job_materials
 */
async function routeManufacturedFlow(
  supabase: SupabaseClient,
  line: FetchedLine,
): Promise<SendToProductionResult> {
  if (line.is_raw_material) {
    return {
      success: false,
      error: "ไม่สามารถเปิดใบสั่งผลิตจากวัตถุดิบได้",
    };
  }
  if (!line.product_id || !line.model_id) {
    return {
      success: false,
      error: "สินค้าผลิตเองต้องมีรหัสสินค้าและรุ่นก่อนส่งเข้า Kanban",
    };
  }

  const duplicate = await assertNotDuplicateJob(
    supabase,
    line.document_id,
    line.product_id,
    line.model_id,
  );
  if (duplicate) {
    return { success: false, error: duplicate };
  }

  // EXPLODE BOM
  const { data: bomRows, error: bomError } = await supabase
    .from("product_boms")
    .select(
      "id, finished_model_id, raw_material_model_id, uom_id, quantity_required, waste_percent",
    )
    .eq("finished_model_id", line.model_id);

  if (bomError) {
    return {
      success: false,
      error: bomError.message ?? "ดึงสูตรการผลิต (BOM) ไม่สำเร็จ",
    };
  }

  const bomList = bomRows ?? [];
  if (bomList.length === 0) {
    return {
      success: false,
      error:
        "ยังไม่มีสูตรการผลิต (BOM) สำหรับรุ่นนี้ — กรุณาตั้งค่า BOM ก่อนส่งงานผลิต",
    };
  }

  const rawMaterialIds = [
    ...new Set(
      bomList
        .map((row) => String(row.raw_material_model_id ?? "").trim())
        .filter(Boolean),
    ),
  ];

  // LPP snapshot — latest active SKU cost per raw_material_model_id
  const costByModelId = new Map<string, number>();
  if (rawMaterialIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("model_id, cost_price, created_at")
      .in("model_id", rawMaterialIds)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (productsError) {
      return {
        success: false,
        error: productsError.message ?? "ดึงต้นทุนวัตถุดิบ (LPP) ไม่สำเร็จ",
      };
    }

    for (const product of products ?? []) {
      const modelKey = String(product.model_id ?? "").trim();
      if (!modelKey || costByModelId.has(modelKey)) continue;
      costByModelId.set(modelKey, toCostPrice(product.cost_price));
    }
  }

  const materialRows = bomList.map((bom) => {
    const rawMaterialId = String(bom.raw_material_model_id).trim();
    const quantityRequired = toPositiveQty(bom.quantity_required) ?? 0;
    const wastePercent = toWastePercent(bom.waste_percent);
    return {
      raw_material_model_id: rawMaterialId,
      uom_id: String(bom.uom_id),
      planned_qty: calculatePlannedQty(
        quantityRequired,
        line.qty,
        wastePercent,
      ),
      cost_price_snapshot: costByModelId.get(rawMaterialId) ?? 0,
    };
  });

  let lastError = "สร้างใบสั่งผลิตไม่สำเร็จ";

  for (let attempt = 0; attempt < JOB_NO_MAX_RETRIES; attempt += 1) {
    const jobNo = await nextMtoJobNo(supabase);
    const remark =
      line.description?.trim() ||
      [line.model_code, line.model_name].filter(Boolean).join(" · ") ||
      null;

    const jobInsert: Record<string, unknown> = {
      job_no: jobNo,
      status: "PLANNED",
      ref_document_id: line.document_id,
      finished_model_id: line.model_id,
      target_quantity: line.qty,
      mockup_image_url: line.mockup_image_url,
      remark,
    };

    const { data: created, error: insertError } = await supabase
      .from("production_jobs")
      .insert(jobInsert)
      .select("id, job_no")
      .maybeSingle();

    if (insertError) {
      lastError = insertError.message ?? lastError;
      if (insertError.code === POSTGRES_UNIQUE_VIOLATION) continue;
      return { success: false, error: lastError };
    }
    if (!created?.id) {
      return { success: false, error: "สร้างใบสั่งผลิตแล้วแต่ไม่ได้รหัสงานกลับมา" };
    }

    const jobId = String(created.id);

    const { error: itemsError } = await supabase
      .from("production_job_items")
      .insert({
        job_id: jobId,
        product_id: line.product_id,
        quantity: line.qty,
      });

    if (itemsError) {
      await rollbackJob(supabase, jobId);
      return {
        success: false,
        error: `${itemsError.message ?? "บันทึก production_job_items ไม่สำเร็จ"} (Rollback แล้ว)`,
      };
    }

    const { error: materialsError } = await supabase
      .from("production_job_materials")
      .insert(
        materialRows.map((row) => ({
          ...row,
          job_id: jobId,
        })),
      );

    if (materialsError) {
      await rollbackJob(supabase, jobId);
      return {
        success: false,
        error: `${materialsError.message ?? "บันทึก production_job_materials ไม่สำเร็จ"} (Rollback แล้ว)`,
      };
    }

    const markError = await markItemSentToProduction(supabase, line.id);
    if (markError) {
      await rollbackJob(supabase, jobId);
      return { success: false, error: `${markError} (Rollback แล้ว)` };
    }

    revalidatePaths(line.doc_no);

    return {
      success: true,
      data: {
        flow: "MANUFACTURED" satisfies SendToProductionFlow,
        document_item_id: line.id,
        document_id: line.document_id,
        job_id: jobId,
        job_no: String(created.job_no ?? jobNo),
        materials_count: materialRows.length,
      },
    };
  }

  return { success: false, error: lastError };
}

function revalidatePaths(docNo: string | null) {
  revalidatePath(KANBAN_PATH);
  revalidatePath("/sales");
  revalidatePath("/sales/orders");
  if (docNo) {
    revalidatePath(`/sales/${encodeURIComponent(docNo)}`);
  }
}

/**
 * Smart Routing — ส่งรายการ document_items หนึ่งบรรทัดเข้าผลิต
 *
 * @param documentItemId — document_items.id
 */
export async function sendToProduction(
  documentItemId: string,
): Promise<SendToProductionResult> {
  try {
    const id = String(documentItemId ?? "").trim();
    if (!id) {
      return { success: false, error: "ไม่พบรหัสรายการเอกสาร (documentItemId)" };
    }

    const supabase = getSupabaseAdmin();
    const fetched = await fetchDocumentItemForRouting(supabase, id);
    if (fetched.error || !fetched.data) {
      return {
        success: false,
        error: fetched.error ?? "โหลดรายการเอกสารไม่สำเร็จ",
      };
    }

    const line = fetched.data;

    // Guard: already sent (production_status ≠ NONE)
    if (isAlreadySent(line.production_status)) {
      return {
        success: false,
        error: `รายการนี้ถูกส่งเข้าผลิตแล้ว (สถานะ: ${line.production_status})`,
      };
    }

    // Prefer ISSUED SO — Soft Allocation / Job Costing integrity
    const docType = String(line.doc_type ?? "").toUpperCase();
    const docStatus = String(line.doc_status ?? "").toUpperCase();
    const kanbanDocTypes = new Set(["SO", "INV_DO", "TAX_INV", "CS_TAX", "ABB"]);
    if (!kanbanDocTypes.has(docType)) {
      return {
        success: false,
        error: `ส่งงานเข้า Production Kanban ได้เฉพาะ SO, INV_DO, TAX_INV, CS_TAX, ABB (ปัจจุบัน: ${line.doc_type ?? "—"})`,
      };
    }
    if (docStatus !== "ISSUED" && docStatus !== "COMPLETED") {
      return {
        success: false,
        error: `ส่งงานผลิตได้เมื่อเอกสารยืนยันแล้ว (ISSUED) — ปัจจุบัน: ${line.doc_status ?? "—"}`,
      };
    }

    if (line.is_service) {
      return routeServiceFlow(supabase, line);
    }

    if (line.is_manufactured) {
      return routeManufacturedFlow(supabase, line);
    }

    return {
      success: false,
      error:
        "รายการนี้ไม่ใช่งานบริการ (is_service) และไม่ใช่สินค้าผลิตเอง (is_manufactured) — ไม่สามารถส่งงานผลิตได้",
    };
  } catch (err) {
    console.error("[sendToProduction]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ส่งงานผลิตไม่สำเร็จ",
    };
  }
}

/**
 * ส่งทุกบรรทัดบริการ / สินค้าผลิตเองที่ยังไม่เข้า Kanban
 * 1 บรรทัด = 1 ใบงาน (MTO-YYMM-XXXX คนละใบ)
 */
export async function sendDocumentToKanban(documentId: string): Promise<{
  success: boolean;
  error: string | null;
  data: { job_nos: string[] } | null;
}> {
  try {
    const id = String(documentId ?? "").trim();
    if (!id) {
      return { success: false, error: "ไม่พบรหัสเอกสาร", data: null };
    }

    const supabase = getSupabaseAdmin();
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, doc_no, doc_type, status")
      .eq("id", id)
      .maybeSingle();

    if (docError) {
      return { success: false, error: docError.message, data: null };
    }
    if (!doc) {
      return { success: false, error: "ไม่พบเอกสาร", data: null };
    }

    const docType = String(doc.doc_type ?? "").toUpperCase();
    const docStatus = String(doc.status ?? "").toUpperCase();
    const kanbanDocTypes = new Set(["SO", "INV_DO", "TAX_INV", "CS_TAX", "ABB"]);
    if (!kanbanDocTypes.has(docType)) {
      return {
        success: false,
        error: `ส่งงานเข้า Production Kanban ได้เฉพาะ SO, INV_DO, TAX_INV, CS_TAX, ABB`,
        data: null,
      };
    }
    if (docStatus !== "ISSUED" && docStatus !== "COMPLETED") {
      return {
        success: false,
        error: "ส่งงานผลิตได้เมื่อเอกสารยืนยันแล้ว (ISSUED)",
        data: null,
      };
    }

    const { data: rows, error: itemsError } = await supabase
      .from("document_items")
      .select(
        `
        id,
        product_id,
        qty,
        sort_order,
        is_service_item,
        is_sent_to_production,
        production_status,
        products!document_items_product_id_fkey (
          product_models!products_model_id_fkey ( is_service, is_manufactured )
        )
      `,
      )
      .eq("document_id", id)
      .order("sort_order", { ascending: true });

    if (itemsError) {
      return { success: false, error: itemsError.message, data: null };
    }

    const pendingIds: string[] = [];
    for (const row of rows ?? []) {
      const sentFlag = row.is_sent_to_production === true;
      const status = String(row.production_status ?? "NONE").trim().toUpperCase();
      if (sentFlag || (status !== "" && status !== "NONE")) continue;
      if ((toPositiveQty(row.qty) ?? 0) <= 0) continue;

      const product = unwrapOne(
        row.products as
          | {
              product_models?:
                | { is_service?: boolean | null; is_manufactured?: boolean | null }
                | { is_service?: boolean | null; is_manufactured?: boolean | null }[]
                | null;
            }
          | {
              product_models?:
                | { is_service?: boolean | null; is_manufactured?: boolean | null }
                | { is_service?: boolean | null; is_manufactured?: boolean | null }[]
                | null;
            }[]
          | null,
      );
      const model = unwrapOne(product?.product_models ?? null);
      const isService =
        row.is_service_item === true || model?.is_service === true;
      const isManufactured =
        model?.is_manufactured === true && Boolean(String(row.product_id ?? "").trim());
      if (!isService && !isManufactured) continue;
      pendingIds.push(String(row.id));
    }

    if (pendingIds.length === 0) {
      return {
        success: false,
        error: "ไม่มีรายการบริการหรือสินค้าผลิตเองที่ยังไม่ได้ส่งเข้า Kanban",
        data: null,
      };
    }

    const jobNos: string[] = [];
    const errors: string[] = [];
    for (const itemId of pendingIds) {
      const result = await sendToProduction(itemId);
      if (result.success && result.data?.job_no) {
        jobNos.push(result.data.job_no);
      } else {
        errors.push(result.error ?? "ส่งงานไม่สำเร็จ");
      }
    }

    revalidatePaths(doc.doc_no != null ? String(doc.doc_no) : null);

    if (jobNos.length === 0) {
      return {
        success: false,
        error: errors[0] ?? "ส่งงานเข้า Production Kanban ไม่สำเร็จ",
        data: null,
      };
    }

    return {
      success: true,
      error: errors.length > 0 ? errors[0] : null,
      data: { job_nos: jobNos },
    };
  } catch (err) {
    console.error("[sendDocumentToKanban]", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "ส่งงานเข้า Production Kanban ไม่สำเร็จ",
      data: null,
    };
  }
}

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

/**
 * อัปโหลด Mockup รายบรรทัด → bucket production_attachments
 * แล้วบันทึก URL ลง document_items.mockup_image_url
 *
 * @param documentItemId — document_items.id
 * @param formData — ต้องมี key `file` (WebP บีบอัดฝั่ง Client แล้ว)
 */
export async function uploadDocumentItemMockup(
  documentItemId: string,
  formData: FormData,
): Promise<UploadDocumentItemMockupResult> {
  try {
    const id = String(documentItemId ?? "").trim();
    const fileEntry = formData.get("file") ?? formData.get("mockup");

    if (!id) {
      return { success: false, error: "ไม่พบรหัสรายการเอกสาร" };
    }
    if (!isUploadFile(fileEntry)) {
      return { success: false, error: "ไม่พบไฟล์รูป Mockup" };
    }

    const mimeType = (fileEntry.type || "").toLowerCase();
    if (mimeType && !ALLOWED_MOCKUP_MIME.has(mimeType)) {
      return {
        success: false,
        error: `ประเภทไฟล์ไม่รองรับ (${mimeType || "unknown"}) — ใช้ JPG/PNG/WEBP`,
      };
    }
    if (fileEntry.size > MAX_MOCKUP_BYTES) {
      return { success: false, error: "ไฟล์ใหญ่เกิน 10MB" };
    }

    const supabase = getSupabaseAdmin();

    const { data: item, error: itemError } = await supabase
      .from("document_items")
      .select(
        `
        id,
        document_id,
        documents!document_items_document_id_fkey (
          id,
          doc_no,
          doc_type,
          status
        )
      `,
      )
      .eq("id", id)
      .maybeSingle();

    if (itemError) {
      return {
        success: false,
        error: itemError.message ?? "ตรวจสอบรายการเอกสารไม่สำเร็จ",
      };
    }
    if (!item) {
      return { success: false, error: "ไม่พบรายการสินค้าในเอกสาร" };
    }

    const doc = unwrapOne(item.documents as { doc_no?: string } | null);
    const safeName = sanitizeFileName(fileEntry.name || "mockup.webp");
    const objectPath = `items/${id}/${Date.now()}-${safeName}`;
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
      };
    }

    const { error: updateError } = await supabase
      .from("document_items")
      .update({ mockup_image_url: url })
      .eq("id", id);

    if (updateError) {
      if (updateError.code === POSTGRES_UNDEFINED_COLUMN) {
        return {
          success: false,
          error:
            "ยังไม่มีคอลัมน์ document_items.mockup_image_url — กรุณารัน SQL เพิ่มคอลัมน์บน Supabase Cloud",
        };
      }
      return {
        success: false,
        error: updateError.message ?? "บันทึก URL Mockup ไม่สำเร็จ",
      };
    }

    revalidatePath("/sales");
    revalidatePath("/sales/orders");
    if (doc?.doc_no) {
      revalidatePath(`/sales/${encodeURIComponent(String(doc.doc_no))}`);
    }

    return {
      success: true,
      data: {
        document_item_id: id,
        mockup_image_url: url,
      },
    };
  } catch (err) {
    console.error("[uploadDocumentItemMockup]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "อัปโหลด Mockup ไม่สำเร็จ",
    };
  }
}
