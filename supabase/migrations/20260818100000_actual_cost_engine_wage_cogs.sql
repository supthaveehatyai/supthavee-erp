-- =============================================================================
-- Actual Cost Engine — production_jobs.technician_id / wage_cost
-- + Profit views: product_cogs (เสื้อเปล่า) + wage_cogs (ค่าแรงงานบริการ)
-- Idempotent — ปลอดภัยถ้า Phase 13 ใส่คอลัมน์ไปแล้ว
-- =============================================================================

-- 1) production_jobs: ช่างรับเหมา + ค่าแรงจริง
ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS technician_id UUID;

ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS wage_cost NUMERIC(14, 4);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_jobs_technician_id_fkey'
  ) THEN
    ALTER TABLE public.production_jobs
      ADD CONSTRAINT production_jobs_technician_id_fkey
      FOREIGN KEY (technician_id)
      REFERENCES public.contacts(id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.production_jobs
  ALTER COLUMN wage_cost SET DEFAULT 0;

UPDATE public.production_jobs
SET wage_cost = 0
WHERE wage_cost IS NULL;

ALTER TABLE public.production_jobs
  ALTER COLUMN wage_cost SET NOT NULL;

COMMENT ON COLUMN public.production_jobs.technician_id IS
  'ช่างรับเหมา — FK contacts.id (contact_roles รวม Technician)';
COMMENT ON COLUMN public.production_jobs.wage_cost IS
  'ค่าแรงจริง (บาท, 4 ตำแหน่ง) — จาก technician_rates แล้ว override ได้; หักเป็น COGS';

CREATE INDEX IF NOT EXISTS idx_production_jobs_technician_id
  ON public.production_jobs (technician_id);

-- 2) Recreate profit views — COGS = ต้นทุนสินค้า (cost snapshot) + ค่าแรง JOB
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
    COALESCE(job_cogs.wage_cogs, 0) AS wage_cogs,
    COALESCE(line_cogs.product_cogs, 0)
      + COALESCE(job_cogs.wage_cogs, 0) AS total_cogs
FROM public.documents d
LEFT JOIN public.contacts c ON d.contact_id = c.id
LEFT JOIN (
    SELECT
        document_id,
        SUM(unit_cost_price * qty) AS product_cogs
    FROM public.document_items
    GROUP BY document_id
) line_cogs ON line_cogs.document_id = d.id
LEFT JOIN (
    SELECT
        document_id,
        SUM(wage_cost) AS wage_cogs
    FROM public.production_jobs
    WHERE status <> 'CANCELLED'
    GROUP BY document_id
) job_cogs ON job_cogs.document_id = d.id
WHERE d.doc_type IN ('INV_DO', 'TAX_INV', 'ABB', 'CS_TAX')
  AND d.status = 'ISSUED';

COMMENT ON VIEW public.vw_sales_profit_analysis IS
  'Actual Cost Engine — per-document profit. COGS = product cost snapshot + production_jobs.wage_cost (non-cancelled).';

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
  'Actual Cost Engine — monthly net profit = (revenue − product COGS − wage_cost) − OPEX.';

GRANT SELECT ON public.vw_sales_profit_analysis TO service_role;
GRANT SELECT ON public.vw_monthly_profit_summary TO service_role;
