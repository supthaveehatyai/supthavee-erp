-- ==========================================
-- Migration: Phase 7 - Production Kanban Workflow
-- ==========================================
-- Access: Service Role only (Zero Client-Side Fetching).
-- Idempotent — safe if prior Phase 7 migrations already applied.
-- ==========================================

-- 1. สร้าง Enum สำหรับประเภทงานและสถานะงาน
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

-- 2. สร้างตารางใบสั่งผลิต (Production Jobs)
CREATE TABLE IF NOT EXISTS public.production_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_no VARCHAR(50) NOT NULL UNIQUE, -- เลขที่ใบสั่งผลิต เช่น PROD-2608-0001
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE, -- ผูกอ้างอิงกับบิลขายต้นทาง (INV_DO หรือ QT)
  job_type public.production_job_type NOT NULL DEFAULT 'OTHER',
  status public.production_job_status NOT NULL DEFAULT 'TODO',
  due_date DATE, -- กำหนดส่งงาน
  details TEXT, -- รายละเอียดงาน เช่น สกรีนอกซ้าย 1 สี
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Index เพื่อเพิ่มความเร็วให้บอร์ด Kanban
CREATE INDEX IF NOT EXISTS idx_production_jobs_status
  ON public.production_jobs (status);

CREATE INDEX IF NOT EXISTS idx_production_jobs_due_date
  ON public.production_jobs (due_date);

CREATE INDEX IF NOT EXISTS idx_production_jobs_document_id
  ON public.production_jobs (document_id);

-- *หมายเหตุ: อาศัยหลัก Default Deny สำหรับ Client
--   ฝั่ง Server Actions (service_role) จะ Bypass ได้อัตโนมัติ
ALTER TABLE public.production_jobs ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON TYPE public.production_job_type TO service_role;
GRANT USAGE ON TYPE public.production_job_status TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_jobs TO service_role;
