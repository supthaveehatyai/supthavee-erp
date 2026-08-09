-- =============================================================================
-- Phase 10 — Company Assets Storage + branch_name
-- File: 20260805042000_company_assets_and_branch_name.sql
-- =============================================================================
-- 1) system_settings.branch_name (ชื่อสาขาบนเอกสาร)
-- 2) Storage bucket company_assets (โลโก้ / ลายเซ็นอิเล็กทรอนิกส์)
-- Uploads: Server Actions + service_role (Zero Client-Side Fetching)
-- Public SELECT: แสดงโลโก้บนบิลพิมพ์ได้โดยไม่ต้อง login
-- =============================================================================

-- ==========================================
-- 1. เพิ่มคอลัมน์ชื่อสาขา
-- ==========================================
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS branch_name TEXT NOT NULL DEFAULT 'สำนักงานใหญ่';

COMMENT ON COLUMN public.system_settings.branch_name IS
  'ชื่อสาขาที่แสดงบนเอกสาร (เช่น สำนักงานใหญ่)';

UPDATE public.system_settings
SET branch_name = COALESCE(NULLIF(TRIM(branch_name), ''), 'สำนักงานใหญ่')
WHERE id = 1;

-- ==========================================
-- 2. Storage Bucket: company_assets
-- ==========================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company_assets',
  'company_assets',
  true,
  5242880, -- 5 MB
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/svg+xml'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ==========================================
-- 3. RLS Policies: storage.objects / company_assets
-- ==========================================
DROP POLICY IF EXISTS "Public Access to Company Assets" ON storage.objects;
DROP POLICY IF EXISTS "Admin CRUD Company Assets" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_public_select" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_admin_all" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_service_role_insert" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_service_role_select" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_service_role_update" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_service_role_delete" ON storage.objects;

-- Public read — โลโก้บนหน้าบิลพิมพ์ (รวม anon)
CREATE POLICY "Public Access to Company Assets"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'company_assets');

-- Admin manage via Auth UI path (fn_is_admin กัน RLS recursion)
CREATE POLICY "Admin CRUD Company Assets"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'company_assets'
    AND public.fn_is_admin()
  )
  WITH CHECK (
    bucket_id = 'company_assets'
    AND public.fn_is_admin()
  );

-- Service Role — Zero Client-Side Fetching uploads จาก Server Actions
CREATE POLICY "company_assets_service_role_insert"
  ON storage.objects
  FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'company_assets');

CREATE POLICY "company_assets_service_role_select"
  ON storage.objects
  FOR SELECT
  TO service_role
  USING (bucket_id = 'company_assets');

CREATE POLICY "company_assets_service_role_update"
  ON storage.objects
  FOR UPDATE
  TO service_role
  USING (bucket_id = 'company_assets')
  WITH CHECK (bucket_id = 'company_assets');

CREATE POLICY "company_assets_service_role_delete"
  ON storage.objects
  FOR DELETE
  TO service_role
  USING (bucket_id = 'company_assets');
