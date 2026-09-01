-- =============================================================================
-- Bill of Materials (product_boms) — สูตรการผลิตต่อรุ่นสินค้าสำเร็จรูป
-- Zero Client-Side Fetching: writes via service_role only
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.product_boms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finished_model_id UUID NOT NULL
    REFERENCES public.product_models(id) ON DELETE CASCADE,
  raw_material_model_id UUID NOT NULL
    REFERENCES public.product_models(id) ON DELETE CASCADE,
  uom_id UUID NOT NULL
    REFERENCES public.mst_uom(uom_id),
  quantity_required NUMERIC(14, 4) NOT NULL
    CONSTRAINT product_boms_quantity_required_positive
    CHECK (quantity_required > 0),
  waste_percent NUMERIC(6, 2) NOT NULL DEFAULT 0
    CONSTRAINT product_boms_waste_percent_non_negative
    CHECK (waste_percent >= 0),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_boms_finished_raw_material_unique
    UNIQUE (finished_model_id, raw_material_model_id),
  CONSTRAINT product_boms_no_self_reference
    CHECK (finished_model_id <> raw_material_model_id)
);

COMMENT ON TABLE public.product_boms IS
  'สูตรการผลิต (BOM) — วัตถุดิบต่อ 1 หน่วยสินค้าสำเร็จรูป';
COMMENT ON COLUMN public.product_boms.quantity_required IS
  'ปริมาณที่ใช้ต่อ 1 หน่วยสินค้าสำเร็จรูป';
COMMENT ON COLUMN public.product_boms.waste_percent IS
  'เปอร์เซ็นต์เผื่อเสีย (%)';

CREATE INDEX IF NOT EXISTS idx_product_boms_finished_model_id
  ON public.product_boms (finished_model_id);

CREATE INDEX IF NOT EXISTS idx_product_boms_raw_material_model_id
  ON public.product_boms (raw_material_model_id);

ALTER TABLE public.product_boms ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.product_boms FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_boms TO service_role;

DROP POLICY IF EXISTS "product_boms_service_role_all" ON public.product_boms;
CREATE POLICY "product_boms_service_role_all"
  ON public.product_boms
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
