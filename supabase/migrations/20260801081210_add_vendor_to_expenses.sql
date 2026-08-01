-- =============================================================================
-- Phase 8 — Expenses: link optional vendor (contacts)
-- File: 20260801081210_add_vendor_to_expenses.sql
-- =============================================================================

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS vendor_id UUID
    REFERENCES public.contacts(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.expenses.vendor_id IS
  'Optional vendor/payee contact (contacts.id) for expense provenance';

CREATE INDEX IF NOT EXISTS idx_expenses_vendor_id
  ON public.expenses (vendor_id);
