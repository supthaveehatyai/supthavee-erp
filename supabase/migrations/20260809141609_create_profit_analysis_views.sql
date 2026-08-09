-- =============================================================================
-- Phase 12 — Profit Analysis Views (Gross Profit / Monthly Net Profit)
-- File: 20260809141609_create_profit_analysis_views.sql
--
-- security_invoker = true → View เคารพ RLS ของตารางต้นทาง
--   (documents, document_items, expenses, contacts) ตามสิทธิ์ผู้เรียก
-- Schema mapping (Blueprint → actual):
--   document_number ← documents.doc_no
--   document_date   ← documents.doc_date
--   contact_name    ← contacts.company_name
-- Access pattern: Server Actions + supabaseAdmin (Zero Client-Side Fetching)
-- =============================================================================

-- 1. View: กำไรขั้นต้น (Gross Profit) แยกตามเอกสารขาย
CREATE OR REPLACE VIEW public.vw_sales_profit_analysis
WITH (security_invoker = true) AS
SELECT
    d.id AS document_id,
    d.doc_no AS document_number,
    d.doc_date AS document_date,
    d.doc_type,
    c.company_name AS contact_name,
    d.grand_total,
    -- ถอด VAT เพื่อหารายได้สุทธิ (Net Revenue)
    CASE
        WHEN d.vat_type = 'INCLUSIVE' THEN (d.grand_total / 1.07)
        ELSE d.total_amount - COALESCE(d.discount_amount, 0)
    END AS net_revenue,
    -- รวมต้นทุนขาย (COGS) จาก Line Items (Cost Snapshot)
    COALESCE(SUM(di.unit_cost_price * di.qty), 0) AS total_cogs
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
  'Phase 12 — Per-document sales gross profit (net_revenue − COGS). ISSUED sales docs only.';

-- 2. View: สรุปกำไรสุทธิรายเดือน (Monthly Net Profit)
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
  'Phase 12 — Monthly net profit = gross_profit − OPEX (expenses.net_payable, ISSUED).';

-- Privileges — Service Role only (matches documents / expenses grant pattern)
GRANT SELECT ON public.vw_sales_profit_analysis TO service_role;
GRANT SELECT ON public.vw_monthly_profit_summary TO service_role;
