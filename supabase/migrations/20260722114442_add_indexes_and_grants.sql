-- 1. ฟื้นฟูสิทธิ์ให้ Service Role เข้าถึงตารางหลักได้อย่างสมบูรณ์แบบ
GRANT ALL PRIVILEGES ON TABLE public.contacts TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.vendor_product_mapping TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.product_models TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.products TO service_role;

-- 2. อนุญาตให้อ่านข้อมูล (SELECT) สำหรับ role ปกติ เผื่อการใช้งานจาก Client Components ในอนาคต
GRANT SELECT ON TABLE public.contacts TO anon, authenticated;
GRANT SELECT ON TABLE public.vendor_product_mapping TO anon, authenticated;
GRANT SELECT ON TABLE public.product_models TO anon, authenticated;
GRANT SELECT ON TABLE public.products TO anon, authenticated;

-- 3. สร้าง Index เตรียมความพร้อมสำหรับฟีเจอร์ Smart Goods Receipt (AI OCR)
CREATE INDEX IF NOT EXISTS idx_vendor_product_mapping_vendor_id ON public.vendor_product_mapping(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_product_mapping_vendor_sku ON public.vendor_product_mapping(vendor_sku);