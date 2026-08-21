-- =============================================================================
-- Phase 14 — Fixed Assets: link Expense + Warranty + Attachments
-- Cloud-First: รันบน Supabase Cloud SQL Editor หากยังไม่มีคอลัมน์
-- จากนั้น: npx supabase gen types typescript --project-id <PROJECT_ID> > src/types/supabase.ts
-- =============================================================================

ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS expense_id UUID
    REFERENCES public.expenses(id) ON DELETE SET NULL;

ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS warranty_expiry_date DATE;

ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS attachment_urls TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_fixed_assets_expense_id
  ON public.fixed_assets (expense_id)
  WHERE expense_id IS NOT NULL;

COMMENT ON COLUMN public.fixed_assets.expense_id IS
  'Optional link to OPEX expense that funded this asset (acquisition cost source)';
COMMENT ON COLUMN public.fixed_assets.warranty_expiry_date IS
  'Warranty end date (ใบรับประกัน)';
COMMENT ON COLUMN public.fixed_assets.attachment_urls IS
  'Public URLs in document_attachments bucket (warranty / invoice scans)';
