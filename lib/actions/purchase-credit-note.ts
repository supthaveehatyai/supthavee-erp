"use server";

import { revalidatePath } from "next/cache";
import { generateDocumentNumber } from "@/lib/actions/document-actions";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isVatCalculationType } from "@/lib/utils/document-summary";

type VendorHit = {
  id: string;
  company_name: string;
  tax_id: string | null;
};

type VendorBill = {
  id: string;
  doc_no: string;
  doc_date: string;
  reference_no: string | null;
  grand_total: number;
};

type CreditLineInput = {
  product_id?: string | null;
  description?: string | null;
  qty?: number | null;
  uom?: string | null;
  unit_price?: number | null;
  discount_text?: string | null;
};

type SavePurchaseCreditNoteInput = {
  contact_id: string;
  reference_no: string;
  doc_date: string;
  vat_reporting_date: string;
  ref_document_id?: string | null;
  vendor_ref_invoice_no?: string | null;
  return_stock_flag?: boolean | null;
  vat_type?: string | null;
  lines: CreditLineInput[];
};

function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function parseDiscount(gross: number, text: string): number {
  const raw = text.trim();
  if (!raw) return 0;
  if (raw.endsWith("%")) {
    const rate = Number(raw.slice(0, -1));
    if (!Number.isFinite(rate) || rate < 0) return 0;
    return round2(gross * (Math.min(rate, 100) / 100));
  }
  const amount = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return round2(Math.min(amount, gross));
}

