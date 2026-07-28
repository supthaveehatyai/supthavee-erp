-- =============================================================================
-- Phase 4 — Add COMPLETED to document_status
-- =============================================================================
-- Used by issueDocument() when confirming a DRAFT sales document.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'document_status'
      AND e.enumlabel = 'COMPLETED'
  ) THEN
    ALTER TYPE public.document_status ADD VALUE 'COMPLETED';
  END IF;
END $$;

COMMENT ON TYPE public.document_status IS
  'Document lifecycle — DRAFT → COMPLETED / ISSUED → PAID | CANCELLED | VOID';
