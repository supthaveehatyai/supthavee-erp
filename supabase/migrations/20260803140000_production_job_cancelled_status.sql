-- =============================================================================
-- Phase 7 — Production job CANCELLED lifecycle
-- =============================================================================
-- Adds CANCELLED to production_job_status enum (idempotent).
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'production_job_status'
      AND e.enumlabel = 'CANCELLED'
  ) THEN
    ALTER TYPE public.production_job_status ADD VALUE 'CANCELLED';
  END IF;
END $$;

COMMENT ON TYPE public.production_job_status IS
  'Phase 7 Production Kanban — workflow status (includes CANCELLED void state)';
