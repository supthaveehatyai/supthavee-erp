-- =============================================================================
-- Phase 4 — Document VAT / Bill Summary columns
-- =============================================================================
-- Enum: vat_calculation_type (NONE | INCLUSIVE | EXCLUSIVE)
-- Columns on documents: vat_type, vat_rate, total_amount, net_before_vat,
--                       vat_amount, discount_text
-- (discount_amount / grand_total / tax_* already exist — kept in sync by app)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'vat_calculation_type' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.vat_calculation_type AS ENUM (
      'NONE',
      'INCLUSIVE',
      'EXCLUSIVE'
    );
  END IF;
END $$;

COMMENT ON TYPE public.vat_calculation_type IS
  'Sales document VAT mode — NONE / INCLUSIVE (ราคารวม VAT) / EXCLUSIVE (ราคาไม่รวม VAT)';

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS vat_type public.vat_calculation_type NOT NULL DEFAULT 'EXCLUSIVE';

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5, 2) NOT NULL DEFAULT 7.00;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS net_before_vat DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS discount_text VARCHAR(50);

COMMENT ON COLUMN public.documents.vat_type IS
  'VAT calculation mode for this document';
COMMENT ON COLUMN public.documents.vat_rate IS
  'VAT rate percent (default 7.00)';
COMMENT ON COLUMN public.documents.total_amount IS
  'Sum of line totals before bill discount (subtotal)';
COMMENT ON COLUMN public.documents.net_before_vat IS
  'Amount after bill discount, before / excluding VAT depending on vat_type';
COMMENT ON COLUMN public.documents.vat_amount IS
  'Computed VAT amount';
COMMENT ON COLUMN public.documents.discount_text IS
  'Bill-level discount input e.g. 10% or 500';
