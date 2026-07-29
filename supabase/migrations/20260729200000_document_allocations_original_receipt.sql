-- Phase 5: track whether original paper receipt was received per allocation line
ALTER TABLE public.document_allocations
  ADD COLUMN IF NOT EXISTS original_receipt_received BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.document_allocations.original_receipt_received IS
  'True when the physical / original invoice-receipt document has been received for this allocation line.';

CREATE INDEX IF NOT EXISTS idx_doc_alloc_original_receipt
  ON public.document_allocations (original_receipt_received)
  WHERE original_receipt_received = false;
