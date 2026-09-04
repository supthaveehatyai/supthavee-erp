/**
 * Production Kanban (MTO) — shared types.
 * Keep outside `"use server"` modules.
 * DB: production_jobs.status is VARCHAR — enforce via TS union only.
 */

export const PRODUCTION_KANBAN_STATUSES = [
  "PLANNED",
  "IN_PROGRESS",
  "QA",
  "COMPLETED",
] as const;

export type ProductionKanbanStatus =
  (typeof PRODUCTION_KANBAN_STATUSES)[number];

export type ProductionJobCard = {
  id: string;
  job_no: string;
  status: ProductionKanbanStatus;
  /** production_jobs.finished_model_id → product_models.id */
  finished_model_id: string | null;
  product_name: string;
  product_model_code: string | null;
  target_quantity: number;
  due_date: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ProductionJobsByStatus = Record<
  ProductionKanbanStatus,
  ProductionJobCard[]
>;

export type GetProductionJobsResult =
  | { success: true; data: ProductionJobsByStatus; flat: ProductionJobCard[] }
  | {
      success: false;
      error: string;
      data: ProductionJobsByStatus;
      flat: ProductionJobCard[];
    };

export type UpdateJobStatusResult = {
  success: boolean;
  error: string | null;
};

export function isProductionKanbanStatus(
  value: string,
): value is ProductionKanbanStatus {
  return (PRODUCTION_KANBAN_STATUSES as readonly string[]).includes(value);
}

export function emptyProductionBoard(): ProductionJobsByStatus {
  return {
    PLANNED: [],
    IN_PROGRESS: [],
    QA: [],
    COMPLETED: [],
  };
}
