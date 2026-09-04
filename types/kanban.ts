/**
 * Phase 7 — Production Kanban shared types (safe for Client + Server).
 */

import type { Database } from "@/src/types/supabase";
import type { StorageTier } from "@/types/storage-tier";

export type ProductionJobType =
  Database["public"]["Enums"]["production_job_type"];

/** ERP Standard — production_jobs.status (VARCHAR / TS union) */
export type ProductionJobStatus =
  | "PLANNED"
  | "IN_PROGRESS"
  | "QA"
  | "COMPLETED"
  | "CANCELLED";

/** Active Kanban columns — CANCELLED is excluded from the board */
export const KANBAN_STATUSES = [
  "PLANNED",
  "IN_PROGRESS",
  "QA",
  "COMPLETED",
] as const satisfies readonly ProductionJobStatus[];

export type KanbanColumnStatus = (typeof KANBAN_STATUSES)[number];

export type ProductionJobCard = {
  id: string;
  job_no: string;
  job_type: ProductionJobType;
  status: ProductionJobStatus;
  due_date: string | null;
  details: string | null;
  /** Raw Storage URLs (CLOUD) — keep for uploads / audit */
  attachment_paths: string[];
  /** Phase 14 Tiered Storage */
  storage_tier: StorageTier;
  nas_archive_url: string | null;
  /**
   * Display URLs resolved on Server (CLOUD → attachment_paths, NAS → nas_archive_url).
   * Client must render these — Zero Client-Side Fetching.
   */
  display_attachment_urls: string[];
  created_at: string | null;
  updated_at: string | null;
  document_id: string | null;
  /** documents.doc_no */
  document_no: string | null;
  /** contacts.company_name via documents.contact_id */
  customer_name: string | null;
  /** ช่างรับเหมา (contacts.id) */
  technician_id: string | null;
  technician_name: string | null;
  /** ค่าแรงช่าง — หักเป็น COGS */
  wage_cost: number;
};

export type ProductionJobsByStatus = Record<
  KanbanColumnStatus,
  ProductionJobCard[]
>;

export type GetProductionJobsResult =
  | { success: true; data: ProductionJobsByStatus; flat: ProductionJobCard[] }
  | { success: false; error: string };

export type UpdateJobStatusResult = {
  success: boolean;
  error: string | null;
};

export type CancelProductionJobResult = {
  success: boolean;
  error: string | null;
  data: { id: string; job_no: string } | null;
};

export type ProductionJobLineItem = {
  id: string;
  sku: string;
  name: string;
  qty: number;
  uom: string | null;
  color: string | null;
  size: string | null;
  description: string | null;
  model_id: string | null;
  is_service: boolean;
  technician_id: string | null;
  technician_name: string | null;
  wage_cost: number;
  technician_bill_id: string | null;
};

export type ProductionJobServiceModel = {
  id: string;
  model_code: string;
  name: string;
};

export type ProductionJobDetails = ProductionJobCard & {
  line_items: ProductionJobLineItem[];
  /** งานบริการหลักจากเอกสารต้นทาง (product_models.is_service) */
  service_model_id: string | null;
  service_model: ProductionJobServiceModel | null;
};

export type GetJobDetailsResult =
  | { success: true; data: ProductionJobDetails }
  | { success: false; error: string; data: null };

export const PRODUCTION_JOB_TYPES: ProductionJobType[] = [
  "SCREEN",
  "EMBROIDERY",
  "SEWING",
  "OTHER",
];

export const JOB_STATUS_LABEL: Record<ProductionJobStatus, string> = {
  PLANNED: "รอผลิต",
  IN_PROGRESS: "กำลังผลิต",
  QA: "ตรวจสอบคุณภาพ",
  COMPLETED: "เสร็จสิ้น",
  CANCELLED: "ยกเลิก",
};

export type CreateProductionJobInput = {
  document_id: string;
  job_type: string;
  due_date: string;
  details: string;
};

export type CreateProductionJobResult = {
  success: boolean;
  error: string | null;
  data: { id: string; job_no: string; attachment_count?: number } | null;
};

export type TechnicianOption = {
  id: string;
  company_name: string;
  contact_type: string;
  /** เรตจาก technician_rates — ใช้เมื่อ filter ตามรุ่นเดียว */
  default_wage: number;
};

export type TechnicianRateOption = {
  technician_id: string;
  service_model_id: string;
  default_wage: number;
};

export type GetTechnicianOptionsResult =
  | { success: true; data: TechnicianOption[]; rates: TechnicianRateOption[] }
  | { success: false; error: string; data: TechnicianOption[]; rates: TechnicianRateOption[] };

export type ProductionJobLineAssignment = {
  /** document_items.id */
  item_id?: string;
  /** alias ของ item_id */
  document_item_id?: string;
  technician_id: string | null;
  wage_cost: number;
};

export type UpdateProductionJobAssignmentInput = {
  job_id: string;
  lines: ProductionJobLineAssignment[];
};

export type UpdateProductionJobAssignmentResult = {
  success: boolean;
  error: string | null;
};

export type LookupTechnicianWageResult =
  | {
      success: true;
      default_wage: number;
      has_rate: boolean;
      service_model_id: string | null;
    }
  | {
      success: false;
      error: string;
      default_wage: number;
      has_rate: false;
      service_model_id: string | null;
    };
