-- 1. ให้สิทธิ์ระดับตารางแก่ anon เพื่อให้ UI หน้าบ้านดึงรายชื่อซัพพลายเออร์ได้
GRANT SELECT ON TABLE public.contacts TO anon;

-- 2. สร้าง/อัปเดต RLS Policy สำหรับตาราง contacts ให้อ่านได้ใน Local Dev
DROP POLICY IF EXISTS "Enable read access for all users" ON contacts;
CREATE POLICY "Enable read access for all users" ON contacts FOR SELECT USING (true);

-- 3. บังคับรีโหลด API Schema Cache ของ Supabase (เพื่อทำลาย Ghost Cache ทันที)
NOTIFY pgrst, 'reload schema';