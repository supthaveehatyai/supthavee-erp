-- =============================================================================
-- Phase 4 — Document bill image attachments (Smart Goods Receipt OCR)
-- =============================================================================
-- 1) documents.attachment_url — public/storage URL of the scanned bill image
-- 2) Storage bucket `document_attachments` + service_role policies
-- =============================================================================

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS attachment_url TEXT;

COMMENT ON COLUMN public.documents.attachment_url IS
  'URL/path of the uploaded bill image in storage bucket document_attachments';

-- ---------------------------------------------------------------------------
-- Storage bucket
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'document_attachments',
  'document_attachments',
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
-- Service Role policies (Upload / Read / Update / Delete)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "document_attachments_service_role_insert"
  ON storage.objects;
DROP POLICY IF EXISTS "document_attachments_service_role_select"
  ON storage.objects;
DROP POLICY IF EXISTS "document_attachments_service_role_update"
  ON storage.objects;
DROP POLICY IF EXISTS "document_attachments_service_role_delete"
  ON storage.objects;

CREATE POLICY "document_attachments_service_role_insert"
  ON storage.objects
  FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'document_attachments');

CREATE POLICY "document_attachments_service_role_select"
  ON storage.objects
  FOR SELECT
  TO service_role
  USING (bucket_id = 'document_attachments');

CREATE POLICY "document_attachments_service_role_update"
  ON storage.objects
  FOR UPDATE
  TO service_role
  USING (bucket_id = 'document_attachments')
  WITH CHECK (bucket_id = 'document_attachments');

CREATE POLICY "document_attachments_service_role_delete"
  ON storage.objects
  FOR DELETE
  TO service_role
  USING (bucket_id = 'document_attachments');

-- Public read (bucket is public) — so attachment_url works in the browser UI
DROP POLICY IF EXISTS "document_attachments_public_select"
  ON storage.objects;

CREATE POLICY "document_attachments_public_select"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'document_attachments');
