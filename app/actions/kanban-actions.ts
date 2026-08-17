"use server";

/**
 * Phase 7 — Production Kanban Server Actions.
 * Zero Client-Side Fetching: Service Role (`createClient` / supabaseAdmin) only.
 */

import { revalidatePath } from "next/cache";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server-admin";
import {
  KANBAN_STATUSES,
  PRODUCTION_JOB_TYPES,
  type CancelProductionJobResult,
  type CreateProductionJobResult,
  type GetJobDetailsResult,
  type GetProductionJobsResult,
  type GetTechnicianOptionsResult,
  type KanbanColumnStatus,
  type ProductionJobCard,
  type ProductionJobDetails,
  type ProductionJobLineItem,
  type ProductionJobServiceModel,
  type ProductionJobStatus,
  type ProductionJobType,
  type ProductionJobsByStatus,
  type TechnicianOption,
  type UpdateJobStatusResult,
  type UpdateProductionJobAssignmentInput,
  type UpdateProductionJobAssignmentResult,
} from "@/types/kanban";

const PRODUCTION_ATTACHMENTS_BUCKET = "production_attachments";
/** Sales doc types ที่ส่งเข้าสายผลิต (MTO) ได้ */
const MTO_ELIGIBLE_DOC_TYPES = new Set([
  "TAX_INV",
  "ABB",
  "CS_TAX",
  "INV_DO",
]);
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 8;

type ContactJoin = {
  company_name?: string | null;
};

type DocumentJoin = {
  id?: string;
  doc_no?: string | null;
  contacts?: ContactJoin | ContactJoin[] | null;
};

type ProductionJobRow = {
  id: string;
  job_no: string;
  job_type: ProductionJobType;
  status: ProductionJobStatus;
  due_date: string | null;
  details: string | null;
  attachment_paths: string[] | null;
  created_at: string | null;
  updated_at: string | null;
  document_id: string | null;
  technician_id: string | null;
  wage_cost: number | string | null;
  documents: DocumentJoin | DocumentJoin[] | null;
  technician?: ContactJoin | ContactJoin[] | null;
};

function unwrapJoin<T extends object>(
  value: T | T[] | null | undefined,
): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function emptyBoard(): ProductionJobsByStatus {
  return {
    TODO: [],
    IN_PROGRESS: [],
    QC: [],
    READY_TO_SHIP: [],
    DELIVERED: [],
  };
}

function isKanbanColumnStatus(value: string): value is KanbanColumnStatus {
  return (KANBAN_STATUSES as readonly string[]).includes(value);
}

function isProductionJobType(value: string): value is ProductionJobType {
  return (PRODUCTION_JOB_TYPES as string[]).includes(value);
}

function bangkokYyMm(): { yy: string; mm: string } {
  const ymd = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Bangkok",
  });
  return { yy: ymd.slice(2, 4), mm: ymd.slice(5, 7) };
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^\w.\-ก-๙]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

