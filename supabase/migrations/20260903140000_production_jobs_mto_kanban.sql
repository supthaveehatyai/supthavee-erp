-- =============================================================================
-- Production Kanban (MTO) — product_model_id, target_quantity, new statuses
-- Additive: keeps legacy TODO/QC/READY_TO_SHIP/DELIVERED for old rows
-- =============================================================================

-- New board statuses (PG 15+ supports IF NOT EXISTS on enum values)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'production_job_status' AND e.enumlabel = 'PLANNED'
  ) THEN
    ALTER TYPE public.production_job_status ADD VALUE 'PLANNED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'production_job_status' AND e.enumlabel = 'QA'
  ) THEN
    ALTER TYPE public.production_job_status ADD VALUE 'QA';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'production_job_status' AND e.enumlabel = 'COMPLETED'
  ) THEN
    ALTER TYPE public.production_job_status ADD VALUE 'COMPLETED';
  END IF;
END $$;

ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS product_model_id UUID
    REFERENCES public.product_models(id) ON DELETE SET NULL;

ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS target_quantity NUMERIC(14, 4) NOT NULL DEFAULT 0
    CONSTRAINT production_jobs_target_quantity_non_negative
    CHECK (target_quantity >= 0);

COMMENT ON COLUMN public.production_jobs.product_model_id IS
  'รุ่นสินค้าสำเร็จรูป (MTO) → product_models.id — ใช้แสดงชื่อบน Kanban';
COMMENT ON COLUMN public.production_jobs.target_quantity IS
  'จำนวนที่สั่งผลิต (target qty)';

CREATE INDEX IF NOT EXISTS idx_production_jobs_product_model_id
  ON public.production_jobs (product_model_id);

CREATE INDEX IF NOT EXISTS idx_production_jobs_status_active
  ON public.production_jobs (status)
  WHERE COALESCE(is_archived, false) = false;
