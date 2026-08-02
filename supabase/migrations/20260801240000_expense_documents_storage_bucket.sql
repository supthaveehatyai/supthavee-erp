-- =============================================================================
-- Phase 8 — Expense receipt attachments (Manual + OCR)
-- =============================================================================
-- Storage bucket `expense_documents` for OPEX receipt images.
-- URL is stored on public.expenses.receipt_url (existing column).
-- Zero Client-Side Fetching: uploads go through Server Actions + service_role.
-- =============================================================================

COMMENT ON COLUMN public.expenses.receipt_url IS
  'Public URL of the uploaded expense receipt image in storage bucket expense_documents';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense_documents',
  'expense_documents',
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

DROP POLICY IF EXISTS "expense_documents_service_role_insert"
  ON storage.objects;
DROP POLICY IF EXISTS "expense_documents_service_role_select"
  ON storage.objects;
DROP POLICY IF EXISTS "expense_documents_service_role_update"
  ON storage.objects;
DROP POLICY IF EXISTS "expense_documents_service_role_delete"
  ON storage.objects;
DROP POLICY IF EXISTS "expense_documents_public_select"
  ON storage.objects;

CREATE POLICY "expense_documents_service_role_insert"
  ON storage.objects
  FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'expense_documents');

CREATE POLICY "expense_documents_service_role_select"
  ON storage.objects
  FOR SELECT
  TO service_role
  USING (bucket_id = 'expense_documents');

CREATE POLICY "expense_documents_service_role_update"
  ON storage.objects
  FOR UPDATE
  TO service_role
  USING (bucket_id = 'expense_documents')
  WITH CHECK (bucket_id = 'expense_documents');

CREATE POLICY "expense_documents_service_role_delete"
  ON storage.objects
  FOR DELETE
  TO service_role
  USING (bucket_id = 'expense_documents');

-- Public read so receipt_url can render in the browser UI
CREATE POLICY "expense_documents_public_select"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'expense_documents');
