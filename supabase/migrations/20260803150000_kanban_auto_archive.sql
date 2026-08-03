-- =============================================================================
-- Phase 7 — Kanban Auto-Archive (pg_cron)
-- =============================================================================
-- 1) production_jobs.is_archived — hide stale DELIVERED / CANCELLED from board
-- 2) Nightly cron (02:00 Asia/Bangkok ≈ 19:00 UTC) archives jobs older than 7 days
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------------
ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.production_jobs.is_archived IS
  'Auto-archived by pg_cron when DELIVERED/CANCELLED and updated_at older than 7 days';

CREATE INDEX IF NOT EXISTS idx_production_jobs_is_archived
  ON public.production_jobs (is_archived)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_production_jobs_archive_candidates
  ON public.production_jobs (status, updated_at)
  WHERE is_archived = false
    AND status IN ('DELIVERED', 'CANCELLED');

-- ---------------------------------------------------------------------------
-- 2. pg_cron extension + nightly archive job
--    Supabase: enable "pg_cron" in Dashboard → Database → Extensions if needed.
--    Cron schedule uses UTC. 19:00 UTC = 02:00 Asia/Bangkok.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotent reschedule: drop prior job by name if present
DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT j.jobid
    INTO existing_job_id
  FROM cron.job j
  WHERE j.jobname = 'kanban-auto-archive-jobs'
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    -- cron.job missing (extension not fully available) — schedule below may still fail loudly
    NULL;
  WHEN undefined_function THEN
    NULL;
END $$;

SELECT cron.schedule(
  'kanban-auto-archive-jobs',
  '0 19 * * *',
  $cron$
    UPDATE public.production_jobs
    SET
      is_archived = true,
      updated_at = NOW()
    WHERE is_archived = false
      AND status IN ('DELIVERED', 'CANCELLED')
      AND COALESCE(updated_at, created_at) < NOW() - INTERVAL '7 days';
  $cron$
);
