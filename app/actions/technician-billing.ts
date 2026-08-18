"use server";

/**
 * Technician Billing (TB) — สรุปวางบิลช่าง
 * Zero Client-Side Fetching: supabaseAdmin (Service Role) only.
 * Types: `@/types/technician-billing`
 *
 * Ledger:
 * - Header → documents (doc_type = TB)
 * - Lines  → document_items (1 แถวต่อ JOB, unit_price = wage_cost)
 * - Flag   → production_jobs.technician_bill_id
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server-admin";
import { roundMoney } from "@/lib/utils/payment-fifo";
import type {
  CreateTechnicianBillInput,
  CreateTechnicianBillResult,
  GetUnbilledTechnicianJobsInput,
  GetUnbilledTechnicianJobsResult,
  TechnicianBillingContact,
  TechnicianBillingJobRow,
} from "@/types/technician-billing";

/** Schema ไม่มีสถานะ DONE — ใช้ READY_TO_SHIP (= งานเสร็จ) + DELIVERED */
const BILLABLE_JOB_STATUSES = ["READY_TO_SHIP", "DELIVERED"] as const;

const JOB_TYPE_LABEL: Record<string, string> = {
  SCREEN: "สกรีน",
  EMBROIDERY: "ปัก",
  SEWING: "เย็บ",
  OTHER: "อื่นๆ",
};

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function deliveredOnFromJob(updatedAt: string | null | undefined): string | null {
  const raw = String(updatedAt ?? "").trim();
  if (!raw) return null;
  return raw.slice(0, 10);
}

type ContactJoin = { id?: string | null; company_name?: string | null };
type DocumentJoin = { id?: string | null; doc_no?: string | null };
type ServiceModelJoin = {
  id?: string | null;
  name?: string | null;
  short_name?: string | null;
  model_code?: string | null;
  is_service?: boolean | null;
};

async function loadTechnicianContacts(
  supabase: ReturnType<typeof createClient>,
): Promise<{ data: TechnicianBillingContact[]; error: string | null }> {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, company_name, contact_roles, is_active")
    .contains("contact_roles", ["Technician"])
    .neq("is_active", false)
    .order("company_name", { ascending: true });

  if (error) {
    return {
      data: [],
      error: error.message ?? "ดึงรายชื่อช่างรับเหมาไม่สำเร็จ",
    };
  }

  const contacts: TechnicianBillingContact[] = [];
  const seen = new Set<string>();
  for (const row of data ?? []) {
    const id = String(row.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    contacts.push({
      id,
      company_name: String(row.company_name ?? "").trim() || "ไม่ระบุชื่อ",
    });
  }
  return { data: contacts, error: null };
}

async function loadServiceNameByDocumentId(
  supabase: ReturnType<typeof createClient>,
  documentIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (documentIds.length === 0) return map;

  const { data, error } = await supabase
    .from("document_items")
    .select(
      `
      document_id,
      sort_order,
      description,
      products!document_items_product_id_fkey (
        name,
        short_name,
        product_models!products_model_id_fkey (
          name,
          short_name,
          model_code,
          is_service
        )
      )
    `,
    )
    .in("document_id", documentIds)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[loadServiceNameByDocumentId]", error.message);
    return map;
  }

  for (const item of data ?? []) {
    const docId = String(item.document_id ?? "").trim();
    if (!docId || map.has(docId)) continue;
    const product = unwrapJoin(
      item.products as
        | {
            name?: string | null;
            short_name?: string | null;
            product_models?: ServiceModelJoin | ServiceModelJoin[] | null;
          }
        | {
            name?: string | null;
            short_name?: string | null;
            product_models?: ServiceModelJoin | ServiceModelJoin[] | null;
          }[]
        | null,
    );
    const model = unwrapJoin(product?.product_models ?? null);
    if (model?.is_service === true) {
      const name =
        String(model.name ?? "").trim() ||
        String(model.short_name ?? "").trim() ||
        String(model.model_code ?? "").trim();
      if (name) {
        map.set(docId, name);
        continue;
      }
    }
    const fallback =
      String(product?.name ?? "").trim() ||
      String(product?.short_name ?? "").trim() ||
      String(item.description ?? "").trim();
    if (fallback) map.set(docId, fallback);
  }

  return map;
}

