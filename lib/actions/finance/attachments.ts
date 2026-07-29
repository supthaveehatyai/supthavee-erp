"use server";

/**
 * Phase 5 — Upload reference attachments for REC / PAY documents.
 * Zero Client-Side Fetching: Service Role + Storage only.
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase-server";

const DOCUMENT_ATTACHMENTS_BUCKET = "document_attachments";
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

export type DocumentAttachmentKind = "wht_certificate" | "original_receipt";

export type UploadDocumentAttachmentResult = {
  success: boolean;
  error: string | null;
  url?: string | null;
};

function columnForKind(kind: DocumentAttachmentKind): {
  column: "wht_attachment_url" | "original_receipt_url";
  folder: string;
  label: string;
} {
  if (kind === "wht_certificate") {
    return {
      column: "wht_attachment_url",
      folder: "wht-certificates",
      label: "ใบหัก ณ ที่จ่าย",
    };
  }
  return {
    column: "original_receipt_url",
    folder: "original-receipts",
    label: "ใบเสร็จตัวจริง/ใบกำกับภาษี",
  };
}

async function uploadReferenceFile(
  supabase: SupabaseClient,
  file: File,
  folder: string,
): Promise<{ url: string; path: string } | { error: string }> {
  const mimeType = (file.type || "").toLowerCase();
  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
    return {
      error: `ประเภทไฟล์ไม่รองรับ (${mimeType || "unknown"}) — ใช้ JPG/PNG/WEBP/GIF/PDF`,
    };
  }

  const maxBytes = 10 * 1024 * 1024;
  if (file.size > maxBytes) {
    return { error: "ไฟล์ใหญ่เกิน 10MB" };
  }

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const safeName = file.name
    .replace(/[^\w.\-ก-๙]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
  const extFromName = safeName.includes(".")
    ? safeName.slice(safeName.lastIndexOf("."))
    : mimeType === "application/pdf"
      ? ".pdf"
      : mimeType === "image/png"
        ? ".png"
        : mimeType === "image/webp"
          ? ".webp"
          : mimeType === "image/gif"
            ? ".gif"
            : ".jpg";
  const objectPath = `finance-refs/${folder}/${yyyy}/${mm}/${crypto.randomUUID()}${extFromName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_ATTACHMENTS_BUCKET)
    .upload(objectPath, buffer, {
      contentType: mimeType || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return {
      error: uploadError.message ?? "อัปโหลดไฟล์ขึ้น Storage ไม่สำเร็จ",
    };
  }

  const { data: publicData } = supabase.storage
    .from(DOCUMENT_ATTACHMENTS_BUCKET)
    .getPublicUrl(objectPath);

  const url = publicData?.publicUrl?.trim();
  if (!url) {
    return { error: "อัปโหลดสำเร็จ แต่สร้าง URL ไม่ได้" };
  }

  return { url, path: objectPath };
}

/**
 * Upload a reference attachment and store its URL on the documents row.
 * FormData fields: document_id, kind (`wht_certificate` | `original_receipt`), file
 */
export async function uploadDocumentAttachment(
  formData: FormData,
): Promise<UploadDocumentAttachmentResult> {
  const documentId = String(formData.get("document_id") ?? "").trim();
  const kindRaw = String(formData.get("kind") ?? "").trim();
  const file = formData.get("file");

  if (!documentId) {
    return { success: false, error: "ไม่พบรหัสเอกสาร" };
  }

  if (kindRaw !== "wht_certificate" && kindRaw !== "original_receipt") {
    return { success: false, error: "ประเภทไฟล์แนบไม่ถูกต้อง" };
  }
  const kind = kindRaw as DocumentAttachmentKind;
  const meta = columnForKind(kind);

  if (!(file instanceof File) || file.size <= 0) {
    return { success: false, error: "กรุณาเลือกไฟล์ที่จะอัปโหลด" };
  }

  const supabase = createSupabaseServerClient();
  let slipStoragePath: string | null = null;

  try {
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, doc_no, doc_type, wht_amount")
      .eq("id", documentId)
      .maybeSingle();

    if (docError || !doc) {
      return {
        success: false,
        error: docError?.message ?? "ไม่พบเอกสารที่ต้องการแนบไฟล์",
      };
    }

    const docType = String(doc.doc_type ?? "");
    if (kind === "wht_certificate" && docType !== "REC") {
      return {
        success: false,
        error: "แนบใบหัก ณ ที่จ่ายได้เฉพาะเอกสาร REC",
      };
    }
    if (kind === "original_receipt" && docType !== "PAY") {
      return {
        success: false,
        error: "แนบใบเสร็จตัวจริงได้เฉพาะเอกสาร PAY",
      };
    }
    if (kind === "wht_certificate") {
      const headerWht = Number(doc.wht_amount ?? 0);
      let allocWht = 0;
      if (!(Number.isFinite(headerWht) && headerWht > 0)) {
        const { data: allocRows } = await supabase
          .from("document_allocations")
          .select("wht_amount")
          .eq("receipt_doc_id", documentId);
        allocWht = (allocRows ?? []).reduce(
          (sum, row) => sum + Number(row.wht_amount ?? 0),
          0,
        );
      }
      if (
        !(Number.isFinite(headerWht) && headerWht > 0) &&
        !(allocWht > 0)
      ) {
        return {
          success: false,
          error: "เอกสารนี้ไม่มียอด WHT — ไม่ต้องแนบใบหัก ณ ที่จ่าย",
        };
      }
    }

    const uploaded = await uploadReferenceFile(supabase, file, meta.folder);
    if ("error" in uploaded) {
      return { success: false, error: uploaded.error };
    }
    slipStoragePath = uploaded.path;

    const { error: updateError } = await supabase
      .from("documents")
      .update({
        [meta.column]: uploaded.url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    if (updateError) {
      await supabase.storage
        .from(DOCUMENT_ATTACHMENTS_BUCKET)
        .remove([uploaded.path]);
      return {
        success: false,
        error: updateError.message ?? `บันทึก URL ${meta.label} ไม่สำเร็จ`,
      };
    }

    // Best-effort mirror on doc_headers (PAY legacy)
    await supabase
      .from("doc_headers")
      .update({ [meta.column]: uploaded.url })
      .eq("doc_no", String(doc.doc_no));

    revalidatePath("/sales");
    revalidatePath("/purchases");
    revalidatePath("/finance/payments");
    revalidatePath("/finance/ap-payment");

    return { success: true, error: null, url: uploaded.url };
  } catch (err) {
    if (slipStoragePath) {
      await supabase.storage
        .from(DOCUMENT_ATTACHMENTS_BUCKET)
        .remove([slipStoragePath]);
    }
    const message =
      err instanceof Error ? err.message : "อัปโหลดเอกสารอ้างอิงไม่สำเร็จ";
    return { success: false, error: message };
  }
}
