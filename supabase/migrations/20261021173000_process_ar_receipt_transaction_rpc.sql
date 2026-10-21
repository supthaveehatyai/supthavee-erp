-- =============================================================================
-- process_ar_receipt_transaction
-- Atomic AR receipt (processPaymentKnockoff steps 1–6):
-- REC document, payment_transactions, document_allocations,
-- source invoice / CN paid_amount, and DEP_IN deposit_deducted.
-- Billing-note sync and audit stay in the Server Action.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.process_ar_receipt_transaction(
  p_contact_id uuid,
  p_payment_date date,
  p_payment_method text,
  p_bank_account_id uuid,
  p_net_cash_amount numeric,
  p_receipt_grand_total numeric,
  p_header_wht numeric,
  p_reference_no text DEFAULT NULL,
  p_slip_url text DEFAULT NULL,
  p_original_file_name text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_invoice_allocations jsonb DEFAULT '[]'::jsonb,
  p_cn_allocations jsonb DEFAULT '[]'::jsonb,
  p_deposit_allocations jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc_no text;
  v_receipt_id uuid;
  v_method text;
  v_bank_id uuid;
  v_elem jsonb;
  v_target_id uuid;
  v_apply numeric;
  v_doc record;
  v_grand numeric;
  v_prev_paid numeric;
  v_new_paid numeric;
  v_used numeric;
  v_pay_status text;
  v_doc_status text;
  v_applied_cn jsonb := '[]'::jsonb;
  v_prev_deducted numeric;
  v_new_deducted numeric;
BEGIN
  IF p_contact_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ไม่พบรหัสลูกค้า');
  END IF;

  IF p_payment_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ไม่พบวันที่รับชำระ');
  END IF;

  v_method := upper(btrim(COALESCE(p_payment_method, '')));
  IF v_method NOT IN ('CASH', 'BANK_TRANSFER') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'วิธีรับชำระต้องเป็น CASH หรือ BANK_TRANSFER'
    );
  END IF;

  IF COALESCE(p_net_cash_amount, 0) < 0
     OR COALESCE(p_header_wht, 0) < 0
     OR COALESCE(p_receipt_grand_total, 0) < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'ยอดเงินต้องไม่ติดลบ');
  END IF;

  IF p_invoice_allocations IS NULL OR jsonb_typeof(p_invoice_allocations) <> 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'p_invoice_allocations ต้องเป็น JSON array'
    );
  END IF;
  IF p_cn_allocations IS NOT NULL AND jsonb_typeof(p_cn_allocations) <> 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'p_cn_allocations ต้องเป็น JSON array'
    );
  END IF;
  IF p_deposit_allocations IS NOT NULL AND jsonb_typeof(p_deposit_allocations) <> 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'p_deposit_allocations ต้องเป็น JSON array'
    );
  END IF;
  IF jsonb_array_length(p_invoice_allocations) < 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'กรุณาเลือกบิลขายที่ต้องการตัดยอดอย่างน้อย 1 รายการ'
    );
  END IF;

  v_bank_id := CASE WHEN v_method = 'CASH' THEN NULL ELSE p_bank_account_id END;

  -- Exclusive lock lives inside generate_document_no. Call it before row writes
  -- so numbering cannot deadlock with another receipt.
  v_doc_no := public.generate_document_no('REC', p_payment_date);

  INSERT INTO public.documents (
    doc_no,
    doc_type,
    status,
    doc_date,
    contact_id,
    sub_total,
    discount_amount,
    tax_rate,
    tax_amount,
    wht_rate,
    wht_amount,
    grand_total,
    total_amount,
    net_before_vat,
    vat_amount,
    vat_rate,
    vat_type,
    paid_amount,
    payment_status,
    attachment_url,
    attached_file_url,
    original_file_name,
    notes,
    created_by,
    updated_at
  ) VALUES (
    v_doc_no,
    'REC',
    'ISSUED',
    p_payment_date,
    p_contact_id,
    round(COALESCE(p_net_cash_amount, 0), 2),
    0,
    0,
    0,
    0,
    round(COALESCE(p_header_wht, 0), 2),
    round(COALESCE(p_receipt_grand_total, 0), 2),
    round(COALESCE(p_net_cash_amount, 0), 2),
    round(COALESCE(p_net_cash_amount, 0), 2),
    0,
    0,
    'NONE',
    round(COALESCE(p_net_cash_amount, 0), 2),
    'PAID',
    NULLIF(btrim(COALESCE(p_slip_url, '')), ''),
    NULLIF(btrim(COALESCE(p_slip_url, '')), ''),
    NULLIF(LEFT(btrim(COALESCE(p_original_file_name, '')), 255), ''),
    p_notes,
    p_user_id,
    CURRENT_TIMESTAMP
  )
  RETURNING id INTO v_receipt_id;

  INSERT INTO public.payment_transactions (
    document_id,
    payment_method,
    bank_account_id,
    amount,
    reference_no,
    payment_date,
    attachment_url,
    is_reconciled,
    is_voided
  ) VALUES (
    v_receipt_id,
    v_method::public.payment_method_enum,
    v_bank_id,
    round(COALESCE(p_net_cash_amount, 0), 2),
    NULLIF(btrim(COALESCE(p_reference_no, '')), ''),
    (p_payment_date::text || 'T00:00:00.000Z')::timestamptz,
    NULLIF(btrim(COALESCE(p_slip_url, '')), ''),
    false,
    false
  );

  INSERT INTO public.document_allocations (
    receipt_doc_id,
    invoice_doc_id,
    allocated_amount,
    wht_amount,
    adjustment_amount,
    adjustment_reason
  )
  SELECT
    v_receipt_id,
    (elem->>'invoice_id')::uuid,
    round(COALESCE((elem->>'allocated_amount')::numeric, 0), 2),
    round(COALESCE((elem->>'wht_amount')::numeric, 0), 2),
    0,
    NULL
  FROM jsonb_array_elements(p_invoice_allocations) AS elem
  WHERE NULLIF(elem->>'invoice_id', '') IS NOT NULL
    AND (
      COALESCE((elem->>'allocated_amount')::numeric, 0) > 0
      OR COALESCE((elem->>'wht_amount')::numeric, 0) > 0
    )
  UNION ALL
  SELECT
    v_receipt_id,
    (elem->>'invoice_id')::uuid,
    round(COALESCE((elem->>'allocated_amount')::numeric, 0), 2),
    0,
    0,
    'CN_APPLY'
  FROM jsonb_array_elements(COALESCE(p_cn_allocations, '[]'::jsonb)) AS elem
  WHERE NULLIF(elem->>'invoice_id', '') IS NOT NULL
    AND COALESCE((elem->>'allocated_amount')::numeric, 0) > 0
  UNION ALL
  SELECT
    v_receipt_id,
    (elem->>'deposit_id')::uuid,
    round(COALESCE((elem->>'allocated_amount')::numeric, 0), 2),
    0,
    0,
    'DEPOSIT_APPLY'
  FROM jsonb_array_elements(COALESCE(p_deposit_allocations, '[]'::jsonb)) AS elem
  WHERE NULLIF(elem->>'deposit_id', '') IS NOT NULL
    AND COALESCE((elem->>'allocated_amount')::numeric, 0) > 0;

  FOR v_elem IN
    SELECT elem.value
    FROM jsonb_array_elements(p_invoice_allocations) AS elem(value)
  LOOP
    v_target_id := NULLIF(v_elem->>'invoice_id', '')::uuid;
    v_apply := round(COALESCE((v_elem->>'allocated_amount')::numeric, 0), 2);
    IF v_target_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT
      d.id,
      d.doc_no,
      d.doc_type::text AS doc_type,
      d.status::text AS status,
      d.contact_id,
      COALESCE(d.is_voided, false) AS is_voided,
      CASE
        WHEN d.grand_total IS NULL THEN COALESCE(d.total_amount, 0)
        ELSE d.grand_total
      END AS grand_total,
      COALESCE(d.paid_amount, 0) AS paid_amount
    INTO v_doc
    FROM public.documents d
    WHERE d.id = v_target_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ไม่พบบิลต้นทาง %', v_target_id;
    END IF;
    IF v_doc.contact_id IS DISTINCT FROM p_contact_id THEN
      RAISE EXCEPTION 'พบบิลที่ไม่ใช่ของลูกค้ารายนี้';
    END IF;
    IF v_doc.is_voided THEN
      RAISE EXCEPTION 'มีบิลที่ถูกยกเลิก ไม่สามารถตัดยอดได้';
    END IF;
    IF v_doc.status NOT IN ('ISSUED', 'COMPLETED') THEN
      RAISE EXCEPTION 'ตัดยอดได้เฉพาะบิลที่ออกแล้ว (ISSUED)';
    END IF;
    IF v_doc.doc_type NOT IN ('INV_DO', 'TAX_INV', 'CS_TAX') THEN
      RAISE EXCEPTION 'ประเภทเอกสารไม่รองรับการตัดหนี้: %', v_doc.doc_type;
    END IF;

    v_grand := round(COALESCE(v_doc.grand_total, 0), 2);
    v_prev_paid := round(COALESCE(v_doc.paid_amount, 0), 2);
    IF v_apply > (v_grand - v_prev_paid) + 0.02 THEN
      RAISE EXCEPTION 'ยอดตัดหนี้เกินยอดค้างของบิล (เหลือ %)',
        to_char(v_grand - v_prev_paid, 'FM999999990.00');
    END IF;

    v_new_paid := round(v_prev_paid + v_apply, 2);
    v_pay_status := CASE
      WHEN v_new_paid <= 0.02 THEN 'UNPAID'
      WHEN v_new_paid >= v_grand - 0.02 THEN 'PAID'
      ELSE 'PARTIAL'
    END;
    v_doc_status := CASE WHEN v_pay_status = 'PAID' THEN 'PAID' ELSE 'ISSUED' END;

    UPDATE public.documents
    SET
      paid_amount = v_new_paid,
      payment_status = v_pay_status,
      status = v_doc_status::public.document_status,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = v_target_id;
  END LOOP;

  FOR v_elem IN
    SELECT elem.value
    FROM jsonb_array_elements(COALESCE(p_deposit_allocations, '[]'::jsonb)) AS elem(value)
  LOOP
    v_target_id := NULLIF(v_elem->>'deposit_id', '')::uuid;
    v_apply := round(COALESCE((v_elem->>'allocated_amount')::numeric, 0), 2);
    IF v_target_id IS NULL OR v_apply <= 0 THEN
      CONTINUE;
    END IF;

    SELECT
      d.id,
      d.doc_no,
      d.doc_type::text AS doc_type,
      d.contact_id,
      COALESCE(d.is_voided, false) AS is_voided,
      COALESCE(d.grand_total, 0) AS grand_total,
      COALESCE(d.deposit_deducted, 0) AS deposit_deducted
    INTO v_doc
    FROM public.documents d
    WHERE d.id = v_target_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ไม่พบเอกสารมัดจำ %', v_target_id;
    END IF;
    IF v_doc.contact_id IS DISTINCT FROM p_contact_id THEN
      RAISE EXCEPTION 'พบมัดจำที่ไม่ใช่ของลูกค้ารายนี้';
    END IF;
    IF v_doc.is_voided THEN
      RAISE EXCEPTION 'มีมัดจำที่ถูกยกเลิก';
    END IF;
    IF v_doc.doc_type <> 'DEP_IN' THEN
      RAISE EXCEPTION 'ประเภทมัดจำไม่ถูกต้อง: %', v_doc.doc_type;
    END IF;

    SELECT COALESCE(SUM(a.allocated_amount), 0)
    INTO v_used
    FROM public.document_allocations a
    WHERE a.invoice_doc_id = v_target_id
      AND a.receipt_doc_id IS DISTINCT FROM v_receipt_id;

    v_grand := round(COALESCE(v_doc.grand_total, 0), 2);
    v_prev_deducted := round(COALESCE(v_doc.deposit_deducted, 0), 2);
    v_used := round(GREATEST(COALESCE(v_used, 0), v_prev_deducted), 2);
    IF v_apply > (v_grand - v_used) + 0.02 THEN
      RAISE EXCEPTION 'ยอดมัดจำเกินคงเหลือ (เหลือ %)',
        to_char(v_grand - v_used, 'FM999999990.00');
    END IF;

    v_new_deducted := round(v_prev_deducted + v_apply, 2);

    UPDATE public.documents
    SET
      deposit_deducted = v_new_deducted,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = v_target_id;

    IF v_doc.doc_no IS NOT NULL AND btrim(v_doc.doc_no) <> '' THEN
      UPDATE public.doc_headers
      SET deposit_deducted = v_new_deducted
      WHERE doc_no = v_doc.doc_no
        AND doc_type = 'DEP_IN';
    END IF;
  END LOOP;

  FOR v_elem IN
    SELECT elem.value
    FROM jsonb_array_elements(COALESCE(p_cn_allocations, '[]'::jsonb)) AS elem(value)
  LOOP
    v_target_id := NULLIF(v_elem->>'invoice_id', '')::uuid;
    v_apply := round(COALESCE((v_elem->>'allocated_amount')::numeric, 0), 2);
    IF v_target_id IS NULL OR v_apply <= 0 THEN
      CONTINUE;
    END IF;

    SELECT
      d.id,
      d.doc_no,
      d.doc_type::text AS doc_type,
      d.status::text AS status,
      d.contact_id,
      COALESCE(d.is_voided, false) AS is_voided,
      CASE
        WHEN d.grand_total IS NULL THEN COALESCE(d.total_amount, 0)
        ELSE d.grand_total
      END AS grand_total,
      COALESCE(d.paid_amount, 0) AS paid_amount,
      COALESCE(d.payment_status, 'UNPAID') AS payment_status
    INTO v_doc
    FROM public.documents d
    WHERE d.id = v_target_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ไม่พบใบลดหนี้ %', v_target_id;
    END IF;
    IF v_doc.contact_id IS DISTINCT FROM p_contact_id THEN
      RAISE EXCEPTION 'พบบิลที่ไม่ใช่ของลูกค้ารายนี้';
    END IF;
    IF v_doc.is_voided THEN
      RAISE EXCEPTION 'มีบิลที่ถูกยกเลิก ไม่สามารถตัดยอดได้';
    END IF;
    IF v_doc.doc_type <> 'CN' THEN
      RAISE EXCEPTION 'เอกสาร % ไม่ใช่ใบลดหนี้', COALESCE(v_doc.doc_no, v_target_id::text);
    END IF;

    SELECT COALESCE(SUM(a.allocated_amount), 0)
    INTO v_used
    FROM public.document_allocations a
    WHERE a.invoice_doc_id = v_target_id
      AND a.receipt_doc_id IS DISTINCT FROM v_receipt_id;

    v_grand := round(COALESCE(v_doc.grand_total, 0), 2);
    v_prev_paid := round(COALESCE(v_doc.paid_amount, 0), 2);
    v_used := round(GREATEST(COALESCE(v_used, 0), v_prev_paid), 2);
    IF v_apply > (v_grand - v_used) + 0.02 THEN
      RAISE EXCEPTION 'ยอดใบลดหนี้เกินคงเหลือ (เหลือ %)',
        to_char(v_grand - v_used, 'FM999999990.00');
    END IF;

    v_new_paid := round(v_prev_paid + v_apply, 2);
    v_pay_status := CASE
      WHEN v_new_paid <= 0.02 THEN 'UNPAID'
      WHEN v_new_paid >= v_grand - 0.02 THEN 'PAID'
      ELSE 'PARTIAL'
    END;
    v_doc_status := CASE WHEN v_pay_status = 'PAID' THEN 'PAID' ELSE 'ISSUED' END;

    UPDATE public.documents
    SET
      paid_amount = v_new_paid,
      payment_status = v_pay_status,
      status = v_doc_status::public.document_status,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = v_target_id;

    v_applied_cn := v_applied_cn || jsonb_build_array(
      jsonb_build_object(
        'id', v_target_id,
        'doc_no', COALESCE(NULLIF(btrim(v_doc.doc_no), ''), v_target_id::text),
        'allocated_amount', v_apply,
        'previous_status', COALESCE(v_doc.status, 'ISSUED'),
        'previous_payment_status', COALESCE(v_doc.payment_status, 'UNPAID'),
        'previous_paid_amount', v_prev_paid,
        'next_status', v_doc_status,
        'next_payment_status', v_pay_status,
        'paid_amount', v_new_paid
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_doc_id', v_receipt_id,
    'receipt_doc_no', v_doc_no,
    'applied_cn_docs', v_applied_cn,
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

COMMENT ON FUNCTION public.process_ar_receipt_transaction(
  uuid, date, text, uuid, numeric, numeric, numeric, text, text, text, text, uuid, jsonb, jsonb, jsonb
) IS
  'Atomic AR receipt: REC, payment_transactions, allocations, invoice/CN/deposit balances.';

REVOKE ALL ON FUNCTION public.process_ar_receipt_transaction(
  uuid, date, text, uuid, numeric, numeric, numeric, text, text, text, text, uuid, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.process_ar_receipt_transaction(
  uuid, date, text, uuid, numeric, numeric, numeric, text, text, text, text, uuid, jsonb, jsonb, jsonb
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
