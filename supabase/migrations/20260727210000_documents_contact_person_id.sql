-- =============================================================================
-- Phase 4 — Ensure documents.contact_person_id exists
-- =============================================================================
-- The initial documents migration already included this column; this file is
-- idempotent for environments that may have been created without it.
-- =============================================================================

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS contact_person_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'documents_contact_person_id_fkey'
      AND conrelid = 'public.documents'::regclass
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_contact_person_id_fkey
      FOREIGN KEY (contact_person_id)
      REFERENCES public.contact_persons(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_documents_contact_person_id
  ON public.documents (contact_person_id);

COMMENT ON COLUMN public.documents.contact_person_id IS
  'Optional contact person for the selected customer/vendor (contacts → contact_persons)';
