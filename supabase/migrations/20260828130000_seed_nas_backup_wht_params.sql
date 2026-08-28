-- Seed NAS_BACKUP_PATH + WHT_RATE for Settings UI (idempotent)
INSERT INTO public.system_parameters (param_key, param_value, description, data_type, category)
VALUES
  (
    'NAS_BACKUP_PATH',
    '"nas_storage"'::jsonb,
    'โฟลเดอร์ปลายทางบน NAS สำหรับเก็บไฟล์สำรองและ Cold Archive',
    'string',
    'storage'
  ),
  (
    'WHT_RATE',
    '3'::jsonb,
    'อัตราหัก ณ ที่จ่ายมาตรฐาน (%) สำหรับเอกสารค่าใช้จ่าย',
    'number',
    'finance'
  )
ON CONFLICT (param_key) DO NOTHING;
