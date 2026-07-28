-- =============================================================================
-- Phase 4 — Document Conversion: documents.ref_document_id
-- =============================================================================
-- Links a converted draft (e.g. INV_DO / TAX_INV) back to its source document
-- (typically a COMPLETED QT). ON DELETE SET NULL keeps child docs if source is
-- removed.
--
-- Note: Legacy column `ref_doc_id` remains for older inserts; new conversion
-- flow writes `ref_document_id`.
-- =============================================================================

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS ref_document_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'documents_ref_document_id_fkey'
      AND conrelid = 'public.documents'::regclass
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_ref_document_id_fkey
      FOREIGN KEY (ref_document_id)
      REFERENCES public.documents(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_documents_ref_document_id
  ON public.documents (ref_document_id);

COMMENT ON COLUMN public.documents.ref_document_id IS
  'Source document for conversion (e.g. QT → INV_DO / TAX_INV / ABB)';
