"use server";

/**
 * Phase 10 — System Settings Server Actions (Company SSOT).
 * Zero Client-Side Fetching: Service Role only.
 * Mutations require requireAdmin().
 */

import { revalidatePath } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth/require-admin";
import { companySettingsSchema } from "@/lib/validations/system-settings";
import type { Database } from "@/src/types/supabase";
import type {
  GetSystemSettingsResult,
  SystemSettings,
  SystemSettingsFormData,
  UpdateSystemSettingsResult,
  UploadCompanyLogoResult,
} from "@/types/system-settings";

type AdminClient = SupabaseClient<Database>;
type SystemSettingsRow = Database["public"]["Tables"]["system_settings"]["Row"];

const SETTINGS_PATH = "/settings/company";
const SINGLETON_ID = 1;
const COMPANY_ASSETS_BUCKET = "company_assets";
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_LOGO_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/svg+xml",
]);

const SETTINGS_SELECT =
  "id, company_name, company_name_en, tax_id, branch_code, branch_name, address, phone, email, logo_url, vat_rate, gl_rounding_expense_acc, gl_rounding_income_acc, updated_at, updated_by" as const;

function createSupabaseAdminClient(): AdminClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY (หรือ NEXT_PUBLIC_SUPABASE_URL) — ตั้งค่าใน .env.development แล้วรีสตาร์ท next dev",
    );
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function mapRow(row: SystemSettingsRow): SystemSettings {
  return {
    id: Number(row.id ?? SINGLETON_ID),
    company_name: row.company_name ?? "",
    company_name_en: row.company_name_en ?? "",
    tax_id: row.tax_id ?? "",
    branch_code: row.branch_code || "00000",
    branch_name: row.branch_name || "สำนักงานใหญ่",
    address: row.address ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    logo_url: row.logo_url ?? "",
    vat_rate: Number(row.vat_rate ?? 7),
    gl_rounding_expense_acc: row.gl_rounding_expense_acc ?? "5100-99",
    gl_rounding_income_acc: row.gl_rounding_income_acc ?? "4100-99",
    updated_at: row.updated_at ?? new Date().toISOString(),
    updated_by: row.updated_by,
  };
}

/**
 * โหลดข้อมูลบริษัท (singleton id = 1) สำหรับหน้า Settings / เอกสารพิมพ์.
 */
export async function getSystemSettings(): Promise<GetSystemSettingsResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("system_settings")
      .select(SETTINGS_SELECT)
      .eq("id", SINGLETON_ID)
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data) {
      return {
        success: false,
        error: "ไม่พบข้อมูลตั้งค่าบริษัท (system_settings id = 1)",
      };
    }

    return { success: true, data: mapRow(data) };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถโหลดตั้งค่าบริษัทได้";
    return { success: false, error: message };
  }
}

/**
 * UPSERT ตั้งค่าบริษัท — ล็อก id = 1 เสมอ + บังคับสิทธิ์ Admin.
 */
export async function updateSystemSettings(
  data: SystemSettingsFormData,
): Promise<UpdateSystemSettingsResult> {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const parsed = companySettingsSchema.safeParse(data);
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง";
      return { success: false, error: first };
    }

    const payload = parsed.data;
    const supabaseAdmin = createSupabaseAdminClient();

    const { data: row, error } = await supabaseAdmin
      .from("system_settings")
      .upsert(
        {
          id: SINGLETON_ID,
          company_name: payload.company_name,
          tax_id: payload.tax_id,
          branch_code: payload.branch_code,
          branch_name: payload.branch_name,
          address: payload.address,
          phone: payload.phone,
          vat_rate: payload.vat_rate,
          logo_url: payload.logo_url?.trim() || "",
          updated_at: new Date().toISOString(),
          updated_by: gate.admin.userId,
        },
        { onConflict: "id" },
      )
      .select(SETTINGS_SELECT)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath(SETTINGS_PATH);

    return {
      success: true,
      data: mapRow(row),
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถบันทึกตั้งค่าบริษัทได้";
    return { success: false, error: message };
  }
}

/**
 * อัปโหลดโลโก้บริษัทเข้า Storage `company_assets` (Service Role).
 * คืน Public URL ให้ Client เก็บใน form state `logo_url`
 */
export async function uploadCompanyLogo(
  formData: FormData,
): Promise<UploadCompanyLogoResult> {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { success: false, error: "ไม่พบไฟล์โลโก้สำหรับอัปโหลด" };
    }

    const mimeType = (file.type || "").toLowerCase();
    if (!ALLOWED_LOGO_MIME.has(mimeType)) {
      return {
        success: false,
        error: `ประเภทไฟล์ไม่รองรับ (${mimeType || "unknown"}) — ใช้ JPG/PNG/WEBP/SVG`,
      };
    }

    if (file.size > MAX_LOGO_BYTES) {
      return { success: false, error: "ไฟล์ใหญ่เกิน 5MB" };
    }

    const ext =
      mimeType === "image/png"
        ? ".png"
        : mimeType === "image/webp"
          ? ".webp"
          : mimeType === "image/svg+xml"
            ? ".svg"
            : ".jpg";

    // Fixed path — upsert ทับโลโก้เดิม (singleton)
    const objectPath = `branding/company-logo${ext}`;
    const supabaseAdmin = createSupabaseAdminClient();
    const buffer = Buffer.from(await file.arrayBuffer());

    // ลบไฟล์นามสกุลอื่นที่อาจค้างจากรอบก่อน
    await supabaseAdmin.storage
      .from(COMPANY_ASSETS_BUCKET)
      .remove([
        "branding/company-logo.jpg",
        "branding/company-logo.jpeg",
        "branding/company-logo.png",
        "branding/company-logo.webp",
        "branding/company-logo.svg",
      ]);

    const { error: uploadError } = await supabaseAdmin.storage
      .from(COMPANY_ASSETS_BUCKET)
      .upload(objectPath, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      return {
        success: false,
        error: uploadError.message ?? "อัปโหลดโลโก้ขึ้น Storage ไม่สำเร็จ",
      };
    }

    const { data: publicData } = supabaseAdmin.storage
      .from(COMPANY_ASSETS_BUCKET)
      .getPublicUrl(objectPath);

    const url = publicData?.publicUrl?.trim();
    if (!url) {
      return {
        success: false,
        error: "อัปโหลดสำเร็จ แต่สร้าง Public URL ไม่ได้",
      };
    }

    return { success: true, url, path: objectPath };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "อัปโหลดโลโก้บริษัทไม่สำเร็จ";
    return { success: false, error: message };
  }
}
