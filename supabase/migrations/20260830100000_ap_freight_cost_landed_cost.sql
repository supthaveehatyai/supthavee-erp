-- =============================================================================
-- Phase 15 — AP Freight-In (Landed Cost) header column
-- =============================================================================
-- Stores inbound freight at document header level for AP goods receipt /
-- purchase documents (AP_TAX, AP_INV, AP_CASH). Server Actions apportion this
-- into inventory_ledger unit costs (Moving Average) at receipt time.
-- Primary ledger: documents. Legacy mirror: doc_headers (Goods Receipt path).
-- =============================================================================

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS freight_cost NUMERIC(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.documents.freight_cost IS
  'Inbound freight / shipping (ค่าขนส่งต้นทาง) — included in sub_total before VAT; apportioned to line unit costs on goods receipt.';

ALTER TABLE public.doc_headers
  ADD COLUMN IF NOT EXISTS freight_cost NUMERIC(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.doc_headers.freight_cost IS
  'Legacy mirror of documents.freight_cost for vendor invoice identity rows.';

-- Guard: freight cannot be negative
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_freight_cost_nonneg'
      AND conrelid = 'public.documents'::regclass
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_freight_cost_nonneg
      CHECK (freight_cost >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'doc_headers_freight_cost_nonneg'
      AND conrelid = 'public.doc_headers'::regclass
  ) THEN
    ALTER TABLE public.doc_headers
      ADD CONSTRAINT doc_headers_freight_cost_nonneg
      CHECK (freight_cost >= 0);
  END IF;
END $$;
