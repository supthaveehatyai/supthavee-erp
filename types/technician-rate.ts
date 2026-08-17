/**
 * Technician Skill & Rate Card types.
 * Keep outside `"use server"` modules.
 */

export type ServiceModelOption = {
  id: string;
  model_code: string;
  name: string;
};

export type TechnicianRateRow = {
  id: string;
  technician_id: string;
  service_model_id: string;
  service_model_code: string;
  service_model_name: string;
  default_wage: number;
};

export type GetServiceModelsResult =
  | { success: true; data: ServiceModelOption[] }
  | { success: false; error: string; data: ServiceModelOption[] };

export type GetTechnicianRatesResult =
  | { success: true; data: TechnicianRateRow[] }
  | { success: false; error: string; data: TechnicianRateRow[] };

export type UpsertTechnicianRateInput = {
  technician_id: string;
  /** Canonical FK column on technician_rates → product_models.id */
  service_model_id?: string;
  /** Alias of service_model_id (product_models.id) */
  product_model_id?: string;
  default_wage: number;
};

export type MutateTechnicianRateResult = {
  success: boolean;
  error: string | null;
};
