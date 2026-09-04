"use server";

/**
 * Technician Billing (TB) — สรุปวางบิลช่าง
 * รวม 2 แหล่งค่าแรง (Accrual Basis):
 *   A) SERVICE  → document_items (งานบริการลูกค้า / is_service)
 *   B) ROUTING  → production_job_operations (In-house Routing)
 *
 * Zero Client-Side Fetching: supabaseAdmin (Service Role) only.
 * Types: `@/types/technician-billing`
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server-admin";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { getActiveWhtRates } from "@/lib/actions/wht-rate-actions";
import { roundMoney } from "@/lib/utils/payment-fifo";
import type {
  CreateTechnicianBillInput,
  CreateTechnicianBillLineRef,
  CreateTechnicianBillResult,
  GetUnbilledTechnicianJobsInput,
  GetUnbilledTechnicianJobsResult,
  TechnicianBillingContact,
  TechnicianBillingJobRow,
  TechnicianBillingSourceType,
} from "@/types/technician-billing";

/** Kanban ERP status — Service Assignment วางบิลได้เมื่องานผลิตเสร็จ */
const BILLABLE_JOB_STATUS = "COMPLETED" as const;
/** In-house Routing — วางบิลเมื่อขั้นตอนเองเสร็จ */
const BILLABLE_OPERATION_STATUS = "COMPLETED" as const;

type AdminClient = ReturnType<typeof createClient>;

/** production_job_operations ยังไม่อยู่ใน generated Database types — bypass typed schema */
function operationsTable(supabase: AdminClient) {
  return (supabase as unknown as SupabaseClient).from(
    "production_job_operations",
  );
}

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

function inDateRange(
  deliveredOn: string | null,
  from: string,
  to: string,
): boolean {
  if (from && (!deliveredOn || deliveredOn < from)) return false;
  if (to && (!deliveredOn || deliveredOn > to)) return false;
  return true;
}

type ProductionJobBillRow = {
  id: string;
  job_no: string;
  status: string;
  updated_at: string | null;
  ref_document_id: string | null;
  finished_model_id: string | null;
};

function pickCompletedJobForServiceLine(
  jobs: ProductionJobBillRow[],
  serviceModelId: string | null,
): ProductionJobBillRow | null {
  if (jobs.length === 0) return null;
  const modelId = (serviceModelId ?? "").trim();
  if (modelId) {
    const matched = jobs.find(
      (job) => String(job.finished_model_id ?? "").trim() === modelId,
    );
    if (matched) return matched;
  }
  return jobs[0] ?? null;
}

function calculateTechnicianBillWht(
  totalWageCost: number,
  whtRate: number,
): { whtAmount: number; netAmount: number } {
  const base = roundMoney(Math.max(0, totalWageCost));
  const rate = Number.isFinite(whtRate) && whtRate > 0 ? whtRate : 0;
  const whtAmount = roundMoney(base * (rate / 100));
  const netAmount = roundMoney(Math.max(0, base - whtAmount));
  return { whtAmount, netAmount };
}

async function resolveTbWhtFromMaster(
  whtType: string | null | undefined,
  whtRateHint: number | null | undefined,
): Promise<
  | { ok: true; whtType: string | null; whtRate: number }
  | { ok: false; error: string }
> {
  const type = (whtType ?? "").trim();
  if (!type) {
    return { ok: true, whtType: null, whtRate: 0 };
  }

  const ratesResult = await getActiveWhtRates();
  if (ratesResult.error) {
    return { ok: false, error: ratesResult.error };
  }

  const match = ratesResult.data.find((row) => row.wht_name === type);
  if (!match) {
    return {
      ok: false,
      error: "ประเภทหัก ณ ที่จ่ายที่เลือกไม่ถูกต้องหรือถูกปิดใช้งานแล้ว",
    };
  }

  const masterRate = roundMoney(Number(match.wht_rate));
  const hintRate = roundMoney(Number(whtRateHint ?? 0));
  if (hintRate > 0 && Math.abs(hintRate - masterRate) > 0.001) {
    return {
      ok: false,
      error: "อัตราหัก ณ ที่จ่ายไม่ตรงกับ Master Data",
    };
  }

  return { ok: true, whtType: type, whtRate: masterRate };
}

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

