"use server";

/**
 * Phase 7 — Production Kanban Server Actions.
 * Zero Client-Side Fetching: Service Role (`createClient` / supabaseAdmin) only.
 */

import { revalidatePath } from "next/cache";
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
  type LookupTechnicianWageResult,
  type ProductionJobCard,
  type ProductionJobDetails,
  type ProductionJobLineItem,
  type ProductionJobServiceModel,
  type ProductionJobStatus,
  type ProductionJobType,
  type ProductionJobsByStatus,
  type TechnicianOption,
  type TechnicianRateOption,
  type UpdateJobStatusResult,
  type UpdateProductionJobAssignmentInput,
  type UpdateProductionJobAssignmentResult,
} from "@/types/kanban";
import { resolveProductionAttachmentUrls } from "@/lib/utils/storage-tier";
import type { StorageTier } from "@/types/storage-tier";

const PRODUCTION_ATTACHMENTS_BUCKET = "production_attachments";
/** Sales doc types ที่ส่งเข้าสายผลิต (MTO) ได้ */
const MTO_ELIGIBLE_DOC_TYPES = new Set([
  "SO",
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
  estimated_completion_date: string | null;
  remark: string | null;
  attachment_paths: string[] | null;
  storage_tier: StorageTier | null;
  nas_archive_url: string | null;
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
    PLANNED: [],
    IN_PROGRESS: [],
    QA: [],
    COMPLETED: [],
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
    estimated_completion_date: row.estimated_completion_date,
    remark: row.remark,
    attachment_paths: Array.isArray(row.attachment_paths)
      ? row.attachment_paths.filter(Boolean)
      : [],
    storage_tier: row.storage_tier === "NAS" ? "NAS" : "CLOUD",
    nas_archive_url: row.nas_archive_url?.trim() || null,
    display_attachment_urls: resolveProductionAttachmentUrls({
      storageTier: row.storage_tier,
      attachmentPaths: Array.isArray(row.attachment_paths)
        ? row.attachment_paths.filter(Boolean)
        : [],
      nasArchiveUrl: row.nas_archive_url,
    }),
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
        estimated_completion_date,
        remark,
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
      .order("estimated_completion_date", { ascending: true, nullsFirst: false })
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
 * สร้างใบสั่งผลิตจากเอกสารขาย (SO / TAX_INV / ABB / CS_TAX / INV_DO) พร้อมแนบรูป Mockup
 *
 * Fields: documentId | document_id, jobType | job_type,
 * description | remark, targetDate | estimated_completion_date, attachments (File[])
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
  const remark = String(
    formData.get("description") ?? formData.get("remark") ?? "",
  ).trim();
  const estimatedCompletionDate = String(
    formData.get("targetDate") ??
      formData.get("estimated_completion_date") ??
      "",
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(estimatedCompletionDate)) {
    return {
      success: false,
      error: "กรุณาระบุวันกำหนดส่ง (YYYY-MM-DD)",
      data: null,
    };
  }
  if (!remark) {
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
        error: `ส่งงานผลิตได้เฉพาะ SO / TAX_INV / ABB / CS_TAX / INV_DO (ปัจจุบัน: ${doc.doc_type})`,
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
          status: "PLANNED",
          estimated_completion_date: estimatedCompletionDate,
          remark,
          attachment_paths: attachmentPaths,
          technician_id: null,
          wage_cost: 0,
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

  const normalized = newStatus?.trim() ?? "";

  if (!isKanbanColumnStatus(normalized)) {
    return {
      success: false,
      error: `สถานะไม่ถูกต้อง: ${newStatus || "(ว่าง)"} — ใช้ PLANNED / IN_PROGRESS / QA / COMPLETED`,
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
    if (current.status === "COMPLETED" && normalized !== "COMPLETED") {
      return {
        success: false,
        error: "งานเสร็จสิ้นแล้ว — ไม่สามารถย้ายกลับได้",
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
      // ไม่ embed contacts ผ่าน PostgREST — ดึง technician_id แล้ว lookup ชื่อแยก
      // เพื่อไม่พังถ้า Schema Cache ยังไม่เห็น FK document_items → contacts
      const { data: items, error: itemsError } = await supabase
        .from("document_items")
        .select(
          `
          id,
          qty,
          description,
          uom_used,
          sort_order,
          technician_id,
          wage_cost,
          technician_bill_id,
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
        technician_id: string | null;
        wage_cost: number | string | null;
        technician_bill_id: string | null;
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

      const itemRows = (items as ItemRow[] | null) ?? [];
      const technicianIds = [
        ...new Set(
          itemRows
            .map((item) => item.technician_id?.trim())
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      const technicianNameById = new Map<string, string>();
      if (technicianIds.length > 0) {
        const { data: technicians } = await supabase
          .from("contacts")
          .select("id, company_name")
          .in("id", technicianIds);

        for (const tech of technicians ?? []) {
          const techId = String(tech.id ?? "").trim();
          if (!techId) continue;
          technicianNameById.set(
            techId,
            String(tech.company_name ?? "").trim() || "ไม่ระบุชื่อช่าง",
          );
        }
      }

      lineItems = itemRows.map((item) => {
        const product = unwrapJoin(item.products);
        const model = unwrapJoin(product?.product_models ?? null);
        const technicianId = item.technician_id?.trim() || null;
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
          technician_id: technicianId,
          technician_name: technicianId
            ? technicianNameById.get(technicianId) ?? null
            : null,
          wage_cost: toWageCost(item.wage_cost),
          technician_bill_id: item.technician_bill_id?.trim() || null,
        };
      });

      const modelIds = [
        ...new Set(
          lineItems
            .map((item) => item.model_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (modelIds.length > 0) {
        const { data: models } = await supabase
          .from("product_models")
          .select("id, is_service")
          .in("id", modelIds);
        const serviceByModel = new Map(
          (models ?? []).map((row) => [
            String(row.id),
            row.is_service === true,
          ]),
        );
        lineItems = lineItems.map((item) => ({
          ...item,
          is_service: item.model_id
            ? (serviceByModel.get(item.model_id) ?? item.is_service)
            : item.is_service,
        }));
      }
    }

    const serviceModel = await resolveServiceModelFromDocument(
      supabase,
      row.document_id,
    );

    const jobDetails: ProductionJobDetails = {
      ...card,
      line_items: lineItems,
      service_model_id: serviceModel?.id ?? null,
      service_model: serviceModel,
    };

    return { success: true, data: jobDetails };
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
    if (current.status === "COMPLETED") {
      return {
        success: false,
        error: `งาน ${current.job_no} เสร็จสิ้นแล้ว — ไม่สามารถยกเลิกได้`,
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

/**
 * เช็ก Rate Card ของช่างสำหรับรุ่นงานบริการ (product_models.id)
 * ใช้ตอนเลือก Dropdown รายบรรทัด — auto-fill wage_cost
 */
export async function lookupTechnicianWageForService(
  technicianId: string,
  serviceModelId: string | null | undefined,
): Promise<LookupTechnicianWageResult> {
  const techId = technicianId?.trim() ?? "";
  const modelId = serviceModelId?.trim() ?? "";
  if (!techId) {
    return {
      success: true,
      default_wage: 0,
      has_rate: false,
      service_model_id: modelId || null,
    };
  }
  if (!modelId) {
    return {
      success: true,
      default_wage: 0,
      has_rate: false,
      service_model_id: null,
    };
  }

  try {
    const supabase = createClient();
    const { data: rate, error: rateError } = await supabase
      .from("technician_rates")
      .select("default_wage")
      .eq("technician_id", techId)
      .eq("service_model_id", modelId)
      .maybeSingle();

    if (rateError) {
      return {
        success: false,
        error: rateError.message ?? "ตรวจสอบ Rate Card ไม่สำเร็จ",
        default_wage: 0,
        has_rate: false,
        service_model_id: modelId,
      };
    }

    if (!rate) {
      return {
        success: true,
        default_wage: 0,
        has_rate: false,
        service_model_id: modelId,
      };
    }

    return {
      success: true,
      default_wage: toWageCost(rate.default_wage),
      has_rate: true,
      service_model_id: modelId,
    };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ตรวจสอบ Rate Card ไม่สำเร็จ",
      default_wage: 0,
      has_rate: false,
      service_model_id: modelId || null,
    };
  }
}

/**
 * รายชื่อช่างรับเหมาทั้งหมด + Rate Card ทุกงานบริการ
 * UI กรองตาม model_id ของแต่ละบรรทัด
 */
export async function getTechnicianOptions(
  _serviceModelId?: string | null,
): Promise<GetTechnicianOptionsResult> {
  try {
    const supabase = createClient();

    const { data: rateRows, error: ratesError } = await supabase
      .from("technician_rates")
      .select("technician_id, service_model_id, default_wage");

    if (ratesError) {
      console.error("[getTechnicianOptions] rates", ratesError.message);
      return {
        success: false,
        error: ratesError.message ?? "ดึง Rate Card ช่างรับเหมาไม่สำเร็จ",
        data: [],
        rates: [],
      };
    }

    const rates: TechnicianRateOption[] = [];
    for (const rate of rateRows ?? []) {
      const techId = String(rate.technician_id ?? "").trim();
      const modelId = String(rate.service_model_id ?? "").trim();
      if (!techId || !modelId) continue;
      rates.push({
        technician_id: techId,
        service_model_id: modelId,
        default_wage: toWageCost(rate.default_wage),
      });
    }

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
        rates: [],
      };
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
        default_wage: 0,
      });
    }

    return { success: true, data: options, rates };
  } catch (err) {
    console.error("[getTechnicianOptions]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ดึงรายชื่อช่างรับเหมาไม่สำเร็จ",
      data: [],
      rates: [],
    };
  }
}

/**
 * บันทึกช่างรับเหมา + ค่าแรงลง document_items เป็นรายบรรทัด
 */
export async function updateProductionJobAssignment(
  input: UpdateProductionJobAssignmentInput,
): Promise<UpdateProductionJobAssignmentResult> {
  const jobId = input.job_id?.trim() ?? "";
  if (!jobId) {
    return { success: false, error: "ไม่พบรหัสงาน (jobId)" };
  }

  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) {
    return { success: false, error: "ไม่มีรายการงานบริการที่จะบันทึก" };
  }

  try {
    const supabase = createClient();

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
    if (!current.document_id) {
      return { success: false, error: "ใบสั่งผลิตนี้ไม่ได้ผูกเอกสารขาย" };
    }

    const itemIds = [
      ...new Set(
        lines
          .map((line) =>
            (line.document_item_id ?? line.item_id)?.trim(),
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const { data: existingItems, error: itemsError } = await supabase
      .from("document_items")
      .select("id, technician_bill_id, document_id")
      .eq("document_id", current.document_id)
      .in("id", itemIds);

    if (itemsError) {
      return {
        success: false,
        error: itemsError.message ?? "ตรวจสอบรายการสินค้าไม่สำเร็จ",
      };
    }
    if ((existingItems ?? []).length !== itemIds.length) {
      return {
        success: false,
        error: "พบรายการที่ไม่ได้อยู่ในเอกสารต้นทางของใบสั่งผลิตนี้",
      };
    }

    const billed = new Set(
      (existingItems ?? [])
        .filter((row) => row.technician_bill_id)
        .map((row) => String(row.id)),
    );

    const technicianIds = [
      ...new Set(
        lines
          .map((line) => line.technician_id?.trim())
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    if (technicianIds.length > 0) {
      const { data: technicians, error: techError } = await supabase
        .from("contacts")
        .select("id, contact_roles, is_active")
        .in("id", technicianIds)
        .contains("contact_roles", ["Technician"]);

      if (techError) {
        return {
          success: false,
          error: techError.message ?? "ตรวจสอบช่างรับเหมาไม่สำเร็จ",
        };
      }
      const validTechs = new Set(
        (technicians ?? [])
          .filter((row) => row.is_active !== false)
          .map((row) => String(row.id)),
      );
      for (const techId of technicianIds) {
        if (!validTechs.has(techId)) {
          return {
            success: false,
            error: "ช่างรับเหมาต้องมีสถานะ Technician ใน contact_roles",
          };
        }
      }
    }

    const nowIso = new Date().toISOString();
    for (const line of lines) {
      const itemId = (line.document_item_id ?? line.item_id)?.trim() ?? "";
      if (!itemId) continue;
      if (billed.has(itemId)) {
        return {
          success: false,
          error: "มีรายการที่ถูกสรุปวางบิลช่างแล้ว ไม่สามารถแก้ไขได้",
        };
      }
      if (!Number.isFinite(Number(line.wage_cost)) || Number(line.wage_cost) < 0) {
        return { success: false, error: "ค่าแรงต้องเป็นตัวเลขมากกว่าหรือเท่ากับ 0" };
      }

      const { error: updateError } = await supabase
        .from("document_items")
        .update({
          technician_id: line.technician_id?.trim() || null,
          wage_cost: toWageCost(line.wage_cost),
        })
        .eq("id", itemId)
        .eq("document_id", current.document_id);

      if (updateError) {
        return {
          success: false,
          error: updateError.message ?? "บันทึกช่างรับเหมา / ค่าแรงไม่สำเร็จ",
        };
      }
    }

    await supabase
      .from("production_jobs")
      .update({ updated_at: nowIso })
      .eq("id", jobId);

    revalidatePath("/production/kanban");
    revalidatePath("/finance/billing-notes");
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
