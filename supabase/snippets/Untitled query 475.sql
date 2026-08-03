-- เพิ่มคอลัมน์ is_archived เพื่อใช้ซ่อนการ์ด Kanban ที่เสร็จแล้ว
ALTER TABLE public.production_jobs
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

-- สร้าง Index เพื่อให้การดึงข้อมูลบนบอร์ด Kanban ทำได้เร็วระดับ Millisecond
CREATE INDEX IF NOT EXISTS idx_production_jobs_is_archived
ON public.production_jobs (is_archived)
WHERE is_archived = false;