function normalizeLineRefs(
  input: CreateTechnicianBillInput,
): CreateTechnicianBillLineRef[] {
  const seen = new Set<string>();
  const out: CreateTechnicianBillLineRef[] = [];
  for (const item of input.items ?? []) {
    const id = String(item?.id ?? "").trim();
    const source = String(item?.source_type ?? "").trim().toUpperCase();
    if (!id) continue;
    if (source !== "SERVICE" && source !== "ROUTING") continue;
    const key = `${source}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id,
      source_type: source as TechnicianBillingSourceType,
    });
  }
  return out;
}

/**
 * งานค้างวางบิลช่าง — รวม SERVICE + ROUTING เป็น unified rows
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
      return emptyResult(
        "วันที่เริ่มต้นต้องเป็นรูปแบบ YYYY-MM-DD",
        techniciansResult.data,
      );
    }
    if (to && !isIsoDate(to)) {
      return emptyResult(
        "วันที่สิ้นสุดต้องเป็นรูปแบบ YYYY-MM-DD",
        techniciansResult.data,
      );
    }

    const technicianNameById = new Map(
      techniciansResult.data.map((tech) => [tech.id, tech.company_name]),
    );

    // ── SOURCE A: Customer Services (document_items) ─────────────────────
    let serviceQuery = supabase
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
          model_id,
          product_models!products_model_id_fkey (
            id,
            name,
            short_name,
            model_code,
            is_service
          )
        ),
        documents!document_items_document_id_fkey (
          id,
          doc_no
        )
      `,
      )
      .not("technician_id", "is", null)
      .is("technician_bill_id", null)
      .gt("wage_cost", 0)
      .order("sort_order", { ascending: true });

    if (technicianId) {
      serviceQuery = serviceQuery.eq("technician_id", technicianId);
    }

    // ── SOURCE B: In-house Routing (production_job_operations) ───────────
    let routingQuery = operationsTable(supabase)
      .select(
        `
        id,
        job_id,
        operation_name,
        technician_id,
        wage_cost,
        technician_bill_id,
        status
      `,
      )
      .not("technician_id", "is", null)
      .is("technician_bill_id", null)
      .eq("status", BILLABLE_OPERATION_STATUS)
      .gt("wage_cost", 0)
      .order("id", { ascending: true });

    if (technicianId) {
      routingQuery = routingQuery.eq("technician_id", technicianId);
    }

    const [serviceRes, routingRes] = await Promise.all([
      serviceQuery,
      routingQuery,
    ]);

    if (serviceRes.error) {
      console.error("[getUnbilledTechnicianJobs] SERVICE", serviceRes.error.message);
      return emptyResult(
        serviceRes.error.message ?? "ดึงงานบริการค้างวางบิลไม่สำเร็จ",
        techniciansResult.data,
      );
    }
    if (routingRes.error) {
      console.error("[getUnbilledTechnicianJobs] ROUTING", routingRes.error.message);
      return emptyResult(
        routingRes.error.message ?? "ดึงขั้นตอน Routing ค้างวางบิลไม่สำเร็จ",
        techniciansResult.data,
      );
    }

    type ServiceItemRow = {
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
            model_id?: string | null;
            product_models?: ServiceModelJoin | ServiceModelJoin[] | null;
          }
        | {
            sku?: string | null;
            name?: string | null;
            short_name?: string | null;
            model_id?: string | null;
            product_models?: ServiceModelJoin | ServiceModelJoin[] | null;
          }[]
        | null;
      documents: DocumentJoin | DocumentJoin[] | null;
    };

    type RoutingOpRow = {
      id: string;
      job_id: string;
      operation_name: string | null;
      technician_id: string | null;
      wage_cost: number | string | null;
      status: string | null;
    };

    const serviceItemRows = ((serviceRes.data ?? []) as ServiceItemRow[]).filter(
      (row) => {
        const product = unwrapJoin(row.products);
        const model = unwrapJoin(product?.product_models ?? null);
        return model?.is_service === true;
      },
    );

    const routingOpRows = (routingRes.data ?? []) as unknown as RoutingOpRow[];

    const documentIds = [
      ...new Set(
        serviceItemRows
          .map((row) => String(row.document_id ?? "").trim())
          .filter(Boolean),
      ),
    ];

    const routingJobIds = [
      ...new Set(
        routingOpRows
          .map((row) => String(row.job_id ?? "").trim())
          .filter(Boolean),
      ),
    ];

    const jobsByDocument = new Map<string, ProductionJobBillRow[]>();
    const jobsById = new Map<string, ProductionJobBillRow>();

    const jobSelect =
      "id, job_no, status, updated_at, ref_document_id, finished_model_id";

    const [serviceJobsRes, routingJobsRes] = await Promise.all([
      documentIds.length > 0
        ? supabase
            .from("production_jobs")
            .select(jobSelect)
            .in("ref_document_id", documentIds)
            .eq("status", BILLABLE_JOB_STATUS)
            .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [] as ProductionJobBillRow[], error: null }),
      routingJobIds.length > 0
        ? supabase
            .from("production_jobs")
            .select(jobSelect)
            .in("id", routingJobIds)
        : Promise.resolve({ data: [] as ProductionJobBillRow[], error: null }),
    ]);

    if (serviceJobsRes.error) {
      return emptyResult(
        serviceJobsRes.error.message ?? "ดึงใบสั่งผลิต (SERVICE) ไม่สำเร็จ",
        techniciansResult.data,
      );
    }
    if (routingJobsRes.error) {
      return emptyResult(
        routingJobsRes.error.message ?? "ดึงใบสั่งผลิต (ROUTING) ไม่สำเร็จ",
        techniciansResult.data,
      );
    }

    for (const job of (serviceJobsRes.data ?? []) as ProductionJobBillRow[]) {
      const docId = String(job.ref_document_id ?? "").trim();
      if (!docId) continue;
      const deliveredOn = deliveredOnFromJob(job.updated_at);
      if (!inDateRange(deliveredOn, from, to)) continue;
      const mapped: ProductionJobBillRow = {
        id: String(job.id),
        job_no: String(job.job_no ?? "—"),
        status: String(job.status ?? ""),
        updated_at: job.updated_at ? String(job.updated_at) : null,
        ref_document_id: docId,
        finished_model_id: job.finished_model_id
          ? String(job.finished_model_id)
          : null,
      };
      const list = jobsByDocument.get(docId) ?? [];
      list.push(mapped);
      jobsByDocument.set(docId, list);
    }

    for (const job of (routingJobsRes.data ?? []) as ProductionJobBillRow[]) {
      const mapped: ProductionJobBillRow = {
        id: String(job.id),
        job_no: String(job.job_no ?? "—"),
        status: String(job.status ?? ""),
        updated_at: job.updated_at ? String(job.updated_at) : null,
        ref_document_id: job.ref_document_id
          ? String(job.ref_document_id)
          : null,
        finished_model_id: job.finished_model_id
          ? String(job.finished_model_id)
          : null,
      };
      jobsById.set(mapped.id, mapped);
    }

    const routingJobRefIds = [
      ...new Set(
        [...jobsById.values()]
          .map((job) => String(job.ref_document_id ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const soDocNoById = new Map<string, string>();
    if (routingJobRefIds.length > 0) {
      const { data: soDocs } = await supabase
        .from("documents")
        .select("id, doc_no")
        .in("id", routingJobRefIds);
      for (const doc of soDocs ?? []) {
        const id = String(doc.id ?? "").trim();
        if (!id) continue;
        soDocNoById.set(id, String(doc.doc_no ?? "").trim());
      }
    }

    const rows: TechnicianBillingJobRow[] = [];
    let totalWage = 0;

    // Map SOURCE A
    for (const item of serviceItemRows) {
      const id = String(item.id ?? "").trim();
      const techId = String(item.technician_id ?? "").trim();
      const documentId = String(item.document_id ?? "").trim();
      const product = unwrapJoin(item.products);
      const model = unwrapJoin(product?.product_models ?? null);
      const serviceModelId =
        String(model?.id ?? product?.model_id ?? "").trim() || null;

      const job = pickCompletedJobForServiceLine(
        jobsByDocument.get(documentId) ?? [],
        serviceModelId,
      );
      if (!id || !techId || !job) continue;

      const wage = roundMoney(toMoney(item.wage_cost));
      totalWage = roundMoney(totalWage + wage);
      const doc = unwrapJoin(item.documents);
      const serviceName =
        String(model?.name ?? "").trim() ||
        String(model?.short_name ?? "").trim() ||
        String(product?.name ?? "").trim() ||
        String(item.description ?? "").trim() ||
        "งานบริการ";
      const sku = String(product?.sku ?? "").trim() || "—";
      const invoiceNo = doc?.doc_no?.trim() || null;

      rows.push({
        id,
        job_id: String(job.id ?? ""),
        job_no: String(job.job_no ?? "—"),
        status: String(job.status ?? ""),
        delivered_on: deliveredOnFromJob(job.updated_at),
        technician_id: techId,
        technician_name:
          technicianNameById.get(techId) || "ไม่ระบุชื่อช่าง",
        invoice_doc_no: invoiceNo,
        sku,
        service_name: serviceName,
        description: `${job.job_no} · ${invoiceNo || "—"} · ${sku} · ${serviceName}`,
        qty: Number(item.qty) || 0,
        wage_cost: wage,
        source_type: "SERVICE",
      });
    }

    // Map SOURCE B
    for (const op of routingOpRows) {
      const id = String(op.id ?? "").trim();
      const techId = String(op.technician_id ?? "").trim();
      const jobId = String(op.job_id ?? "").trim();
      const job = jobsById.get(jobId);
      if (!id || !techId || !job) continue;

      const deliveredOn = deliveredOnFromJob(job.updated_at);
      if (!inDateRange(deliveredOn, from, to)) continue;

      const wage = roundMoney(toMoney(op.wage_cost));
      if (wage <= 0) continue;

      totalWage = roundMoney(totalWage + wage);
      const jobNo = String(job.job_no ?? "—").trim() || "—";
      const operationName =
        String(op.operation_name ?? "").trim() || "ขั้นตอนผลิต";
      const refDocId = String(job.ref_document_id ?? "").trim();
      const invoiceNo = refDocId ? soDocNoById.get(refDocId) || null : null;

      rows.push({
        id,
        job_id: job.id,
        job_no: jobNo,
        status: BILLABLE_OPERATION_STATUS,
        delivered_on: deliveredOn,
        technician_id: techId,
        technician_name:
          technicianNameById.get(techId) || "ไม่ระบุชื่อช่าง",
        invoice_doc_no: invoiceNo,
        sku: "ROUTING",
        service_name: operationName,
        description: `${jobNo} · ROUTING · ${operationName}`,
        qty: 1,
        wage_cost: wage,
        source_type: "ROUTING",
      });
    }

    rows.sort((a, b) => {
      const byJob = a.job_no.localeCompare(b.job_no);
      if (byJob !== 0) return byJob;
      return a.source_type.localeCompare(b.source_type);
    });

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
 * รวบยอดบรรทัดที่เลือก → เอกสาร TB
 * แล้ว stamp technician_bill_id ตาม source_type
 * (document_items และ/หรือ production_job_operations)
 */
export async function createTechnicianBill(
  input: CreateTechnicianBillInput,
): Promise<CreateTechnicianBillResult> {
  const technicianId = input.technicianId?.trim() ?? "";
  const lineRefs = normalizeLineRefs(input);

  if (!technicianId) {
    return { success: false, error: "ต้องเลือกช่างรับเหมาก่อนสร้างใบสรุปค่าแรง" };
  }
  if (lineRefs.length === 0) {
    return {
      success: false,
      error: "ไม่มีรายการที่พร้อมวางบิลตามตัวกรองนี้",
    };
  }

  const serviceIds = lineRefs
    .filter((row) => row.source_type === "SERVICE")
    .map((row) => row.id);
  const routingIds = lineRefs
    .filter((row) => row.source_type === "ROUTING")
    .map((row) => row.id);

  let createdDocumentId: string | null = null;
  let stampedService = false;
  let stampedRouting = false;

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

    type ServiceItemForBill = {
      id: string;
      qty: number | string | null;
      description: string | null;
      wage_cost: number | string | null;
      document_id: string | null;
      products:
        | {
            sku?: string | null;
            name?: string | null;
            short_name?: string | null;
            model_id?: string | null;
            product_models?: ServiceModelJoin | ServiceModelJoin[] | null;
          }
        | {
            sku?: string | null;
            name?: string | null;
            short_name?: string | null;
            model_id?: string | null;
            product_models?: ServiceModelJoin | ServiceModelJoin[] | null;
          }[]
        | null;
      documents: DocumentJoin | DocumentJoin[] | null;
    };

    type RoutingOpForBill = {
      id: string;
      job_id: string;
      operation_name: string | null;
      wage_cost: number | string | null;
      status: string | null;
    };

    let eligibleServices: ServiceItemForBill[] = [];
    let eligibleRouting: RoutingOpForBill[] = [];
    const serviceJobNoByItemId = new Map<string, string>();
    const routingJobNoByOpId = new Map<string, string>();

    if (serviceIds.length > 0) {
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
            short_name,
            model_id,
            product_models!products_model_id_fkey (
              id,
              name,
              short_name,
              is_service
            )
          ),
          documents!document_items_document_id_fkey (
            id,
            doc_no
          )
        `,
        )
        .in("id", serviceIds)
        .eq("technician_id", technicianId)
        .is("technician_bill_id", null)
        .gt("wage_cost", 0);

      if (itemsError) {
        return {
          success: false,
          error: itemsError.message ?? "ตรวจสอบรายการงานบริการไม่สำเร็จ",
        };
      }

      eligibleServices = ((items ?? []) as ServiceItemForBill[]).filter(
        (row) => {
          const product = unwrapJoin(row.products);
          const model = unwrapJoin(product?.product_models ?? null);
          return model?.is_service === true;
        },
      );

      if (eligibleServices.length !== serviceIds.length) {
        return {
          success: false,
          error:
            "มีรายการ SERVICE ที่ไม่พร้อมวางบิล (คนละช่าง / วางบิลแล้ว / ไม่ใช่งานบริการ / ค่าแรงเป็น 0)",
        };
      }

      const documentIds = [
        ...new Set(
          eligibleServices
            .map((row) => String(row.document_id ?? "").trim())
            .filter(Boolean),
        ),
      ];
      const { data: jobs, error: jobsError } = await supabase
        .from("production_jobs")
        .select(
          "id, ref_document_id, job_no, status, finished_model_id, updated_at",
        )
        .in("ref_document_id", documentIds)
        .eq("status", BILLABLE_JOB_STATUS);

      if (jobsError) {
        return {
          success: false,
          error: jobsError.message ?? "ตรวจสอบสถานะใบสั่งผลิตไม่สำเร็จ",
        };
      }

      const jobsByDocument = new Map<string, ProductionJobBillRow[]>();
      for (const job of (jobs ?? []) as ProductionJobBillRow[]) {
        const docId = String(job.ref_document_id ?? "").trim();
        if (!docId) continue;
        const list = jobsByDocument.get(docId) ?? [];
        list.push({
          id: String(job.id),
          job_no: String(job.job_no ?? "—"),
          status: String(job.status ?? ""),
          updated_at: job.updated_at ? String(job.updated_at) : null,
          ref_document_id: docId,
          finished_model_id: job.finished_model_id
            ? String(job.finished_model_id)
            : null,
        });
        jobsByDocument.set(docId, list);
      }

      for (const item of eligibleServices) {
        const documentId = String(item.document_id ?? "").trim();
        const product = unwrapJoin(item.products);
        const model = unwrapJoin(product?.product_models ?? null);
        const serviceModelId =
          String(model?.id ?? product?.model_id ?? "").trim() || null;
        const job = pickCompletedJobForServiceLine(
          jobsByDocument.get(documentId) ?? [],
          serviceModelId,
        );
        if (!job) {
          return {
            success: false,
            error:
              "มีรายการ SERVICE ที่ใบสั่งผลิตยังไม่เสร็จ (ต้องสถานะ COMPLETED)",
          };
        }
        serviceJobNoByItemId.set(String(item.id), job.job_no);
      }
    }

    if (routingIds.length > 0) {
      const { data: ops, error: opsError } = await operationsTable(supabase)
        .select(
          `
          id,
          job_id,
          operation_name,
          wage_cost,
          status,
          technician_id,
          technician_bill_id
        `,
        )
        .in("id", routingIds)
        .eq("technician_id", technicianId)
        .is("technician_bill_id", null)
        .eq("status", BILLABLE_OPERATION_STATUS)
        .gt("wage_cost", 0);

      if (opsError) {
        return {
          success: false,
          error: opsError.message ?? "ตรวจสอบขั้นตอน Routing ไม่สำเร็จ",
        };
      }

      eligibleRouting = (ops ?? []) as unknown as RoutingOpForBill[];
      if (eligibleRouting.length !== routingIds.length) {
        return {
          success: false,
          error:
            "มีรายการ ROUTING ที่ไม่พร้อมวางบิล (คนละช่าง / วางบิลแล้ว / ขั้นตอนยังไม่ COMPLETED / ค่าแรงเป็น 0)",
        };
      }

      const jobIds = [
        ...new Set(
          eligibleRouting
            .map((row) => String(row.job_id ?? "").trim())
            .filter(Boolean),
        ),
      ];
      const { data: jobs, error: jobsError } = await supabase
        .from("production_jobs")
        .select("id, job_no")
        .in("id", jobIds);

      if (jobsError) {
        return {
          success: false,
          error: jobsError.message ?? "ดึงใบสั่งผลิตของ Routing ไม่สำเร็จ",
        };
      }

      const jobNoById = new Map(
        (jobs ?? []).map((job) => [
          String(job.id),
          String(job.job_no ?? "—"),
        ]),
      );
      for (const op of eligibleRouting) {
        routingJobNoByOpId.set(
          String(op.id),
          jobNoById.get(String(op.job_id)) ?? "—",
        );
      }
    }

    // Build TB lines ตามลำดับที่ผู้ใช้เลือก
    const serviceById = new Map(
      eligibleServices.map((row) => [String(row.id), row]),
    );
    const routingById = new Map(
      eligibleRouting.map((row) => [String(row.id), row]),
    );

    let totalWage = 0;
    const lineRows: Array<{
      description: string;
      qty: number;
      unit_price: number;
      unit_cost_price: number;
      line_total: number;
      discount_amount: number;
      sort_order: number;
      uom_used: string;
    }> = [];

    for (const ref of lineRefs) {
      if (ref.source_type === "SERVICE") {
        const item = serviceById.get(ref.id);
        if (!item) continue;
        const wage = roundMoney(toMoney(item.wage_cost));
        totalWage = roundMoney(totalWage + wage);
        const product = unwrapJoin(item.products);
        const invoiceNo = unwrapJoin(item.documents)?.doc_no?.trim() || "—";
        const jobNo = serviceJobNoByItemId.get(String(item.id)) ?? "—";
        const sku = String(product?.sku ?? "").trim() || "—";
        const name =
          String(product?.name ?? "").trim() ||
          String(product?.short_name ?? "").trim() ||
          String(item.description ?? "").trim() ||
          "งานบริการ";
        lineRows.push({
          description: `${jobNo} · ${invoiceNo} · ${sku} · ${name}`,
          qty: Number(item.qty) || 1,
          unit_price: wage,
          unit_cost_price: wage,
          line_total: wage,
          discount_amount: 0,
          sort_order: lineRows.length + 1,
          uom_used: "จุด",
        });
        continue;
      }

      const op = routingById.get(ref.id);
      if (!op) continue;
      const wage = roundMoney(toMoney(op.wage_cost));
      totalWage = roundMoney(totalWage + wage);
      const jobNo = routingJobNoByOpId.get(String(op.id)) ?? "—";
      const opName =
        String(op.operation_name ?? "").trim() || "ขั้นตอนผลิต";
      lineRows.push({
        description: `${jobNo} · ROUTING · ${opName}`,
        qty: 1,
        unit_price: wage,
        unit_cost_price: wage,
        line_total: wage,
        discount_amount: 0,
        sort_order: lineRows.length + 1,
        uom_used: "งาน",
      });
    }

    if (lineRows.length !== lineRefs.length) {
      return {
        success: false,
        error: "มีรายการที่ไม่พร้อมวางบิล — รีเฟรชแล้วลองใหม่",
      };
    }

    if (totalWage <= 0) {
      return { success: false, error: "ยอดรวมค่าแรงต้องมากกว่า 0" };
    }

    const whtResolved = await resolveTbWhtFromMaster(
      input.whtType,
      input.whtRate,
    );
    if (!whtResolved.ok) {
      return { success: false, error: whtResolved.error };
    }

    const { whtAmount, netAmount } = calculateTechnicianBillWht(
      totalWage,
      whtResolved.whtRate,
    );

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
    const whtNote = whtResolved.whtType
      ? ` · หัก ณ ที่จ่าย ${whtResolved.whtType} ${whtResolved.whtRate}% (฿${whtAmount.toFixed(2)})`
      : "";
    const notes = `สรุปวางบิลช่าง · ${lineRows.length} บรรทัด · SERVICE ${serviceIds.length} · ROUTING ${routingIds.length}${whtNote}`;

    const owner = await requireSessionUserId();
    if (!owner.ok) {
      return { success: false, error: owner.error };
    }

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
        wht_rate: whtResolved.whtRate,
        wht_amount: whtAmount,
        grand_total: netAmount,
        vat_type: "NONE",
        vat_rate: 0,
        total_amount: netAmount,
        net_before_vat: totalWage,
        vat_amount: 0,
        notes,
        payment_status: "UNPAID",
        paid_amount: 0,
        is_voided: false,
        created_by: owner.userId,
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

    if (serviceIds.length > 0) {
      const { data: stamped, error: stampError } = await supabase
        .from("document_items")
        .update({ technician_bill_id: createdDocumentId })
        .in("id", serviceIds)
        .eq("technician_id", technicianId)
        .is("technician_bill_id", null)
        .select("id");

      if (stampError || !stamped || stamped.length !== serviceIds.length) {
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
            "ผูก SERVICE กับเอกสาร TB ไม่สำเร็จ — อาจมีผู้อื่นวางบิลไปแล้ว",
        };
      }
      stampedService = true;
    }

    if (routingIds.length > 0) {
      const { data: stamped, error: stampError } = await operationsTable(
        supabase,
      )
        .update({ technician_bill_id: createdDocumentId })
        .in("id", routingIds)
        .eq("technician_id", technicianId)
        .is("technician_bill_id", null)
        .eq("status", BILLABLE_OPERATION_STATUS)
        .select("id");

      if (stampError || !stamped || stamped.length !== routingIds.length) {
        if (stampedService) {
          await supabase
            .from("document_items")
            .update({ technician_bill_id: null })
            .in("id", serviceIds)
            .eq("technician_bill_id", createdDocumentId);
        }
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
            "ผูก ROUTING กับเอกสาร TB ไม่สำเร็จ — อาจมีผู้อื่นวางบิลไปแล้ว",
        };
      }
      stampedRouting = true;
    }

    revalidatePath("/finance/billing-notes");
    revalidatePath("/production/kanban");
    revalidatePath("/profit-analysis");
    revalidatePath("/dashboard");

    return {
      success: true,
      documentId: createdDocumentId,
      docNo: String(document.doc_no ?? docNo),
      jobCount: lineRows.length,
      totalWage,
      whtAmount,
      netAmount,
    };
  } catch (err) {
    if (createdDocumentId) {
      try {
        const supabase = createClient();
        if (stampedService && serviceIds.length > 0) {
          await supabase
            .from("document_items")
            .update({ technician_bill_id: null })
            .in("id", serviceIds)
            .eq("technician_bill_id", createdDocumentId);
        }
        if (stampedRouting && routingIds.length > 0) {
          await operationsTable(supabase)
            .update({ technician_bill_id: null })
            .in("id", routingIds)
            .eq("technician_bill_id", createdDocumentId);
        }
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
