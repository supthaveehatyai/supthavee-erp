-- =============================================================================
-- Phase 8 — generate_expense_no: prefix from CURRENT_DATE (issue date)
-- =============================================================================
-- Keeps Late Numbering: this remains a callable RPC (NOT a BEFORE INSERT
-- trigger). Official EXP-YYMM-XXXX is assigned only when issueExpense() runs.
--
-- Change: YYMM prefix uses CURRENT_DATE (วันที่กดยืนยัน/ISSUE) instead of
-- p_expense_date / NEW.expense_date — so a draft created late in one month
-- but issued early next month lands in the correct accounting period sequence.
--
-- Locking: LOCK TABLE ... EXCLUSIVE MODE (same pattern as generate_document_no).
-- Do NOT use SELECT ... FOR UPDATE alone — empty result sets do not serialize
-- concurrent first-of-month issuers.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_expense_no(p_expense_date DATE DEFAULT NULL)
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix VARCHAR;
  v_running_no INT;
  v_new_doc_no VARCHAR;
BEGIN
  -- Prefix from CURRENT_DATE (issue / confirmation date), not expense_date.
  -- p_expense_date is retained for API compatibility with existing callers
  -- but is intentionally unused for the YYMM bucket.
  v_prefix := 'EXP-' || TO_CHAR(CURRENT_DATE, 'YYMM') || '-';

  -- Serialize concurrent issuers (Atomic Lock Table)
  LOCK TABLE public.expenses IN EXCLUSIVE MODE;

  SELECT COALESCE(MAX(CAST(SUBSTRING(document_no FROM 10 FOR 4) AS INT)), 0) + 1
  INTO v_running_no
  FROM public.expenses
  WHERE document_no LIKE v_prefix || '%';

  IF v_running_no > 9999 THEN
    RAISE EXCEPTION 'Expense sequence for % exceeded 9999', v_prefix;
  END IF;

  v_new_doc_no := v_prefix || LPAD(v_running_no::TEXT, 4, '0');
  RETURN v_new_doc_no;
END;
$$;

COMMENT ON FUNCTION public.generate_expense_no(DATE) IS
  'Late Numbering RPC: returns EXP-YYMM-XXXX using CURRENT_DATE for YYMM. '
  'Called only on ISSUE (not on DRAFT insert). Locks expenses table.';

REVOKE ALL ON FUNCTION public.generate_expense_no(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_expense_no(DATE) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_expense_no(DATE) TO service_role;
