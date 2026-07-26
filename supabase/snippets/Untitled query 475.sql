-- บังคับให้ Supabase PostgREST อัปเดต Schema และสิทธิ์ใหม่ทันที
NOTIFY pgrst, 'reload schema';