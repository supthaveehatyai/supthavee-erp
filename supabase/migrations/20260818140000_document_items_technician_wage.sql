-- =============================================================================
-- Line-item technician assignment — 1 JOB มีงานบริการหลายบรรทัด / หลายช่าง
-- Source of truth: document_items.technician_id + wage_cost + technician_bill_id
-- =============================================================================

ALTER TABLE public.document_items
  ADD COLUMN IF NOT EXISTS technician_id UUID,
  ADD COLUMN IF NOT EXISTS wage_cost NUMERIC(14, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS technician_bill_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'document_items_technician_id_fkey'
  ) THEN
    ALTER TABLE public.document_items
      ADD CONSTRAINT document_items_technician_id_fkey
      FOREIGN KEY (technician_id)
      REFERENCES public.contacts(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'document_items_technician_bill_id_fkey'
  ) THEN
    ALTER TABLE public.document_items
      ADD CONSTRAINT document_items_technician_bill_id_fkey
      FOREIGN KEY (technician_bill_id)
      REFERENCES public.documents(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.document_items.technician_id IS
  'ช่างรับเหมาของบรรทัดงานบริการ — FK contacts.id';
COMMENT ON COLUMN public.document_items.wage_cost IS
  'ค่าแรงจริงของบรรทัดนี้ (บาท, 4 ตำแหน่ง) — Actual Cost / COGS';
COMMENT ON COLUMN public.document_items.technician_bill_id IS
  'เอกสารสรุปวางบิลช่าง (documents.doc_type = TB) — NULL = ยังไม่วางบิล';

CREATE INDEX IF NOT EXISTS idx_document_items_technician_id
  ON public.document_items (technician_id)
  WHERE technician_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_items_unbilled_technician
  ON public.document_items (technician_id, technician_bill_id)
  WHERE technician_id IS NOT NULL
    AND technician_bill_id IS NULL;

-- Backfill: ย้ายค่าแรงจาก JOB ไปยังบรรทัดงานบริการ เฉพาะบิลที่มีงานบริการ 1 บรรทัด
-- (หลายบรรทัดไม่กระจายยอดรวม เพราะจะซ้ำค่าแรง)
WITH service_lines AS (
  SELECT
    di.id,
    di.document_id,
    COUNT(*) OVER (PARTITION BY di.document_id) AS service_count
  FROM public.document_items di
  JOIN public.products p ON p.id = di.product_id
  JOIN public.product_models pm ON pm.id = p.model_id
  WHERE pm.is_service = true
),
job_source AS (
  SELECT DISTINCT ON (pj.document_id)
    pj.document_id,
    pj.technician_id,
    pj.wage_cost,
    pj.technician_bill_id
  FROM public.production_jobs pj
  WHERE pj.document_id IS NOT NULL
    AND pj.status <> 'CANCELLED'
    AND pj.technician_id IS NOT NULL
  ORDER BY pj.document_id, pj.updated_at DESC NULLS LAST
)
UPDATE public.document_items di
SET
  technician_id = js.technician_id,
  wage_cost = COALESCE(js.wage_cost, 0),
  technician_bill_id = js.technician_bill_id
FROM service_lines sl
JOIN job_source js ON js.document_id = sl.document_id
WHERE di.id = sl.id
  AND sl.service_count = 1
  AND di.technician_id IS NULL
  AND COALESCE(js.wage_cost, 0) > 0;

-- Actual Cost: COGS ค่าแรงจาก document_items.wage_cost (ไม่ใช้ยอดรวม JOB)
DROP VIEW IF EXISTS public.vw_monthly_profit_summary;
DROP VIEW IF EXISTS public.vw_sales_profit_analysis;

CREATE VIEW public.vw_sales_profit_analysis
WITH (security_invoker = true) AS
SELECT
    d.id AS document_id,
    d.doc_no AS document_number,
    d.doc_date AS document_date,
    d.doc_type,
    c.company_name AS contact_name,
    d.grand_total,
    CASE
        WHEN d.vat_type = 'INCLUSIVE' THEN (d.grand_total / 1.07)
        ELSE d.total_amount - COALESCE(d.discount_amount, 0)
    END AS net_revenue,
    COALESCE(line_cogs.product_cogs, 0) AS product_cogs,
    COALESCE(line_cogs.wage_cogs, 0) AS wage_cogs,
    COALESCE(line_cogs.product_cogs, 0)
      + COALESCE(line_cogs.wage_cogs, 0) AS total_cogs
FROM public.documents d
LEFT JOIN public.contacts c ON d.contact_id = c.id
LEFT JOIN (
    SELECT
        document_id,
        SUM(unit_cost_price * qty) AS product_cogs,
        SUM(COALESCE(wage_cost, 0)) AS wage_cogs
    FROM public.document_items
    GROUP BY document_id
) line_cogs ON line_cogs.document_id = d.id
WHERE d.doc_type IN ('INV_DO', 'TAX_INV', 'ABB', 'CS_TAX')
  AND d.status = 'ISSUED';

COMMENT ON VIEW public.vw_sales_profit_analysis IS
  'Actual Cost Engine — COGS = product cost snapshot + document_items.wage_cost (per service line).';

CREATE VIEW public.vw_monthly_profit_summary
WITH (security_invoker = true) AS
WITH sales_monthly AS (
    SELECT
        TO_CHAR(document_date, 'YYYY-MM') AS month,
        SUM(net_revenue) AS total_net_revenue,
        SUM(product_cogs) AS product_cogs,
        SUM(wage_cogs) AS wage_cogs,
        SUM(total_cogs) AS total_cogs,
        SUM(net_revenue - total_cogs) AS gross_profit
    FROM public.vw_sales_profit_analysis
    GROUP BY TO_CHAR(document_date, 'YYYY-MM')
),
expense_monthly AS (
    SELECT
        TO_CHAR(expense_date, 'YYYY-MM') AS month,
        SUM(net_payable) AS total_opex
    FROM public.expenses
    WHERE status = 'ISSUED'
    GROUP BY TO_CHAR(expense_date, 'YYYY-MM')
)
SELECT
    COALESCE(s.month, e.month) AS profit_month,
    COALESCE(s.total_net_revenue, 0) AS revenue,
    COALESCE(s.product_cogs, 0) AS product_cogs,
    COALESCE(s.wage_cogs, 0) AS wage_cogs,
    COALESCE(s.total_cogs, 0) AS cogs,
    COALESCE(s.gross_profit, 0) AS gross_profit,
    COALESCE(e.total_opex, 0) AS opex,
    (COALESCE(s.gross_profit, 0) - COALESCE(e.total_opex, 0)) AS net_profit
FROM sales_monthly s
FULL OUTER JOIN expense_monthly e ON s.month = e.month;

COMMENT ON VIEW public.vw_monthly_profit_summary IS
  'Actual Cost Engine — monthly net profit = (revenue − product COGS − line wage_cost) − OPEX.';

GRANT SELECT ON public.vw_sales_profit_analysis TO service_role;
GRANT SELECT ON public.vw_monthly_profit_summary TO service_role;

-- Reload PostgREST schema cache so embed document_items → contacts works
NOTIFY pgrst, 'reload schema';
