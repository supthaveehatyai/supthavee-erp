-- =============================================================================
-- Phase 14 — Period Closing & Maker-Checker foundation
-- File: 20260820052415_period_closing_and_approval.sql
-- =============================================================================
-- - accounting_periods: monthly close lock
-- - documents / expenses: approval_status, approved_by, approved_at
-- - is_period_closed(doc_date): used by RLS
-- - RESTRICTIVE RLS: block INSERT/UPDATE/DELETE on closed months
-- - Trigger: same lock for service_role (BYPASSRLS) used by Server Actions
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) accounting_periods
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounting_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT accounting_periods_year_check
    CHECK (period_year >= 2000 AND period_year <= 2100),
  CONSTRAINT accounting_periods_month_check
    CHECK (period_month >= 1 AND period_month <= 12),
  CONSTRAINT accounting_periods_year_month_key
    UNIQUE (period_year, period_month),
  CONSTRAINT accounting_periods_closed_fields_check
    CHECK (
      (is_closed = false AND closed_at IS NULL)
      OR (is_closed = true AND closed_at IS NOT NULL)
    )
);

COMMENT ON TABLE public.accounting_periods IS
  'Phase 14 — monthly accounting period lock (Period Closing)';
COMMENT ON COLUMN public.accounting_periods.is_closed IS
  'true = งวดถูกปิดแล้ว ห้ามลงรายการเอกสาร/ค่าใช้จ่ายที่ย้อนวันที่ในงวดนี้';

CREATE INDEX IF NOT EXISTS idx_accounting_periods_closed
  ON public.accounting_periods (period_year, period_month)
  WHERE is_closed = true;

DROP TRIGGER IF EXISTS trg_accounting_periods_updated_at ON public.accounting_periods;
CREATE TRIGGER trg_accounting_periods_updated_at
  BEFORE UPDATE ON public.accounting_periods
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.accounting_periods ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.accounting_periods FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.accounting_periods TO service_role;

DROP POLICY IF EXISTS "accounting_periods_service_role_all" ON public.accounting_periods;
CREATE POLICY "accounting_periods_service_role_all"
  ON public.accounting_periods
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "accounting_periods_deny_client" ON public.accounting_periods;
CREATE POLICY "accounting_periods_deny_client"
  ON public.accounting_periods
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- 2) approval columns — documents + expenses
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'approval_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.approval_status AS ENUM (
      'PENDING',
      'APPROVED',
      'REJECTED'
    );
  END IF;
END $$;

COMMENT ON TYPE public.approval_status IS
  'Phase 14 Maker-Checker — PENDING | APPROVED | REJECTED';

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS approval_status public.approval_status NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS approval_status public.approval_status NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

COMMENT ON COLUMN public.documents.approval_status IS
  'Maker-Checker: เอกสารเดิม default APPROVED เพื่อไม่บล็อกงานที่ออกไปแล้ว';
COMMENT ON COLUMN public.expenses.approval_status IS
  'Maker-Checker: รายการเดิม default APPROVED เพื่อไม่บล็อก OPEX ที่ออกไปแล้ว';

CREATE INDEX IF NOT EXISTS idx_documents_approval_status
  ON public.documents (approval_status);

CREATE INDEX IF NOT EXISTS idx_expenses_approval_status
  ON public.expenses (approval_status);

-- ---------------------------------------------------------------------------
-- 3) is_period_closed(doc_date)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_period_closed(doc_date date)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  closed boolean;
BEGIN
  IF doc_date IS NULL THEN
    RETURN false;
  END IF;

  SELECT ap.is_closed
    INTO closed
  FROM public.accounting_periods ap
  WHERE ap.period_year = EXTRACT(YEAR FROM doc_date)::integer
    AND ap.period_month = EXTRACT(MONTH FROM doc_date)::integer
  LIMIT 1;

  RETURN COALESCE(closed, false);
END;
$$;

