-- =============================================================================
-- Phase 14 — ABAC foundation + document ownership
-- Cloud-First: รัน SQL นี้บน Supabase Cloud SQL Editor ก่อน
-- จากนั้น: npx supabase gen types typescript --project-id <PROJECT_ID> > src/types/supabase.ts
-- =============================================================================

-- 1) user_profiles — Data Access Scope + Approval Limit
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS data_access_scope VARCHAR(10) NOT NULL DEFAULT 'OWN';

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS approval_limit NUMERIC(15, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_profiles_data_access_scope_check'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_data_access_scope_check
      CHECK (data_access_scope IN ('ALL', 'OWN'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_profiles_approval_limit_check'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_approval_limit_check
      CHECK (approval_limit >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.user_profiles.data_access_scope IS
  'Phase 14 ABAC — ALL = เห็นข้อมูลทั้งหมด, OWN = เห็นเฉพาะเอกสารที่ตนเองสร้าง';
COMMENT ON COLUMN public.user_profiles.approval_limit IS
  'Phase 14 ABAC — วงเงินอนุมัติสูงสุด (บาท); 0 = ไม่มีวงเงินอนุมัติ';

-- Admin bootstrap: ผู้บริหารเห็นข้อมูลทั้งหมดเป็นค่าเริ่มต้น
UPDATE public.user_profiles
SET data_access_scope = 'ALL'
WHERE lower(role_code) = 'admin'
  AND data_access_scope IS DISTINCT FROM 'ALL';

-- 2) documents — ownership stamp for ABAC OWN filter
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.documents.created_by IS
  'Phase 14 ABAC — Auth user.id ของผู้สร้างเอกสาร (stamp จาก Server Action เสมอ)';

CREATE INDEX IF NOT EXISTS idx_documents_created_by
  ON public.documents (created_by);
