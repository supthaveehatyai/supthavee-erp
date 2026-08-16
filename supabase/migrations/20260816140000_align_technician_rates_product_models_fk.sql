-- =============================================================================
-- Align technician_rates → Skill & Rate Card schema (Phase 13)
-- Root cause: Cloud/legacy table used contact_id + service_name (free text)
-- without FK to product_models, so PostgREST could not embed:
--   product_models!technician_rates_service_model_id_fkey
-- =============================================================================

-- 1) Ensure table exists (no-op if already present)
CREATE TABLE IF NOT EXISTS public.technician_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL,
  service_model_id UUID NOT NULL,
  default_wage NUMERIC(14, 4) NOT NULL DEFAULT 0
    CONSTRAINT technician_rates_default_wage_non_negative CHECK (default_wage >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) Add missing columns used by the app (safe on both old + new shapes)
ALTER TABLE public.technician_rates
  ADD COLUMN IF NOT EXISTS technician_id UUID,
  ADD COLUMN IF NOT EXISTS service_model_id UUID,
  ADD COLUMN IF NOT EXISTS default_wage NUMERIC(14, 4),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

-- Legacy columns may still exist: contact_id, service_name, cost_price, selling_price, is_active

-- 3) Backfill technician_id from legacy contact_id (if present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'technician_rates'
      AND column_name = 'contact_id'
  ) THEN
    EXECUTE $sql$
      UPDATE public.technician_rates
      SET technician_id = contact_id
      WHERE technician_id IS NULL
        AND contact_id IS NOT NULL
    $sql$;
  END IF;
END $$;

-- 4) Backfill default_wage from legacy cost_price (if present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'technician_rates'
      AND column_name = 'cost_price'
  ) THEN
    EXECUTE $sql$
      UPDATE public.technician_rates
      SET default_wage = COALESCE(default_wage, cost_price, 0)
      WHERE default_wage IS NULL
    $sql$;
  END IF;
END $$;

UPDATE public.technician_rates
SET default_wage = 0
WHERE default_wage IS NULL;

UPDATE public.technician_rates
SET created_at = COALESCE(created_at, now()),
    updated_at = COALESCE(updated_at, now())
WHERE created_at IS NULL
   OR updated_at IS NULL;

-- 5) Archive legacy free-text rows that cannot map to product_models
CREATE TABLE IF NOT EXISTS public.technician_rates_legacy_archive (
  LIKE public.technician_rates INCLUDING DEFAULTS
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'technician_rates'
      AND column_name = 'service_name'
  ) THEN
    -- Snapshot unmigratable rows (no service_model_id)
    EXECUTE $sql$
      INSERT INTO public.technician_rates_legacy_archive
      SELECT *
      FROM public.technician_rates
      WHERE service_model_id IS NULL
    $sql$;

    EXECUTE $sql$
      DELETE FROM public.technician_rates
      WHERE service_model_id IS NULL
    $sql$;
  ELSE
    -- No legacy service_name: drop rows that still lack service_model_id
    -- (empty table after create is fine; prevents NOT NULL failure)
    DELETE FROM public.technician_rates
    WHERE service_model_id IS NULL
       OR technician_id IS NULL;
  END IF;
END $$;

-- 6) Enforce NOT NULL on required columns (after cleanup)
ALTER TABLE public.technician_rates
  ALTER COLUMN technician_id SET NOT NULL,
  ALTER COLUMN service_model_id SET NOT NULL,
  ALTER COLUMN default_wage SET NOT NULL,
  ALTER COLUMN default_wage SET DEFAULT 0,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

-- 7) Drop / recreate FKs with stable names PostgREST embeds expect
ALTER TABLE public.technician_rates
  DROP CONSTRAINT IF EXISTS technician_rates_technician_id_fkey,
  DROP CONSTRAINT IF EXISTS technician_rates_service_model_id_fkey,
  DROP CONSTRAINT IF EXISTS technician_rates_contact_id_fkey;

ALTER TABLE public.technician_rates
  ADD CONSTRAINT technician_rates_technician_id_fkey
    FOREIGN KEY (technician_id)
    REFERENCES public.contacts(id)
    ON DELETE CASCADE;

ALTER TABLE public.technician_rates
  ADD CONSTRAINT technician_rates_service_model_id_fkey
    FOREIGN KEY (service_model_id)
    REFERENCES public.product_models(id)
    ON DELETE CASCADE;

-- 8) Unique pair for upsert onConflict
ALTER TABLE public.technician_rates
  DROP CONSTRAINT IF EXISTS technician_rates_technician_service_unique;

ALTER TABLE public.technician_rates
  ADD CONSTRAINT technician_rates_technician_service_unique
    UNIQUE (technician_id, service_model_id);

-- 9) Wage non-negative check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'technician_rates_default_wage_non_negative'
      AND conrelid = 'public.technician_rates'::regclass
  ) THEN
    ALTER TABLE public.technician_rates
      ADD CONSTRAINT technician_rates_default_wage_non_negative
      CHECK (default_wage >= 0);
  END IF;
END $$;

-- 10) Indexes
CREATE INDEX IF NOT EXISTS idx_technician_rates_technician_id
  ON public.technician_rates (technician_id);

CREATE INDEX IF NOT EXISTS idx_technician_rates_service_model_id
  ON public.technician_rates (service_model_id);

-- 11) Drop obsolete legacy columns (keep archive table for audit)
ALTER TABLE public.technician_rates
  DROP COLUMN IF EXISTS contact_id,
  DROP COLUMN IF EXISTS service_name,
  DROP COLUMN IF EXISTS cost_price,
  DROP COLUMN IF EXISTS selling_price,
  DROP COLUMN IF EXISTS is_active;

COMMENT ON TABLE public.technician_rates IS
  'เรตค่าแรงมาตรฐานของช่างรับเหมา แยกตามรุ่นงานบริการ (product_models.is_service)';
COMMENT ON COLUMN public.technician_rates.technician_id IS
  'contacts.id — Vendor หรือ Technician (FK technician_rates_technician_id_fkey)';
COMMENT ON COLUMN public.technician_rates.service_model_id IS
  'product_models.id ที่ is_service = true (FK technician_rates_service_model_id_fkey)';
COMMENT ON COLUMN public.technician_rates.default_wage IS
  'ค่าแรงมาตรฐาน (บาท) — ดึงลง production_jobs.wage_cost อัตโนมัติ';

ALTER TABLE public.technician_rates ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.technician_rates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.technician_rates TO authenticated;
