-- Replace authenticated-only SELECT policies with public read (anon + authenticated)
-- for local development comboboxes. INSERT/UPDATE/DELETE on vendor_product_mapping
-- remain TO authenticated only (unchanged).

-- Ensure base roles can access tables (RLS still controls row-level reads)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- contacts
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.contacts;
DROP POLICY IF EXISTS "Enable public read access" ON public.contacts;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable public read access"
  ON public.contacts
  FOR SELECT
  USING (true);

-- contact_persons
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.contact_persons;
DROP POLICY IF EXISTS "Enable public read access" ON public.contact_persons;
ALTER TABLE public.contact_persons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable public read access"
  ON public.contact_persons
  FOR SELECT
  USING (true);

-- mst_brands
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.mst_brands;
DROP POLICY IF EXISTS "Enable public read access" ON public.mst_brands;
ALTER TABLE public.mst_brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable public read access"
  ON public.mst_brands
  FOR SELECT
  USING (true);

-- mst_categories
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.mst_categories;
DROP POLICY IF EXISTS "Enable public read access" ON public.mst_categories;
ALTER TABLE public.mst_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable public read access"
  ON public.mst_categories
  FOR SELECT
  USING (true);

-- mst_colors
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.mst_colors;
DROP POLICY IF EXISTS "Enable public read access" ON public.mst_colors;
ALTER TABLE public.mst_colors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable public read access"
  ON public.mst_colors
  FOR SELECT
  USING (true);

-- mst_sizes
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.mst_sizes;
DROP POLICY IF EXISTS "Enable public read access" ON public.mst_sizes;
ALTER TABLE public.mst_sizes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable public read access"
  ON public.mst_sizes
  FOR SELECT
  USING (true);

-- product_models
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.product_models;
DROP POLICY IF EXISTS "Enable public read access" ON public.product_models;
ALTER TABLE public.product_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable public read access"
  ON public.product_models
  FOR SELECT
  USING (true);

-- products
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.products;
DROP POLICY IF EXISTS "Enable public read access" ON public.products;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable public read access"
  ON public.products
  FOR SELECT
  USING (true);
