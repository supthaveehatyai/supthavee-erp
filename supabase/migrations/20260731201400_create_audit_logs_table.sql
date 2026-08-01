-- =============================================================================
-- Phase 6 — Audit Trail (Row-level INSERT / UPDATE / DELETE)
-- File: 20260731201400_create_audit_logs_table.sql
-- =============================================================================
-- Rebuilds the Phase-1 stub `public.audit_logs` into an append-only change log.
-- Access: Service Role only (Zero Client-Side Fetching). No anon/auth policies.
-- =============================================================================

-- 0) Drop Phase-1 stub (seed has no audit rows — safe rebuild)
DROP TABLE IF EXISTS public.audit_logs CASCADE;

-- 1) Action enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'audit_action_type' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.audit_action_type AS ENUM ('INSERT', 'UPDATE', 'DELETE');
  END IF;
END $$;

COMMENT ON TYPE public.audit_action_type IS
  'Phase 6 Audit Trail — row-level mutation verbs';

-- 2) audit_logs
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name VARCHAR(100) NOT NULL,
  record_id VARCHAR(100) NOT NULL,
  action public.audit_action_type NOT NULL,
  old_data JSONB,
  new_data JSONB,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_address VARCHAR(45),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by_name VARCHAR(100),
  correlation_id UUID
);

COMMENT ON TABLE public.audit_logs IS
  'Phase 6 append-only row audit. Written via service_role Server Actions or DB triggers only.';

COMMENT ON COLUMN public.audit_logs.table_name IS
  'Logical source table e.g. documents, products, contacts';
COMMENT ON COLUMN public.audit_logs.record_id IS
  'Primary key of the mutated row (stored as text for UUID/varchar PKs)';
COMMENT ON COLUMN public.audit_logs.old_data IS
  'JSONB snapshot BEFORE mutation (null on INSERT)';
COMMENT ON COLUMN public.audit_logs.new_data IS
  'JSONB snapshot AFTER mutation (null on DELETE)';

-- 3) Indexes
CREATE INDEX idx_audit_logs_table_name
  ON public.audit_logs (table_name);

CREATE INDEX idx_audit_logs_record_id
  ON public.audit_logs (record_id);

CREATE INDEX idx_audit_logs_changed_by
  ON public.audit_logs (changed_by);

CREATE INDEX idx_audit_logs_changed_at
  ON public.audit_logs (changed_at DESC);

CREATE INDEX idx_audit_logs_table_record_at
  ON public.audit_logs (table_name, record_id, changed_at DESC);

-- 4) Append-only hard lock
CREATE OR REPLACE FUNCTION public.fn_audit_logs_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only — UPDATE/DELETE forbidden'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_no_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_audit_logs_forbid_mutation();

DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_no_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_audit_logs_forbid_mutation();

-- 5) RLS — deny client paths; service_role bypasses RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.audit_logs FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.audit_logs TO service_role;

-- 6) Generic row-audit trigger helper (attach to tables in a later migration)
CREATE OR REPLACE FUNCTION public.fn_write_row_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record_id TEXT;
  v_actor UUID;
BEGIN
  v_actor := auth.uid();

  IF TG_OP = 'INSERT' THEN
    v_record_id := NEW.id::text;
    INSERT INTO public.audit_logs (table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, v_record_id, 'INSERT', NULL, to_jsonb(NEW), v_actor);
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    v_record_id := NEW.id::text;
    INSERT INTO public.audit_logs (table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, v_record_id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), v_actor);
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    v_record_id := OLD.id::text;
    INSERT INTO public.audit_logs (table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, v_record_id, 'DELETE', to_jsonb(OLD), NULL, v_actor);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.fn_write_row_audit() IS
  'Phase 6 — attach AFTER INSERT OR UPDATE OR DELETE on audited tables when ready.';

GRANT EXECUTE ON FUNCTION public.fn_write_row_audit() TO service_role;