COMMENT ON FUNCTION public.is_period_closed(date) IS
  'true เมื่องวดปี-เดือนของวันที่เอกสารถูกปิดงบ (ไม่มีแถว = ยังไม่ปิด)';

REVOKE ALL ON FUNCTION public.is_period_closed(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_period_closed(date) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) RESTRICTIVE RLS — ห้ามเขียนถ้าเดือนถูกปิด (ไม่เปิดสิทธิ์ client เพิ่ม)
--    service_role มี BYPASSRLS จึงต้องมี trigger ในข้อ 5
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "documents_period_open_insert" ON public.documents;
CREATE POLICY "documents_period_open_insert"
  ON public.documents
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon, service_role
  WITH CHECK (NOT public.is_period_closed(doc_date));

DROP POLICY IF EXISTS "documents_period_open_update" ON public.documents;
CREATE POLICY "documents_period_open_update"
  ON public.documents
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated, anon, service_role
  USING (NOT public.is_period_closed(doc_date))
  WITH CHECK (NOT public.is_period_closed(doc_date));

DROP POLICY IF EXISTS "documents_period_open_delete" ON public.documents;
CREATE POLICY "documents_period_open_delete"
  ON public.documents
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated, anon, service_role
  USING (NOT public.is_period_closed(doc_date));

DROP POLICY IF EXISTS "expenses_period_open_insert" ON public.expenses;
CREATE POLICY "expenses_period_open_insert"
  ON public.expenses
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon, service_role
  WITH CHECK (NOT public.is_period_closed(expense_date));

DROP POLICY IF EXISTS "expenses_period_open_update" ON public.expenses;
CREATE POLICY "expenses_period_open_update"
  ON public.expenses
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated, anon, service_role
  USING (NOT public.is_period_closed(expense_date))
  WITH CHECK (NOT public.is_period_closed(expense_date));

DROP POLICY IF EXISTS "expenses_period_open_delete" ON public.expenses;
CREATE POLICY "expenses_period_open_delete"
  ON public.expenses
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated, anon, service_role
  USING (NOT public.is_period_closed(expense_date));

-- ---------------------------------------------------------------------------
-- 5) Trigger — บังคับ Period Lock แม้ใช้ supabaseAdmin (service_role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_open_accounting_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_date date;
  new_date date;
BEGIN
  IF TG_TABLE_NAME = 'expenses' THEN
    IF TG_OP = 'DELETE' THEN
      old_date := OLD.expense_date;
    ELSE
      new_date := NEW.expense_date;
      IF TG_OP = 'UPDATE' THEN
        old_date := OLD.expense_date;
      END IF;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      old_date := OLD.doc_date;
    ELSE
      new_date := NEW.doc_date;
      IF TG_OP = 'UPDATE' THEN
        old_date := OLD.doc_date;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF public.is_period_closed(old_date) THEN
      RAISE EXCEPTION 'ช่วงบัญชีนี้ถูกปิดงบแล้ว ไม่สามารถลบเอกสารได้'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND public.is_period_closed(old_date) THEN
    RAISE EXCEPTION 'ช่วงบัญชีนี้ถูกปิดงบแล้ว ไม่สามารถแก้ไขเอกสารได้'
      USING ERRCODE = 'P0001';
  END IF;

  IF public.is_period_closed(new_date) THEN
    RAISE EXCEPTION 'ช่วงบัญชีนี้ถูกปิดงบแล้ว ไม่สามารถบันทึกเอกสารได้'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documents_enforce_open_period ON public.documents;
CREATE TRIGGER trg_documents_enforce_open_period
  BEFORE INSERT OR UPDATE OR DELETE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_open_accounting_period();

DROP TRIGGER IF EXISTS trg_expenses_enforce_open_period ON public.expenses;
CREATE TRIGGER trg_expenses_enforce_open_period
  BEFORE INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_open_accounting_period();
