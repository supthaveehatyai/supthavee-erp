-- =============================================================================
-- Void ISSUED/COMPLETED document + mirror inventory_ledger (transactional)
-- Sales ledger links stock moves via notes: document_id=<uuid>
-- =============================================================================

CREATE OR REPLACE FUNCTION public.void_document_with_stock_reversal(
  p_document_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc record;
  v_ledger record;
  v_reversed integer := 0;
  v_mirror_type text;
  v_notes text;
BEGIN
  IF p_document_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ไม่พบรหัสเอกสาร');
  END IF;

  SELECT id, doc_no, status, COALESCE(paid_amount, 0) AS paid_amount
  INTO v_doc
  FROM public.documents
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ไม่พบเอกสาร');
  END IF;

  IF v_doc.status NOT IN ('ISSUED', 'COMPLETED') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',
      format(
        'ยกเลิกได้เฉพาะเอกสารสถานะ ISSUED หรือ COMPLETED (ปัจจุบัน: %s)',
        v_doc.status
      )
    );
  END IF;

  IF v_doc.paid_amount > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',
      'เอกสารมียอดชำระแล้ว — ต้องยกเลิกการตัดชำระ (payments) ก่อน'
    );
  END IF;

  UPDATE public.documents
  SET
    status = 'CANCELLED',
    updated_at = CURRENT_TIMESTAMP
  WHERE id = p_document_id;

  FOR v_ledger IN
    SELECT id, product_id, doc_header_id, trans_type, qty, notes
    FROM public.inventory_ledger
    WHERE notes LIKE '%document_id=' || p_document_id::text || '%'
      AND notes NOT ILIKE '%VOID reverse%'
  LOOP
    IF upper(btrim(v_ledger.trans_type)) = 'OUT' THEN
      v_mirror_type := 'IN';
    ELSIF upper(btrim(v_ledger.trans_type)) = 'IN' THEN
      v_mirror_type := 'OUT';
    ELSE
      CONTINUE;
    END IF;

    v_notes := left(
      'VOID reverse | source_ledger='
        || v_ledger.id::text
        || ' | document_id='
        || p_document_id::text
        || ' | ยกเลิกเอกสาร '
        || v_doc.doc_no,
      255
    );

    INSERT INTO public.inventory_ledger (
      product_id,
      doc_header_id,
      trans_type,
      qty,
      notes
    ) VALUES (
      v_ledger.product_id,
      NULL,
      v_mirror_type,
      v_ledger.qty,
      v_notes
    );

    v_reversed := v_reversed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'doc_no', v_doc.doc_no,
    'reversed_count', v_reversed,
    'error', null
  );
END;
$$;

REVOKE ALL ON FUNCTION public.void_document_with_stock_reversal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_document_with_stock_reversal(uuid) TO service_role;

COMMENT ON FUNCTION public.void_document_with_stock_reversal(uuid) IS
  'Cancel ISSUED/COMPLETED document and insert mirroring inventory_ledger rows (OUT↔IN).';