function emptyResult(
  error: string,
  technicians: TechnicianBillingContact[] = [],
): GetUnbilledTechnicianJobsResult {
  return {
    success: false,
    error,
    rows: [],
    totalWage: 0,
    technicians,
  };
}

/**
 * JOB ที่พร้อมสรุปวางบิลช่าง:
 * READY_TO_SHIP / DELIVERED + มีช่าง + มีค่าแรง + ยังไม่มี technician_bill_id
 */
export async function getUnbilledTechnicianJobs(
  input: GetUnbilledTechnicianJobsInput = {},
): Promise<GetUnbilledTechnicianJobsResult> {
  try {
    const supabase = createClient();
    const techniciansResult = await loadTechnicianContacts(supabase);
    if (techniciansResult.error) {
      return emptyResult(techniciansResult.error);
    }

    const technicianId = input.technicianId?.trim() || "";
    const from = input.from?.trim() || "";
    const to = input.to?.trim() || "";
    if (from && !isIsoDate(from)) {
      return emptyResult("วันที่เริ่มต้นต้องเป็นรูปแบบ YYYY-MM-DD", techniciansResult.data);
    }
    if (to && !isIsoDate(to)) {
      return emptyResult("วันที่สิ้นสุดต้องเป็นรูปแบบ YYYY-MM-DD", techniciansResult.data);
    }

    let query = supabase
      .from("production_jobs")
      .select(
        `
        id,
        job_no,
        job_type,
        status,
        details,
        updated_at,
        technician_id,
        wage_cost,
        document_id,
        technician_bill_id,
        documents!production_jobs_document_id_fkey (
          id,
          doc_no
        ),
        technician:contacts!production_jobs_technician_id_fkey (
          id,
          company_name
        )
      `,
      )
      .in("status", [...BILLABLE_JOB_STATUSES])
      .not("technician_id", "is", null)
      .is("technician_bill_id", null)
      .gt("wage_cost", 0)
      .order("updated_at", { ascending: false });

    if (technicianId) {
      query = query.eq("technician_id", technicianId);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[getUnbilledTechnicianJobs]", error.message);
      return emptyResult(
        error.message ?? "ดึงรายการงานค้างวางบิลช่างไม่สำเร็จ",
        techniciansResult.data,
      );
    }

    type JobRow = {
      id: string;
      job_no: string;
      job_type: string | null;
      status: string;
      details: string | null;
      updated_at: string | null;
      technician_id: string | null;
      wage_cost: number | string | null;
      document_id: string | null;
      documents: DocumentJoin | DocumentJoin[] | null;
      technician: ContactJoin | ContactJoin[] | null;
    };

    const filtered = ((data ?? []) as JobRow[]).filter((row) => {
      const deliveredOn = deliveredOnFromJob(row.updated_at);
      if (from && (!deliveredOn || deliveredOn < from)) return false;
      if (to && (!deliveredOn || deliveredOn > to)) return false;
      return true;
    });

    const documentIds = [
      ...new Set(
        filtered
          .map((row) => String(row.document_id ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const serviceByDoc = await loadServiceNameByDocumentId(supabase, documentIds);

    const rows: TechnicianBillingJobRow[] = [];
    let totalWage = 0;

    for (const row of filtered) {
      const id = String(row.id ?? "").trim();
      const techId = String(row.technician_id ?? "").trim();
      if (!id || !techId) continue;
      const wage = roundMoney(toMoney(row.wage_cost));
      totalWage = roundMoney(totalWage + wage);
      const doc = unwrapJoin(row.documents);
      const technician = unwrapJoin(row.technician);
      const jobTypeLabel =
        JOB_TYPE_LABEL[String(row.job_type ?? "")] ?? "งานบริการ";
      const serviceName =
        (row.document_id ? serviceByDoc.get(row.document_id) : null) ||
        String(row.details ?? "").trim() ||
        jobTypeLabel;

      rows.push({
        id,
        job_no: String(row.job_no ?? "—"),
        status: String(row.status ?? ""),
        delivered_on: deliveredOnFromJob(row.updated_at),
        technician_id: techId,
        technician_name:
          technician?.company_name?.trim() || "ไม่ระบุชื่อช่าง",
        invoice_doc_no: doc?.doc_no?.trim() || null,
        service_name: serviceName,
        wage_cost: wage,
      });
    }

    return {
      success: true,
      rows,
      totalWage,
      technicians: techniciansResult.data,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "ดึงรายการงานค้างวางบิลช่างไม่สำเร็จ";
    console.error("[getUnbilledTechnicianJobs]", message);
    return emptyResult(message);
  }
}

/**
 * รวบยอด JOB ที่เลือก → เอกสาร TB (ISSUED) แล้วผูก technician_bill_id
 * หนึ่งใบต่อช่างหนึ่งคน — ไม่บันทึกเป็น OPEX เพราะค่าแรงอยู่ใน COGS แล้ว
 */
export async function createTechnicianBill(
  input: CreateTechnicianBillInput,
): Promise<CreateTechnicianBillResult> {
  const technicianId = input.technicianId?.trim() ?? "";
  const jobIds = [
    ...new Set(
      (input.jobIds ?? [])
        .map((id) => id?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (!technicianId) {
    return { success: false, error: "ต้องเลือกช่างรับเหมาก่อนสร้างใบสรุปค่าแรง" };
  }
  if (jobIds.length === 0) {
    return { success: false, error: "ไม่มีใบสั่งผลิตที่พร้อมวางบิลตามตัวกรองนี้" };
  }

  let createdDocumentId: string | null = null;

  try {
    const supabase = createClient();

    const { data: technician, error: techError } = await supabase
      .from("contacts")
      .select("id, company_name, contact_roles, is_active")
      .eq("id", technicianId)
      .contains("contact_roles", ["Technician"])
      .maybeSingle();

    if (techError) {
      return {
        success: false,
        error: techError.message ?? "ตรวจสอบช่างรับเหมาไม่สำเร็จ",
      };
    }
    if (!technician || technician.is_active === false) {
      return {
        success: false,
        error: "ช่างรับเหมาต้องมีสถานะ Technician และยังใช้งานอยู่",
      };
    }

    const { data: jobs, error: jobsError } = await supabase
      .from("production_jobs")
      .select(
        `
        id,
        job_no,
        job_type,
        details,
        wage_cost,
        status,
        technician_id,
        technician_bill_id,
        document_id,
        documents!production_jobs_document_id_fkey ( doc_no )
      `,
      )
      .in("id", jobIds)
      .eq("technician_id", technicianId)
      .in("status", [...BILLABLE_JOB_STATUSES])
      .is("technician_bill_id", null)
      .gt("wage_cost", 0);

    if (jobsError) {
      return {
        success: false,
        error: jobsError.message ?? "ตรวจสอบใบสั่งผลิตไม่สำเร็จ",
      };
    }

    type JobForBill = {
      id: string;
      job_no: string;
      job_type: string | null;
      details: string | null;
      wage_cost: number | string | null;
      document_id: string | null;
      documents: DocumentJoin | DocumentJoin[] | null;
    };

    const eligible = (jobs ?? []) as JobForBill[];
    if (eligible.length !== jobIds.length) {
      return {
        success: false,
        error:
          "มีงานที่ไม่พร้อมวางบิล (คนละช่าง / ยังไม่เสร็จ / วางบิลแล้ว / ค่าแรงเป็น 0)",
      };
    }

    const documentIds = [
      ...new Set(
        eligible
          .map((row) => String(row.document_id ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const serviceByDoc = await loadServiceNameByDocumentId(supabase, documentIds);

    let totalWage = 0;
    const lineRows = eligible.map((job, index) => {
      const wage = roundMoney(toMoney(job.wage_cost));
      totalWage = roundMoney(totalWage + wage);
      const invoiceNo = unwrapJoin(job.documents)?.doc_no?.trim() || "—";
      const jobTypeLabel =
        JOB_TYPE_LABEL[String(job.job_type ?? "")] ?? "งานบริการ";
      const serviceName =
        (job.document_id ? serviceByDoc.get(job.document_id) : null) ||
        String(job.details ?? "").trim() ||
        jobTypeLabel;
      return {
        description: `${job.job_no} · ${invoiceNo} · ${serviceName}`,
        qty: 1,
        unit_price: wage,
        unit_cost_price: wage,
        line_total: wage,
        discount_amount: 0,
        sort_order: index + 1,
        uom_used: "งาน",
      };
    });

    if (totalWage <= 0) {
      return { success: false, error: "ยอดรวมค่าแรงต้องมากกว่า 0" };
    }

    const docDate = new Date().toISOString().slice(0, 10);
    const { data: docNoRaw, error: rpcError } = await supabase.rpc(
      "generate_document_no",
      {
        p_doc_type: "TB",
        p_doc_date: docDate,
      },
    );

    if (rpcError || typeof docNoRaw !== "string" || !docNoRaw.trim()) {
      return {
        success: false,
        error: rpcError?.message ?? "สร้างเลขที่เอกสาร TB ไม่สำเร็จ",
      };
    }

    const docNo = docNoRaw.trim();
    const nowIso = new Date().toISOString();
    const notes = `สรุปวางบิลช่าง · ${eligible.length} ใบงาน · ค่าแรงจริงจาก production_jobs.wage_cost`;

    const { data: document, error: insertError } = await supabase
      .from("documents")
      .insert({
        doc_no: docNo,
        doc_type: "TB",
        status: "ISSUED",
        doc_date: docDate,
        contact_id: technicianId,
        sub_total: totalWage,
        discount_amount: 0,
        tax_rate: 0,
        tax_amount: 0,
        grand_total: totalWage,
        vat_type: "NONE",
        vat_rate: 0,
        total_amount: totalWage,
        net_before_vat: totalWage,
        vat_amount: 0,
        notes,
        payment_status: "UNPAID",
        paid_amount: 0,
        is_voided: false,
        updated_at: nowIso,
      })
      .select("id, doc_no")
      .single();

    if (insertError || !document?.id) {
      return {
        success: false,
        error: insertError?.message ?? "บันทึกเอกสารสรุปวางบิลช่างไม่สำเร็จ",
      };
    }

    createdDocumentId = String(document.id);

    const { error: itemsError } = await supabase.from("document_items").insert(
      lineRows.map((row) => ({
        ...row,
        document_id: createdDocumentId!,
      })),
    );

    if (itemsError) {
      await supabase.from("documents").delete().eq("id", createdDocumentId);
      createdDocumentId = null;
      return {
        success: false,
        error: itemsError.message ?? "บันทึกรายการค่าแรงไม่สำเร็จ",
      };
    }

    const { data: stamped, error: stampError } = await supabase
      .from("production_jobs")
      .update({
        technician_bill_id: createdDocumentId,
        updated_at: nowIso,
      })
      .in("id", jobIds)
      .eq("technician_id", technicianId)
      .is("technician_bill_id", null)
      .select("id");

    if (stampError || !stamped || stamped.length !== jobIds.length) {
      await supabase.from("documents").delete().eq("id", createdDocumentId);
      createdDocumentId = null;
      return {
        success: false,
        error:
          stampError?.message ??
          "ผูกใบงานกับเอกสาร TB ไม่สำเร็จ — อาจมีผู้อื่นวางบิลไปแล้ว",
      };
    }

    revalidatePath("/finance/billing-notes");
    revalidatePath("/production/kanban");
    revalidatePath("/profit-analysis");
    revalidatePath("/dashboard");

    return {
      success: true,
      documentId: createdDocumentId,
      docNo: String(document.doc_no ?? docNo),
      jobCount: eligible.length,
      totalWage,
    };
  } catch (err) {
    if (createdDocumentId) {
      try {
        const supabase = createClient();
        await supabase
          .from("production_jobs")
          .update({ technician_bill_id: null })
          .eq("technician_bill_id", createdDocumentId);
        await supabase.from("documents").delete().eq("id", createdDocumentId);
      } catch {
        /* rollback best-effort */
      }
    }
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "สร้างใบสรุปค่าแรงไม่สำเร็จ",
    };
  }
}