function monthStart(value: string): string | null {
  const text = value.trim();
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text.slice(0, 7)}-01`;
  return null;
}

export async function searchPurchaseVendors(keyword: string): Promise<{
  data: VendorHit[];
  error: string | null;
}> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: [], error: owner.error };
    const trimmed = keyword.trim();
    if (trimmed.length < 1) return { data: [], error: null };
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("contacts")
      .select("id, company_name, tax_id")
      .or(`company_name.ilike.%${trimmed}%,nickname.ilike.%${trimmed}%,tax_id.ilike.%${trimmed}%`)
      .order("company_name", { ascending: true })
      .limit(20);
    if (error) return { data: [], error: error.message };
    return {
      data: (data ?? []).map((row) => ({
        id: String(row.id),
        company_name: String(row.company_name ?? "").trim() || "ไม่ระบุชื่อ",
        tax_id: row.tax_id ? String(row.tax_id) : null,
      })),
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "ค้นหาผู้ขายไม่สำเร็จ";
    return { data: [], error: message };
  }
}

export async function getPurchaseVendor(contactId: string): Promise<{
  data: VendorHit | null;
  error: string | null;
}> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error };
    const id = contactId.trim();
    if (!id) return { data: null, error: null };
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("contacts")
      .select("id, company_name, tax_id")
      .eq("id", id)
      .maybeSingle();
    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };
    return {
      data: {
        id: String(data.id),
        company_name: String(data.company_name ?? "").trim() || "ไม่ระบุชื่อ",
        tax_id: data.tax_id ? String(data.tax_id) : null,
      },
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "อ่านข้อมูลผู้ขายไม่สำเร็จ";
    return { data: null, error: message };
  }
}

export async function listVendorApTaxBills(contactId: string): Promise<{
  data: VendorBill[];
  error: string | null;
}> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: [], error: owner.error };
    const id = contactId.trim();
    if (!id) return { data: [], error: null };
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("documents")
      .select("id, doc_no, doc_date, reference_no, grand_total")
      .eq("contact_id", id)
      .eq("doc_type", "AP_TAX")
      .in("status", ["ISSUED", "PAID", "COMPLETED"])
      .or("is_voided.is.null,is_voided.eq.false")
      .order("doc_date", { ascending: false })
      .limit(40);
    if (error) return { data: [], error: error.message };
    return {
      data: (data ?? []).map((row) => ({
        id: String(row.id),
        doc_no: String(row.doc_no ?? ""),
        doc_date: String(row.doc_date ?? "").slice(0, 10),
        reference_no: row.reference_no ? String(row.reference_no) : null,
        grand_total: round2(Number(row.grand_total ?? 0)),
      })),
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "ดึงบิลซื้อของผู้ขายไม่สำเร็จ";
    return { data: [], error: message };
  }
}

export async function savePurchaseCreditNote(
  input: SavePurchaseCreditNoteInput,
): Promise<{ data: { id: string; doc_no: string } | null; error: string | null }> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error };

    const contactId = input.contact_id?.trim() ?? "";
    const referenceNo = input.reference_no?.trim() ?? "";
    const docDate = input.doc_date?.trim() ?? "";
    const reportingDate = monthStart(input.vat_reporting_date ?? "") ?? monthStart(docDate);
    const vatType = isVatCalculationType(String(input.vat_type ?? ""))
      ? input.vat_type
      : "EXCLUSIVE";
    if (!contactId) return { data: null, error: "กรุณาเลือกผู้ขาย" };
    if (!referenceNo) return { data: null, error: "กรุณากรอกเลขที่ใบลดหนี้ของผู้ขาย" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(docDate)) {
      return { data: null, error: "วันที่ออกใบลดหนี้ไม่ถูกต้อง" };
    }
    if (!reportingDate) return { data: null, error: "งวดเดือนที่ยื่นภาษีซื้อไม่ถูกต้อง" };

    const rate = vatType === "NONE" ? 0 : 7;
    const priced = (input.lines ?? [])
      .map((line) => {
        const qty = round2(Number(line.qty ?? 0));
        const unitPrice = round2(Number(line.unit_price ?? 0));
        const gross = round2(qty * unitPrice);
        const discount = parseDiscount(gross, String(line.discount_text ?? ""));
        const net = round2(Math.max(0, gross - discount));
        let base = net;
        let vat = 0;
        let grand = net;
        if (vatType === "EXCLUSIVE" && rate > 0) {
          vat = round2(net * (rate / 100));
          grand = round2(net + vat);
        } else if (vatType === "INCLUSIVE" && rate > 0) {
          vat = round2(net * (rate / (100 + rate)));
          base = round2(net - vat);
          grand = net;
        }
        return {
          product_id: line.product_id?.trim() || null,
          description: String(line.description ?? "").trim(),
          qty,
          uom: String(line.uom ?? "").trim() || "ชิ้น",
          unit_price: unitPrice,
          discount_text: String(line.discount_text ?? "").trim() || null,
          discount,
          net,
          base,
          vat,
          grand,
        };
      })
      .filter((line) => line.qty > 0 && (line.description || line.product_id));

    if (priced.length === 0) {
      return { data: null, error: "กรุณาระบุสินค้าที่ส่งคืนอย่างน้อย 1 รายการ" };
    }

    const netBeforeVat = round2(priced.reduce((sum, line) => sum + line.base, 0));
    const vatAmount = round2(priced.reduce((sum, line) => sum + line.vat, 0));
    const grandTotal = round2(priced.reduce((sum, line) => sum + line.grand, 0));
    const discountAmount = round2(priced.reduce((sum, line) => sum + line.discount, 0));
    const goodsAmount = round2(priced.reduce((sum, line) => sum + line.net, 0));
    const returnStock = input.return_stock_flag !== false;
    const refId = input.ref_document_id?.trim() || null;
    const vendorInvoice = input.vendor_ref_invoice_no?.trim() || null;

    const numbered = await generateDocumentNumber("AP_CN", docDate);
    if (!numbered.data) {
      return { data: null, error: numbered.error ?? "ออกเลขที่ PCN ไม่สำเร็จ" };
    }
    const docNo = numbered.data;
    const supabase = createSupabaseServerClient();
    const nowIso = new Date().toISOString();

    const created = await supabase
      .from("documents")
      .insert({
        doc_no: docNo,
        doc_type: "AP_CN",
        status: "ISSUED",
        doc_date: docDate,
        contact_id: contactId,
        ref_document_id: refId,
        ref_doc_id: refId,
        reference_no: referenceNo,
        vendor_ref_invoice_no: vendorInvoice,
        vat_reporting_date: reportingDate,
        return_stock_flag: returnStock,
        sub_total: goodsAmount,
        total_amount: goodsAmount,
        discount_amount: discountAmount,
        tax_rate: rate,
        tax_amount: vatAmount,
        vat_type: vatType,
        vat_rate: rate,
        net_before_vat: netBeforeVat,
        vat_amount: vatAmount,
        grand_total: grandTotal,
        paid_amount: 0,
        payment_status: "UNPAID",
        notes: vendorInvoice
          ? `ใบลดหนี้ซื้อ ${referenceNo} อ้างอิง ${vendorInvoice}`
          : `ใบลดหนี้ซื้อ ${referenceNo}`,
        created_by: owner.userId,
        updated_at: nowIso,
      } as never)
      .select("id, doc_no")
      .single();

    if (created.error || !created.data) {
      return { data: null, error: created.error?.message ?? "บันทึกใบลดหนี้ซื้อไม่สำเร็จ" };
    }

    const documentId = created.data.id;
    const itemInsert = await supabase.from("document_items").insert(
      priced.map((line, index) => ({
        document_id: documentId,
        product_id: line.product_id,
        description: line.description || "สินค้าส่งคืน",
        qty: line.qty,
        uom_used: line.uom,
        unit_price: line.unit_price,
        unit_cost_price: line.qty > 0 ? round2(line.net / line.qty) : line.unit_price,
        discount_text: line.discount_text,
        discount_amount: line.discount,
        line_total: line.net,
        sort_order: index + 1,
      })),
    );
    if (itemInsert.error) {
      await supabase.from("documents").delete().eq("id", documentId);
      return { data: null, error: itemInsert.error.message };
    }

    if (returnStock) {
      const ledgerRows = priced
        .filter((line) => line.product_id && line.qty > 0)
        .map((line) => ({
          product_id: line.product_id,
          document_id: documentId,
          doc_header_id: documentId,
          trans_type: "OUT",
          qty: round2(-Math.abs(line.qty)),
          unit_cost: line.qty > 0 ? round2(line.net / line.qty) : 0,
          tx_date: docDate,
          notes: `คืนสินค้าผู้ขายตามใบลดหนี้ ${docNo} (${referenceNo})`.slice(0, 255),
        }));
      if (ledgerRows.length > 0) {
        const ledger = await supabase.from("inventory_ledger").insert(ledgerRows as never);
        if (ledger.error && /tx_date|42703/i.test(ledger.error.message)) {
          const retry = await supabase.from("inventory_ledger").insert(
            ledgerRows.map(({ tx_date: _txDate, ...row }) => row) as never,
          );
          if (retry.error) {
            await supabase.from("document_items").delete().eq("document_id", documentId);
            await supabase.from("documents").delete().eq("id", documentId);
            return { data: null, error: retry.error.message };
          }
        } else if (ledger.error) {
          await supabase.from("document_items").delete().eq("document_id", documentId);
          await supabase.from("documents").delete().eq("id", documentId);
          return { data: null, error: ledger.error.message };
        }
      }
    }

    revalidatePath("/purchases");
    revalidatePath("/finance/ap-payment");
    revalidatePath("/finance/billing-notes");
    revalidatePath("/finance/tax-reports");
    return { data: { id: documentId, doc_no: docNo }, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "บันทึกใบลดหนี้ซื้อไม่สำเร็จ";
    return { data: null, error: message };
  }
}

export async function uploadPurchaseCreditNoteFile(
  formData: FormData,
): Promise<{ success: boolean; error: string | null }> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { success: false, error: owner.error };
    const documentId = String(formData.get("document_id") ?? "").trim();
    const file = formData.get("file");
    if (!documentId) return { success: false, error: "ไม่พบรหัสใบลดหนี้" };
    if (!(file instanceof File) || file.size <= 0) {
      return { success: false, error: "กรุณาเลือกไฟล์ใบลดหนี้" };
    }
    const mime = (file.type || "").toLowerCase();
    const allowed = new Set([
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
    ]);
    if (mime && !allowed.has(mime)) {
      return { success: false, error: "รองรับเฉพาะ PDF หรือรูปภาพ" };
    }
    const supabase = createSupabaseServerClient();
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, doc_no, doc_type")
      .eq("id", documentId)
      .maybeSingle();
    if (docError || !doc || String(doc.doc_type) !== "AP_CN") {
      return { success: false, error: docError?.message ?? "ไม่พบใบลดหนี้ซื้อ" };
    }
    const ext = mime === "application/pdf" ? "pdf" : mime.includes("png") ? "png" : "jpg";
    const path = `purchase-cn/${doc.doc_no}-${Date.now()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploaded = await supabase.storage
      .from("document_attachments")
      .upload(path, bytes, { contentType: mime || "application/octet-stream", upsert: false });
    if (uploaded.error) return { success: false, error: uploaded.error.message };
    const url = supabase.storage.from("document_attachments").getPublicUrl(path).data.publicUrl;
    const saved = await supabase
      .from("documents")
      .update({
        original_receipt_url: url,
        attachment_url: url,
        attached_file_url: url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
    if (saved.error) return { success: false, error: saved.error.message };
    revalidatePath(`/purchases/${encodeURIComponent(String(doc.doc_no))}`);
    return { success: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "อัปโหลดใบลดหนี้ไม่สำเร็จ";
    return { success: false, error: message };
  }
}
