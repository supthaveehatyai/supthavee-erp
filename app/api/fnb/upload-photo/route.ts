import { randomUUID } from "node:crypto";
import { createClient as createAdminClient } from "@/lib/supabase/server-admin";
import { createSupabaseSSRClient } from "@/lib/supabase/ssr-server";

export const dynamic = "force-dynamic";

function asciiPath(branchCode: string, folder: string): string {
  const branch = branchCode.replace(/[^A-Za-z0-9_-]/g, "") || "branch";
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date()).replace(/-/g, "");
  const cleanFolder = folder.replace(/[^A-Za-z0-9/_-]/g, "");
  if (cleanFolder.startsWith("ops/")) return `${cleanFolder.replace(/\/+$/, "")}/${Date.now()}-${randomUUID().slice(0, 8)}.jpg`;
  return `ops/${branch}/${day}/${Date.now()}-${randomUUID().slice(0, 8)}.jpg`;
}

export async function POST(request: Request) {
  const supabase = await createSupabaseSSRClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return Response.json({ ok: false, error: "กรุณาเข้าสู่ระบบก่อนอัปโหลดรูป" }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return Response.json({ ok: false, error: "ไม่พบไฟล์รูป" }, { status: 400 });
  const branchCode = String(form.get("branchCode") || form.get("branch_code") || "");
  const folder = String(form.get("folder") || "");
  const path = asciiPath(branchCode, folder);
  const admin = createAdminClient();
  const uploaded = await admin.storage.from("fnb_operations").upload(path, Buffer.from(await file.arrayBuffer()), {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (uploaded.error) return Response.json({ ok: false, error: uploaded.error.message || "อัปโหลดรูปไม่สำเร็จ" }, { status: 500 });
  const publicUrl = admin.storage.from("fnb_operations").getPublicUrl(path).data.publicUrl;
  return Response.json({ ok: true, publicUrl, serverTimeISO: new Date().toISOString() });
}
