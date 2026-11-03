"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUserId } from "@/lib/auth/current-user";
import {
  isPaymentChannel,
  paymentChannelLabel,
  RECEIPT_REGISTER_DOC_TYPES,
  type PaymentChannel,
  type UnsweptReceiptRow,
} from "@/lib/finance/payment-channel";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import * as XLSX from "xlsx";

const RECEIPT_DOC_TYPES = [...RECEIPT_REGISTER_DOC_TYPES];

type ReceiptQueryRow = {
  id: string;
  doc_no: string | null;
  doc_date: string | null;
  doc_type: string | null;
  status: string | null;
  grand_total: number | string | null;
  net_before_vat: number | string | null;
  vat_amount: number | string | null;
  paid_amount: number | string | null;
  payment_channel: string | null;
  receiving_bank_label: string | null;
  reference_no: string | null;
  is_swept_to_company: boolean | null;
  swept_to_company_at: string | null;
  swept_batch_ref: string | null;
  contacts: { company_name: string | null } | { company_name: string | null }[] | null;
};

function toMoney(value: number | string | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function contactName(
  value: ReceiptQueryRow["contacts"],
): string {
  const row = Array.isArray(value) ? value[0] : value;
  return row?.company_name?.trim() || "—";
}

function receivedAmount(row: ReceiptQueryRow): number {
  const paid = toMoney(row.paid_amount);
  return paid > 0 ? paid : toMoney(row.grand_total);
}

function sweepStatus(row: ReceiptQueryRow): string {
  if (!row.is_swept_to_company) return "รอโอนเข้าบัญชีบริษัท";
  const date = row.swept_to_company_at
    ? String(row.swept_to_company_at).slice(0, 10)
    : "";
  const ref = row.swept_batch_ref?.trim() || "";
  if (date && ref) return `${date} / ${ref}`;
  if (date) return date;
  if (row.payment_channel === "COMPANY_BANK") return "เข้าบัญชีบริษัทแล้ว";
  return ref || "โอนเข้าบัญชีบริษัทแล้ว";
}

async function loadReceiptRows(): Promise<{
  rows: ReceiptQueryRow[];
  error: string | null;
}> {
  const supabase = createSupabaseServerClient();
  const page = await fetchAllPages<ReceiptQueryRow>((from, to) =>
    supabase
      .from("documents")
      .select(
        `
        id, doc_no, doc_date, doc_type, status, grand_total, net_before_vat,
        vat_amount, paid_amount, payment_channel, receiving_bank_label,
        reference_no, is_swept_to_company, swept_to_company_at, swept_batch_ref,
        contacts:contact_id ( company_name )
      `,
      )
      .in("doc_type", RECEIPT_DOC_TYPES)
      .or("is_voided.is.null,is_voided.eq.false")
      .order("doc_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (page.error) return { rows: [], error: page.error.message };
  return {
    rows: page.data.filter((row) => {
      const status = String(row.status ?? "");
      return status !== "VOID" && status !== "CANCELLED";
    }),
    error: null,
  };
}

export async function resolveCompanyBankAccountId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("mst_bank_accounts")
    .select("id, account_no, is_active");
  const match = (data ?? []).find((row) => {
    if (row.is_active === false) return false;
    return String(row.account_no ?? "").replace(/\D/g, "").includes("6510");
  });
  return match?.id ?? null;
}

export async function getUnsweptReceipts(): Promise<{
  data: UnsweptReceiptRow[];
  error: string | null;
}> {
  try {
    const loaded = await loadReceiptRows();
    if (loaded.error) return { data: [], error: loaded.error };
    const data = loaded.rows
      .filter(
        (row) =>
          (row.payment_channel === "CASH" || row.payment_channel === "OTHER_BANK") &&
          row.is_swept_to_company !== true,
      )
      .map((row) => ({
        id: row.id,
        doc_no: row.doc_no?.trim() || "—",
        doc_date: String(row.doc_date ?? "").slice(0, 10),
        doc_type: String(row.doc_type ?? ""),
        contact_name: contactName(row.contacts),
        payment_channel: row.payment_channel as "CASH" | "OTHER_BANK",
        amount: receivedAmount(row),
        receiving_bank_label: row.receiving_bank_label,
      }));
    return { data, error: null };
  } catch (error) {
    return {
      data: [],
      error: error instanceof Error ? error.message : "โหลดยอดรอโอนไม่สำเร็จ",
    };
  }
}

export async function markReceiptsSweptToCompany(input: {
  document_ids: string[];
  swept_on: string;
  swept_batch_ref: string;
}): Promise<{ success: boolean; error: string | null; updated: number }> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { success: false, error: owner.error, updated: 0 };

    const ids = [...new Set(input.document_ids.map((id) => id.trim()).filter(Boolean))];
    const sweptOn = String(input.swept_on ?? "").trim();
    const batchRef = String(input.swept_batch_ref ?? "").trim();
    if (ids.length === 0) {
      return { success: false, error: "กรุณาเลือกรายการที่จะโอนรวม", updated: 0 };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sweptOn)) {
      return { success: false, error: "กรุณาระบุวันที่โอนเข้าบัญชีบริษัท", updated: 0 };
    }
    if (!batchRef) {
      return { success: false, error: "กรุณาระบุเลขอ้างอิงสลิปโอนรวม", updated: 0 };
    }

    const supabase = createSupabaseServerClient();
    const sweptAt = new Date(`${sweptOn}T00:00:00+07:00`).toISOString();
    const { data, error } = await supabase
      .from("documents")
      .update({
        is_swept_to_company: true,
        swept_to_company_at: sweptAt,
        swept_batch_ref: batchRef.slice(0, 80),
        updated_at: new Date().toISOString(),
      })
      .in("id", ids)
      .in("payment_channel", ["CASH", "OTHER_BANK"])
      .select("id");

    if (error) return { success: false, error: error.message, updated: 0 };

    revalidatePath("/finance/deposits");
    revalidatePath("/sales");
    return { success: true, error: null, updated: data?.length ?? 0 };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "บันทึกการโอนรวมไม่สำเร็จ",
      updated: 0,
    };
  }
}

