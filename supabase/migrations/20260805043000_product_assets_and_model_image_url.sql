-- =============================================================================
-- Phase 10 / 11 prep — Product Assets Storage + product_models.image_url
-- File: 20260805043000_product_assets_and_model_image_url.sql
-- =============================================================================
-- 1) Storage bucket product_assets (รูปภาพสินค้าระดับ Model)
-- 2) product_models.image_url — Public URL สำหรับ Visual Verification
-- Uploads: Server Actions + service_role (Zero Client-Side Fetching)
-- Public SELECT: แสดงรูปบน UI / เอกสารได้โดยไม่ต้อง login
-- =============================================================================

-- ==========================================
-- 1. Storage Bucket: product_assets
-- ==========================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product_assets',
  'product_assets',
  true,
  5242880, -- 5 MB
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ==========================================
-- 2. RLS Policies: storage.objects / product_assets
-- ==========================================
DROP POLICY IF EXISTS "Public Access to Product Assets" ON storage.objects;
DROP POLICY IF EXISTS "Admin CRUD Product Assets" ON storage.objects;
DROP POLICY IF EXISTS "product_assets_service_role_insert" ON storage.objects;
DROP POLICY IF EXISTS "product_assets_service_role_select" ON storage.objects;
DROP POLICY IF EXISTS "product_assets_service_role_update" ON storage.objects;
DROP POLICY IF EXISTS "product_assets_service_role_delete" ON storage.objects;

-- Public read — รูปสินค้าบน UI / บิลพิมพ์ (รวม anon)
CREATE POLICY "Public Access to Product Assets"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'product_assets');

-- Admin manage via Auth UI path (fn_is_admin กัน RLS recursion)
CREATE POLICY "Admin CRUD Product Assets"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'product_assets'
    AND public.fn_is_admin()
  )
  WITH CHECK (
    bucket_id = 'product_assets'
    AND public.fn_is_admin()
  );

-- Service Role — Zero Client-Side Fetching uploads จาก Server Actions
CREATE POLICY "product_assets_service_role_insert"
  ON storage.objects
  FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'product_assets');

CREATE POLICY "product_assets_service_role_select"
  ON storage.objects
  FOR SELECT
  TO service_role
  USING (bucket_id = 'product_assets');

CREATE POLICY "product_assets_service_role_update"
  ON storage.objects
  FOR UPDATE
  TO service_role
  USING (bucket_id = 'product_assets')
  WITH CHECK (bucket_id = 'product_assets');

CREATE POLICY "product_assets_service_role_delete"
  ON storage.objects
  FOR DELETE
  TO service_role
  USING (bucket_id = 'product_assets');

-- ==========================================
-- 3. product_models.image_url
-- ==========================================
ALTER TABLE public.product_models
  ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMENT ON COLUMN public.product_models.image_url IS
  'Public URL of product model image in storage bucket product_assets (Visual Verification).';
