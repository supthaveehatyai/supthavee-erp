-- =============================================================================
-- Phase 14 — Fixed Asset Management (Register + Categories)
-- Cloud-First: รัน SQL นี้บน Supabase Cloud SQL Editor ก่อน
-- จากนั้น: npx supabase gen types typescript --project-id <PROJECT_ID> > src/types/supabase.ts
-- Access: Service Role only (Zero Client-Side Fetching / RLS deny client)
-- =============================================================================

-- 1) Master: asset categories (รองรับ Straight-line ในเฟสถัดไป)
CREATE TABLE IF NOT EXISTS public.mst_asset_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code VARCHAR(20) NOT NULL,
  category_name VARCHAR(100) NOT NULL,
  useful_life_years INTEGER NOT NULL DEFAULT 5
    CHECK (useful_life_years > 0 AND useful_life_years <= 100),
  depreciation_method VARCHAR(30) NOT NULL DEFAULT 'STRAIGHT_LINE'
    CHECK (depreciation_method IN ('STRAIGHT_LINE')),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mst_asset_categories_code_key UNIQUE (category_code),
  CONSTRAINT mst_asset_categories_name_key UNIQUE (category_name)
);

COMMENT ON TABLE public.mst_asset_categories IS
  'Phase 14 — Fixed asset category master (useful life for straight-line depreciation)';
COMMENT ON COLUMN public.mst_asset_categories.useful_life_years IS
  'Default useful life (years) inherited when registering an asset';
COMMENT ON COLUMN public.mst_asset_categories.depreciation_method IS
  'ERP default: STRAIGHT_LINE only in Phase 14 foundation';

-- 2) Fixed asset register
CREATE TABLE IF NOT EXISTS public.fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code VARCHAR(50) NOT NULL,
  asset_name VARCHAR(200) NOT NULL,
  category_id UUID NOT NULL
    REFERENCES public.mst_asset_categories(id) ON DELETE RESTRICT,
  location VARCHAR(200),
  purchase_date DATE NOT NULL,
  acquisition_cost DECIMAL(15, 2) NOT NULL DEFAULT 0
    CHECK (acquisition_cost >= 0),
  salvage_value DECIMAL(15, 2) NOT NULL DEFAULT 0
    CHECK (salvage_value >= 0),
  useful_life_years INTEGER
    CHECK (useful_life_years IS NULL OR (useful_life_years > 0 AND useful_life_years <= 100)),
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  remark TEXT,
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fixed_assets_code_key UNIQUE (asset_code),
  CONSTRAINT fixed_assets_status_check
    CHECK (status IN ('ACTIVE', 'DISPOSED', 'UNDER_MAINTENANCE')),
  CONSTRAINT fixed_assets_salvage_lte_cost_check
    CHECK (salvage_value <= acquisition_cost)
);

COMMENT ON TABLE public.fixed_assets IS
  'Phase 14 — Fixed asset register (acquisition cost basis for depreciation)';
COMMENT ON COLUMN public.fixed_assets.acquisition_cost IS
  'Historical cost (ราคาทุน) — never mutate after ISSUED depreciation starts';
COMMENT ON COLUMN public.fixed_assets.status IS
  'ACTIVE | DISPOSED | UNDER_MAINTENANCE — soft dispose only (no hard delete)';

-- 3) Indexes
CREATE INDEX IF NOT EXISTS idx_mst_asset_categories_active_name
  ON public.mst_asset_categories (is_active, category_name);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_status
  ON public.fixed_assets (status);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_category_id
  ON public.fixed_assets (category_id);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_purchase_date
  ON public.fixed_assets (purchase_date DESC);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_code_name
  ON public.fixed_assets (asset_code, asset_name);

-- 4) RLS — deny anon/authenticated; service_role bypasses RLS
ALTER TABLE public.mst_asset_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Strict Server-Side Only - Asset Categories"
  ON public.mst_asset_categories;
CREATE POLICY "Strict Server-Side Only - Asset Categories"
  ON public.mst_asset_categories
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Strict Server-Side Only - Fixed Assets"
  ON public.fixed_assets;
CREATE POLICY "Strict Server-Side Only - Fixed Assets"
  ON public.fixed_assets
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.mst_asset_categories FROM anon, authenticated;
REVOKE ALL ON TABLE public.fixed_assets FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mst_asset_categories TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fixed_assets TO service_role;

-- 5) updated_at triggers
DROP TRIGGER IF EXISTS trg_mst_asset_categories_updated_at ON public.mst_asset_categories;
CREATE TRIGGER trg_mst_asset_categories_updated_at
  BEFORE UPDATE ON public.mst_asset_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_fixed_assets_updated_at ON public.fixed_assets;
CREATE TRIGGER trg_fixed_assets_updated_at
  BEFORE UPDATE ON public.fixed_assets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 6) Seed starter categories (Thai SME / retail + production)
INSERT INTO public.mst_asset_categories (
  category_code,
  category_name,
  useful_life_years,
  description
)
VALUES
  ('BLDG', 'อาคารและสิ่งปลูกสร้าง', 20, 'อาคารสำนักงาน / โกดัง'),
  ('MACH', 'เครื่องจักรและอุปกรณ์ผลิต', 5, 'เครื่องสกรีน ปัก เย็บ'),
  ('COMP', 'คอมพิวเตอร์และไอที', 3, 'คอมพิวเตอร์ เซิร์ฟเวอร์ เครือข่าย'),
  ('FURN', 'เฟอร์นิเจอร์และตกแต่ง', 5, 'โต๊ะ เก้าอี้ ชั้นวาง'),
  ('VEHL', 'ยานพาหนะ', 5, 'รถยนต์ รถกระบะ รถส่งของ'),
  ('TOOL', 'เครื่องมือและอุปกรณ์', 5, 'เครื่องมือช่างและอุปกรณ์ทั่วไป')
ON CONFLICT (category_code) DO NOTHING;
