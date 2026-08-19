-- Phase 14 — Cycle Counting & Stock Adjustment (STK_OB / STK_ADJ)
-- Ledger-driven inventory documents on public.documents + inventory_ledger

ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'STK_OB';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'STK_ADJ';

COMMENT ON TYPE public.document_type IS
  'ERP document types incl. STK_OB (opening balance) and STK_ADJ (stock adjustment)';

-- Internal inventory docs do not require a trading partner (contact).
ALTER TABLE public.documents
  ALTER COLUMN contact_id DROP NOT NULL;

COMMENT ON COLUMN public.documents.contact_id IS
  'Customer/Vendor FK — nullable for internal inventory docs (STK_OB, STK_ADJ)';
