-- สั่งให้ PostgREST รีเฟรช Schema Cache ใหม่ทันที
NOTIFY pgrst, 'reload schema';