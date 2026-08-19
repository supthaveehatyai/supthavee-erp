/**
 * Technician Billing (TB) — types for Billing Note tab 3.
 * Do NOT put these in `"use server"` files.
 */

export type BillingNotesTab = "BN" | "BR" | "TB";

export type TechnicianBillingContact = {
  id: string;
  company_name: string;
};

export type TechnicianBillingJobRow = {
  /** document_items.id */
  id: string;
  /** production_jobs.id — for linking to job detail */
  job_id: string;
  job_no: string;
  status: string;
  /** วันที่ส่งงาน (updated_at ของงานที่เสร็จ/ส่งมอบ) */
  delivered_on: string | null;
  technician_id: string;
  technician_name: string;
  invoice_doc_no: string | null;
  sku: string;
  service_name: string;
  qty: number;
  wage_cost: number;
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

export type CreateTechnicianBillInput = {
  technicianId: string;
  itemIds: string[];
};

export type CreateTechnicianBillResult =
  | { success: true; documentId: string; docNo: string; jobCount: number; totalWage: number }
  | { success: false; error: string };
