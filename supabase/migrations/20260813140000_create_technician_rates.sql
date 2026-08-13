-- =============================================================================
-- Phase 13 — Technician Skill & Rate Card
-- technician_rates: เรตค่าแรงมาตรฐานของช่าง แยกตามงานบริการ (product_models.is_service)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.technician_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  service_model_id UUID NOT NULL REFERENCES public.product_models(id) ON DELETE CASCADE,
  default_wage NUMERIC(14, 4) NOT NULL DEFAULT 0
    CONSTRAINT technician_rates_default_wage_non_negative CHECK (default_wage >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT technician_rates_technician_service_unique
    UNIQUE (technician_id, service_model_id)
);

COMMENT ON TABLE public.technician_rates IS
  'เรตค่าแรงมาตรฐานของช่างรับเหมา แยกตามรุ่นงานบริการ (product_models.is_service)';
COMMENT ON COLUMN public.technician_rates.technician_id IS
  'contacts.id — Vendor หรือ Technician';
COMMENT ON COLUMN public.technician_rates.service_model_id IS
  'product_models.id ที่ is_service = true';
COMMENT ON COLUMN public.technician_rates.default_wage IS
  'ค่าแรงมาตรฐาน (บาท) — ดึงลง production_jobs.wage_cost อัตโนมัติ';

CREATE INDEX IF NOT EXISTS idx_technician_rates_technician_id
  ON public.technician_rates (technician_id);

CREATE INDEX IF NOT EXISTS idx_technician_rates_service_model_id
  ON public.technician_rates (service_model_id);

ALTER TABLE public.technician_rates ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.technician_rates TO service_role;
