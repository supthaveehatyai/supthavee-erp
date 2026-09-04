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
  estimated_completion_date: string | null;
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

/** Payload สร้างใบสั่งผลิต MTO + BOM Snapshot */
export type CreateProductionJobPayload = {
  finished_model_id: string;
  target_quantity: number | string;
  /** YYYY-MM-DD */
  estimated_completion_date: string;
};

export type CreateProductionJobResult = {
  success: boolean;
  error: string | null;
  data: {
    id: string;
    job_no: string;
    materials_count: number;
  } | null;
};

/** รุ่นสินค้าผลิตเอง (is_manufactured = true) สำหรับ Create MTO ComboBox */
export type ManufacturedModelOption = {
  id: string;
  model_code: string;
  name: string;
};

export type SearchManufacturedModelsResult =
  | { success: true; data: ManufacturedModelOption[] }
  | { success: false; error: string; data: ManufacturedModelOption[] };

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
