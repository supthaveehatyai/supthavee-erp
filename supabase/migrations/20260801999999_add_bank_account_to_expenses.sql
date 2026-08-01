-- =============================================================================
-- Phase 8 — Expenses: optional company bank account (for TRANSFER payments)
-- File: 20260801023932_add_bank_account_to_expenses.sql
-- =============================================================================

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS bank_account_id UUID
    REFERENCES public.mst_bank_accounts(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.expenses.bank_account_id IS
  'Optional company bank account used when payment_method = TRANSFER';

CREATE INDEX IF NOT EXISTS idx_expenses_bank_account_id
  ON public.expenses (bank_account_id);
