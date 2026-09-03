-- =============================================================================
-- product_models.is_manufactured — Make vs Buy (In-house Production)
-- =============================================================================

ALTER TABLE public.product_models
  ADD COLUMN IF NOT EXISTS is_manufactured BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.product_models.is_manufactured IS
  'Make vs Buy: true = ผลิตเอง (In-house) — vendor_id ว่างได้ ต้นทุนผ่าน BOM';

CREATE INDEX IF NOT EXISTS idx_product_models_is_manufactured
  ON public.product_models (is_manufactured)
  WHERE is_manufactured = true;
