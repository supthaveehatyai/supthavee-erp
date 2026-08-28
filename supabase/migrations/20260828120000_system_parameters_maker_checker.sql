-- =============================================================================
-- Phase 15 — System Parameters + Maker-Checker Change Requests (Cloud-aligned)
-- Aligns with existing Cloud tables:
--   system_parameters (param_key PK)
--   parameter_change_requests (id PK, param_key FK)
-- RLS:
--   system_parameters → authenticated SELECT, writes service_role only
--   parameter_change_requests → service_role only (Server Actions)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) system_parameters — extend existing table + comments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_parameters (
  param_key VARCHAR(100) PRIMARY KEY,
  param_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  data_type VARCHAR(50) NOT NULL DEFAULT 'json',
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.system_parameters
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS data_type VARCHAR(50) NOT NULL DEFAULT 'json',
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS is_sensitive BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON TABLE public.system_parameters IS
  'Phase 15 — Runtime system config (current values). Read: authenticated RLS; Write: service_role via approved change requests only.';
COMMENT ON COLUMN public.system_parameters.param_key IS
  'Stable uppercase key e.g. ARCHIVE_COLD_AGE_DAYS, DEFAULT_VAT_RATE';
COMMENT ON COLUMN public.system_parameters.param_value IS
  'JSONB payload — scalar or structured config';
COMMENT ON COLUMN public.system_parameters.data_type IS
  'Value hint for UI/validation: string | number | boolean | json';
COMMENT ON COLUMN public.system_parameters.is_sensitive IS
  'true = mask in UI (secrets still via env, not stored here)';

CREATE INDEX IF NOT EXISTS idx_system_parameters_category
  ON public.system_parameters (category);

CREATE INDEX IF NOT EXISTS idx_system_parameters_updated_at
  ON public.system_parameters (updated_at DESC);

-- ---------------------------------------------------------------------------
-- 2) parameter_change_requests — extend existing Maker-Checker queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.parameter_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  param_key VARCHAR(100) NOT NULL REFERENCES public.system_parameters(param_key) ON DELETE CASCADE,
  old_value JSONB,
  new_value JSONB NOT NULL,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE public.parameter_change_requests
  ADD COLUMN IF NOT EXISTS old_value JSONB,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS change_reason TEXT,
  ADD COLUMN IF NOT EXISTS review_comment TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON TABLE public.parameter_change_requests IS
  'Phase 15 Maker-Checker — คำขอแก้ system_parameters; อ่าน/เขียนผ่าน service_role (Server Actions) เท่านั้น';
COMMENT ON COLUMN public.parameter_change_requests.approved_by IS
  'Checker (ผู้อนุมัติ/ปฏิเสธ) — set when status leaves PENDING';
COMMENT ON COLUMN public.parameter_change_requests.resolved_at IS
  'Timestamp when request was APPROVED/REJECTED and applied (if approved)';

CREATE INDEX IF NOT EXISTS idx_parameter_change_requests_status
  ON public.parameter_change_requests (status);

CREATE INDEX IF NOT EXISTS idx_parameter_change_requests_param_key
  ON public.parameter_change_requests (param_key);

CREATE INDEX IF NOT EXISTS idx_parameter_change_requests_created_at
  ON public.parameter_change_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_parameter_change_requests_pending
  ON public.parameter_change_requests (created_at DESC)
  WHERE status = 'PENDING';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'parameter_change_requests_status_check'
  ) THEN
    ALTER TABLE public.parameter_change_requests
      ADD CONSTRAINT parameter_change_requests_status_check CHECK (
        status IN ('PENDING', 'APPROVED', 'REJECTED')
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) updated_at triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_system_parameters_updated_at ON public.system_parameters;
CREATE TRIGGER trg_system_parameters_updated_at
  BEFORE UPDATE ON public.system_parameters
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_parameter_change_requests_updated_at ON public.parameter_change_requests;
CREATE TRIGGER trg_parameter_change_requests_updated_at
  BEFORE UPDATE ON public.parameter_change_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 4) RLS — system_parameters (authenticated read-only)
-- ---------------------------------------------------------------------------
ALTER TABLE public.system_parameters ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.system_parameters FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.system_parameters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.system_parameters TO service_role;

DROP POLICY IF EXISTS "system_parameters_authenticated_select" ON public.system_parameters;
CREATE POLICY "system_parameters_authenticated_select"
  ON public.system_parameters
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "system_parameters_service_role_all" ON public.system_parameters;
CREATE POLICY "system_parameters_service_role_all"
  ON public.system_parameters
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "system_parameters_deny_authenticated_insert" ON public.system_parameters;
CREATE POLICY "system_parameters_deny_authenticated_insert"
  ON public.system_parameters
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "system_parameters_deny_authenticated_update" ON public.system_parameters;
CREATE POLICY "system_parameters_deny_authenticated_update"
  ON public.system_parameters
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "system_parameters_deny_authenticated_delete" ON public.system_parameters;
CREATE POLICY "system_parameters_deny_authenticated_delete"
  ON public.system_parameters
  FOR DELETE
  TO authenticated
  USING (false);

-- ---------------------------------------------------------------------------
-- 5) RLS — parameter_change_requests (service_role only)
-- ---------------------------------------------------------------------------
ALTER TABLE public.parameter_change_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.parameter_change_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.parameter_change_requests TO service_role;

DROP POLICY IF EXISTS "parameter_change_requests_service_role_all" ON public.parameter_change_requests;
CREATE POLICY "parameter_change_requests_service_role_all"
  ON public.parameter_change_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "parameter_change_requests_deny_client" ON public.parameter_change_requests;
CREATE POLICY "parameter_change_requests_deny_client"
  ON public.parameter_change_requests
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- 6) Seed — starter parameters (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO public.system_parameters (param_key, param_value, description, data_type, category)
VALUES
  (
    'ARCHIVE_COLD_AGE_DAYS',
    '365'::jsonb,
    'อายุไฟล์ (วัน) ก่อนย้ายจาก Cloud ไป NAS',
    'number',
    'storage'
  ),
  (
    'MANUAL_BACKUP_ENABLED',
    'true'::jsonb,
    'เปิดใช้ปุ่ม Manual Backup Request บน Executive Dashboard',
    'boolean',
    'backup'
  )
ON CONFLICT (param_key) DO NOTHING;
