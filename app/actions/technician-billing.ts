"use server";

/**
 * Technician Billing (TB) — สรุปวางบิลช่าง ระดับ document_items
 * Zero Client-Side Fetching: supabaseAdmin (Service Role) only.
 * Types: `@/types/technician-billing`
 *
 * Ledger:
 * - Header → documents (doc_type = TB)
 * - Lines  → document_items ของเอกสาร TB (สรุปรายบรรทัดค่าแรง)
 * - Flag   → document_items.technician_bill_id บนบิลขายต้นทาง
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
 * บรรทัดงานบริการที่พร้อมสรุปวางบิลช่าง:
 * JOB = READY_TO_SHIP / DELIVERED + document_items มีช่าง + ค่าแรง + ยังไม่ถูก TB
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

    const { data: jobs, error: jobsError } = await supabase
      .from("production_jobs")
      .select("id, job_no, status, updated_at, document_id")
      .in("status", [...BILLABLE_JOB_STATUSES])
      .not("document_id", "is", null)
      .order("updated_at", { ascending: false });

    if (jobsError) {
      return emptyResult(
        jobsError.message ?? "ดึงใบสั่งผลิตไม่สำเร็จ",
        techniciansResult.data,
      );
    }

    type JobRow = {
      id: string;
      job_no: string;
      status: string;
      updated_at: string | null;
      document_id: string | null;
    };

    const billableJobs = ((jobs ?? []) as JobRow[]).filter((row) => {
      const deliveredOn = deliveredOnFromJob(row.updated_at);
      if (from && (!deliveredOn || deliveredOn < from)) return false;
      if (to && (!deliveredOn || deliveredOn > to)) return false;
      return Boolean(row.document_id);
    });

    const jobByDocument = new Map<string, JobRow>();
    for (const job of billableJobs) {
      const docId = String(job.document_id ?? "").trim();
      if (!docId || jobByDocument.has(docId)) continue;
      jobByDocument.set(docId, job);
    }

    const documentIds = [...jobByDocument.keys()];
    if (documentIds.length === 0) {
      return {
        success: true,
        rows: [],
        totalWage: 0,
        technicians: techniciansResult.data,
      };
    }

    let itemQuery = supabase
      .from("document_items")
      .select(
        `
        id,
        qty,
        description,
        wage_cost,
        technician_id,
        technician_bill_id,
        document_id,
        products!document_items_product_id_fkey (
          sku,
          name,
          short_name,
          product_models!products_model_id_fkey (
            name,
            short_name,
            model_code,
            is_service
          )
        ),
        technician:contacts!document_items_technician_id_fkey (
          id,
          company_name
        ),
        documents!document_items_document_id_fkey (
          id,
          doc_no
        )
      `,
      )
      .in("document_id", documentIds)
      .not("technician_id", "is", null)
      .is("technician_bill_id", null)
      .gt("wage_cost", 0)
      .order("sort_order", { ascending: true });

    if (technicianId) {
      itemQuery = itemQuery.eq("technician_id", technicianId);
    }

    const { data: items, error: itemsError } = await itemQuery;
    if (itemsError) {
      console.error("[getUnbilledTechnicianJobs]", itemsError.message);
      return emptyResult(
        itemsError.message ?? "ดึงรายการงานค้างวางบิลช่างไม่สำเร็จ",
        techniciansResult.data,
      );
    }

    type ItemRow = {
      id: string;
      qty: number | string | null;
      description: string | null;
      wage_cost: number | string | null;
      technician_id: string | null;
      document_id: string | null;
      products:
        | {
            sku?: string | null;
            name?: string | null;
            short_name?: string | null;
            product_models?: ServiceModelJoin | ServiceModelJoin[] | null;
          }
        | {
            sku?: string | null;
            name?: string | null;
            short_name?: string | null;
            product_models?: ServiceModelJoin | ServiceModelJoin[] | null;
          }[]
        | null;
      technician: ContactJoin | ContactJoin[] | null;
      documents: DocumentJoin | DocumentJoin[] | null;
    };

    const rows: TechnicianBillingJobRow[] = [];
    let totalWage = 0;

    for (const item of (items ?? []) as ItemRow[]) {
      const id = String(item.id ?? "").trim();
      const techId = String(item.technician_id ?? "").trim();
      const documentId = String(item.document_id ?? "").trim();
      const job = jobByDocument.get(documentId);
      if (!id || !techId || !job) continue;

      const wage = roundMoney(toMoney(item.wage_cost));
      totalWage = roundMoney(totalWage + wage);
      const product = unwrapJoin(item.products);
      const model = unwrapJoin(product?.product_models ?? null);
      const technician = unwrapJoin(item.technician);
      const doc = unwrapJoin(item.documents);
      const serviceName =
        String(model?.name ?? "").trim() ||
        String(model?.short_name ?? "").trim() ||
        String(product?.name ?? "").trim() ||
        String(item.description ?? "").trim() ||
        "งานบริการ";

      rows.push({
        id,
        job_no: String(job.job_no ?? "—"),
        status: String(job.status ?? ""),
        delivered_on: deliveredOnFromJob(job.updated_at),
        technician_id: techId,
        technician_name: technician?.company_name?.trim() || "ไม่ระบุชื่อช่าง",
        invoice_doc_no: doc?.doc_no?.trim() || null,
        sku: String(product?.sku ?? "").trim() || "—",
        service_name: serviceName,
        qty: Number(item.qty) || 0,
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
 * รวบยอดบรรทัด document_items ที่เลือก → เอกสาร TB แล้วผูก technician_bill_id
 */
