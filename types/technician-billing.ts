/**
 * Technician Billing (TB) — types for Billing Note tab 3.
 * Do NOT put these in `"use server"` files.
 *
 * Accrual: ค่าแรงค้างจ่ายจาก 2 แหล่ง
 * - SERVICE  → document_items (งานบริการลูกค้า)
 * - ROUTING  → production_job_operations (In-house Routing)
 */

export type BillingNotesTab = "BN" | "BR" | "TB";

export type TechnicianBillingContact = {
  id: string;
  company_name: string;
};

/** แหล่งค่าแรงค้างวางบิล */
export type TechnicianBillingSourceType = "SERVICE" | "ROUTING";

export type TechnicianBillingJobRow = {
  /** document_items.id หรือ production_job_operations.id */
  id: string;
  /** production_jobs.id — ลิงก์ Job Detail */
  job_id: string;
  job_no: string;
  status: string;
  /** วันที่ส่งงาน / งานเสร็จ (จาก production_jobs.updated_at) */
  delivered_on: string | null;
  technician_id: string;
  technician_name: string;
  invoice_doc_no: string | null;
  sku: string;
  /** ชื่องานบริการ หรือชื่อขั้นตอน Routing */
  service_name: string;
  /** คำอธิบายมาตรฐานสำหรับ UI / TB line */
  description: string;
  qty: number;
  wage_cost: number;
  source_type: TechnicianBillingSourceType;
};

export type GetUnbilledTechnicianJobsInput = {
  technicianId?: string | null;
  from?: string | null;
  to?: string | null;
};

export type GetUnbilledTechnicianJobsResult =
  | {
      success: true;
      rows: TechnicianBillingJobRow[];
      totalWage: number;
      technicians: TechnicianBillingContact[];
    }
  | {
      success: false;
      error: string;
      rows: TechnicianBillingJobRow[];
      totalWage: number;
      technicians: TechnicianBillingContact[];
    };

/** อ้างอิงบรรทัดที่เลือกตอนสร้าง TB — แยกตารางตาม source_type */
export type CreateTechnicianBillLineRef = {
  id: string;
  source_type: TechnicianBillingSourceType;
};

export type CreateTechnicianBillInput = {
  technicianId: string;
  /** บรรทัดที่เลือก (SERVICE และ/หรือ ROUTING) */
  items: CreateTechnicianBillLineRef[];
  /** mst_wht_rates.wht_name — empty = no WHT */
  whtType?: string | null;
  /** Percent from master (client hint; server re-validates) */
  whtRate?: number | null;
};

export type CreateTechnicianBillResult =
  | {
      success: true;
      documentId: string;
      docNo: string;
      jobCount: number;
      totalWage: number;
      whtAmount: number;
      netAmount: number;
    }
  | { success: false; error: string };
