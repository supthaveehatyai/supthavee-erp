-- เพิ่มคอลัมน์สำหรับเก็บ URL ของสลิปโอนเงิน (ไม่บังคับ)
ALTER TABLE public.expenses 
ADD COLUMN payment_slip_url TEXT;