function toWageCost(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function mapJobCard(row: ProductionJobRow): ProductionJobCard {
  const doc = unwrapJoin(row.documents);
  const contact = unwrapJoin(doc?.contacts ?? null);
  const technician = unwrapJoin(row.technician ?? null);

  return {
    id: row.id,
    job_no: row.job_no,
    job_type: row.job_type,
    status: row.status,
    due_date: row.due_date,
    details: row.details,
    attachment_paths: Array.isArray(row.attachment_paths)
      ? row.attachment_paths.filter(Boolean)
      : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    document_id: row.document_id,
    document_no: doc?.doc_no?.trim() || null,
    customer_name: contact?.company_name?.trim() || null,
    technician_id: row.technician_id ?? null,
    technician_name: technician?.company_name?.trim() || null,
    wage_cost: toWageCost(row.wage_cost),
  };
}

const JOB_SELECT = `
        id,
        job_no,
        job_type,
        status,
        due_date,
        details,
        attachment_paths,
        created_at,
        updated_at,
        document_id,
        technician_id,
        wage_cost,
        documents!production_jobs_document_id_fkey (
          id,
          doc_no,
          contacts!documents_contact_id_fkey (
            company_name
          )
        ),
        technician:contacts!production_jobs_technician_id_fkey (
          company_name
        )
      ` as const;

function collectAttachmentFiles(formData: FormData): File[] {
  const files: File[] = [];
  for (const value of formData.getAll("attachments")) {
    if (value instanceof File && value.size > 0 && value.name) {
      files.push(value);
    }
  }
  return files;
}

/**
 * JOB-YYMM-XXXX — running number ต่อเดือน (Bangkok)
 */
async function nextProductionJobNo(
  supabase: ReturnType<typeof createClient>,
): Promise<string> {
  const { yy, mm } = bangkokYyMm();
  const prefix = `JOB-${yy}${mm}-`;

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
  const match = latest.match(/JOB-\d{4}-(\d+)$/i);
  if (match?.[1]) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > 0) seq = n + 1;
  }

  return `${prefix}${String(seq).padStart(4, "0")}`;
}

