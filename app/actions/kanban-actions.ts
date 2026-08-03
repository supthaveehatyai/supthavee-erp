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
  type CreateProductionJobInput,
  type CreateProductionJobResult,
  type GetProductionJobsResult,
  type ProductionJobCard,
  type ProductionJobStatus,
  type ProductionJobType,
  type ProductionJobsByStatus,
  type UpdateJobStatusResult,
} from "@/types/kanban";

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
  created_at: string | null;
  updated_at: string | null;
  document_id: string | null;
  documents: DocumentJoin | DocumentJoin[] | null;
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

function isProductionJobStatus(value: string): value is ProductionJobStatus {
  return (KANBAN_STATUSES as string[]).includes(value);
}

function isProductionJobType(value: string): value is ProductionJobType {
  return (PRODUCTION_JOB_TYPES as string[]).includes(value);
}

/** PROD-YYMM-XXXX (Bangkok calendar + short UUID) */
function generateProductionJobNo(): string {
  const ymd = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Bangkok",
  }); // YYYY-MM-DD
  const yy = ymd.slice(2, 4);
  const mm = ymd.slice(5, 7);
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase();
  return `PROD-${yy}${mm}-${suffix}`;
}

/**
 * ดึงใบสั่งผลิตทั้งหมดสำหรับบอร์ด Kanban
 * Join documents.doc_no + contacts.company_name แล้วจัดกลุ่มตาม status
 */
export async function getProductionJobs(): Promise<GetProductionJobsResult> {
  try {
    const supabase = createClient();

    const { data, error } = await supabase
      .from("production_jobs")
      .select(
        `
        id,
        job_no,
        job_type,
        status,
        due_date,
        details,
        created_at,
        updated_at,
        document_id,
        documents!production_jobs_document_id_fkey (
          id,
          doc_no,
          contacts!documents_contact_id_fkey (
            company_name
          )
        )
      `,
      )
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
    ).map((row) => {
      const doc = unwrapJoin(row.documents);
      const contact = unwrapJoin(doc?.contacts ?? null);

      return {
        id: row.id,
        job_no: row.job_no,
        job_type: row.job_type,
        status: row.status,
        due_date: row.due_date,
        details: row.details,
        created_at: row.created_at,
        updated_at: row.updated_at,
        document_id: row.document_id,
        document_no: doc?.doc_no?.trim() || null,
        customer_name: contact?.company_name?.trim() || null,
      };
    });

    const byStatus = emptyBoard();
    for (const job of flat) {
      const bucket = byStatus[job.status];
      if (bucket) {
        bucket.push(job);
      } else {
        byStatus.TODO.push(job);
      }
    }

    for (const status of KANBAN_STATUSES) {
      byStatus[status] = byStatus[status] ?? [];
    }

    return { success: true, data: byStatus, flat };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ดึงข้อมูลใบสั่งผลิตไม่สำเร็จ",
    };
  }
}

/**
 * สร้างใบสั่งผลิตจากบิลขาย (MTO) — status เริ่มต้น TODO
 */
export async function createProductionJob(
  data: CreateProductionJobInput,
): Promise<CreateProductionJobResult> {
  const documentId = data.document_id?.trim() ?? "";
  if (!documentId) {
    return { success: false, error: "ไม่พบรหัสเอกสาร (document_id)", data: null };
  }

  const jobTypeRaw = data.job_type?.trim().toUpperCase() ?? "";
  if (!isProductionJobType(jobTypeRaw)) {
    return {
      success: false,
      error: `ประเภทงานไม่ถูกต้อง: ${data.job_type || "(ว่าง)"}`,
      data: null,
    };
  }

  const dueDate = data.due_date?.trim().slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return {
      success: false,
      error: "กรุณาระบุวันกำหนดส่ง (YYYY-MM-DD)",
      data: null,
    };
  }

  const details = data.details?.trim() ?? "";
  if (!details) {
    return {
      success: false,
      error: "กรุณาระบุรายละเอียดคำสั่งทำ",
      data: null,
    };
  }

  try {
    const supabase = createClient();

    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, doc_no, status")
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
    if (doc.status !== "ISSUED") {
      return {
        success: false,
        error: `ส่งงานผลิตได้เฉพาะเอกสารสถานะ ISSUED (ปัจจุบัน: ${doc.status})`,
        data: null,
      };
    }

    // Retry on rare job_no unique collision
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const jobNo = generateProductionJobNo();
      const { data: created, error: insertError } = await supabase
        .from("production_jobs")
        .insert({
          job_no: jobNo,
          document_id: documentId,
          job_type: jobTypeRaw,
          status: "TODO",
          due_date: dueDate,
          details,
        })
        .select("id, job_no")
        .maybeSingle();

      if (!insertError && created) {
        revalidatePath("/production/kanban");
        revalidatePath(`/sales/${encodeURIComponent(doc.doc_no)}`);
        return {
          success: true,
          error: null,
          data: { id: created.id, job_no: created.job_no },
        };
      }

      lastError = insertError?.message ?? "สร้างใบสั่งผลิตไม่สำเร็จ";
      // Unique violation on job_no → retry
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

  const status = newStatus?.trim() ?? "";
  if (!isProductionJobStatus(status)) {
    return {
      success: false,
      error: `สถานะไม่ถูกต้อง: ${newStatus || "(ว่าง)"}`,
    };
  }

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("production_jobs")
      .update({
        status,
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
