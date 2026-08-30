-- =============================================================================
-- Phase 15 — inventory_ledger.unit_cost (Landed Unit Cost per receipt line)
-- =============================================================================
-- Stores (line_net_amount + prorated_freight) / qty at goods receipt time.
-- Feeds Moving Average updates on products.cost_price (LPP).
-- =============================================================================

ALTER TABLE public.inventory_ledger
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14, 4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.inventory_ledger.unit_cost IS
  'Landed unit cost per line: (line_net_amount + prorated_freight) / qty at receipt.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_ledger_unit_cost_nonneg'
      AND conrelid = 'public.inventory_ledger'::regclass
  ) THEN
    ALTER TABLE public.inventory_ledger
      ADD CONSTRAINT inventory_ledger_unit_cost_nonneg
      CHECK (unit_cost >= 0);
  END IF;
END $$;
