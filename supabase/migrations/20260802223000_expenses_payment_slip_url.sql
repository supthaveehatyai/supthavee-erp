-- =============================================================================
-- Phase 8 — Optional payment slip attachment on expenses
-- =============================================================================

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS payment_slip_url TEXT;

COMMENT ON COLUMN public.expenses.payment_slip_url IS
  'Public URL of optional bank transfer slip in expense_documents (SLIP-*)';
