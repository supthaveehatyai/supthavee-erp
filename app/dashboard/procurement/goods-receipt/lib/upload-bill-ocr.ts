/**
 * Phase 3 — Smart Goods Receipt
 * Client utility: bill image → Base64 → POST `process-receipt-ocr` → review rows
 */

import { supabase } from "@/lib/supabase";
import type { OcrVerificationItem } from "@/app/dashboard/procurement/goods-receipt/types";

const MAX_BILL_BYTES = 8 * 1024 * 1024;

export type ProcessReceiptOcrLine = {
  raw_vendor_sku: string;
  description?: string;
  qty: number;
  unit_price: number;
  discount_text: string;
};

export type ProcessReceiptOcrMeta = {
  vendor_id: string;
  vendor_name: string | null;
  model: string;
  line_count: number;
};

type EdgeFunctionResponse = {
  success: boolean;
  data?: ProcessReceiptOcrLine[];
  error?: string;
  meta?: ProcessReceiptOcrMeta;
};

export type UploadBillOcrInput = {
  /** Uploaded bill image or PDF */
  file: File;
  /** contacts.id where contact_roles contains Vendor */
  vendorId: string;
};

export type UploadBillOcrResult = {
  items: OcrVerificationItem[];
  meta: ProcessReceiptOcrMeta | null;
  error: string | null;
  /** Pretty JSON of mapped items — useful for the editable OCR panel */
  jsonText: string;
};

/**
 * Convert an uploaded File to a raw Base64 string (+ MIME type).
 * Strips the `data:*;base64,` prefix so the Edge Function payload stays smaller.
 */
export function convertFileToBase64(
  file: File,
): Promise<{ imageBase64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const match = /^data:([^;]+);base64,(.+)$/i.exec(result);
      if (match) {
        resolve({
          mimeType: match[1],
          imageBase64: match[2].replace(/\s/g, ""),
        });
        return;
      }
      resolve({
        mimeType: file.type || "image/jpeg",
        imageBase64: result.replace(/\s/g, ""),
      });
    };
    reader.onerror = () =>
      reject(new Error("แปลงไฟล์เป็น Base64 ไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

/** Map Edge Function JSON array → Verification Table rows */
export function mapOcrLinesToReviewItems(
  lines: ProcessReceiptOcrLine[],
): OcrVerificationItem[] {
  return lines.map((line) => ({
    raw_vendor_sku: String(line.raw_vendor_sku ?? "").trim(),
    qty: Number(line.qty) || 0,
    unit_price: Number(line.unit_price) || 0,
    discount_text: String(line.discount_text ?? ""),
    raw_description: line.description?.trim() || undefined,
  }));
}

export function reviewItemsToJsonText(items: OcrVerificationItem[]): string {
  return JSON.stringify(
    items.map((item) => ({
      raw_vendor_sku: item.raw_vendor_sku,
      qty: item.qty,
      unit_price: item.unit_price,
      discount_text: item.discount_text,
      raw_description: item.raw_description,
    })),
    null,
    2,
  );
}

function validateUpload(file: File, vendorId: string): string | null {
  if (!vendorId.trim()) {
    return "กรุณาเลือกผู้จำหน่าย (vendor_id) ก่อนอัปโหลดบิล";
  }
  if (!file) {
    return "ไม่พบไฟล์บิล";
  }
  const okType =
    file.type.startsWith("image/") || file.type === "application/pdf";
  if (!okType) {
    return "รองรับเฉพาะไฟล์รูปภาพ (JPEG/PNG/WebP) หรือ PDF";
  }
  if (file.size > MAX_BILL_BYTES) {
    return "ไฟล์ใหญ่เกิน 8MB — ย่อรูปแล้วลองใหม่";
  }
  return null;
}

/**
 * POST payload to Supabase Edge Function `process-receipt-ocr`.
 * Body: `{ imageBase64, vendor_id, mimeType? }`
 */
export async function postProcessReceiptOcr(input: {
  vendorId: string;
  imageBase64: string;
  mimeType?: string;
}): Promise<{
  lines: ProcessReceiptOcrLine[];
  meta: ProcessReceiptOcrMeta | null;
  error: string | null;
}> {
  const { data, error } = await supabase.functions.invoke(
    "process-receipt-ocr",
    {
      body: {
        vendor_id: input.vendorId,
        imageBase64: input.imageBase64,
        mimeType: input.mimeType,
      },
    },
  );

  if (error) {
    return {
      lines: [],
      meta: null,
      error: error.message || "POST process-receipt-ocr ไม่สำเร็จ",
    };
  }

  const payload = data as EdgeFunctionResponse | null;
  if (!payload?.success || !Array.isArray(payload.data)) {
    return {
      lines: [],
      meta: null,
      error: payload?.error ?? "OCR ไม่สำเร็จ — ไม่มีข้อมูลรายการ",
    };
  }

  return {
    lines: payload.data,
    meta: payload.meta ?? null,
    error: null,
  };
}

/**
 * End-to-end API utility for Smart Goods Receipt upload flow:
 * 1. Validate `vendor_id` + file
 * 2. Convert bill image → Base64
 * 3. POST to Edge Function `process-receipt-ocr`
 * 4. Map returned JSON array → Shadcn review table rows
 */
export async function uploadBillAndProcessOcr(
  input: UploadBillOcrInput,
): Promise<UploadBillOcrResult> {
  const validationError = validateUpload(input.file, input.vendorId);
  if (validationError) {
    return {
      items: [],
      meta: null,
      error: validationError,
      jsonText: "[]",
    };
  }

  try {
    const { imageBase64, mimeType } = await convertFileToBase64(input.file);
    const { lines, meta, error } = await postProcessReceiptOcr({
      vendorId: input.vendorId,
      imageBase64,
      mimeType,
    });

    if (error) {
      return { items: [], meta: null, error, jsonText: "[]" };
    }

    const items = mapOcrLinesToReviewItems(lines);
    return {
      items,
      meta,
      error: null,
      jsonText: reviewItemsToJsonText(items),
    };
  } catch (err) {
    return {
      items: [],
      meta: null,
      error: err instanceof Error ? err.message : "สแกนบิลไม่สำเร็จ",
      jsonText: "[]",
    };
  }
}
