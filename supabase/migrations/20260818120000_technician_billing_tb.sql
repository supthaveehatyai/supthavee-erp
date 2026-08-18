-- =============================================================================
-- Technician Billing (TB) — สรุปวางบิลช่าง
-- Header: documents.doc_type = 'TB'
-- Lines:  document_items (1 แถวต่อ JOB, unit_price = wage_cost)
-- Flag:   production_jobs.technician_bill_id → documents.id
-- ไม่สร้างตารางใหม่ — ใช้ ledger เอกสารหลักตามมาตรฐาน ERP
-- =============================================================================

ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'TB';

COMMENT ON TYPE public.document_type IS
  'Sales: QT SO INV_DO TAX_INV CS_TAX ABB DEP_IN REC CN AR_REFUND AR_WRITEOFF | Purchases: PO AP_TAX AP_INV AP_CASH DEP_OUT PAY AP_REFUND AP_WRITEOFF | Billing: BN BR TB | Legacy: REFUND WRITE_OFF';

ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS technician_bill_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_jobs_technician_bill_id_fkey'
  ) THEN
    ALTER TABLE public.production_jobs
      ADD CONSTRAINT production_jobs_technician_bill_id_fkey
      FOREIGN KEY (technician_bill_id)
      REFERENCES public.documents(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.production_jobs.technician_bill_id IS
  'เอกสารสรุปวางบิลช่าง (documents.doc_type = TB) — NULL = ยังไม่ตัดจ่าย/ยังไม่วางบิล';

CREATE INDEX IF NOT EXISTS idx_production_jobs_technician_bill_id
  ON public.production_jobs (technician_bill_id)
  WHERE technician_bill_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_production_jobs_unbilled_technician
  ON public.production_jobs (technician_id, status, updated_at)
  WHERE technician_id IS NOT NULL
    AND technician_bill_id IS NULL;

-- generate_document_no: TB → TB-YYMM-XXXX (ELSE v_raw อยู่แล้ว แต่ล็อก prefix ให้ชัด)
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

  v_prefix := CASE v_raw
    WHEN 'AR_REFUND' THEN 'SRF'
    WHEN 'AP_REFUND' THEN 'PRF'
    WHEN 'AR_WRITEOFF' THEN 'SWO'
    WHEN 'AP_WRITEOFF' THEN 'PWO'
    WHEN 'REFUND' THEN 'RFD'
    WHEN 'WRITE_OFF' THEN 'WRO'
    WHEN 'TB' THEN 'TB'
    WHEN 'BN' THEN 'BN'
    WHEN 'BR' THEN 'BR'
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
  'Race-safe PREFIX-YYMM-XXXX. Maps settlement types + TB/BN/BR billing prefixes.';

REVOKE ALL ON FUNCTION public.generate_document_no(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_document_no(text, date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_document_no(text, date) TO service_role;
