-- =============================================================================
-- Phase 14 — Data Archiving & Tiered Storage
-- ENUM storage_tier_type + columns on payment_slips / production_jobs
-- =============================================================================

-- 1) ENUM: CLOUD (hot) | NAS (cold archive)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'storage_tier_type' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.storage_tier_type AS ENUM ('CLOUD', 'NAS');
  END IF;
END $$;

COMMENT ON TYPE public.storage_tier_type IS
  'Phase 14 Tiered Storage — CLOUD = Supabase Storage (hot), NAS = archived off-cloud (cold)';

-- 2) payment_slips
ALTER TABLE public.payment_slips
  ADD COLUMN IF NOT EXISTS storage_tier public.storage_tier_type;

ALTER TABLE public.payment_slips
  ADD COLUMN IF NOT EXISTS nas_archive_url TEXT;

UPDATE public.payment_slips
SET storage_tier = 'CLOUD'
WHERE storage_tier IS NULL;

ALTER TABLE public.payment_slips
  ALTER COLUMN storage_tier SET DEFAULT 'CLOUD'::public.storage_tier_type;

ALTER TABLE public.payment_slips
  ALTER COLUMN storage_tier SET NOT NULL;

COMMENT ON COLUMN public.payment_slips.storage_tier IS
  'Tiered Storage — CLOUD = file still on Supabase Storage; NAS = archived to office NAS';
COMMENT ON COLUMN public.payment_slips.nas_archive_url IS
  'Absolute/relative path on NAS when storage_tier = NAS (e.g. document_attachments/2024/08/...)';

-- 3) production_jobs
ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS storage_tier public.storage_tier_type;

ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS nas_archive_url TEXT;

UPDATE public.production_jobs
SET storage_tier = 'CLOUD'
WHERE storage_tier IS NULL;

ALTER TABLE public.production_jobs
  ALTER COLUMN storage_tier SET DEFAULT 'CLOUD'::public.storage_tier_type;

ALTER TABLE public.production_jobs
  ALTER COLUMN storage_tier SET NOT NULL;

COMMENT ON COLUMN public.production_jobs.storage_tier IS
  'Tiered Storage — CLOUD = mockup attachments on Supabase; NAS = archived to office NAS';
COMMENT ON COLUMN public.production_jobs.nas_archive_url IS
  'NAS path(s) marker when storage_tier = NAS (cold production_attachments)';

-- 4) Partial indexes — archive job queries only rows still on CLOUD
CREATE INDEX IF NOT EXISTS idx_payment_slips_storage_tier_cloud
  ON public.payment_slips (storage_tier)
  WHERE storage_tier = 'CLOUD';

CREATE INDEX IF NOT EXISTS idx_production_jobs_storage_tier_cloud
  ON public.production_jobs (storage_tier)
  WHERE storage_tier = 'CLOUD';
