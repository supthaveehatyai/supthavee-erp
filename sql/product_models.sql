-- Base product models (pre color × size SKU expansion)
CREATE TABLE IF NOT EXISTS product_models (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  brand_id UUID NOT NULL REFERENCES mst_brands(id) ON DELETE RESTRICT,
  category_id UUID NOT NULL REFERENCES mst_categories(id) ON DELETE RESTRICT,
  vendor_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  model_code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  short_name VARCHAR(100),
  gender VARCHAR(50) DEFAULT 'Unisex',
  tax_type VARCHAR(20) DEFAULT 'INC_VAT'
    CHECK (tax_type IN ('INC_VAT', 'EXC_VAT', 'NON_VAT')),
  size_pricing_config JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ACTIVE')),
  UNIQUE (brand_id, category_id, model_code, gender)
);

CREATE INDEX IF NOT EXISTS idx_product_models_brand_id
  ON product_models (brand_id);

CREATE INDEX IF NOT EXISTS idx_product_models_category_id
  ON product_models (category_id);

CREATE INDEX IF NOT EXISTS idx_product_models_model_code
  ON product_models (model_code);

CREATE INDEX IF NOT EXISTS idx_product_models_status
  ON product_models (status);

-- Link SKUs → parent model
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS model_id UUID REFERENCES product_models(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_model_id ON products (model_id);

-- Migrate existing product_models tables (safe / idempotent)
ALTER TABLE product_models
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS short_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS tax_type VARCHAR(20) DEFAULT 'INC_VAT',
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS size_pricing_config JSONB DEFAULT '[]'::jsonb;

-- Backfill status for rows that predate the column
UPDATE product_models SET status = 'ACTIVE' WHERE status IS NULL;
