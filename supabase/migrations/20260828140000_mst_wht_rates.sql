-- =============================================================================
-- Master Data — Withholding Tax (WHT) rate presets
-- Table: mst_wht_rates
-- RLS: authenticated SELECT; writes via service_role (Server Actions)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.mst_wht_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wht_name VARCHAR(150) NOT NULL,
  wht_rate NUMERIC(5, 2) NOT NULL CHECK (wht_rate >= 0 AND wht_rate <= 100),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mst_wht_rates_wht_name_unique UNIQUE (wht_name)
);

COMMENT ON TABLE public.mst_wht_rates IS
  'Master — อัตราหัก ณ ที่จ่ายมาตรฐานสำหรับเอกสารค่าใช้จ่าย (OPEX)';
COMMENT ON COLUMN public.mst_wht_rates.wht_name IS
  'ชื่อประเภทเงินได้ที่จ่าย เช่น ค่าขนส่ง, ค่าเช่า';
COMMENT ON COLUMN public.mst_wht_rates.wht_rate IS
  'อัตราหัก ณ ที่จ่าย (%)';

CREATE INDEX IF NOT EXISTS idx_mst_wht_rates_active_name
  ON public.mst_wht_rates (is_active, wht_name);

DROP TRIGGER IF EXISTS trg_mst_wht_rates_updated_at ON public.mst_wht_rates;
CREATE TRIGGER trg_mst_wht_rates_updated_at
  BEFORE UPDATE ON public.mst_wht_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS — authenticated read-only
-- ---------------------------------------------------------------------------
ALTER TABLE public.mst_wht_rates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mst_wht_rates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mst_wht_rates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mst_wht_rates TO service_role;

DROP POLICY IF EXISTS "mst_wht_rates_authenticated_select" ON public.mst_wht_rates;
CREATE POLICY "mst_wht_rates_authenticated_select"
  ON public.mst_wht_rates
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "mst_wht_rates_service_role_all" ON public.mst_wht_rates;
CREATE POLICY "mst_wht_rates_service_role_all"
  ON public.mst_wht_rates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "mst_wht_rates_deny_authenticated_write" ON public.mst_wht_rates;
CREATE POLICY "mst_wht_rates_deny_authenticated_write"
  ON public.mst_wht_rates
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "mst_wht_rates_deny_authenticated_update" ON public.mst_wht_rates;
CREATE POLICY "mst_wht_rates_deny_authenticated_update"
  ON public.mst_wht_rates
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "mst_wht_rates_deny_authenticated_delete" ON public.mst_wht_rates;
CREATE POLICY "mst_wht_rates_deny_authenticated_delete"
  ON public.mst_wht_rates
  FOR DELETE
  TO authenticated
  USING (false);

-- ---------------------------------------------------------------------------
-- Seed — standard Thai WHT presets (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO public.mst_wht_rates (wht_name, wht_rate, is_active)
VALUES
  ('ค่าขนส่ง', 1.00, true),
  ('ค่าโฆษณา', 2.00, true),
  ('ค่าบริการ/รับเหมา/วิชาชีพอิสระ', 3.00, true),
  ('ค่าเช่า', 5.00, true)
ON CONFLICT (wht_name) DO NOTHING;
