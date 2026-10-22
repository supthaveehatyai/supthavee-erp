"use server";

import { requireSessionUserId } from "@/lib/auth/current-user";
import { mergeBillNotes, sanitizeVendorRef, splitBillNotes } from "@/lib/procurement/bill-notes";
import { createClient as createSupabaseAdmin } from "@/lib/supabase/server-admin";
import type {
  ProcurementBillAttachment,
  ProcurementBillSet,
  SaveProcurementBillsResult,
  UploadProcurementBillResult,
} from "@/types/procurement-bills";

const BUCKET = "procurement_bills";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function bangkokYearMonth(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).format(date);
  return parts.slice(0, 7);
}

function extensionOf(file: File): string {
  const fromName = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (fromName === "jpeg") return "jpg";
  if (fromName === "jpg" || fromName === "png" || fromName === "webp" || fromName === "pdf") {
    return fromName;
  }
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "application/pdf") return "pdf";
  return "jpg";
}

async function ensureBucket(supabase: ReturnType<typeof createSupabaseAdmin>) {
  const existing = await supabase.storage.getBucket(BUCKET);
  if (!existing.error && existing.data) return null;
  const created = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES,
  });
  if (created.error && !/already exists/i.test(created.error.message)) {
    return created.error.message;
  }
  return null;
}

export async function uploadProcurementBillFile(
  formData: FormData,
): Promise<UploadProcurementBillResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { data: null, error: "ไม่พบไฟล์บิลสำหรับอัปโหลด" };
    }
    const mime = (file.type || "").toLowerCase();
    if (mime && !ALLOWED.has(mime)) {
      return { data: null, error: "รองรับเฉพาะ JPEG, PNG, WebP หรือ PDF" };
    }
    if (file.size > MAX_BYTES) {
      return { data: null, error: "ไฟล์ใหญ่เกิน 10MB" };
    }

    const index = Math.max(0, Math.min(99, Number(formData.get("index")) || 0));
    const timestamp = String(formData.get("timestamp") || Date.now()).replace(/\D/g, "") || String(Date.now());
    const vendorRef = sanitizeVendorRef(String(formData.get("vendorRef") ?? ""));
    const objectPath = `${bangkokYearMonth()}/${vendorRef}_${timestamp}_${index}.${extensionOf(file)}`;

    const supabase = createSupabaseAdmin();
    const bucketError = await ensureBucket(supabase);
    if (bucketError) return { data: null, error: bucketError };

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, Buffer.from(await file.arrayBuffer()), {
        contentType: mime || "application/octet-stream",
        upsert: false,
      });
    if (uploadError) {
      return { data: null, error: uploadError.message };
    }

    const url = supabase.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl?.trim();
    if (!url) return { data: null, error: "อัปโหลดสำเร็จ แต่สร้าง URL ไม่ได้" };

    const attachment: ProcurementBillAttachment = {
      name: file.name,
      path: objectPath,
      url,
      type: mime || "application/octet-stream",
      size: file.size,
      uploaded_at: new Date().toISOString(),
    };
    return { data: attachment, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "อัปโหลดรูปบิลไม่สำเร็จ";
    return { data: null, error: message };
  }
}

function isMissingBillColumn(message: string): boolean {
  return /attachment_urls|attachments|schema cache|Could not find the/i.test(message);
}

export async function saveDocumentProcurementBills(input: {
  documentId: string;
  docHeaderId?: string | null;
  bills: ProcurementBillSet;
}): Promise<SaveProcurementBillsResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { success: false, error: owner.error };

    const documentId = input.documentId?.trim();
    if (!documentId) return { success: false, error: "ไม่พบเอกสารสำหรับผูกไฟล์บิล" };
    const incoming = input.bills?.attachments ?? [];
    if (incoming.length === 0) return { success: true, error: null };

    const supabase = createSupabaseAdmin();
    const { data: row, error: readError } = await supabase
      .from("documents")
      .select("id, notes")
      .eq("id", documentId)
      .maybeSingle();
    if (readError) return { success: false, error: readError.message };
    if (!row) return { success: false, error: "ไม่พบเอกสารสำหรับผูกไฟล์บิล" };

    const notes = mergeBillNotes(row.notes, {
      attachment_urls: incoming.map((item) => item.url),
      attachments: incoming,
    });
    const saved = splitBillNotes(notes).bills;
    const firstUrl = saved.attachment_urls[0] ?? null;
    const firstName = saved.attachments[0]?.name?.slice(0, 240) ?? null;
    const base = {
      notes,
      attachment_url: firstUrl,
      attached_file_url: firstUrl,
      original_receipt_url: firstUrl,
      original_file_name: firstName,
    };
    const dynamic = supabase as unknown as {
      from: (table: string) => {
        update: (values: Record<string, unknown>) => {
          eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
        };
      };
    };

    const withColumns = {
      ...base,
      attachment_urls: saved.attachment_urls,
      attachments: saved.attachments,
    };
    const updated = await dynamic.from("documents").update(withColumns).eq("id", documentId);
    if (updated.error && isMissingBillColumn(updated.error.message)) {
      const fallback = await dynamic.from("documents").update(base).eq("id", documentId);
      if (fallback.error) return { success: false, error: fallback.error.message };
    } else if (updated.error) {
      return { success: false, error: updated.error.message };
    }

    const headerId = input.docHeaderId?.trim();
    if (headerId) {
      await dynamic
        .from("doc_headers")
        .update({
          attached_file_url: firstUrl,
          original_receipt_url: firstUrl,
          original_file_name: firstName,
        })
        .eq("id", headerId);
    }

    return { success: true, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "บันทึกรูปบิลลงเอกสารไม่สำเร็จ";
    return { success: false, error: message };
  }
}
