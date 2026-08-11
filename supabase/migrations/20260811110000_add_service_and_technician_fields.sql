-- =============================================================================
-- Phase 13 — Services + Technician wage (is_service / technician_id / wage_cost)
-- Idempotent — safe if Production already applied the columns by hand.
-- =============================================================================

-- 1) product_models.is_service — งานบริการ ไม่ตัดสต็อก
ALTER TABLE public.product_models
  ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.product_models.is_service IS
  'true = งานบริการ (Services) — ไม่เช็ค/ไม่ตัดสต็อกใน inventory_ledger';

-- 2) production_jobs.technician_id + wage_cost
ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS technician_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS wage_cost NUMERIC(14, 4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.production_jobs.technician_id IS
  'ช่างรับเหมา / freelancer — FK contacts (Vendor หรือ Technician)';
COMMENT ON COLUMN public.production_jobs.wage_cost IS
  'ค่าแรงช่าง (บาท) — หักเป็น COGS เพิ่มในกำไรสุทธิ';

CREATE INDEX IF NOT EXISTS idx_production_jobs_technician_id
  ON public.production_jobs (technician_id);

-- 3) อนุญาต contact_type = Technician (นอกเหนือ Customer / Vendor)
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_contact_type_check;

ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_contact_type_check
  CHECK (contact_type IN ('Customer', 'Vendor', 'Technician'));

-- 4) True Net Profit — รวม wage_cost ของงานผลิตที่ไม่ถูกยกเลิก เป็น COGS เพิ่ม
CREATE OR REPLACE VIEW public.vw_sales_profit_analysis
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
    COALESCE(SUM(di.unit_cost_price * di.qty), 0)
      + COALESCE((
          SELECT SUM(pj.wage_cost)
          FROM public.production_jobs pj
          WHERE pj.document_id = d.id
            AND pj.status <> 'CANCELLED'
        ), 0) AS total_cogs
FROM public.documents d
LEFT JOIN public.document_items di ON d.id = di.document_id
LEFT JOIN public.contacts c ON d.contact_id = c.id
WHERE d.doc_type IN ('INV_DO', 'TAX_INV', 'ABB', 'CS_TAX')
  AND d.status = 'ISSUED'
GROUP BY
    d.id,
    d.doc_no,
    d.doc_date,
    d.doc_type,
    c.company_name,
    d.grand_total,
    d.vat_type,
    d.total_amount,
    d.discount_amount;

COMMENT ON VIEW public.vw_sales_profit_analysis IS
  'Phase 13 — Per-document sales gross profit. COGS = line cost snapshot + production_jobs.wage_cost.';

CREATE OR REPLACE VIEW public.vw_monthly_profit_summary
WITH (security_invoker = true) AS
WITH sales_monthly AS (
    SELECT
        TO_CHAR(document_date, 'YYYY-MM') AS month,
        SUM(net_revenue) AS total_net_revenue,
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
    COALESCE(s.total_cogs, 0) AS cogs,
    COALESCE(s.gross_profit, 0) AS gross_profit,
    COALESCE(e.total_opex, 0) AS opex,
    (COALESCE(s.gross_profit, 0) - COALESCE(e.total_opex, 0)) AS net_profit
FROM sales_monthly s
FULL OUTER JOIN expense_monthly e ON s.month = e.month;

COMMENT ON VIEW public.vw_monthly_profit_summary IS
  'Phase 13 — Monthly net profit = (revenue − product COGS − wage_cost) − OPEX.';

GRANT SELECT ON public.vw_sales_profit_analysis TO service_role;
GRANT SELECT ON public.vw_monthly_profit_summary TO service_role;