export async function getAccountantReceiptFiles(): Promise<{
  csv: string | null;
  xlsx_base64: string | null;
  error: string | null;
}> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { csv: null, xlsx_base64: null, error: owner.error };

    const loaded = await loadReceiptRows();
    if (loaded.error) return { csv: null, xlsx_base64: null, error: loaded.error };

    const rows = loaded.rows.map((row) => {
      const channel = isPaymentChannel(row.payment_channel)
        ? paymentChannelLabel(row.payment_channel, row.receiving_bank_label)
        : paymentChannelLabel(row.payment_channel);
      return {
        วันที่เอกสาร: String(row.doc_date ?? "").slice(0, 10),
        เลขที่เอกสาร: row.doc_no ?? "",
        ประเภทเอกสาร: String(row.doc_type ?? ""),
        ชื่อลูกค้า: contactName(row.contacts),
        มูลค่าก่อนภาษี: toMoney(row.net_before_vat),
        "VAT 7%": toMoney(row.vat_amount),
        ยอดสุทธิ: toMoney(row.grand_total),
        ช่องทางรับเงิน: row.receiving_bank_label?.trim() || channel,
        เลขสลิปอ้างอิง: row.reference_no?.trim() || "",
        สถานะโอนเข้าบัญชีบริษัท: sweepStatus(row),
      };
    });

    const headers = Object.keys(rows[0] ?? {
      วันที่เอกสาร: "",
      เลขที่เอกสาร: "",
      ประเภทเอกสาร: "",
      ชื่อลูกค้า: "",
      มูลค่าก่อนภาษี: "",
      "VAT 7%": "",
      ยอดสุทธิ: "",
      ช่องทางรับเงิน: "",
      เลขสลิปอ้างอิง: "",
      สถานะโอนเข้าบัญชีบริษัท: "",
    });
    const csvBody = [
      headers.join(","),
      ...rows.map((row) =>
        headers
          .map((header) => {
            const value = String(row[header as keyof typeof row] ?? "");
            return `"${value.replace(/"/g, '""')}"`;
          })
          .join(","),
      ),
    ].join("\n");

    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "รับเงิน");
    const xlsxBase64 = XLSX.write(book, { type: "base64", bookType: "xlsx" }) as string;

    return { csv: `\uFEFF${csvBody}`, xlsx_base64: xlsxBase64, error: null };
  } catch (error) {
    return {
      csv: null,
      xlsx_base64: null,
      error: error instanceof Error ? error.message : "ส่งออกรายงานไม่สำเร็จ",
    };
  }
}

export async function paymentChannelFields(input: {
  channel: string | null | undefined;
  otherBankName?: string | null;
}): Promise<{
  payment_channel: PaymentChannel;
  bank_account_id: string | null;
  receiving_bank_label: string;
  is_swept_to_company: boolean;
  swept_to_company_at: string | null;
}> {
  const channel: PaymentChannel = isPaymentChannel(input.channel)
    ? input.channel
    : "COMPANY_BANK";
  const label = paymentChannelLabel(channel, input.otherBankName);
  const swept = channel === "COMPANY_BANK";
  const bankAccountId = swept ? await resolveCompanyBankAccountId() : null;
  return {
    payment_channel: channel,
    bank_account_id: bankAccountId,
    receiving_bank_label: label,
    is_swept_to_company: swept,
    swept_to_company_at: swept ? new Date().toISOString() : null,
  };
}
