-- 1. สร้างลูกค้าทดสอบ (แก้ contact_type เป็น 'นิติบุคคล' ให้ตรงกับ Check Constraint)
INSERT INTO public.contacts (id, company_name, contact_type, is_active)
VALUES ('11111111-1111-1111-1111-111111111111', 'บริษัท ม็อกอัพ จำกัด (ทดสอบ)', 'นิติบุคคล', true)
ON CONFLICT (id) DO NOTHING;

-- 2. สร้างบิลขายค้างชำระ 2 ใบ ให้ลูกค้ารายนี้
INSERT INTO public.documents (
  id, document_number, document_date, doc_type, 
  net_amount, paid_amount, payment_status, contact_person_id
) VALUES 
(gen_random_uuid(), 'INV-TEST-001', '2026-07-01', 'INV_DO', 15000.00, 0, 'UNPAID', '11111111-1111-1111-1111-111111111111'),
(gen_random_uuid(), 'INV-TEST-002', '2026-07-15', 'INV_DO', 8500.50, 0, 'UNPAID', '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;