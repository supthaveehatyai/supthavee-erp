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
};

export type ProductionJobDetails = ProductionJobCard & {
  line_items: ProductionJobLineItem[];
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
