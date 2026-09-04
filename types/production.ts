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

/** รายการ SKU/ไซส์ จาก Sales Order → production_job_items */
export type CreateProductionJobFromSOItem = {
  product_id: string;
  quantity: number | string;
};

/**
 * Payload สร้างใบสั่งผลิตจาก SO (Audit Trail ผ่าน ref_document_id)
 * Zero Human Error — ดึงจำนวน/SKU จากเอกสารขายโดยตรง
 */
export type CreateProductionJobFromSOPayload = {
  /** documents.id ของใบ SO */
  so_id: string;
  finished_model_id: string;
  mockup_image_url?: string | null;
  remark?: string | null;
  items: CreateProductionJobFromSOItem[];
  /** YYYY-MM-DD — optional */
  estimated_completion_date?: string | null;
};

export type CreateProductionJobFromSOResult = {
  success: boolean;
  error: string | null;
  data: {
    id: string;
    job_no: string;
    items_count: number;
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

/** กลุ่มรุ่นสินค้าผลิตเองบน SO สำหรับปุ่ม Send to Production */
export type ManufacturedSendGroup = {
  finished_model_id: string;
  model_code: string;
  model_name: string;
  mockup_image_url: string | null;
  items: CreateProductionJobFromSOItem[];
  already_sent: boolean;
  production_job_no: string | null;
};

/** รายการ SKU ในใบสั่งผลิต (production_job_items) */
export type ProductionJobDetailItem = {
  id: string;
  product_id: string;
  sku: string;
  product_name: string;
  size: string | null;
  color: string | null;
  quantity: number;
};

/** รายการวัตถุดิบ WIP (production_job_materials) */
export type ProductionJobDetailMaterial = {
  id: string;
  raw_material_model_id: string;
  raw_material_code: string;
  raw_material_name: string;
  uom_id: string;
  uom_code: string | null;
  planned_qty: number;
  cost_price_snapshot: number;
};

/**
 * บรรทัดงานบริการจาก document_items ของ SO (ref_document_id)
 * Phase 13 Subcontracting — บันทึก technician_id / wage_cost ที่นี่เพื่อให้ TB ตรวจจับได้
 */
export type ProductionJobServiceLine = {
  id: string;
  sku: string;
  name: string;
  qty: number;
  uom: string | null;
  color: string | null;
  size: string | null;
  description: string | null;
  model_id: string | null;
  technician_id: string | null;
  technician_name: string | null;
  wage_cost: number;
  technician_bill_id: string | null;
};

export type ProductionJobTechnicianOption = {
  id: string;
  company_name: string;
};

export type ProductionJobTechnicianRate = {
  technician_id: string;
  service_model_id: string;
  default_wage: number;
};

/** รายละเอียดใบสั่งผลิตสำหรับ Slide-over */
export type ProductionJobDetail = {
  id: string;
  job_no: string;
  status: ProductionKanbanStatus | string;
  finished_model_id: string | null;
  product_name: string;
  product_model_code: string | null;
  /** product_models.is_manufactured ของ finished model */
  is_manufactured: boolean;
  /** product_models.is_service ของ finished model */
  is_service: boolean;
  target_quantity: number;
  estimated_completion_date: string | null;
  ref_document_id: string | null;
  /** documents.doc_no ของ SO */
  so_doc_no: string | null;
  mockup_image_url: string | null;
  remark: string | null;
  items: ProductionJobDetailItem[];
  materials: ProductionJobDetailMaterial[];
  /** งานบริการในเอกสารต้นทาง (is_service) — สำหรับมอบหมายช่าง */
  service_lines: ProductionJobServiceLine[];
  technicians: ProductionJobTechnicianOption[];
  technician_rates: ProductionJobTechnicianRate[];
};

export type GetProductionJobDetailResult =
  | { success: true; data: ProductionJobDetail }
  | { success: false; error: string; data: null };

export const PRODUCTION_STATUS_LABEL: Record<ProductionKanbanStatus, string> = {
  PLANNED: "รอผลิต",
  IN_PROGRESS: "กำลังผลิต",
  QA: "ตรวจสอบคุณภาพ",
  COMPLETED: "เสร็จสิ้น",
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

/** Smart Routing — ส่งรายการ document_items เข้าผลิต (Service vs MTO) */
export type SendToProductionFlow = "SERVICE" | "MANUFACTURED";

export type SendToProductionResult = {
  success: boolean;
  error?: string;
  data?: {
    flow: SendToProductionFlow;
    document_item_id: string;
    document_id: string;
    job_id: string | null;
    job_no: string | null;
    materials_count: number;
  };
};

export type UploadDocumentItemMockupResult = {
  success: boolean;
  error?: string;
  data?: {
    document_item_id: string;
    mockup_image_url: string;
  };
};
