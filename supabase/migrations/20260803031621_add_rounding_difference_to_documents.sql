-- ==========================================
-- Migration: Add Rounding Difference to Documents
-- ==========================================

-- 1. เพิ่มคอลัมน์สำหรับเก็บเศษสตางค์ที่เหลื่อมกันจากการคำนวณ
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS rounding_difference DECIMAL(10,2) DEFAULT 0.00;

-- 2. สร้าง Comment อธิบาย Business Logic ไว้ใน Database
COMMENT ON COLUMN public.documents.rounding_difference IS
  'ส่วนต่างปัดเศษสตางค์ เพื่อให้ยอด Grand Total ตรงกับบิลกระดาษ (บวกหรือลบไม่เกิน 1.00 บาท)';
