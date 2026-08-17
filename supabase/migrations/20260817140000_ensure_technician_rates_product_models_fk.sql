-- =============================================================================
-- Ensure technician_rates → product_models FK (PostgREST embed)
-- Canonical column is service_model_id (this IS the product_models.id FK).
-- Do NOT add a second product_model_id column — dual FKs break PostgREST:
--   "Could not find a relationship between technician_rates and product_models"
-- Also backfill empty contacts.contact_roles for seed rows.
-- =============================================================================

ALTER TABLE public.technician_rates
  ADD COLUMN IF NOT EXISTS technician_id UUID,
  ADD COLUMN IF NOT EXISTS service_model_id UUID,
  ADD COLUMN IF NOT EXISTS default_wage NUMERIC(14, 4) DEFAULT 0;

-- Drop leftover rows that cannot satisfy NOT NULL / FK
DELETE FROM public.technician_rates
WHERE technician_id IS NULL
   OR service_model_id IS NULL
   OR service_model_id NOT IN (SELECT id FROM public.product_models)
   OR technician_id NOT IN (SELECT id FROM public.contacts);

ALTER TABLE public.technician_rates
  ALTER COLUMN technician_id SET NOT NULL,
  ALTER COLUMN service_model_id SET NOT NULL,
  ALTER COLUMN default_wage SET NOT NULL,
  ALTER COLUMN default_wage SET DEFAULT 0;

ALTER TABLE public.technician_rates
  DROP CONSTRAINT IF EXISTS technician_rates_technician_id_fkey,
  DROP CONSTRAINT IF EXISTS technician_rates_service_model_id_fkey,
  DROP CONSTRAINT IF EXISTS technician_rates_product_model_id_fkey;

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

CREATE INDEX IF NOT EXISTS idx_technician_rates_technician_id
  ON public.technician_rates (technician_id);

CREATE INDEX IF NOT EXISTS idx_technician_rates_service_model_id
  ON public.technician_rates (service_model_id);

COMMENT ON COLUMN public.technician_rates.service_model_id IS
  'FK → product_models(id) — รุ่นงานบริการ (product model id ของงาน is_service)';

-- Seed / legacy rows with null or empty contact_roles
UPDATE public.contacts
SET contact_roles = ARRAY['Customer']::VARCHAR[]
WHERE contact_roles IS NULL
   OR cardinality(contact_roles) = 0;

-- Reload PostgREST relationship cache (Supabase)
NOTIFY pgrst, 'reload schema';
