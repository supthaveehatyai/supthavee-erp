"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUserId } from "@/lib/auth/current-user";
import {
  isAccountingTaxTier,
  isVendorTaxTier,
  loadCashReceiptPack,
} from "@/lib/finance/cash-receipt-data";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { CashReceiptPack, VendorTaxTier } from "@/types/cash-receipt";

const DOCUMENT_ATTACHMENTS_BUCKET = "document_attachments";

function revalidateTaxSurfaces() {
  revalidatePath("/finance/reports");
  revalidatePath("/finance/billing-notes", "layout");
  revalidatePath("/purchases");
  revalidatePath("/contacts");
}

export async function getCashReceiptPackAction(
  fromDate: string,
  toDate: string,
): Promise<CashReceiptPack> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { fromDate, toDate, bills: [], error: owner.error };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return { fromDate, toDate, bills: [], error: "ช่วงวันที่ไม่ถูกต้อง" };
  }
  return loadCashReceiptPack(createSupabaseServerClient(), fromDate, toDate);
}

export async function generateTier12CashReceiptNumbersAction(payload: {
  fromDate: string;
  toDate: string;
  prefix: string;
}): Promise<{ success: boolean; error: string | null; generatedCount: number }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { success: false, error: owner.error, generatedCount: 0 };
  const prefix = payload.prefix.trim().toUpperCase() || "CA01";
  if (!/^[A-Z0-9]{2,10}$/.test(prefix)) {
    return { success: false, error: "รหัสนำหน้าใช้ได้เฉพาะ A-Z และตัวเลข ไม่เกิน 10 ตัว", generatedCount: 0 };
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("generate_tier_1_2_cash_receipt_numbers", {
    p_start_date: payload.fromDate,
    p_end_date: payload.toDate,
    p_prefix: prefix,
  });
  if (error) return { success: false, error: error.message, generatedCount: 0 };
  const body = data as { generated_count?: number } | null;
  revalidateTaxSurfaces();
  return {
    success: true,
    error: null,
    generatedCount: Number(body?.generated_count ?? 0),
  };
}

export async function convertPurchaseBillTaxModeAction(
  documentId: string,
  targetTier: "CORP_VAT" | "RECEIPT_1_2" | "INTERNAL_1_3",
): Promise<{ success: boolean; error: string | null; grandTotal: number | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { success: false, error: owner.error, grandTotal: null };
  const id = documentId.trim();
  if (!id) return { success: false, error: "ไม่พบเอกสาร", grandTotal: null };
  if (!isAccountingTaxTier(targetTier)) {
    return { success: false, error: "ประเภทบิลไม่ถูกต้อง", grandTotal: null };
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("convert_purchase_bill_tax_mode", {
    p_document_id: id,
    p_target_tier: targetTier,
  });
  if (error) return { success: false, error: error.message, grandTotal: null };
  const body = data as { new_grand_total?: number } | null;
  revalidateTaxSurfaces();
  return {
    success: true,
    error: null,
    grandTotal: body?.new_grand_total == null ? null : Number(body.new_grand_total),
  };
}

export async function setContactVendorTaxTierAction(payload: {
  contactId: string;
  vendorTaxTier: VendorTaxTier;
  idCardAttachmentUrl?: string | null;
}): Promise<{ success: boolean; error: string | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { success: false, error: owner.error };
  if (!isVendorTaxTier(payload.vendorTaxTier)) {
    return { success: false, error: "ประเภทผู้จำหน่ายไม่ถูกต้อง" };
  }
  const patch: { vendor_tax_tier: VendorTaxTier; id_card_attachment_url?: string | null } = {
    vendor_tax_tier: payload.vendorTaxTier,
  };
  if (payload.idCardAttachmentUrl !== undefined) {
    patch.id_card_attachment_url = payload.idCardAttachmentUrl;
  }
  const { error } = await createSupabaseServerClient()
    .from("contacts")
    .update(patch)
    .eq("id", payload.contactId.trim());
  if (error) return { success: false, error: error.message };
  revalidateTaxSurfaces();
  return { success: true, error: null };
}

export async function getContactVendorTaxTierAction(contactId: string): Promise<{
  vendorTaxTier: VendorTaxTier | null;
  idCardAttachmentUrl: string | null;
  error: string | null;
}> {
  const owner = await requireSessionUserId();
  if (!owner.ok) {
    return { vendorTaxTier: null, idCardAttachmentUrl: null, error: owner.error };
  }
  const { data, error } = await createSupabaseServerClient()
    .from("contacts")
    .select("vendor_tax_tier, id_card_attachment_url")
    .eq("id", contactId.trim())
    .maybeSingle();
  if (error) return { vendorTaxTier: null, idCardAttachmentUrl: null, error: error.message };
  const tier = String(data?.vendor_tax_tier ?? "");
  return {
    vendorTaxTier: isVendorTaxTier(tier) ? tier : null,
    idCardAttachmentUrl: data?.id_card_attachment_url ? String(data.id_card_attachment_url) : null,
    error: null,
  };
}

export async function uploadContactIdCardAction(
  formData: FormData,
): Promise<{ success: boolean; url: string | null; error: string | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { success: false, url: null, error: owner.error };
  const contactId = String(formData.get("contact_id") ?? "").trim();
  const file = formData.get("id_card");
  if (!contactId) return { success: false, url: null, error: "ไม่พบรหัสคู่ค้า" };
  if (!(file instanceof File) || file.size <= 0) {
    return { success: false, url: null, error: "กรุณาเลือกไฟล์สำเนาบัตรประชาชน" };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { success: false, url: null, error: "ไฟล์ใหญ่เกิน 10MB" };
  }
  const mime = (file.type || "").toLowerCase();
  const allowed = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"]);
  if (mime && !allowed.has(mime)) {
    return { success: false, url: null, error: "ใช้ไฟล์ JPG, PNG, WEBP หรือ PDF" };
  }
  const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const path = `contact-id-cards/${contactId}/${crypto.randomUUID()}.${ext}`;
  const supabase = createSupabaseServerClient();
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_ATTACHMENTS_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: mime || "application/octet-stream",
      upsert: false,
    });
  if (uploadError) return { success: false, url: null, error: uploadError.message };
  const url = supabase.storage.from(DOCUMENT_ATTACHMENTS_BUCKET).getPublicUrl(path).data.publicUrl;
  const saved = await setContactVendorTaxTierAction({
    contactId,
    vendorTaxTier: "INDIVIDUAL_ID_1_2",
    idCardAttachmentUrl: url,
  });
  if (!saved.success) return { success: false, url: null, error: saved.error };
  return { success: true, url, error: null };
}
