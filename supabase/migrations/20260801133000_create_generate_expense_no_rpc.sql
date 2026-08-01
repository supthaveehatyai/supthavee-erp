CREATE OR REPLACE FUNCTION public.generate_expense_no(p_expense_date DATE)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_prefix VARCHAR;
    v_year_month VARCHAR;
    v_running_no INT;
    v_new_doc_no VARCHAR;
BEGIN
    -- Format: EXP-YYMM
    v_year_month := TO_CHAR(p_expense_date, 'YYMM');
    v_prefix := 'EXP-' || v_year_month || '-';

    -- Lock table to prevent race condition
    LOCK TABLE public.expenses IN EXCLUSIVE MODE;

    -- Find the latest running number for this month
    SELECT COALESCE(MAX(CAST(SUBSTRING(document_no FROM 10 FOR 4) AS INT)), 0) + 1
    INTO v_running_no
    FROM public.expenses
    WHERE document_no LIKE v_prefix || '%';

    -- Construct new document number (e.g., EXP-2608-0001)
    v_new_doc_no := v_prefix || LPAD(v_running_no::VARCHAR, 4, '0');

    RETURN v_new_doc_no;
END;
$$;