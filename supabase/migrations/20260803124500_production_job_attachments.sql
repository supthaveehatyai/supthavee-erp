-- =============================================================================
-- Phase 7 — Production job image attachments (Kanban / MTO)
-- =============================================================================
-- 1) production_jobs.attachment_paths — TEXT[] of storage paths/URLs
-- 2) Storage bucket `production_attachments`
-- Zero Client-Side Fetching: uploads via Server Actions + service_role only.
-- Public SELECT so attachment URLs can render in the browser UI.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Column on production_jobs
-- ---------------------------------------------------------------------------
ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS attachment_paths TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.production_jobs.attachment_paths IS
  'Array of storage paths/URLs in bucket production_attachments (screen/embroidery proof photos)';

-- ---------------------------------------------------------------------------
-- 2. Storage bucket
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'production_attachments',
  'production_attachments',
  true,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 3. Storage RLS — service_role write + public read
--    (Do NOT grant INSERT/DELETE to authenticated — Zero Client-Side Fetching)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "production_attachments_service_role_insert"
  ON storage.objects;
DROP POLICY IF EXISTS "production_attachments_service_role_select"
  ON storage.objects;
DROP POLICY IF EXISTS "production_attachments_service_role_update"
  ON storage.objects;
DROP POLICY IF EXISTS "production_attachments_service_role_delete"
  ON storage.objects;
DROP POLICY IF EXISTS "production_attachments_public_select"
  ON storage.objects;
-- Drop draft policies if someone applied the authenticated variants manually
DROP POLICY IF EXISTS "Allow authenticated users to upload production images"
  ON storage.objects;
DROP POLICY IF EXISTS "Allow public to view production images"
  ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete production images"
  ON storage.objects;

CREATE POLICY "production_attachments_service_role_insert"
  ON storage.objects
  FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'production_attachments');

CREATE POLICY "production_attachments_service_role_select"
  ON storage.objects
  FOR SELECT
  TO service_role
  USING (bucket_id = 'production_attachments');

CREATE POLICY "production_attachments_service_role_update"
  ON storage.objects
  FOR UPDATE
  TO service_role
  USING (bucket_id = 'production_attachments')
  WITH CHECK (bucket_id = 'production_attachments');

CREATE POLICY "production_attachments_service_role_delete"
  ON storage.objects
  FOR DELETE
  TO service_role
  USING (bucket_id = 'production_attachments');

CREATE POLICY "production_attachments_public_select"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'production_attachments');
