-- =============================================================================
-- save_manual_goods_receipt_transaction
-- Atomic manual goods receipt: documents, document_items, inventory_ledger IN,
-- and products.cost_price. Numbering, landed cost, and moving average are
-- prepared by the Server Action and committed here in one transaction.
-- Ledger posts only when p_should_post_ledger is true (ISSUED / PAID).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.save_manual_goods_receipt_transaction(
  p_should_post_ledger boolean,
  p_running_prefix text,
  p_draft_doc_no text,
  p_doc_date date,
  p_document_ref text,
  p_header jsonb,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_ledger_lines jsonb DEFAULT '[]'::jsonb,
  p_cost_updates jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc_no text;
  v_doc_id uuid;
  v_ledger_count integer := 0;
  v_updated integer := 0;
BEGIN
  IF p_header IS NULL OR jsonb_typeof(p_header) <> 'object' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'p_header ต้องเป็น JSON object'
    );
  END IF;
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'p_items ต้องเป็น JSON array'
    );
  END IF;
  IF p_ledger_lines IS NOT NULL AND jsonb_typeof(p_ledger_lines) <> 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'p_ledger_lines ต้องเป็น JSON array'
    );
  END IF;
  IF p_cost_updates IS NOT NULL AND jsonb_typeof(p_cost_updates) <> 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'p_cost_updates ต้องเป็น JSON array'
    );
  END IF;
  IF NULLIF(btrim(COALESCE(p_header->>'contact_id', '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ไม่พบผู้จำหน่าย (Vendor)');
  END IF;
  IF p_doc_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ไม่พบวันที่เอกสาร');
  END IF;

  IF COALESCE(p_should_post_ledger, false) THEN
    IF p_running_prefix IS NULL OR btrim(p_running_prefix) = '' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'ไม่พบ prefix สำหรับเลขที่เอกสารรับสินค้า'
      );
    END IF;
    v_doc_no := public.generate_document_no(btrim(p_running_prefix), p_doc_date);
  ELSE
    v_doc_no := NULLIF(btrim(COALESCE(p_draft_doc_no, '')), '');
    IF v_doc_no IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'ไม่พบเลขที่เอกสารชั่วคราว'
      );
    END IF;
  END IF;

  INSERT INTO public.documents (
    doc_no,
    doc_type,
    status,
    doc_date,
    contact_id,
    contact_person_id,
    sub_total,
    discount_amount,
    tax_rate,
    tax_amount,
    grand_total,
    freight_cost,
    freight_tax_mode,
    freight_paid_separately,
    separate_freight_amount,
    billing_note_eligible_amount,
    dest_freight_cost,
    carrier_id,
    carrier_tracking_no,
    dest_freight_paid_status,
    carrier_receipt_status,
    carrier_receipt_no,
    carrier_receipt_date,
    vat_type,
    vat_rate,
    total_amount,
    net_before_vat,
    vat_amount,
    discount_text,
    payment_status,
    paid_amount,
    notes,
    created_by,
    updated_at
  ) VALUES (
    v_doc_no,
    (p_header->>'doc_type')::public.document_type,
    COALESCE(NULLIF(p_header->>'status', ''), 'ISSUED')::public.document_status,
    p_doc_date,
    (p_header->>'contact_id')::uuid,
    NULLIF(p_header->>'contact_person_id', '')::uuid,
    COALESCE(NULLIF(p_header->>'sub_total', '')::numeric, 0),
    COALESCE(NULLIF(p_header->>'discount_amount', '')::numeric, 0),
    COALESCE(NULLIF(p_header->>'tax_rate', '')::numeric, 0),
    COALESCE(NULLIF(p_header->>'tax_amount', '')::numeric, 0),
    COALESCE(NULLIF(p_header->>'grand_total', '')::numeric, 0),
    COALESCE(NULLIF(p_header->>'freight_cost', '')::numeric, 0),
    NULLIF(p_header->>'freight_tax_mode', ''),
    COALESCE(NULLIF(p_header->>'freight_paid_separately', '')::boolean, false),
    COALESCE(NULLIF(p_header->>'separate_freight_amount', '')::numeric, 0),
    NULLIF(p_header->>'billing_note_eligible_amount', '')::numeric,
    COALESCE(NULLIF(p_header->>'dest_freight_cost', '')::numeric, 0),
    NULLIF(p_header->>'carrier_id', '')::uuid,
    NULLIF(p_header->>'carrier_tracking_no', ''),
    COALESCE(NULLIF(p_header->>'dest_freight_paid_status', ''), 'UNPAID'),
    COALESCE(NULLIF(p_header->>'carrier_receipt_status', ''), 'PENDING'),
    NULLIF(p_header->>'carrier_receipt_no', ''),
    NULLIF(p_header->>'carrier_receipt_date', '')::date,
    COALESCE(NULLIF(p_header->>'vat_type', ''), 'NONE')::public.vat_calculation_type,
    COALESCE(NULLIF(p_header->>'vat_rate', '')::numeric, 0),
    COALESCE(NULLIF(p_header->>'total_amount', '')::numeric, 0),
    COALESCE(NULLIF(p_header->>'net_before_vat', '')::numeric, 0),
    COALESCE(NULLIF(p_header->>'vat_amount', '')::numeric, 0),
    NULLIF(p_header->>'discount_text', ''),
    COALESCE(NULLIF(p_header->>'payment_status', ''), 'UNPAID'),
    COALESCE(NULLIF(p_header->>'paid_amount', '')::numeric, 0),
    p_header->>'notes',
    NULLIF(p_header->>'created_by', '')::uuid,
    CURRENT_TIMESTAMP
  )
  RETURNING id INTO v_doc_id;

  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
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
      prorated_freight,
      sort_order
    )
    SELECT
      v_doc_id,
      NULLIF(elem->>'product_id', '')::uuid,
      LEFT(COALESCE(elem->>'description', ''), 255),
      COALESCE(NULLIF(elem->>'qty', '')::numeric, 0),
      NULLIF(LEFT(COALESCE(elem->>'uom_used', ''), 50), ''),
      COALESCE(NULLIF(elem->>'unit_price', '')::numeric, 0),
      COALESCE(NULLIF(elem->>'unit_cost_price', '')::numeric, 0),
      NULLIF(elem->>'discount_text', ''),
      COALESCE(NULLIF(elem->>'discount_amount', '')::numeric, 0),
      COALESCE(NULLIF(elem->>'line_total', '')::numeric, 0),
      COALESCE(NULLIF(elem->>'prorated_freight', '')::numeric, 0),
      COALESCE(NULLIF(elem->>'sort_order', '')::integer, 0)
    FROM jsonb_array_elements(p_items) AS elem;
  END IF;

  IF COALESCE(p_should_post_ledger, false)
     AND p_ledger_lines IS NOT NULL
     AND jsonb_array_length(p_ledger_lines) > 0 THEN
    INSERT INTO public.inventory_ledger (
      product_id,
      doc_header_id,
      document_id,
      trans_type,
      qty,
      unit_cost,
      notes
    )
    SELECT
      (elem->>'product_id')::uuid,
      NULL,
      v_doc_id,
      'IN',
      COALESCE(NULLIF(elem->>'qty', '')::numeric, 0),
      COALESCE(NULLIF(elem->>'unit_cost', '')::numeric, 0),
      LEFT(
        'รับสินค้า Manual จากเอกสาร ' || v_doc_no
          || ' (อ้างอิง ' || COALESCE(NULLIF(btrim(p_document_ref), ''), '-') || ')'
          || ' | document_id=' || v_doc_id::text
          || CASE
               WHEN COALESCE(elem->>'notes_detail', '') <> ''
                 THEN ' | ' || (elem->>'notes_detail')
               ELSE ''
             END,
        255
      )
    FROM jsonb_array_elements(p_ledger_lines) AS elem
    WHERE NULLIF(elem->>'product_id', '') IS NOT NULL;

    GET DIAGNOSTICS v_ledger_count = ROW_COUNT;
  END IF;

  IF COALESCE(p_should_post_ledger, false)
     AND p_cost_updates IS NOT NULL
     AND jsonb_array_length(p_cost_updates) > 0 THEN
    UPDATE public.products AS p
    SET cost_price = round(COALESCE(NULLIF(elem->>'cost_price', '')::numeric, 0), 4)
    FROM jsonb_array_elements(p_cost_updates) AS elem
    WHERE p.id = NULLIF(elem->>'product_id', '')::uuid;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated < jsonb_array_length(p_cost_updates) THEN
      RAISE EXCEPTION 'อัปเดตต้นทุนเฉลี่ย (products.cost_price) ไม่สำเร็จ';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'document_id', v_doc_id,
    'doc_no', v_doc_no,
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

COMMENT ON FUNCTION public.save_manual_goods_receipt_transaction(
  boolean, text, text, date, text, jsonb, jsonb, jsonb, jsonb
) IS
  'Atomic manual goods receipt: header, lines, inventory IN, and moving-average cost.';

REVOKE ALL ON FUNCTION public.save_manual_goods_receipt_transaction(
  boolean, text, text, date, text, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_manual_goods_receipt_transaction(
  boolean, text, text, date, text, jsonb, jsonb, jsonb, jsonb
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
