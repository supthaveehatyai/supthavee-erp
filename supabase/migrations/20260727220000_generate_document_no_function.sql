-- =============================================================================
-- Phase 4 — generate_document_no (race-safe running number)
-- =============================================================================
-- Format: {PREFIX}-{YYMM}-{XXXX}  e.g. INV-2607-0001
-- NOTE: column on public.documents is `doc_no` (not document_no).
-- p_doc_type is the running-number PREFIX (INV, QT, DO, …) — not the enum label.
-- =============================================================================

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
  v_prefix text;
BEGIN
  IF p_doc_type IS NULL OR btrim(p_doc_type) = '' THEN
    RAISE EXCEPTION 'p_doc_type is required';
  END IF;

  IF p_doc_date IS NULL THEN
    RAISE EXCEPTION 'p_doc_date is required';
  END IF;

  v_prefix := upper(btrim(p_doc_type));
  v_year_month := to_char(p_doc_date, 'YYMM');
  v_search_prefix := v_prefix || '-' || v_year_month || '-';

  -- Serialize concurrent callers for the same documents table.
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
  'Race-safe document running number: PREFIX-YYMM-XXXX (locks documents table)';

REVOKE ALL ON FUNCTION public.generate_document_no(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_document_no(text, date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_document_no(text, date) TO service_role;
