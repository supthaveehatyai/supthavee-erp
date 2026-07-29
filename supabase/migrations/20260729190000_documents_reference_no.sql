-- Phase 5: vendor invoice reference on purchase documents
-- Enables AP search OR (doc_no / reference_no) and dual display on Knock-off.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS reference_no TEXT;

COMMENT ON COLUMN public.documents.reference_no IS
  'Vendor / supplier invoice number (external). Internal running number remains doc_no.';

CREATE INDEX IF NOT EXISTS idx_documents_reference_no
  ON public.documents (reference_no)
  WHERE reference_no IS NOT NULL;

-- Backfill from notes written by Goods Receipt / Manual Receipt
UPDATE public.documents
SET reference_no = NULLIF(
  trim(
    both
    FROM regexp_replace(notes, '.*อ้างอิงบิลซัพพลายเออร์:\s*', '')
  ),
  ''
)
WHERE reference_no IS NULL
  AND notes IS NOT NULL
  AND notes LIKE '%อ้างอิงบิลซัพพลายเออร์:%';
