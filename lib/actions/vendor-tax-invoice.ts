"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { logAuditTrail } from "@/lib/supabase/auditService";
import { mergeBillNotes, splitBillNotes } from "@/lib/procurement/bill-notes";
import { roundTaxMoney } from "@/lib/utils/tax-invoice-status";

function createSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY หรือ NEXT_PUBLIC_SUPABASE_URL");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isMissingTaxInvoiceStore(error: { code?: string; message?: string } | null): boolean {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST202" ||
    error?.code === "42703" ||
    /match_vendor_tax_invoice_transaction|tax_invoice_status|tax_invoice_no|tax_reported_base|does not exist|could not find the function|schema cache/i.test(
      message,
    )
  );
}

export async function loadVendorUsesTemporaryBill(vendorId: string): Promise<{
  usesTemporaryBill: boolean;
  error: string | null;
}> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { usesTemporaryBill: false, error: owner.error };
  const id = vendorId.trim();
  if (!id) return { usesTemporaryBill: false, error: null };

  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("contacts")
      .select("company_name, pending_tax_invoice_default")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (isMissingTaxInvoiceStore(error)) {
        const nameOnly = await supabase
          .from("contacts")
          .select("company_name")
          .eq("id", id)
          .maybeSingle();
        const name = String(nameOnly.data?.company_name ?? "");
        return { usesTemporaryBill: name.replace(/\s+/g, "").includes("กมลกิจ"), error: null };
      }
      return { usesTemporaryBill: false, error: error.message };
    }
    const row = data as {
      company_name?: string | null;
      pending_tax_invoice_default?: boolean | null;
    } | null;
    const name = String(row?.company_name ?? "").replace(/\s+/g, "");
    return {
      usesTemporaryBill: row?.pending_tax_invoice_default === true || name.includes("กมลกิจ"),
      error: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "โหลดรูปแบบบิลผู้จำหน่ายไม่สำเร็จ";
    return { usesTemporaryBill: false, error: message };
  }
}

type MatchDocumentRow = {
  id: string;
  doc_no: string;
  contact_id: string | null;
  status: string | null;
  grand_total: number | null;
  tax_invoice_status: string | null;
  notes: string | null;
  attachment_urls: string[] | null;
};

