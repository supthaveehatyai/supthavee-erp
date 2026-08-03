/**
 * Phase 7 — Production Kanban shared types (safe for Client + Server).
 */

import type { Database } from "@/src/types/supabase";

export type ProductionJobType =
  Database["public"]["Enums"]["production_job_type"];
export type ProductionJobStatus =
  Database["public"]["Enums"]["production_job_status"];

export const KANBAN_STATUSES: ProductionJobStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "QC",
  "READY_TO_SHIP",
  "DELIVERED",
];

export type ProductionJobCard = {
  id: string;
  job_no: string;
  job_type: ProductionJobType;
  status: ProductionJobStatus;
  due_date: string | null;
  details: string | null;
  created_at: string | null;
  updated_at: string | null;
  document_id: string | null;
  /** documents.doc_no */
  document_no: string | null;
  /** contacts.company_name via documents.contact_id */
  customer_name: string | null;
};

export type ProductionJobsByStatus = Record<
  ProductionJobStatus,
  ProductionJobCard[]
>;

export type GetProductionJobsResult =
  | { success: true; data: ProductionJobsByStatus; flat: ProductionJobCard[] }
  | { success: false; error: string };

export type UpdateJobStatusResult = {
  success: boolean;
  error: string | null;
};

export const PRODUCTION_JOB_TYPES: ProductionJobType[] = [
  "SCREEN",
  "EMBROIDERY",
  "SEWING",
  "OTHER",
];

export type CreateProductionJobInput = {
  document_id: string;
  job_type: string;
  due_date: string;
  details: string;
};

export type CreateProductionJobResult = {
  success: boolean;
  error: string | null;
  data: { id: string; job_no: string } | null;
};
