-- =============================================================================
-- Phase 8 — Withholding Tax (WHT) on expenses (GAAP / TFRS)
-- =============================================================================
-- net_payable = grand_total - wht_amount (enforced in Server Action guardrail)
-- =============================================================================

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS wht_type TEXT,
  ADD COLUMN IF NOT EXISTS wht_rate DECIMAL(5, 2) NOT NULL DEFAULT 0
    CHECK (wht_rate >= 0 AND wht_rate <= 100),
  ADD COLUMN IF NOT EXISTS wht_amount DECIMAL(15, 2) NOT NULL DEFAULT 0
    CHECK (wht_amount >= 0),
  ADD COLUMN IF NOT EXISTS net_payable DECIMAL(15, 2) NOT NULL DEFAULT 0
    CHECK (net_payable >= 0);

COMMENT ON COLUMN public.expenses.wht_type IS
  'Withholding tax category label (e.g. ค่าบริการ, ค่าขนส่ง, ค่าเช่า)';
COMMENT ON COLUMN public.expenses.wht_rate IS
  'WHT rate percent (e.g. 1, 2, 3, 5)';
COMMENT ON COLUMN public.expenses.wht_amount IS
  'WHT amount withheld from the payee';
COMMENT ON COLUMN public.expenses.net_payable IS
  'Cash to transfer: grand_total - wht_amount (Server Action verified)';

-- Backfill existing rows: no WHT → net_payable = grand_total
UPDATE public.expenses
SET
  wht_rate = COALESCE(wht_rate, 0),
  wht_amount = COALESCE(wht_amount, 0),
  net_payable = COALESCE(grand_total, 0) - COALESCE(wht_amount, 0)
WHERE net_payable IS DISTINCT FROM (COALESCE(grand_total, 0) - COALESCE(wht_amount, 0))
   OR wht_amount IS NULL
   OR wht_rate IS NULL;