async function applyTaxInvoiceMatch(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  input: {
    documentIds: string[];
    taxInvoiceNo: string;
    taxInvoiceDate: string;
    actualTaxBase: number;
    actualVatAmount: number;
    taxInvoiceFileUrl: string | null;
    adjustApToTaxInvoice: boolean;
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, doc_no, contact_id, status, grand_total, tax_invoice_status, notes, attachment_urls")
    .in("id", input.documentIds);
  if (error) return error.message;

  const byId = new Map(
    ((data ?? []) as MatchDocumentRow[]).map((row) => [row.id, row]),
  );
  const rows = input.documentIds.map((id) => byId.get(id)).filter((row): row is MatchDocumentRow => Boolean(row));
  if (rows.length !== input.documentIds.length) return "ไม่พบเอกสารบางใบที่เลือก";

  const vendorIds = new Set(rows.map((row) => row.contact_id).filter(Boolean));
  if (vendorIds.size !== 1) return "ประกบใบกำกับได้เฉพาะเอกสารของผู้จำหน่ายรายเดียวกัน";
  const blocked = rows.find((row) => {
    const status = String(row.status ?? "").toUpperCase();
    const taxStatus = String(row.tax_invoice_status ?? "").toUpperCase();
    return status === "VOID" || taxStatus !== "PENDING_TAX_INVOICE";
  });
  if (blocked) {
    return `เอกสาร ${blocked.doc_no} ไม่ได้อยู่สถานะรอใบกำกับภาษี`;
  }

  const deliveryTotal = roundTaxMoney(
    rows.reduce((sum, row) => sum + Number(row.grand_total ?? 0), 0),
  );
  const taxTotal = roundTaxMoney(input.actualTaxBase + input.actualVatAmount);
  const variance = roundTaxMoney(taxTotal - deliveryTotal);
  const primary = rows[0];
  if (!primary) return "ไม่พบเอกสารสำหรับประกบใบกำกับ";

  for (const [index, row] of rows.entries()) {
    const isPrimary = index === 0;
    const urls = Array.isArray(row.attachment_urls) ? [...row.attachment_urls] : [];
    if (input.taxInvoiceFileUrl && !urls.includes(input.taxInvoiceFileUrl)) {
      urls.push(input.taxInvoiceFileUrl);
    }
    const notes = input.taxInvoiceFileUrl
      ? mergeBillNotes(row.notes, {
          attachment_urls: [input.taxInvoiceFileUrl],
          attachments: [
            {
              url: input.taxInvoiceFileUrl,
              path: input.taxInvoiceFileUrl,
              name: input.taxInvoiceNo,
              type: "image/webp",
              size: 0,
              uploaded_at: new Date().toISOString(),
            },
          ],
        })
      : row.notes;
    const nextGrand =
      isPrimary && input.adjustApToTaxInvoice
        ? roundTaxMoney(Number(row.grand_total ?? 0) + variance)
        : Number(row.grand_total ?? 0);
    const payload = {
      tax_invoice_status: isPrimary ? "TAX_READY" : "CONSOLIDATED_CHILD",
      tax_invoice_no: input.taxInvoiceNo,
      tax_invoice_date: input.taxInvoiceDate,
      tax_reported_base: isPrimary ? input.actualTaxBase : null,
      tax_reported_vat: isPrimary ? input.actualVatAmount : null,
      tax_invoice_file_url: input.taxInvoiceFileUrl,
      grand_total: nextGrand,
      notes,
      attachment_urls: urls,
    };
    const { error: updateError } = await supabase
      .from("documents")
      .update(payload as never)
      .eq("id", row.id);
    if (updateError && /attachment_urls|schema cache/i.test(updateError.message)) {
      const { attachment_urls: _urls, ...withoutUrls } = payload;
      const retry = await supabase.from("documents").update(withoutUrls as never).eq("id", row.id);
      if (retry.error) return retry.error.message;
    } else if (updateError) {
      return updateError.message;
    }
  }

  return null;
}

export async function matchVendorTaxInvoiceAction(input: {
  documentIds: string[];
  taxInvoiceNo: string;
  taxInvoiceDate: string;
  actualTaxBase: number;
  actualVatAmount: number;
  taxInvoiceFileUrl?: string | null;
  adjustApToTaxInvoice: boolean;
}): Promise<{ success: boolean; error: string | null }> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { success: false, error: owner.error };

    const documentIds = [...new Set((input.documentIds ?? []).map((id) => id.trim()).filter(Boolean))];
    const taxInvoiceNo = input.taxInvoiceNo?.trim() ?? "";
    const taxInvoiceDate = input.taxInvoiceDate?.trim() ?? "";
    const actualTaxBase = roundTaxMoney(Number(input.actualTaxBase));
    const actualVatAmount = roundTaxMoney(Number(input.actualVatAmount));
    const taxInvoiceFileUrl = input.taxInvoiceFileUrl?.trim() || null;
    if (documentIds.length === 0) return { success: false, error: "ยังไม่ได้เลือกใบส่งของ" };
    if (!taxInvoiceNo) return { success: false, error: "กรุณากรอกเลขที่ใบกำกับภาษีตัวจริง" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(taxInvoiceDate)) {
      return { success: false, error: "กรุณาระบุวันที่ใบกำกับภาษีตัวจริง" };
    }
    if (actualTaxBase < 0 || actualVatAmount < 0) {
      return { success: false, error: "ฐานภาษีและภาษีมูลค่าเพิ่มต้องไม่ติดลบ" };
    }

    const supabase = createSupabaseAdmin();
    const rpcPayload = {
      p_document_ids: documentIds,
      p_tax_invoice_no: taxInvoiceNo,
      p_tax_invoice_date: taxInvoiceDate,
      p_actual_tax_base: actualTaxBase,
      p_actual_vat_amount: actualVatAmount,
      p_tax_invoice_file_url: taxInvoiceFileUrl,
      p_adjust_ap_to_tax_invoice: input.adjustApToTaxInvoice === true,
    };
    const { error: rpcError } = await supabase.rpc(
      "match_vendor_tax_invoice_transaction",
      rpcPayload,
    );
    if (rpcError && !isMissingTaxInvoiceStore(rpcError)) {
      return { success: false, error: rpcError.message };
    }
    if (rpcError) {
      const fallbackError = await applyTaxInvoiceMatch(supabase, {
        documentIds,
        taxInvoiceNo,
        taxInvoiceDate,
        actualTaxBase,
        actualVatAmount,
        taxInvoiceFileUrl,
        adjustApToTaxInvoice: input.adjustApToTaxInvoice === true,
      });
      if (fallbackError) {
        return {
          success: false,
          error: isMissingTaxInvoiceStore({ message: fallbackError })
            ? "ยังไม่ได้ติดตั้งคอลัมน์ใบกำกับภาษี — รัน SQL match_vendor_tax_invoice_transaction บน Supabase ก่อน"
            : fallbackError,
        };
      }
    } else if (taxInvoiceFileUrl) {
      const { data: noteRows } = await supabase
        .from("documents")
        .select("id, notes")
        .in("id", documentIds);
      for (const row of noteRows ?? []) {
        const notes = String((row as { notes?: string | null }).notes ?? "");
        if (splitBillNotes(notes).bills.attachment_urls.includes(taxInvoiceFileUrl)) continue;
        const merged = mergeBillNotes(notes, {
          attachment_urls: [taxInvoiceFileUrl],
          attachments: [
            {
              url: taxInvoiceFileUrl,
              path: taxInvoiceFileUrl,
              name: taxInvoiceNo,
              type: "image/webp",
              size: 0,
              uploaded_at: new Date().toISOString(),
            },
          ],
        });
        await supabase.from("documents").update({ notes: merged }).eq("id", row.id);
      }
    }

    const correlationId = crypto.randomUUID();
    for (const documentId of documentIds) {
      await logAuditTrail(
        "documents",
        documentId,
        "UPDATE",
        { tax_invoice_status: "PENDING_TAX_INVOICE" },
        {
          tax_invoice_status: documentId === documentIds[0] ? "TAX_READY" : "CONSOLIDATED_CHILD",
          tax_invoice_no: taxInvoiceNo,
          tax_invoice_date: taxInvoiceDate,
          tax_reported_base: documentId === documentIds[0] ? actualTaxBase : null,
          tax_reported_vat: documentId === documentIds[0] ? actualVatAmount : null,
          adjust_ap_to_tax_invoice: input.adjustApToTaxInvoice === true,
        },
        null,
        { correlationId },
      );
    }

    revalidatePath("/purchases");
    revalidatePath("/finance/tax-reports");
    return { success: true, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ประกบใบกำกับภาษีไม่สำเร็จ";
    return { success: false, error: message };
  }
}
