"use server";

/**
 * Technician Billing (TB) — สรุปวางบิลช่าง ระดับ document_items
 * Zero Client-Side Fetching: supabaseAdmin (Service Role) only.
 * Types: `@/types/technician-billing`
 *
 * Pending criteria (schema Phase 13 + Kanban):
 * - document_items.technician_id IS NOT NULL
 * - document_items.technician_bill_id IS NULL
 * - product_models.is_service = true (via products → product_models)
 * - production_jobs.ref_document_id = documents.id
 * - production_jobs.status = 'COMPLETED'
 *
 * Ledger:
 * - Header → documents (doc_type = TB)
 * - Lines  → document_items ของเอกสาร TB (สรุปรายบรรทัดค่าแรง)
 * - Flag   → document_items.technician_bill_id บนบิลขายต้นทาง
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server-admin";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { getActiveWhtRates } from "@/lib/actions/wht-rate-actions";
import { roundMoney } from "@/lib/utils/payment-fifo";
import type {
  CreateTechnicianBillInput,
  CreateTechnicianBillResult,
  GetUnbilledTechnicianJobsInput,
  GetUnbilledTechnicianJobsResult,
  TechnicianBillingContact,
  TechnicianBillingJobRow,
} from "@/types/technician-billing";

/** Kanban ERP status — วางบิลช่างได้เมื่องานผลิตเสร็จเท่านั้น */
const BILLABLE_JOB_STATUS = "COMPLETED" as const;

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

type ProductionJobBillRow = {
  id: string;
  job_no: string;
  status: string;
  updated_at: string | null;
  ref_document_id: string | null;
  finished_model_id: string | null;
};

/**
 * เลือกใบสั่งผลิต COMPLETED ที่ผูก SO
 * — ถ้ามี finished_model_id ตรงรุ่นงานบริการ ให้ใช้ใบนั้นก่อน
 */
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

/** WHT on gross wage — net payable = total_wage_cost − wht_amount */
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
    return {
      ok: false,
      error: ratesResult.error,
    };
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

/**
 * บรรทัดงานบริการที่พร้อมสรุปวางบิลช่าง:
 * - technician_id IS NOT NULL + technician_bill_id IS NULL + wage_cost > 0
 * - product_models.is_service = true
 * - มี production_jobs (ref_document_id = SO) สถานะ COMPLETED
 */
export async function getUnbilledTechnicianJobs(
  input: GetUnbilledTechnicianJobsInput = {},
): Promise<GetUnbilledTechnicianJobsResult> {
  try {
    // Service Role — bypass RLS สำหรับ join ข้ามตาราง
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

    // Schema: is_service อยู่ที่ product_models (ไม่ใช่ products)
    const itemRows = ((items ?? []) as ItemRow[]).filter((row) => {
      const product = unwrapJoin(row.products);
      const model = unwrapJoin(product?.product_models ?? null);
      return model?.is_service === true;
    });

    const documentIds = [
      ...new Set(
        itemRows
          .map((row) => String(row.document_id ?? "").trim())
          .filter(Boolean),
      ),
    ];

    if (documentIds.length === 0) {
      return {
        success: true,
        rows: [],
        totalWage: 0,
        technicians: techniciansResult.data,
      };
    }

    // CRITICAL: production_jobs.ref_document_id → documents.id + status = COMPLETED
    const { data: jobs, error: jobsError } = await supabase
      .from("production_jobs")
      .select(
        "id, job_no, status, updated_at, ref_document_id, finished_model_id",
      )
      .in("ref_document_id", documentIds)
      .eq("status", BILLABLE_JOB_STATUS)
      .order("updated_at", { ascending: false });

    if (jobsError) {
      return emptyResult(
        jobsError.message ?? "ดึงใบสั่งผลิตไม่สำเร็จ",
        techniciansResult.data,
      );
    }

    const jobsByDocument = new Map<string, ProductionJobBillRow[]>();
    for (const job of (jobs ?? []) as ProductionJobBillRow[]) {
      const docId = String(job.ref_document_id ?? "").trim();
      if (!docId) continue;
      const deliveredOn = deliveredOnFromJob(job.updated_at);
      if (from && (!deliveredOn || deliveredOn < from)) continue;
      if (to && (!deliveredOn || deliveredOn > to)) continue;
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

    const technicianNameById = new Map(
      techniciansResult.data.map((tech) => [tech.id, tech.company_name]),
    );

    const rows: TechnicianBillingJobRow[] = [];
    let totalWage = 0;

    for (const item of itemRows) {
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

      rows.push({
        id,
        job_id: String(job.id ?? ""),
        job_no: String(job.job_no ?? "—"),
        status: String(job.status ?? ""),
        delivered_on: deliveredOnFromJob(job.updated_at),
        technician_id: techId,
        technician_name:
          technicianNameById.get(techId) || "ไม่ระบุชื่อช่าง",
        invoice_doc_no: doc?.doc_no?.trim() || null,
        sku: String(product?.sku ?? "").trim() || "—",
        service_name: serviceName,
        qty: Number(item.qty) || 0,
        wage_cost: wage,
      });
    }

    rows.sort((a, b) => a.job_no.localeCompare(b.job_no));

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

    const eligible = ((items ?? []) as ItemForBill[]).filter((row) => {
      const product = unwrapJoin(row.products);
      const model = unwrapJoin(product?.product_models ?? null);
      return model?.is_service === true;
    });
    if (eligible.length !== itemIds.length) {
      return {
        success: false,
        error:
          "มีรายการที่ไม่พร้อมวางบิล (คนละช่าง / วางบิลแล้ว / ไม่ใช่งานบริการ / ค่าแรงเป็น 0)",
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
      .select("id, ref_document_id, job_no, status, finished_model_id, updated_at")
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

    const jobByItemDocument = new Map<string, { job_no: string }>();
    for (const item of eligible) {
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
            "มีรายการที่ใบสั่งผลิตยังไม่เสร็จ (ต้องสถานะ COMPLETED ก่อนวางบิลช่าง)",
        };
      }
      jobByItemDocument.set(String(item.id), { job_no: job.job_no });
    }

    let totalWage = 0;
    const lineRows = eligible.map((item, index) => {
      const wage = roundMoney(toMoney(item.wage_cost));
      totalWage = roundMoney(totalWage + wage);
      const product = unwrapJoin(item.products);
      const invoiceNo = unwrapJoin(item.documents)?.doc_no?.trim() || "—";
      const jobNo = jobByItemDocument.get(String(item.id))?.job_no ?? "—";
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
    const notes = `สรุปวางบิลช่าง · ${eligible.length} บรรทัด · ค่าแรงจาก document_items.wage_cost${whtNote}`;

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
      whtAmount,
      netAmount,
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
