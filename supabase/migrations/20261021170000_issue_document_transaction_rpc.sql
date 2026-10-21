-- =============================================================================
-- issue_document_transaction
-- Atomic ISSUE for sales documents (issueDocument + completeDocument).
-- Late numbering, optional document_items insert, header update, and
-- inventory_ledger OUT rows commit or roll back together.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_document_transaction(
  p_document_id uuid,
  p_needs_official_no boolean,
  p_doc_prefix text,
  p_issue_date date,
  p_issued_status text,
  p_payment_status text,
  p_paid_amount numeric,
  p_approval_status text DEFAULT NULL,
  p_ledger_lines jsonb DEFAULT '[]'::jsonb,
  p_new_items jsonb DEFAULT NULL,
  p_sub_total numeric DEFAULT NULL,
  p_tax_amount numeric DEFAULT NULL,
  p_grand_total numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.documents%ROWTYPE;
  v_doc_no text;
  v_ledger_count integer := 0;
BEGIN
  IF p_document_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ไม่พบรหัสเอกสาร (document_id)'
    );
  END IF;

  IF p_issued_status IS NULL OR btrim(p_issued_status) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ไม่พบสถานะเอกสารที่ต้องการออก'
    );
  END IF;

  IF p_new_items IS NOT NULL AND jsonb_typeof(p_new_items) <> 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'p_new_items ต้องเป็น JSON array'
    );
  END IF;

  IF p_ledger_lines IS NOT NULL AND jsonb_typeof(p_ledger_lines) <> 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'p_ledger_lines ต้องเป็น JSON array'
    );
  END IF;

  -- Take the documents exclusive lock before the row lock so numbering
  -- cannot deadlock with another generate_document_no caller.
  IF COALESCE(p_needs_official_no, false) THEN
    IF p_doc_prefix IS NULL OR btrim(p_doc_prefix) = '' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'ไม่พบ prefix สำหรับเลขที่เอกสาร'
      );
    END IF;
    IF p_issue_date IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'ไม่พบวันที่ออกเอกสาร'
      );
    END IF;
    v_doc_no := public.generate_document_no(btrim(p_doc_prefix), p_issue_date);
  END IF;

  SELECT *
  INTO v_doc
  FROM public.documents
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ไม่พบเอกสารที่ระบุ'
    );
  END IF;

  IF v_doc.status <> 'DRAFT' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format(
        'เอกสาร %s ไม่ใช่สถานะ DRAFT (ปัจจุบัน: %s)',
        v_doc.doc_no,
        v_doc.status
      )
    );
  END IF;

  IF v_doc_no IS NULL OR btrim(v_doc_no) = '' THEN
    v_doc_no := v_doc.doc_no;
  END IF;

  IF p_new_items IS NOT NULL AND jsonb_array_length(p_new_items) > 0 THEN
    INSERT INTO public.document_items (
      document_id,
      product_id,
      description,
      qty,
      uom_used,
      unit_price,
      unit_cost_price,
      discount_text,
      discount_amount,
      line_total,
      sort_order
    )
    SELECT
      p_document_id,
      NULLIF(elem->>'product_id', '')::uuid,
      LEFT(COALESCE(elem->>'description', ''), 255),
      COALESCE((elem->>'qty')::numeric, 0),
      NULLIF(LEFT(COALESCE(elem->>'uom_used', ''), 50), ''),
      COALESCE((elem->>'unit_price')::numeric, 0),
      COALESCE((elem->>'unit_cost_price')::numeric, 0),
      NULLIF(LEFT(COALESCE(elem->>'discount_text', ''), 50), ''),
      COALESCE((elem->>'discount_amount')::numeric, 0),
      COALESCE((elem->>'line_total')::numeric, 0),
      COALESCE((elem->>'sort_order')::integer, 0)
    FROM jsonb_array_elements(p_new_items) AS elem;
  END IF;

  UPDATE public.documents
  SET
    status = p_issued_status::public.document_status,
    doc_no = v_doc_no,
    doc_date = CASE
      WHEN COALESCE(p_needs_official_no, false) THEN p_issue_date
      ELSE doc_date
    END,
    sub_total = COALESCE(p_sub_total, sub_total),
    tax_amount = COALESCE(p_tax_amount, tax_amount),
    grand_total = COALESCE(p_grand_total, grand_total),
    payment_status = COALESCE(NULLIF(btrim(p_payment_status), ''), payment_status),
    paid_amount = COALESCE(p_paid_amount, 0),
    approval_status = CASE
      WHEN p_approval_status IS NULL OR btrim(p_approval_status) = ''
        THEN approval_status
      ELSE p_approval_status::public.approval_status
    END,
    approved_by = NULL,
    approved_at = NULL,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = p_document_id
    AND status = 'DRAFT';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'อัปเดตสถานะเอกสารเป็น % ไม่สำเร็จ', p_issued_status;
  END IF;

  IF p_ledger_lines IS NOT NULL AND jsonb_array_length(p_ledger_lines) > 0 THEN
    INSERT INTO public.inventory_ledger (
      product_id,
      doc_header_id,
      document_id,
      trans_type,
      qty,
      notes
    )
    SELECT
      (elem->>'product_id')::uuid,
      NULL,
      p_document_id,
      'OUT',
      ROUND(COALESCE((elem->>'qty')::numeric, 0))::integer,
      LEFT(
        'ขายจากเอกสาร ' || v_doc_no
          || ' | document_id=' || p_document_id::text
          || CASE
               WHEN COALESCE(elem->>'notes_suffix', '') <> ''
                 THEN ' | ' || (elem->>'notes_suffix')
               ELSE ''
             END,
        255
      )
    FROM jsonb_array_elements(p_ledger_lines) AS elem
    WHERE NULLIF(elem->>'product_id', '') IS NOT NULL;

    GET DIAGNOSTICS v_ledger_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'doc_no', v_doc_no,
    'document_no', v_doc_no,
    'status', p_issued_status,
    'ledger_count', v_ledger_count,
    'error', NULL
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

COMMENT ON FUNCTION public.issue_document_transaction(
  uuid, boolean, text, date, text, text, numeric, text, jsonb, jsonb, numeric, numeric, numeric
) IS
  'Atomic sales issue: official number, optional lines, header status, inventory_ledger OUT.';

REVOKE ALL ON FUNCTION public.issue_document_transaction(
  uuid, boolean, text, date, text, text, numeric, text, jsonb, jsonb, numeric, numeric, numeric
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.issue_document_transaction(
  uuid, boolean, text, date, text, text, numeric, text, jsonb, jsonb, numeric, numeric, numeric
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
