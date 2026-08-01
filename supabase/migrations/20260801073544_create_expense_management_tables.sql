-- =============================================================================
-- Phase 8 — Expense Management (Master Categories + Expense Records)
-- File: 20260801073544_create_expense_management_tables.sql
-- Access: Service Role only (Zero Client-Side Fetching / RLS deny client)
-- =============================================================================

-- 1) Master: expense categories
CREATE TABLE IF NOT EXISTS public.mst_expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.mst_expense_categories IS
  'Phase 8 — Chart of Accounts (expense categories) master data';

-- 2) Expense records (Late Numbering via document_no DRAFT-...)
CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_no VARCHAR(50) NOT NULL UNIQUE,
  expense_date DATE NOT NULL,
  category_id UUID REFERENCES public.mst_expense_categories(id) ON DELETE RESTRICT,
  net_amount DECIMAL(15, 2) NOT NULL DEFAULT 0 CHECK (net_amount >= 0),
  vat_amount DECIMAL(15, 2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  grand_total DECIMAL(15, 2) GENERATED ALWAYS AS (net_amount + vat_amount) STORED,
  payment_method VARCHAR(50),
  receipt_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  remark TEXT,
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expenses_status_check
    CHECK (status IN ('DRAFT', 'ISSUED', 'VOID'))
);

COMMENT ON TABLE public.expenses IS
  'Phase 8 — OPEX expense records. Late Numbering: DRAFT-* until ISSUED.';
COMMENT ON COLUMN public.expenses.document_no IS
  'Temporary DRAFT-YYYYMMDDHHmmss at create; official EXP-YYMM-XXXX on issue (future RPC).';
COMMENT ON COLUMN public.expenses.grand_total IS
  'Generated: net_amount + vat_amount (DB-level).';

-- 3) Indexes
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date
  ON public.expenses (expense_date DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_category_id
  ON public.expenses (category_id);

CREATE INDEX IF NOT EXISTS idx_expenses_status
  ON public.expenses (status);

CREATE INDEX IF NOT EXISTS idx_mst_expense_categories_active_name
  ON public.mst_expense_categories (is_active, category_name);

-- 4) RLS — deny anon/authenticated; service_role bypasses RLS
ALTER TABLE public.mst_expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Strict Server-Side Only - Categories"
  ON public.mst_expense_categories;
CREATE POLICY "Strict Server-Side Only - Categories"
  ON public.mst_expense_categories
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Strict Server-Side Only - Expenses"
  ON public.expenses;
CREATE POLICY "Strict Server-Side Only - Expenses"
  ON public.expenses
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.mst_expense_categories FROM anon, authenticated;
REVOKE ALL ON TABLE public.expenses FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mst_expense_categories TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expenses TO service_role;

-- 5) updated_at trigger (function created in Phase 5 finance init)
DROP TRIGGER IF EXISTS trg_expenses_updated_at ON public.expenses;
CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 6) Seed starter categories
INSERT INTO public.mst_expense_categories (category_name, description)
VALUES
  ('ค่าขนส่ง', 'ค่าขนส่งสินค้า / ค่าจัดส่ง'),
  ('ค่าน้ำ-ไฟ', 'สาธารณูปโภค ค่าน้ำ ค่าไฟ'),
  ('เงินเดือน', 'เงินเดือนและค่าจ้างพนักงาน'),
  ('ค่าวัสดุสิ้นเปลือง', 'วัสดุสำนักงานและของใช้สิ้นเปลือง'),
  ('ค่าใช้จ่ายสำนักงาน', 'ค่าใช้จ่ายดำเนินงานทั่วไป'),
  ('อื่นๆ', 'ค่าใช้จ่ายไม่อยู่ในหมวดหลัก')
ON CONFLICT (category_name) DO NOTHING;
