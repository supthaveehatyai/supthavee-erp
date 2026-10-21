BEGIN;

CREATE OR REPLACE FUNCTION public.get_on_hand_qty_by_product_ids(
  p_product_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  product_id UUID,
  on_hand_qty NUMERIC,
  movement_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    il.product_id,
    COALESCE(
      SUM(
        CASE
          WHEN UPPER(BTRIM(COALESCE(il.trans_type, ''))) = 'IN'
            THEN ABS(COALESCE(il.qty, 0))
          WHEN UPPER(BTRIM(COALESCE(il.trans_type, ''))) = 'OUT'
            THEN -ABS(COALESCE(il.qty, 0))
          ELSE COALESCE(il.qty, 0)
        END
      ),
      0
    )::NUMERIC AS on_hand_qty,
    COUNT(*)::BIGINT AS movement_count
  FROM public.inventory_ledger il
  WHERE il.product_id IS NOT NULL
    AND (p_product_ids IS NULL OR il.product_id = ANY(p_product_ids))
  GROUP BY il.product_id;
$$;

REVOKE ALL ON FUNCTION public.get_on_hand_qty_by_product_ids(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_on_hand_qty_by_product_ids(UUID[]) TO service_role;

ALTER TABLE public.doc_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doc_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technician_rates_legacy_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mst_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_note_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.doc_headers,
  public.doc_details,
  public.technician_rates_legacy_archive,
  public.mst_bank_accounts,
  public.payment_transactions,
  public.document_allocations,
  public.billing_note_items,
  public.payment_allocations
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.doc_headers,
  public.doc_details,
  public.technician_rates_legacy_archive,
  public.mst_bank_accounts,
  public.payment_transactions,
  public.document_allocations,
  public.billing_note_items,
  public.payment_allocations
TO service_role;

DROP POLICY IF EXISTS "Allow All on mst_bank_accounts" ON public.mst_bank_accounts;
DROP POLICY IF EXISTS "mst_bank_accounts_service_role_all" ON public.mst_bank_accounts;
CREATE POLICY "mst_bank_accounts_service_role_all"
  ON public.mst_bank_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow All on payment_transactions" ON public.payment_transactions;
DROP POLICY IF EXISTS "payment_transactions_service_role_all" ON public.payment_transactions;
CREATE POLICY "payment_transactions_service_role_all"
  ON public.payment_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow All on document_allocations" ON public.document_allocations;
DROP POLICY IF EXISTS "document_allocations_service_role_all" ON public.document_allocations;
CREATE POLICY "document_allocations_service_role_all"
  ON public.document_allocations FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to delete billing_note_items" ON public.billing_note_items;
DROP POLICY IF EXISTS "Allow authenticated users to insert billing_note_items" ON public.billing_note_items;
DROP POLICY IF EXISTS "Allow authenticated users to read billing_note_items" ON public.billing_note_items;
DROP POLICY IF EXISTS "Allow authenticated users to update billing_note_items" ON public.billing_note_items;
DROP POLICY IF EXISTS "billing_note_items_service_role_all" ON public.billing_note_items;
CREATE POLICY "billing_note_items_service_role_all"
  ON public.billing_note_items FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "erp_authenticated_access_payment_allocations" ON public.payment_allocations;
DROP POLICY IF EXISTS "payment_allocations_service_role_all" ON public.payment_allocations;
CREATE POLICY "payment_allocations_service_role_all"
  ON public.payment_allocations FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "doc_headers_service_role_all" ON public.doc_headers;
CREATE POLICY "doc_headers_service_role_all"
  ON public.doc_headers FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "doc_details_service_role_all" ON public.doc_details;
CREATE POLICY "doc_details_service_role_all"
  ON public.doc_details FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "technician_rates_legacy_archive_service_role_all" ON public.technician_rates_legacy_archive;
CREATE POLICY "technician_rates_legacy_archive_service_role_all"
  ON public.technician_rates_legacy_archive FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER VIEW public.vw_carrier_freight_summary SET (security_invoker = true);
REVOKE ALL ON TABLE public.vw_carrier_freight_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_carrier_freight_summary TO service_role;

ALTER TABLE public.inventory_ledger
  ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL;

WITH extracted AS (
  SELECT
    il.id AS ledger_id,
    (regexp_match(il.notes, 'document_id=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'))[1]::UUID AS parsed_doc_id
  FROM public.inventory_ledger il
  WHERE il.document_id IS NULL
    AND il.notes ~ 'document_id=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
)
UPDATE public.inventory_ledger il
SET document_id = e.parsed_doc_id
FROM extracted e
JOIN public.documents d ON d.id = e.parsed_doc_id
WHERE il.id = e.ledger_id;

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_document_id
  ON public.inventory_ledger (document_id)
  WHERE document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_product_agg
  ON public.inventory_ledger (product_id)
  INCLUDE (trans_type, qty);

CREATE INDEX IF NOT EXISTS idx_products_active_sku
  ON public.products (is_active, sku);

NOTIFY pgrst, 'reload schema';

COMMIT;
