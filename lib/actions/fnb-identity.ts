"use server";

import { cookies } from "next/headers";
import { FNB_LIFF_COOKIE } from "@/lib/fnb/actor";
import { schemaAdmin, schemaErrorMessage } from "@/lib/holding/schema-db";
import { FNB_LIFF_SUSPENDED_MESSAGE, type FnbBrandCode } from "@/types/fnb";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function bindLiffSessionAction(lineUserId: string, brand: FnbBrandCode): Promise<{ ok: boolean; error: string | null; name: string | null }> {
  const id = text(lineUserId);
  if (!id) return { ok: false, error: "กรุณาใส่รหัส LINE ที่ลงทะเบียนไว้", name: null };
  const listed = await schemaAdmin()
    .schema("holding")
    .from("liff_user_registrations")
    .select("display_name, staff_nickname, approval_status, is_active, assigned_brand_code")
    .eq("line_user_id", id)
    .maybeSingle();
  if (listed.error) return { ok: false, error: schemaErrorMessage(listed.error, "ตรวจสิทธิ์ไม่สำเร็จ"), name: null };
  const row = listed.data && typeof listed.data === "object" ? listed.data as Record<string, unknown> : null;
  if (!row || row.is_active !== true || text(row.approval_status) !== "APPROVED") {
    const jar = await cookies();
    jar.delete(FNB_LIFF_COOKIE);
    return { ok: false, error: FNB_LIFF_SUSPENDED_MESSAGE, name: null };
  }
  if (text(row.assigned_brand_code) !== brand) return { ok: false, error: "บัญชีนี้ไม่ได้รับสิทธิ์แบรนด์นี้", name: null };
  const jar = await cookies();
  jar.set(FNB_LIFF_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 18 });
  const name = text(row.staff_nickname) || text(row.display_name) || "พนักงาน";
  return { ok: true, error: null, name };
}

export async function clearLiffSessionAction(): Promise<{ ok: boolean }> {
  const jar = await cookies();
  jar.delete(FNB_LIFF_COOKIE);
  return { ok: true };
}
