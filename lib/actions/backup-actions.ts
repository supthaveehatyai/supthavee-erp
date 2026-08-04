'use server'

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const execAsync = promisify(exec);

// 1. บังคับใช้ Service Role Key ทะลุกำแพง RLS (Zero Client-Side Fetching)
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function triggerManualBackup() {
    try {
        // Guardrail: ตรวจสอบสิทธิ์แบบ Hard-code สำหรับสถานะ Setup
        if (process.env.MANUAL_BACKUP_ALLOW_ADMIN !== 'true') {
            return { success: false, error: 'Forbidden: ขาดสิทธิ์การเข้าถึงระบบ Backup' };
        }

        // 2. ใช้ Absolute Path ป้องกันปัญหา Next.js หลงโฟลเดอร์ใน Windows
        const rootDir = process.cwd();
        const dbScriptPath = path.join(rootDir, 'scripts', 'backup', 'backup-db.mjs');
        const storageScriptPath = path.join(rootDir, 'scripts', 'backup', 'backup-storage.mjs');

        // 3. รัน Database Backup (ขยาย Buffer เป็น 10MB ป้องกัน Process Crash เงียบ)
        try {
            await execAsync(`node "${dbScriptPath}"`, { cwd: rootDir, maxBuffer: 1024 * 1024 * 10 });
        } catch (dbErr: any) {
            console.error("DB Backup Crash:", dbErr);
            return { success: false, error: `DB Backup Failed: ${dbErr.stdout || dbErr.message}` };
        }

        // 4. รัน Storage Backup
        try {
            await execAsync(`node "${storageScriptPath}"`, { cwd: rootDir, maxBuffer: 1024 * 1024 * 10 });
        } catch (storageErr: any) {
            console.error("Storage Backup Crash:", storageErr);
            return { success: false, error: `Storage Backup Failed: ${storageErr.stdout || storageErr.message}` };
        }

        // 5. บันทึกประวัติลง Audit Trail อย่างถูกต้อง (ใช้ action: 'INSERT' ตามกฎ Database)
        const { error: auditError } = await supabaseAdmin
            .from('audit_logs')
            .insert({
                action: 'INSERT', 
                table_name: 'system_backups',
                record_id: 'MANUAL_BACKUP',
                old_data: {},
                new_data: { 
                    event: 'MANUAL_BACKUP_TRIGGERED', 
                    status: 'SUCCESS',
                    timestamp: new Date().toISOString()
                }
            });

        // หากบันทึก Log ไม่สำเร็จ ให้แจ้ง Error ชัดเจน ไม่ปล่อยผ่าน
        if (auditError) {
            console.error("Audit Log Error:", auditError);
            return { success: false, error: `Backup สำเร็จแต่เขียน Log ไม่ลง: ${auditError.message}` };
        }

        return { success: true, message: '🎉 สำรองข้อมูล Database และ Storage เสร็จสมบูรณ์!' };

    } catch (error: any) {
        console.error("Critical Backup Error:", error);
        return { success: false, error: error.message };
    }
}