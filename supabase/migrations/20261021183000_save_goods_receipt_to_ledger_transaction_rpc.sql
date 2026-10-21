-- =============================================================================
-- save_goods_receipt_to_ledger_transaction
-- Atomic Smart OCR goods receipt:
-- doc_headers, doc_details, documents, document_items,
-- inventory_ledger IN, and products.cost_price.
-- Duplicate vendor invoice (23505) is re-raised so the caller can map it.
-- vendor_doc_no is documents.doc_no, the official purchase number.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.save_goods_receipt_to_ledger_transaction(
  p_running_prefix text,
  p_doc_date date,
  p_legacy_header jsonb,
  p_legacy_details jsonb DEFAULT '[]'::jsonb,
  p_document_header jsonb DEFAULT '{}'::jsonb,
  p_document_items jsonb DEFAULT '[]'::jsonb,
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
  v_legacy_id uuid;
  v_doc_id uuid;
  v_updated integer := 0;
  v_vendor_invoice text;
BEGIN
  IF p_legacy_header IS NULL OR jsonb_typeof(p_legacy_header) <> 'object' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'p_legacy_header ต้องเป็น JSON object'
    );
  END IF;
  IF p_document_header IS NOT NULL AND jsonb_typeof(p_document_header) <> 'object' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'p_document_header ต้องเป็น JSON object'
    );
  END IF;
  IF p_legacy_details IS NOT NULL AND jsonb_typeof(p_legacy_details) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'p_legacy_details ต้องเป็น JSON array');
  END IF;
  IF p_document_items IS NOT NULL AND jsonb_typeof(p_document_items) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'p_document_items ต้องเป็น JSON array');
  END IF;
  IF p_ledger_lines IS NOT NULL AND jsonb_typeof(p_ledger_lines) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'p_ledger_lines ต้องเป็น JSON array');
  END IF;
  IF p_cost_updates IS NOT NULL AND jsonb_typeof(p_cost_updates) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'p_cost_updates ต้องเป็น JSON array');
  END IF;
  IF p_doc_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ไม่พบวันที่เอกสาร');
  END IF;
  IF NULLIF(btrim(COALESCE(p_legacy_header->>'contact_id', '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ไม่พบผู้จำหน่าย (Vendor)');
  END IF;
  IF p_running_prefix IS NULL OR btrim(p_running_prefix) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ไม่พบ prefix สำหรับเลขที่เอกสารรับสินค้า'
    );
  END IF;

  v_vendor_invoice := COALESCE(
    NULLIF(btrim(p_legacy_header->>'doc_no'), ''),
    'REC-' || floor(extract(epoch FROM clock_timestamp()))::text
  );

  INSERT INTO public.doc_headers (
    doc_no,
    doc_type,
    doc_date,
    contact_id,
    sub_total,
    discount_amount,
    grand_total,
    freight_cost,
    payment_status
  ) VALUES (
    v_vendor_invoice,
    COALESCE(NULLIF(p_legacy_header->>'doc_type', ''), 'AP_TAX'),
    p_doc_date,
    (p_legacy_header->>'contact_id')::uuid,
    COALESCE(NULLIF(p_legacy_header->>'sub_total', '')::numeric, 0),
    COALESCE(NULLIF(p_legacy_header->>'discount_amount', '')::numeric, 0),
    COALESCE(NULLIF(p_legacy_header->>'grand_total', '')::numeric, 0),
    COALESCE(NULLIF(p_legacy_header->>'freight_cost', '')::numeric, 0),
    COALESCE(NULLIF(p_legacy_header->>'payment_status', ''), 'UNPAID')
  )
  RETURNING id INTO v_legacy_id;

  IF p_legacy_details IS NOT NULL AND jsonb_array_length(p_legacy_details) > 0 THEN
    INSERT INTO public.doc_details (
      doc_header_id,
      product_id,
      description,
      qty,
      uom_used,
      unit_price,
      unit_cost_price,
      discount_text,
      discount_amount,
      line_total
    )
    SELECT
      v_legacy_id,
      NULLIF(elem->>'product_id', '')::uuid,
      elem->>'description',
      COALESCE(NULLIF(elem->>'qty', '')::numeric, 0),
      NULLIF(elem->>'uom_used', ''),
      COALESCE(NULLIF(elem->>'unit_price', '')::numeric, 0),
      COALESCE(NULLIF(elem->>'unit_cost_price', '')::numeric, 0),
      COALESCE(elem->>'discount_text', ''),
      COALESCE(NULLIF(elem->>'discount_amount', '')::numeric, 0),
      COALESCE(NULLIF(elem->>'line_total', '')::numeric, 0)
    FROM jsonb_array_elements(p_legacy_details) AS elem;
  END IF;

  v_doc_no := public.generate_document_no(btrim(p_running_prefix), p_doc_date);

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
    rounding_difference,
    discount_text,
    payment_status,
    paid_amount,
    notes,
    attachment_url,
    attached_file_url,
    original_file_name,
    created_by,
    updated_at
  ) VALUES (
    v_doc_no,
    (p_document_header->>'doc_type')::public.document_type,
    COALESCE(NULLIF(p_document_header->>'status', ''), 'ISSUED')::public.document_status,
    p_doc_date,
    (p_document_header->>'contact_id')::uuid,
    NULLIF(p_document_header->>'contact_person_id', '')::uuid,
    COALESCE(NULLIF(p_document_header->>'sub_total', '')::numeric, 0),
    COALESCE(NULLIF(p_document_header->>'discount_amount', '')::numeric, 0),
    COALESCE(NULLIF(p_document_header->>'tax_rate', '')::numeric, 0),
    COALESCE(NULLIF(p_document_header->>'tax_amount', '')::numeric, 0),
    COALESCE(NULLIF(p_document_header->>'grand_total', '')::numeric, 0),
    COALESCE(NULLIF(p_document_header->>'freight_cost', '')::numeric, 0),
    NULLIF(p_document_header->>'freight_tax_mode', ''),
    COALESCE(NULLIF(p_document_header->>'freight_paid_separately', '')::boolean, false),
    COALESCE(NULLIF(p_document_header->>'separate_freight_amount', '')::numeric, 0),
    NULLIF(p_document_header->>'billing_note_eligible_amount', '')::numeric,
    COALESCE(NULLIF(p_document_header->>'dest_freight_cost', '')::numeric, 0),
    NULLIF(p_document_header->>'carrier_id', '')::uuid,
    NULLIF(p_document_header->>'carrier_tracking_no', ''),
    COALESCE(NULLIF(p_document_header->>'dest_freight_paid_status', ''), 'UNPAID'),
    COALESCE(NULLIF(p_document_header->>'carrier_receipt_status', ''), 'PENDING'),
    NULLIF(p_document_header->>'carrier_receipt_no', ''),
    NULLIF(p_document_header->>'carrier_receipt_date', '')::date,
    COALESCE(NULLIF(p_document_header->>'vat_type', ''), 'NONE')::public.vat_calculation_type,
    COALESCE(NULLIF(p_document_header->>'vat_rate', '')::numeric, 0),
    COALESCE(NULLIF(p_document_header->>'total_amount', '')::numeric, 0),
    COALESCE(NULLIF(p_document_header->>'net_before_vat', '')::numeric, 0),
    COALESCE(NULLIF(p_document_header->>'vat_amount', '')::numeric, 0),
    COALESCE(NULLIF(p_document_header->>'rounding_difference', '')::numeric, 0),
    NULLIF(p_document_header->>'discount_text', ''),
    COALESCE(NULLIF(p_document_header->>'payment_status', ''), 'UNPAID'),
    COALESCE(NULLIF(p_document_header->>'paid_amount', '')::numeric, 0),
    p_document_header->>'notes',
    NULLIF(p_document_header->>'attachment_url', ''),
    NULLIF(p_document_header->>'attached_file_url', ''),
    NULLIF(p_document_header->>'original_file_name', ''),
    NULLIF(p_document_header->>'created_by', '')::uuid,
    CURRENT_TIMESTAMP
  )
  RETURNING id INTO v_doc_id;

  IF p_document_items IS NOT NULL AND jsonb_array_length(p_document_items) > 0 THEN
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
    FROM jsonb_array_elements(p_document_items) AS elem;
  END IF;

  IF p_ledger_lines IS NOT NULL AND jsonb_array_length(p_ledger_lines) > 0 THEN
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
      v_legacy_id,
      v_doc_id,
      'IN',
      COALESCE(NULLIF(elem->>'qty', '')::numeric, 0),
      COALESCE(NULLIF(elem->>'unit_cost', '')::numeric, 0),
      LEFT(
        'รับสินค้าจากเอกสาร ' || v_vendor_invoice
          || ' (' || v_doc_no || ') — '
          || COALESCE(elem->>'notes_detail', ''),
        255
      )
    FROM jsonb_array_elements(p_ledger_lines) AS elem
    WHERE NULLIF(elem->>'product_id', '') IS NOT NULL;
  END IF;

  IF p_cost_updates IS NOT NULL AND jsonb_array_length(p_cost_updates) > 0 THEN
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
    'doc_header_id', v_legacy_id,
    'vendor_doc_no', v_doc_no,
    'error', NULL
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE;
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

COMMENT ON FUNCTION public.save_goods_receipt_to_ledger_transaction(
  text, date, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) IS
  'Atomic OCR goods receipt. vendor_doc_no is the official documents.doc_no. 23505 is re-raised.';

REVOKE ALL ON FUNCTION public.save_goods_receipt_to_ledger_transaction(
  text, date, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_goods_receipt_to_ledger_transaction(
  text, date, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
