-- Phase 5: reference attachment URLs for REC (WHT cert) / PAY (original receipt)
-- Primary ledger: documents. Mirror on doc_headers for legacy PAY rows.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS wht_attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS original_receipt_url TEXT;

COMMENT ON COLUMN public.documents.wht_attachment_url IS
  'Scanned WHT certificate (50 ทวิ) URL — typically on REC when wht_amount > 0.';
COMMENT ON COLUMN public.documents.original_receipt_url IS
  'Scanned original vendor receipt / tax invoice URL — typically on PAY.';

ALTER TABLE public.doc_headers
  ADD COLUMN IF NOT EXISTS wht_attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS original_receipt_url TEXT;

COMMENT ON COLUMN public.doc_headers.wht_attachment_url IS
  'Legacy mirror of documents.wht_attachment_url.';
COMMENT ON COLUMN public.doc_headers.original_receipt_url IS
  'Legacy mirror of documents.original_receipt_url.';
