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
  id: string;
  job_no: string;
  status: string;
  /** วันที่ส่งงาน (updated_at ของงานที่เสร็จ/ส่งมอบ) */
  delivered_on: string | null;
  technician_id: string;
  technician_name: string;
  invoice_doc_no: string | null;
  service_name: string;
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
  jobIds: string[];
};

export type CreateTechnicianBillResult =
  | { success: true; documentId: string; docNo: string; jobCount: number; totalWage: number }
  | { success: false; error: string };
