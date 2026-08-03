-- ==========================================
-- Migration: Phase 7 - Production Kanban Workflow
-- ==========================================
-- Access: Service Role only (Zero Client-Side Fetching).
-- Client roles rely on Default Deny (RLS enabled, no policies).
-- Idempotent — safe if a prior Phase 7 migration already applied.
-- ==========================================

-- 1. สร้าง Enum สำหรับสถานะงานและประเภทงาน
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'production_job_type' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.production_job_type AS ENUM (
      'SCREEN',
      'EMBROIDERY',
      'SEWING',
      'OTHER'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'production_job_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.production_job_status AS ENUM (
      'TODO',
      'IN_PROGRESS',
      'QC',
      'READY_TO_SHIP',
      'DELIVERED'
    );
  END IF;
END $$;

COMMENT ON TYPE public.production_job_type IS
  'Phase 7 Production Kanban — job category (screen / embroidery / sewing / other)';
COMMENT ON TYPE public.production_job_status IS
  'Phase 7 Production Kanban — workflow column status';

-- 2. สร้างตารางใบสั่งผลิต (Production Jobs)
CREATE TABLE IF NOT EXISTS public.production_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_no VARCHAR(50) NOT NULL UNIQUE, -- เลขที่ใบสั่งผลิต เช่น PROD-2608-0001
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE, -- ผูกกับบิลขายต้นทาง
  job_type public.production_job_type NOT NULL DEFAULT 'OTHER',
  status public.production_job_status NOT NULL DEFAULT 'TODO',
  due_date DATE, -- กำหนดส่งงาน
  details TEXT, -- รายละเอียด เช่น สกรีนอกซ้าย 1 สี
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.production_jobs IS
  'Phase 7 — Production jobs for Kanban board (screen / embroidery / sewing)';
COMMENT ON COLUMN public.production_jobs.job_no IS
  'Official production job number e.g. PROD-2608-0001';
COMMENT ON COLUMN public.production_jobs.document_id IS
  'Source sales document (documents.id)';

-- 3. Index เพื่อให้บอร์ด Kanban ค้นหาและเรียงลำดับได้อย่างรวดเร็ว
CREATE INDEX IF NOT EXISTS idx_production_jobs_status
  ON public.production_jobs (status);

CREATE INDEX IF NOT EXISTS idx_production_jobs_due_date
  ON public.production_jobs (due_date);

CREATE INDEX IF NOT EXISTS idx_production_jobs_document_id
  ON public.production_jobs (document_id);

-- 4. Default Deny — enable RLS, no anon/authenticated policies
-- *หมายเหตุ: อาศัยหลัก Default Deny สำหรับ Client
--   ฝั่ง Server Actions (service_role) จะ Bypass ได้อัตโนมัติ
ALTER TABLE public.production_jobs ENABLE ROW LEVEL SECURITY;

-- 5. Service Role grants
GRANT USAGE ON TYPE public.production_job_type TO service_role;
GRANT USAGE ON TYPE public.production_job_status TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_jobs TO service_role;
