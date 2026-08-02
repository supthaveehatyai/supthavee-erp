-- =============================================================================
-- Phase 8 — Prevent duplicate expense bills (vendor + bill date + vendor doc no)
-- =============================================================================
-- Composite uniqueness mirrors Procurement Duplicate Invoice Early Warning:
--   vendor_id + expense_date + vendor_doc_no
-- Internal Late Numbering (`document_no` = DRAFT-/EXP-) is separate.
-- VOID rows are excluded so a cancelled bill can be re-entered.
-- =============================================================================

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS vendor_doc_no TEXT;

COMMENT ON COLUMN public.expenses.vendor_doc_no IS
  'Vendor/payee bill number printed on the receipt (OCR document_number). '
  'Distinct from internal document_no (DRAFT-/EXP-).';

CREATE INDEX IF NOT EXISTS idx_expenses_vendor_doc_no
  ON public.expenses (vendor_doc_no)
  WHERE vendor_doc_no IS NOT NULL AND vendor_doc_no <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_duplicate_prevent
  ON public.expenses (vendor_id, expense_date, vendor_doc_no)
  WHERE vendor_id IS NOT NULL
    AND vendor_doc_no IS NOT NULL
    AND vendor_doc_no <> ''
    AND status <> 'VOID';