async function uploadProductionAttachments(
  supabase: ReturnType<typeof createClient>,
  jobNo: string,
  files: File[],
): Promise<{ paths: string[]; error: string | null }> {
  const paths: string[] = [];

  for (const file of files) {
    const mimeType = (file.type || "").toLowerCase();
    if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
      return {
        paths: [],
        error: `ประเภทไฟล์ไม่รองรับ (${mimeType || "unknown"}) — ใช้ JPG/PNG/WEBP`,
      };
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return { paths: [], error: `ไฟล์ ${file.name} ใหญ่เกิน 10MB` };
    }

    const safeName = sanitizeFileName(file.name || "image.jpg");
    const objectPath = `${jobNo}-${Date.now()}-${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from(PRODUCTION_ATTACHMENTS_BUCKET)
      .upload(objectPath, buffer, {
        contentType: mimeType || "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      return {
        paths: [],
        error: uploadError.message ?? `อัปโหลด ${file.name} ไม่สำเร็จ`,
      };
    }

    const { data: publicData } = supabase.storage
      .from(PRODUCTION_ATTACHMENTS_BUCKET)
      .getPublicUrl(objectPath);

    const url = publicData?.publicUrl?.trim();
    // Store public URL for Kanban thumbnails (bucket is public)
    paths.push(url || objectPath);
  }

  return { paths, error: null };
}

/**
 * ดึงใบสั่งผลิตทั้งหมดสำหรับบอร์ด Kanban
 */
export async function getProductionJobs(): Promise<GetProductionJobsResult> {
  try {
    const supabase = createClient();

    const { data, error } = await supabase
      .from("production_jobs")
      .select(JOB_SELECT)
      .eq("is_archived", false)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (error) {
      return {
        success: false,
        error: error.message ?? "ดึงข้อมูลใบสั่งผลิตไม่สำเร็จ",
      };
    }

    const flat: ProductionJobCard[] = (
      (data as ProductionJobRow[] | null) ?? []
    ).map(mapJobCard);

    // Active board only — CANCELLED jobs are hidden from columns
    const active = flat.filter((job) => job.status !== "CANCELLED");

    const byStatus = emptyBoard();
    for (const job of active) {
      if (isKanbanColumnStatus(job.status)) {
        byStatus[job.status].push(job);
      }
    }

    for (const status of KANBAN_STATUSES) {
      byStatus[status] = byStatus[status] ?? [];
    }

    return { success: true, data: byStatus, flat: active };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ดึงข้อมูลใบสั่งผลิตไม่สำเร็จ",
    };
  }
}

/** Alias ตามสเปก E2E */
export async function getKanbanBoardData(): Promise<GetProductionJobsResult> {
  return getProductionJobs();
}

/**
 * สร้างใบสั่งผลิตจากเอกสารขาย (TAX_INV / ABB / CS_TAX / INV_DO) พร้อมแนบรูป Mockup
 *
 * Fields: documentId | document_id, jobType | job_type,
 * description | details, targetDate | due_date, attachments (File[])
 */
export async function createProductionJob(
  formData: FormData,
): Promise<CreateProductionJobResult> {
  const documentId = String(
    formData.get("documentId") ?? formData.get("document_id") ?? "",
  ).trim();
  const jobTypeRaw = String(
    formData.get("jobType") ?? formData.get("job_type") ?? "OTHER",
  )
    .trim()
    .toUpperCase();
  const details = String(
    formData.get("description") ?? formData.get("details") ?? "",
  ).trim();
  const dueDate = String(
    formData.get("targetDate") ?? formData.get("due_date") ?? "",
  )
    .trim()
    .slice(0, 10);

  if (!documentId) {
    return { success: false, error: "ไม่พบรหัสเอกสาร (documentId)", data: null };
  }
  if (!isProductionJobType(jobTypeRaw)) {
    return {
      success: false,
      error: `ประเภทงานไม่ถูกต้อง: ${jobTypeRaw || "(ว่าง)"}`,
      data: null,
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return {
      success: false,
      error: "กรุณาระบุวันกำหนดส่ง (YYYY-MM-DD)",
      data: null,
    };
  }
  if (!details) {
    return {
      success: false,
      error: "กรุณาระบุรายละเอียดคำสั่งทำ",
      data: null,
    };
  }

  const files = collectAttachmentFiles(formData);
  if (files.length > MAX_ATTACHMENTS) {
    return {
      success: false,
      error: `แนบรูปได้สูงสุด ${MAX_ATTACHMENTS} ไฟล์`,
      data: null,
    };
  }

  try {
    const supabase = createClient();

    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, doc_no, doc_type, status")
      .eq("id", documentId)
      .maybeSingle();

    if (docError) {
      return {
        success: false,
        error: docError.message ?? "ตรวจสอบเอกสารต้นทางไม่สำเร็จ",
        data: null,
      };
    }
    if (!doc) {
      return { success: false, error: "ไม่พบเอกสารต้นทางในระบบ", data: null };
    }
    if (!MTO_ELIGIBLE_DOC_TYPES.has(doc.doc_type)) {
      return {
        success: false,
        error: `ส่งงานผลิตได้เฉพาะ TAX_INV / ABB / CS_TAX / INV_DO (ปัจจุบัน: ${doc.doc_type})`,
        data: null,
      };
    }
    if (doc.status !== "ISSUED") {
      return {
        success: false,
        error: `ส่งงานผลิตได้เฉพาะเอกสารสถานะ ISSUED (ปัจจุบัน: ${doc.status})`,
        data: null,
      };
    }

    const { data: existing, error: existingError } = await supabase
      .from("production_jobs")
      .select("id, job_no, status")
      .eq("document_id", documentId)
      .neq("status", "CANCELLED")
      .limit(1)
      .maybeSingle();

    if (existingError) {
      return {
        success: false,
        error: existingError.message ?? "ตรวจสอบใบงานซ้ำไม่สำเร็จ",
        data: null,
      };
    }
    if (existing) {
      return {
        success: false,
        error: `เอกสารนี้มีใบสั่งผลิตแล้ว (${existing.job_no} · ${existing.status})`,
        data: null,
      };
    }

    let lastError: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const jobNo = await nextProductionJobNo(supabase);

      let attachmentPaths: string[] = [];
      if (files.length > 0) {
        const uploaded = await uploadProductionAttachments(
          supabase,
          jobNo,
          files,
        );
        if (uploaded.error) {
          return { success: false, error: uploaded.error, data: null };
        }
        attachmentPaths = uploaded.paths;
      }

      const { data: created, error: insertError } = await supabase
        .from("production_jobs")
        .insert({
          job_no: jobNo,
          document_id: documentId,
          job_type: jobTypeRaw,
          status: "TODO",
          due_date: dueDate,
          details,
          attachment_paths: attachmentPaths,
        })
        .select("id, job_no")
        .maybeSingle();

      if (!insertError && created) {
        revalidatePath("/production/kanban");
        revalidatePath(`/sales/${encodeURIComponent(doc.doc_no)}`);
        return {
          success: true,
          error: null,
          data: {
            id: created.id,
            job_no: created.job_no,
            attachment_count: attachmentPaths.length,
          },
        };
      }

      lastError = insertError?.message ?? "สร้างใบสั่งผลิตไม่สำเร็จ";
      if (insertError?.code !== "23505") {
        break;
      }
    }

    return { success: false, error: lastError, data: null };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "สร้างใบสั่งผลิตไม่สำเร็จ",
      data: null,
    };
  }
}

/**
 * อัปเดตสถานะใบสั่งผลิตเมื่อลากการ์ดข้ามคอลัมน์บน Kanban
 */
export async function updateJobStatus(
  jobId: string,
  newStatus: string,
): Promise<UpdateJobStatusResult> {
  const id = jobId?.trim() ?? "";
  if (!id) {
    return { success: false, error: "ไม่พบรหัสงาน (jobId)" };
  }

  const normalized =
    newStatus?.trim() === "READY_FOR_DELIVERY"
      ? "READY_TO_SHIP"
      : (newStatus?.trim() ?? "");

  if (!isKanbanColumnStatus(normalized)) {
    return {
      success: false,
      error: `สถานะไม่ถูกต้อง: ${newStatus || "(ว่าง)"}`,
    };
  }

  try {
    const supabase = createClient();

    const { data: current, error: currentError } = await supabase
      .from("production_jobs")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (currentError) {
      return {
        success: false,
        error: currentError.message ?? "ตรวจสอบสถานะงานไม่สำเร็จ",
      };
    }
    if (!current) {
      return { success: false, error: "ไม่พบใบสั่งผลิตในระบบ" };
    }
    if (current.status === "CANCELLED") {
      return { success: false, error: "งานถูกยกเลิกแล้ว ไม่สามารถย้ายสถานะได้" };
    }
    if (current.status === "DELIVERED" && normalized !== "DELIVERED") {
      return {
        success: false,
        error: "งานส่งมอบแล้ว — ไม่สามารถย้ายกลับได้",
      };
    }

    const { data, error } = await supabase
      .from("production_jobs")
      .update({
        status: normalized,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      return {
        success: false,
        error: error.message ?? "อัปเดตสถานะงานไม่สำเร็จ",
      };
    }
    if (!data) {
      return { success: false, error: "ไม่พบใบสั่งผลิตในระบบ" };
    }

    revalidatePath("/production/kanban");
    return { success: true, error: null };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "อัปเดตสถานะงานไม่สำเร็จ",
    };
  }
}

/**
 * ดึงรายละเอียดใบสั่งผลิตสำหรับ Job Detail Sheet
 * รวมลูกค้า + รายการสินค้าจากเอกสารต้นทาง (document_items → products)
 */
export async function getJobDetails(
  jobId: string,
): Promise<GetJobDetailsResult> {
  const id = jobId?.trim() ?? "";
  if (!id) {
    return { success: false, error: "ไม่พบรหัสงาน (jobId)", data: null };
  }

  try {
    const supabase = createClient();

    const { data: job, error: jobError } = await supabase
      .from("production_jobs")
      .select(JOB_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (jobError) {
      return {
        success: false,
        error: jobError.message ?? "ดึงรายละเอียดงานไม่สำเร็จ",
        data: null,
      };
    }
    if (!job) {
      return { success: false, error: "ไม่พบใบสั่งผลิตในระบบ", data: null };
    }

    const row = job as ProductionJobRow;
    const card = mapJobCard(row);

    let lineItems: ProductionJobLineItem[] = [];

    if (row.document_id) {
      const { data: items, error: itemsError } = await supabase
        .from("document_items")
        .select(
          `
          id,
          qty,
          description,
          uom_used,
          sort_order,
          products!document_items_product_id_fkey (
            id,
            sku,
            name,
            short_name,
            color,
            size,
            model_id,
            product_models!products_model_id_fkey (
              id,
              model_code,
              name,
              short_name,
              is_service
            )
          )
        `,
        )
        .eq("document_id", row.document_id)
        .order("sort_order", { ascending: true });

      if (itemsError) {
        return {
          success: false,
          error: itemsError.message ?? "ดึงรายการสินค้าไม่สำเร็จ",
          data: null,
        };
      }

      type ItemRow = {
        id: string;
        qty: number;
        description: string | null;
        uom_used: string | null;
        products:
          | {
              id?: string;
              sku?: string | null;
              name?: string | null;
              short_name?: string | null;
              color?: string | null;
              size?: string | null;
              model_id?: string | null;
              product_models?: ServiceModelJoin | ServiceModelJoin[] | null;
            }
          | {
              id?: string;
              sku?: string | null;
              name?: string | null;
              short_name?: string | null;
              color?: string | null;
              size?: string | null;
              model_id?: string | null;
              product_models?: ServiceModelJoin | ServiceModelJoin[] | null;
            }[]
          | null;
      };

      lineItems = ((items as ItemRow[] | null) ?? []).map((item) => {
        const product = unwrapJoin(item.products);
        const model = unwrapJoin(product?.product_models ?? null);
        const sku = product?.sku?.trim() || "—";
        const name =
          product?.name?.trim() ||
          product?.short_name?.trim() ||
          item.description?.trim() ||
          "ไม่ระบุสินค้า";

        return {
          id: item.id,
          sku,
          name,
          qty: Number(item.qty) || 0,
          uom: item.uom_used?.trim() || null,
          color: product?.color?.trim() || null,
          size: product?.size?.trim() || null,
          description: item.description?.trim() || null,
          model_id: product?.model_id?.trim() || model?.id?.trim() || null,
          is_service: model?.is_service === true,
        };
      });
    }

    const serviceModel = await resolveServiceModelFromDocument(
      supabase,
      row.document_id,
    );

    const details: ProductionJobDetails = {
      ...card,
      line_items: lineItems,
      service_model_id: serviceModel?.id ?? null,
      service_model: serviceModel,
    };

    return { success: true, data: details };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ดึงรายละเอียดงานไม่สำเร็จ",
      data: null,
    };
  }
}

/**
 * ยกเลิกใบสั่งผลิต (status → CANCELLED) — ไม่สามารถยกเลิกงานที่ส่งมอบแล้ว
 */
export async function cancelProductionJob(
  jobId: string,
): Promise<CancelProductionJobResult> {
  const id = jobId?.trim() ?? "";
  if (!id) {
    return { success: false, error: "ไม่พบรหัสงาน (jobId)", data: null };
  }

  try {
    const supabase = createClient();

    const { data: current, error: currentError } = await supabase
      .from("production_jobs")
      .select("id, job_no, status")
      .eq("id", id)
      .maybeSingle();

    if (currentError) {
      return {
        success: false,
        error: currentError.message ?? "ตรวจสอบใบสั่งผลิตไม่สำเร็จ",
        data: null,
      };
    }
    if (!current) {
      return { success: false, error: "ไม่พบใบสั่งผลิตในระบบ", data: null };
    }
    if (current.status === "CANCELLED") {
      return {
        success: false,
        error: `งาน ${current.job_no} ถูกยกเลิกไปแล้ว`,
        data: null,
      };
    }
    if (current.status === "DELIVERED") {
      return {
        success: false,
        error: `งาน ${current.job_no} ส่งมอบแล้ว — ไม่สามารถยกเลิกได้`,
        data: null,
      };
    }

    const { data: updated, error: updateError } = await supabase
      .from("production_jobs")
      .update({
        status: "CANCELLED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, job_no")
      .maybeSingle();

    if (updateError) {
      return {
        success: false,
        error: updateError.message ?? "ยกเลิกงานไม่สำเร็จ",
        data: null,
      };
    }
    if (!updated) {
      return { success: false, error: "ไม่พบใบสั่งผลิตในระบบ", data: null };
    }

    revalidatePath("/production/kanban");
    return {
      success: true,
      error: null,
      data: { id: updated.id, job_no: updated.job_no },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "ยกเลิกงานไม่สำเร็จ",
      data: null,
    };
  }
}

const TECHNICIAN_CONTACT_TYPES = ["Vendor", "Technician"] as const;

type ServiceModelJoin = {
  id?: string | null;
  model_code?: string | null;
  name?: string | null;
  short_name?: string | null;
  is_service?: boolean | null;
};

async function resolveServiceModelFromDocument(
  supabase: ReturnType<typeof createClient>,
  documentId: string | null,
): Promise<ProductionJobServiceModel | null> {
  if (!documentId) return null;

  const { data, error } = await supabase
    .from("document_items")
    .select(
      `
      sort_order,
      products!document_items_product_id_fkey (
        model_id,
        product_models!products_model_id_fkey (
          id,
          model_code,
          name,
          short_name,
          is_service
        )
      )
    `,
    )
    .eq("document_id", documentId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[resolveServiceModelFromDocument]", error.message);
    return null;
  }

  for (const item of data ?? []) {
    const product = unwrapJoin(
      item.products as
        | { product_models?: ServiceModelJoin | ServiceModelJoin[] | null }
        | { product_models?: ServiceModelJoin | ServiceModelJoin[] | null }[]
        | null,
    );
    const model = unwrapJoin(product?.product_models ?? null);
    if (model?.is_service === true && model.id) {
      return {
        id: String(model.id),
        model_code: String(model.model_code ?? "").trim() || "—",
        name:
          String(model.name ?? "").trim() ||
          String(model.short_name ?? "").trim() ||
          String(model.model_code ?? "").trim() ||
          "งานบริการ",
      };
    }
  }

  return null;
}

async function isCurrentUserAdmin(): Promise<boolean> {
  const user = await getCurrentAuthUser();
  return String(user?.roleCode ?? "").trim().toLowerCase() === "admin";
}

/**
 * รายชื่อช่างรับเหมาจาก contacts.contact_roles (ไม่พึ่ง PostgREST embed)
 */
export async function getTechnicianOptions(
  serviceModelId?: string | null,
): Promise<GetTechnicianOptionsResult> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("contacts")
      .select("id, company_name, contact_roles, is_active")
      .contains("contact_roles", ["Technician"])
      .neq("is_active", false)
      .order("company_name", { ascending: true });

    if (error) {
      console.error("[getTechnicianOptions]", error.message);
      return {
        success: false,
        error: error.message ?? "ดึงรายชื่อช่างรับเหมาไม่สำเร็จ",
        data: [],
      };
    }

    const wageByTechnician = new Map<string, number>();
    const modelId = serviceModelId?.trim() ?? "";
    if (modelId) {
      const { data: rates, error: ratesError } = await supabase
        .from("technician_rates")
        .select("technician_id, default_wage")
        .eq("service_model_id", modelId);

      if (ratesError) {
        console.error("[getTechnicianOptions] rates", ratesError.message);
      } else {
        for (const rate of rates ?? []) {
          const techId = String(rate.technician_id ?? "").trim();
          if (!techId) continue;
          wageByTechnician.set(techId, toWageCost(rate.default_wage));
        }
      }
    }

    const options: TechnicianOption[] = [];
    const seen = new Set<string>();

    for (const row of data ?? []) {
      const id = String(row.id ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const roles = Array.isArray(row.contact_roles) ? row.contact_roles : [];
      const primaryRole =
        roles.find((role) =>
          TECHNICIAN_CONTACT_TYPES.includes(
            role as (typeof TECHNICIAN_CONTACT_TYPES)[number],
          ),
        ) ?? "Technician";
      options.push({
        id,
        company_name: String(row.company_name ?? "").trim() || "ไม่ระบุชื่อ",
        contact_type: String(primaryRole),
        default_wage: wageByTechnician.get(id) ?? 0,
      });
    }

    return { success: true, data: options };
  } catch (err) {
    console.error("[getTechnicianOptions]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ดึงรายชื่อช่างรับเหมาไม่สำเร็จ",
      data: [],
    };
  }
}

/**
 * บันทึกช่างรับเหมา + ค่าแรงลง production_jobs
 */
export async function updateProductionJobAssignment(
  input: UpdateProductionJobAssignmentInput,
): Promise<UpdateProductionJobAssignmentResult> {
  const jobId = input.job_id?.trim() ?? "";
  if (!jobId) {
    return { success: false, error: "ไม่พบรหัสงาน (jobId)" };
  }

  const technicianId = input.technician_id?.trim() || null;

  try {
    const supabase = createClient();
    const isAdmin = await isCurrentUserAdmin();

    const { data: current, error: currentError } = await supabase
      .from("production_jobs")
      .select("id, status, document_id")
      .eq("id", jobId)
      .maybeSingle();

    if (currentError) {
      return {
        success: false,
        error: currentError.message ?? "ตรวจสอบใบสั่งผลิตไม่สำเร็จ",
      };
    }
    if (!current) {
      return { success: false, error: "ไม่พบใบสั่งผลิตในระบบ" };
    }
    if (current.status === "CANCELLED") {
      return { success: false, error: "งานถูกยกเลิกแล้ว ไม่สามารถบันทึกค่าแรงได้" };
    }

    let wageCost = 0;

    if (technicianId) {
      const { data: technician, error: techError } = await supabase
        .from("contacts")
        .select("id, contact_roles")
        .eq("id", technicianId)
        .maybeSingle();

      if (techError) {
        return {
          success: false,
          error: techError.message ?? "ตรวจสอบช่างรับเหมาไม่สำเร็จ",
        };
      }
      const techRoles = Array.isArray(technician?.contact_roles)
        ? technician.contact_roles
        : [];
      if (
        !technician ||
        !TECHNICIAN_CONTACT_TYPES.some((role) => techRoles.includes(role))
      ) {
        return {
          success: false,
          error: "ช่างรับเหมาต้องเป็น Vendor หรือ Technician ที่ลงทะเบียนแล้ว",
        };
      }

      const serviceModel = await resolveServiceModelFromDocument(
        supabase,
        current.document_id,
      );

      if (serviceModel) {
        const { data: rate, error: rateError } = await supabase
          .from("technician_rates")
          .select("default_wage")
          .eq("technician_id", technicianId)
          .eq("service_model_id", serviceModel.id)
          .maybeSingle();

        if (rateError) {
          return {
            success: false,
            error: rateError.message ?? "ตรวจสอบ Rate Card ไม่สำเร็จ",
          };
        }
        wageCost = rate ? toWageCost(rate.default_wage) : 0;
      }

      if (isAdmin && input.wage_cost != null) {
        if (!Number.isFinite(Number(input.wage_cost)) || Number(input.wage_cost) < 0) {
          return { success: false, error: "ค่าแรงต้องเป็นตัวเลขมากกว่าหรือเท่ากับ 0" };
        }
        wageCost = toWageCost(input.wage_cost);
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from("production_jobs")
      .update({
        technician_id: technicianId,
        wage_cost: wageCost,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .select("id")
      .maybeSingle();

    if (updateError) {
      return {
        success: false,
        error: updateError.message ?? "บันทึกช่างรับเหมา / ค่าแรงไม่สำเร็จ",
      };
    }
    if (!updated) {
      return { success: false, error: "ไม่พบใบสั่งผลิตในระบบ" };
    }

    revalidatePath("/production/kanban");
    revalidatePath("/profit-analysis");
    revalidatePath("/dashboard");
    return { success: true, error: null };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "บันทึกช่างรับเหมา / ค่าแรงไม่สำเร็จ",
    };
  }
}
