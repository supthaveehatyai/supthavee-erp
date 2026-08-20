-- =============================================================================
-- Phase 14 — Maker-Checker approval history (approval_logs)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'approval_target_type' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.approval_target_type AS ENUM ('DOCUMENT', 'EXPENSE');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'approval_decision' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.approval_decision AS ENUM ('APPROVED', 'REJECTED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.approval_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type public.approval_target_type NOT NULL,
  target_id UUID NOT NULL,
  decision public.approval_decision NOT NULL,
  comment TEXT,
  previous_status public.approval_status,
  new_status public.approval_status NOT NULL,
  acted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.approval_logs IS
  'Phase 14 Maker-Checker — ประวัติการอนุมัติ/ปฏิเสธ documents และ expenses';
COMMENT ON COLUMN public.approval_logs.comment IS
  'เหตุผล (บังคับเมื่อ decision = REJECTED ที่ชั้น Application)';

CREATE INDEX IF NOT EXISTS idx_approval_logs_target
  ON public.approval_logs (target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_approval_logs_acted_at
  ON public.approval_logs (acted_at DESC);

ALTER TABLE public.approval_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.approval_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.approval_logs TO service_role;

DROP POLICY IF EXISTS "approval_logs_service_role_all" ON public.approval_logs;
CREATE POLICY "approval_logs_service_role_all"
  ON public.approval_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "approval_logs_deny_client" ON public.approval_logs;
CREATE POLICY "approval_logs_deny_client"
  ON public.approval_logs
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);
