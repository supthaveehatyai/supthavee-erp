/**
 * Phase 7 — Production Kanban shared types (safe for Client + Server).
 */

import type { Database } from "@/src/types/supabase";

export type ProductionJobType =
  Database["public"]["Enums"]["production_job_type"];
export type ProductionJobStatus =
  Database["public"]["Enums"]["production_job_status"];

/** Active Kanban columns — CANCELLED is excluded from the board */
export const KANBAN_STATUSES = [
  "TODO",
  "IN_PROGRESS",
  "QC",
  "READY_TO_SHIP",
  "DELIVERED",
] as const satisfies readonly ProductionJobStatus[];

export type KanbanColumnStatus = (typeof KANBAN_STATUSES)[number];

export type ProductionJobCard = {
  id: string;
  job_no: string;
  job_type: ProductionJobType;
  status: ProductionJobStatus;
  due_date: string | null;
  details: string | null;
  /** Public URLs / storage paths of mockup images */
  attachment_paths: string[];
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
  TODO: "รอดำเนินการ",
  IN_PROGRESS: "กำลังทำ",
  QC: "ตรวจคุณภาพ",
  READY_TO_SHIP: "พร้อมส่งมอบ",
  DELIVERED: "ส่งมอบแล้ว",
  CANCELLED: "ยกเลิกแล้ว",
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
  /** เรตจาก technician_rates สำหรับ service_model ของงานนี้ */
  default_wage: number;
};

export type GetTechnicianOptionsResult =
  | { success: true; data: TechnicianOption[] }
  | { success: false; error: string; data: TechnicianOption[] };

export type UpdateProductionJobAssignmentInput = {
  job_id: string;
  technician_id: string | null;
  /** Manual override — ถ้าไม่ส่ง ระบบดึงจาก technician_rates */
  wage_cost?: number;
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
      service_model_id: null;
    };
