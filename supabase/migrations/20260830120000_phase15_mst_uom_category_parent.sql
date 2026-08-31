-- =============================================================================
-- Phase 15 — Inventory & Material Management (schema upgrade)
-- 1) Master UoM: mst_uom + seed
-- 2) product_models.base_uom_id → mst_uom(uom_id)
-- 3) mst_categories.parent_id → mst_categories(id)  [sub-categories]
-- 4) Seed mst_genders: code 'N' / name 'None/ไม่ระบุ' (idempotent)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) mst_uom
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mst_uom (
  uom_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uom_code VARCHAR(10) NOT NULL,
  uom_name VARCHAR(50) NOT NULL,
  CONSTRAINT mst_uom_uom_code_unique UNIQUE (uom_code)
);

COMMENT ON TABLE public.mst_uom IS
  'Master — หน่วยนับสินค้า / วัตถุดิบ (Unit of Measure)';
COMMENT ON COLUMN public.mst_uom.uom_code IS
  'รหัสหน่วยนับ เช่น PCS, KGS, ROL, DZN, MTR';
COMMENT ON COLUMN public.mst_uom.uom_name IS
  'ชื่อหน่วยนับภาษาไทย/อังกฤษ';

CREATE INDEX IF NOT EXISTS idx_mst_uom_uom_code
  ON public.mst_uom (uom_code);

-- RLS + privileges (read for anon/authenticated; writes via service_role)
ALTER TABLE public.mst_uom ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mst_uom FROM PUBLIC;
GRANT SELECT ON TABLE public.mst_uom TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mst_uom TO service_role;

DROP POLICY IF EXISTS "Enable public read access" ON public.mst_uom;
CREATE POLICY "Enable public read access"
  ON public.mst_uom
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "mst_uom_service_role_all" ON public.mst_uom;
CREATE POLICY "mst_uom_service_role_all"
  ON public.mst_uom
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Seed UoM (idempotent on uom_code)
INSERT INTO public.mst_uom (uom_code, uom_name)
VALUES
  ('PCS', 'ตัว'),
  ('KGS', 'กิโลกรัม'),
  ('ROL', 'ม้วน'),
  ('DZN', 'โหล'),
  ('MTR', 'เมตร')
ON CONFLICT (uom_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) product_models.base_uom_id
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_models
  ADD COLUMN IF NOT EXISTS base_uom_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'product_models_base_uom_id_fkey'
      AND conrelid = 'public.product_models'::regclass
  ) THEN
    ALTER TABLE public.product_models
      ADD CONSTRAINT product_models_base_uom_id_fkey
      FOREIGN KEY (base_uom_id)
      REFERENCES public.mst_uom (uom_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_models_base_uom_id
  ON public.product_models (base_uom_id);

COMMENT ON COLUMN public.product_models.base_uom_id IS
  'หน่วยนับหลักของรุ่นสินค้า / วัตถุดิบ → mst_uom.uom_id';

-- ---------------------------------------------------------------------------
-- 3) mst_categories.parent_id (sub-categories)
--    PK ของตารางจริงคือ id (ไม่มี category_id)
-- ---------------------------------------------------------------------------
ALTER TABLE public.mst_categories
  ADD COLUMN IF NOT EXISTS parent_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mst_categories_parent_id_fkey'
      AND conrelid = 'public.mst_categories'::regclass
  ) THEN
    ALTER TABLE public.mst_categories
      ADD CONSTRAINT mst_categories_parent_id_fkey
      FOREIGN KEY (parent_id)
      REFERENCES public.mst_categories (id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mst_categories_parent_id
  ON public.mst_categories (parent_id);

COMMENT ON COLUMN public.mst_categories.parent_id IS
  'หมวดหมู่แม่ (NULL = root) → mst_categories.id สำหรับ sub-categories';

-- ---------------------------------------------------------------------------
-- 4) Seed mst_genders — None / ไม่ระบุ
-- ---------------------------------------------------------------------------
INSERT INTO public.mst_genders (gender_code, gender_name, is_active)
SELECT 'N', 'None/ไม่ระบุ', TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM public.mst_genders
  WHERE gender_code = 'N'
);
