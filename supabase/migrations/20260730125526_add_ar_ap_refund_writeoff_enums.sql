-- ==============================================================================
-- Phase 5 — Split Refund / Write-off by AR (Sales) vs AP (Purchases)
-- Created via: `supabase migration new add_ar_ap_refund_writeoff_enums`
--
-- New document_type values + running-number prefixes:
--   AR_REFUND   → SRF-YYMM-XXXX
--   AP_REFUND   → PRF-YYMM-XXXX
--   AR_WRITEOFF → SWO-YYMM-XXXX
--   AP_WRITEOFF → PWO-YYMM-XXXX
--
-- Legacy REFUND / WRITE_OFF (if present) still map to RFD / WRO for old docs.
-- ==============================================================================

ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'AR_REFUND';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'AP_REFUND';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'AR_WRITEOFF';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'AP_WRITEOFF';

COMMENT ON TYPE public.document_type IS
  'Sales: QT SO INV_DO TAX_INV CS_TAX ABB DEP_IN REC CN AR_REFUND AR_WRITEOFF | Purchases: PO AP_TAX AP_INV AP_CASH DEP_OUT PAY AP_REFUND AP_WRITEOFF | Legacy: REFUND WRITE_OFF';

CREATE OR REPLACE FUNCTION public.generate_document_no(
  p_doc_type text,
  p_doc_date date
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year_month text;
  v_search_prefix text;
  v_last_no text;
  v_next_seq integer;
  v_raw text;
  v_prefix text;
BEGIN
  IF p_doc_type IS NULL OR btrim(p_doc_type) = '' THEN
    RAISE EXCEPTION 'p_doc_type is required';
  END IF;

  IF p_doc_date IS NULL THEN
    RAISE EXCEPTION 'p_doc_date is required';
  END IF;

  v_raw := upper(btrim(p_doc_type));

  -- Map document_type enum labels → running-number prefixes.
  -- Raw prefixes (SRF, PRF, SWO, PWO, INV, …) pass through unchanged.
  v_prefix := CASE v_raw
    WHEN 'AR_REFUND' THEN 'SRF'
    WHEN 'AP_REFUND' THEN 'PRF'
    WHEN 'AR_WRITEOFF' THEN 'SWO'
    WHEN 'AP_WRITEOFF' THEN 'PWO'
    -- Legacy settlement types (kept for backward compatibility)
    WHEN 'REFUND' THEN 'RFD'
    WHEN 'WRITE_OFF' THEN 'WRO'
    ELSE v_raw
  END;

  v_year_month := to_char(p_doc_date, 'YYMM');
  v_search_prefix := v_prefix || '-' || v_year_month || '-';

  LOCK TABLE public.documents IN EXCLUSIVE MODE;

  SELECT d.doc_no
  INTO v_last_no
  FROM public.documents d
  WHERE d.doc_no LIKE v_search_prefix || '%'
  ORDER BY d.doc_no DESC
  LIMIT 1;

  IF v_last_no IS NULL THEN
    v_next_seq := 1;
  ELSE
    v_next_seq :=
      CAST(SUBSTRING(v_last_no FROM LENGTH(v_search_prefix) + 1) AS integer) + 1;
  END IF;

  IF v_next_seq > 9999 THEN
    RAISE EXCEPTION 'Document sequence for % exceeded 9999', v_search_prefix;
  END IF;

  RETURN v_search_prefix || LPAD(v_next_seq::text, 4, '0');
END;
$$;

COMMENT ON FUNCTION public.generate_document_no(text, date) IS
  'Race-safe PREFIX-YYMM-XXXX. Maps AR_REFUND→SRF, AP_REFUND→PRF, AR_WRITEOFF→SWO, AP_WRITEOFF→PWO (legacy REFUND→RFD, WRITE_OFF→WRO).';

REVOKE ALL ON FUNCTION public.generate_document_no(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_document_no(text, date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_document_no(text, date) TO service_role;
