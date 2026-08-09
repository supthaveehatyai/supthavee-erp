"use server";

/**
 * Phase 10 — System Settings Server Actions (Company SSOT).
 * Zero Client-Side Fetching: Service Role only.
 * Mutations require requireAdmin().
 */

import { cache } from "react";
import { revalidatePath } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  normalizePrintPaperSize,
  resolvePrintPaperSize,
} from "@/lib/constants/print-paper-size";
import { companySettingsSchema } from "@/lib/validations/system-settings";
import type { Database } from "@/src/types/supabase";
import type { PrintPaperSize } from "@/types/print-document";
import type {
  DocumentPrintSettings,
  GetSystemSettingsResult,
  SystemSettings,
  SystemSettingsFormData,
  UpdateDocumentPrintSettingResult,
  UpdateSystemSettingsResult,
  UploadCompanyLogoResult,
} from "@/types/system-settings";

type AdminClient = SupabaseClient<Database>;
type SystemSettingsRow = Database["public"]["Tables"]["system_settings"]["Row"];

const SETTINGS_PATH = "/settings/company";
const KNOWLEDGE_BASE_PATH = "/knowledge-base/document-standards";
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
  "id, company_name, company_name_en, tax_id, branch_code, branch_name, address, phone, email, logo_url, vat_rate, gl_rounding_expense_acc, gl_rounding_income_acc, document_print_settings, allow_negative_inventory, updated_at, updated_by" as const;

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

function parseDocumentPrintSettings(
  value: SystemSettingsRow["document_print_settings"] | null | undefined,
): DocumentPrintSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: DocumentPrintSettings = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "string") continue;
    const code = key.trim().toUpperCase();
    const size = normalizePrintPaperSize(raw);
    if (!code || !size) continue;
    out[code] = size;
  }
  return out;
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
    document_print_settings: parseDocumentPrintSettings(
      row.document_print_settings,
    ),
    allow_negative_inventory: Boolean(row.allow_negative_inventory),
    updated_at: row.updated_at ?? new Date().toISOString(),
    updated_by: row.updated_by,
  };
}

async function fetchSystemSettingsRow(): Promise<GetSystemSettingsResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("system_settings")
      .select(SETTINGS_SELECT)
      .eq("id", SINGLETON_ID)
      .maybeSingle();

    if (error) {
      // Column may not exist yet on older DBs — retry without newer columns.
      if (
        error.message?.includes("document_print_settings") ||
        error.message?.includes("allow_negative_inventory") ||
        error.code === "42703"
      ) {
        const fallback = await supabaseAdmin
          .from("system_settings")
          .select(
            "id, company_name, company_name_en, tax_id, branch_code, branch_name, address, phone, email, logo_url, vat_rate, gl_rounding_expense_acc, gl_rounding_income_acc, updated_at, updated_by",
          )
          .eq("id", SINGLETON_ID)
          .maybeSingle();

        if (fallback.error) {
          return { success: false, error: fallback.error.message };
        }
        if (!fallback.data) {
          return {
            success: false,
            error: "ไม่พบข้อมูลตั้งค่าบริษัท (system_settings id = 1)",
          };
        }
        return {
          success: true,
          data: mapRow({
            ...fallback.data,
            document_print_settings: {},
            allow_negative_inventory: false,
          } as SystemSettingsRow),
        };
      }
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
 * โหลดข้อมูลบริษัท (singleton id = 1) สำหรับหน้า Settings / เอกสารพิมพ์.
 * Request-scoped cache — กันซ้ำระหว่าง PrintLayout header + paper resolve.
 */
export const getSystemSettings = cache(
  async (): Promise<GetSystemSettingsResult> => fetchSystemSettingsRow(),
);

/**
 * Resolve paper size for print templates — settings override → default → A4.
 */
export async function getDocumentPrintPaperSize(
  docType: string,
): Promise<PrintPaperSize> {
  const settings = await getSystemSettings();
  const overrides = settings.success
    ? settings.data.document_print_settings
    : null;
  return resolvePrintPaperSize(docType, overrides);
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
          email: payload.email,
          vat_rate: payload.vat_rate,
          logo_url: payload.logo_url?.trim() || "",
          allow_negative_inventory: Boolean(payload.allow_negative_inventory),
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
 * อัปเดตขนาดกระดาษพิมพ์ต่อประเภทเอกสาร (JSONB merge ตาม docType).
 */
export async function updateDocumentPrintSetting(
  docType: string,
  paperSize: string,
): Promise<UpdateDocumentPrintSettingResult> {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const code = String(docType ?? "")
      .trim()
      .toUpperCase();
    if (!code) {
      return { success: false, error: "ไม่ระบุประเภทเอกสาร (docType)" };
    }

    const size = normalizePrintPaperSize(paperSize);
    if (!size) {
      return {
        success: false,
        error: "ขนาดกระดาษไม่ถูกต้อง — เลือก A4, A5 หรือ A5 Landscape",
      };
    }

    const current = await fetchSystemSettingsRow();
    if (!current.success) {
      return current;
    }

    const nextSettings: DocumentPrintSettings = {
      ...current.data.document_print_settings,
      [code]: size,
    };

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: row, error } = await supabaseAdmin
      .from("system_settings")
      .update({
        document_print_settings: nextSettings as Database["public"]["Tables"]["system_settings"]["Update"]["document_print_settings"],
        updated_at: new Date().toISOString(),
        updated_by: gate.admin.userId,
      })
      .eq("id", SINGLETON_ID)
      .select(SETTINGS_SELECT)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath(KNOWLEDGE_BASE_PATH);
    revalidatePath(SETTINGS_PATH);
    revalidatePath("/sales");
    revalidatePath("/purchases");
    revalidatePath("/expenses");
    revalidatePath("/finance");

    return { success: true, data: mapRow(row) };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "ไม่สามารถบันทึกขนาดกระดาษเอกสารได้";
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