export async function createTechnicianBill(
  input: CreateTechnicianBillInput,
): Promise<CreateTechnicianBillResult> {
  const technicianId = input.technicianId?.trim() ?? "";
  const itemIds = [
    ...new Set(
      (input.itemIds ?? [])
        .map((id) => id?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (!technicianId) {
    return { success: false, error: "ต้องเลือกช่างรับเหมาก่อนสร้างใบสรุปค่าแรง" };
  }
  if (itemIds.length === 0) {
    return { success: false, error: "ไม่มีรายการงานบริการที่พร้อมวางบิลตามตัวกรองนี้" };
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

    const { data: items, error: itemsError } = await supabase
      .from("document_items")
      .select(
        `
        id,
        qty,
        description,
        wage_cost,
        technician_id,
        technician_bill_id,
        document_id,
        products!document_items_product_id_fkey (
          sku,
          name,
          short_name
        ),
        documents!document_items_document_id_fkey (
          id,
          doc_no
        )
      `,
      )
      .in("id", itemIds)
      .eq("technician_id", technicianId)
      .is("technician_bill_id", null)
      .gt("wage_cost", 0);

    if (itemsError) {
      return {
        success: false,
        error: itemsError.message ?? "ตรวจสอบรายการงานบริการไม่สำเร็จ",
      };
    }

    type ItemForBill = {
      id: string;
      qty: number | string | null;
      description: string | null;
      wage_cost: number | string | null;
      document_id: string | null;
      products:
        | { sku?: string | null; name?: string | null; short_name?: string | null }
        | { sku?: string | null; name?: string | null; short_name?: string | null }[]
        | null;
      documents: DocumentJoin | DocumentJoin[] | null;
    };

    const eligible = (items ?? []) as ItemForBill[];
    if (eligible.length !== itemIds.length) {
      return {
        success: false,
        error:
          "มีรายการที่ไม่พร้อมวางบิล (คนละช่าง / วางบิลแล้ว / ค่าแรงเป็น 0)",
      };
    }

    const documentIds = [
      ...new Set(
        eligible
          .map((row) => String(row.document_id ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const { data: jobs, error: jobsError } = await supabase
      .from("production_jobs")
      .select("document_id, job_no, status")
      .in("document_id", documentIds)
      .in("status", [...BILLABLE_JOB_STATUSES]);

    if (jobsError) {
      return {
        success: false,
        error: jobsError.message ?? "ตรวจสอบสถานะใบสั่งผลิตไม่สำเร็จ",
      };
    }

    const jobByDocument = new Map<string, { job_no: string }>();
    for (const job of jobs ?? []) {
      const docId = String(job.document_id ?? "").trim();
      if (docId) jobByDocument.set(docId, { job_no: String(job.job_no ?? "—") });
    }
    for (const docId of documentIds) {
      if (!jobByDocument.has(docId)) {
        return {
          success: false,
          error: "มีรายการที่ใบสั่งผลิตยังไม่เสร็จหรือยังไม่ส่งมอบ",
        };
      }
    }

    let totalWage = 0;
    const lineRows = eligible.map((item, index) => {
      const wage = roundMoney(toMoney(item.wage_cost));
      totalWage = roundMoney(totalWage + wage);
      const product = unwrapJoin(item.products);
      const invoiceNo = unwrapJoin(item.documents)?.doc_no?.trim() || "—";
      const jobNo =
        jobByDocument.get(String(item.document_id ?? ""))?.job_no ?? "—";
      const sku = String(product?.sku ?? "").trim() || "—";
      const name =
        String(product?.name ?? "").trim() ||
        String(product?.short_name ?? "").trim() ||
        String(item.description ?? "").trim() ||
        "งานบริการ";
      return {
        description: `${jobNo} · ${invoiceNo} · ${sku} · ${name}`,
        qty: Number(item.qty) || 1,
        unit_price: wage,
        unit_cost_price: wage,
        line_total: wage,
        discount_amount: 0,
        sort_order: index + 1,
        uom_used: "จุด",
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
    const notes = `สรุปวางบิลช่าง · ${eligible.length} บรรทัด · ค่าแรงจาก document_items.wage_cost`;

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

    const { error: tbItemsError } = await supabase.from("document_items").insert(
      lineRows.map((row) => ({
        ...row,
        document_id: createdDocumentId!,
      })),
    );

    if (tbItemsError) {
      await supabase.from("documents").delete().eq("id", createdDocumentId);
      createdDocumentId = null;
      return {
        success: false,
        error: tbItemsError.message ?? "บันทึกรายการค่าแรงไม่สำเร็จ",
      };
    }

    const { data: stamped, error: stampError } = await supabase
      .from("document_items")
      .update({ technician_bill_id: createdDocumentId })
      .in("id", itemIds)
      .eq("technician_id", technicianId)
      .is("technician_bill_id", null)
      .select("id");

    if (stampError || !stamped || stamped.length !== itemIds.length) {
      await supabase
        .from("document_items")
        .delete()
        .eq("document_id", createdDocumentId);
      await supabase.from("documents").delete().eq("id", createdDocumentId);
      createdDocumentId = null;
      return {
        success: false,
        error:
          stampError?.message ??
          "ผูกบรรทัดงานกับเอกสาร TB ไม่สำเร็จ — อาจมีผู้อื่นวางบิลไปแล้ว",
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
          .from("document_items")
          .update({ technician_bill_id: null })
          .eq("technician_bill_id", createdDocumentId)
          .neq("document_id", createdDocumentId);
        await supabase
          .from("document_items")
          .delete()
          .eq("document_id", createdDocumentId);
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
