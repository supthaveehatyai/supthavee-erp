/**
 * Phase 9 / 14 — Manual Backup Request Server Action (Executive Dashboard).
 * Vercel ไม่รองรับ pg_dump — บันทึกคำขอลง audit_logs เท่านั้น (Service Role ทะลุ RLS).
 * Zero Client-Side Fetching: Auth Session (SSR) + supabaseAdmin for writes.
 */

"use server";

import { revalidatePath } from "next/cache";
import { resolveManualBackupAuth } from "@/lib/backup/manual-backup-auth";
import { createClient as createSupabaseAdmin } from "@/lib/supabase/server-admin";

export type TriggerManualBackupResult = {
  success: boolean;
  message?: string;
  error?: string | null;
};

const MANUAL_BACKUP_DR_MESSAGE =
  "แจ้งเตือน: การสำรองทั้งสคีมาและไฟล์แนบรันบน Cloud ไม่ได้ กรุณาเปิด PowerShell บนเครื่องที่แมปไดรฟ์ H: แล้วรัน npm run backup:all เพื่อเขียนไฟล์ลง H:\\My Drive\\STV_ERP_SuperApp\\Backup";

/**
 * บันทึกคำขอ Manual Backup จาก Cloud ลง audit_logs (supabaseAdmin เท่านั้น)
 */
export async function triggerManualBackup(): Promise<TriggerManualBackupResult> {
  try {
    const auth = await resolveManualBackupAuth();
    if (!auth.ok) {
      return { success: false, error: auth.error };
    }

    const supabaseAdmin = createSupabaseAdmin();
    const timestamp = new Date().toISOString();

    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      // audit_logs.action เป็น ENUM (INSERT|UPDATE|DELETE) — เก็บ semantic action ใน new_data
      action: "INSERT",
      table_name: "system",
      record_id: "N/A",
      changed_by: auth.userId,
      new_data: {
        action: "MANUAL_BACKUP_REQUEST",
        status: "Requested Manual Backup via Dashboard",
        timestamp,
      },
    });

    if (auditError) {
      console.error("Audit Log Error:", auditError);
      return { success: false, error: auditError.message };
    }

    revalidatePath("/dashboard");

    return {
      success: true,
      message: MANUAL_BACKUP_DR_MESSAGE,
    };
  } catch (error: unknown) {
    console.error("Manual Backup Request Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
