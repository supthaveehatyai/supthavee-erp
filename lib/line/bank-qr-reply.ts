import { replyLineMessages } from "@/lib/line/line-oa";
import { isSchemaUnavailable, schemaAdmin } from "@/lib/holding/schema-db";
import type { WorkspaceKey } from "@/types/holding";

type BankQrRow = {
  bank_name: string;
  account_name: string;
  account_no: string;
  promptpay_note: string | null;
  qr_image_url: string | null;
};

export type BankQrReplyResult = {
  status: "REPLIED_OK" | "REPLIED_FALLBACK" | "SKIPPED" | "FAILED";
  error: string | null;
};

function textMessage(text: string): Record<string, unknown> {
  return { type: "text", text: text.slice(0, 4900) };
}

function safeHttps(raw: string | null): string | null {
  const value = String(raw ?? "").trim();
  if (!value.toLowerCase().startsWith("https://") || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function mapRows(data: unknown): BankQrRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const accountNo = String(row.account_no ?? "").trim();
    const bankName = String(row.bank_name ?? "").trim();
    if (!accountNo || !bankName) return [];
    return [{
      bank_name: bankName,
      account_name: String(row.account_name ?? "").trim() || "-",
      account_no: accountNo,
      promptpay_note: row.promptpay_note == null ? null : String(row.promptpay_note).trim() || null,
      qr_image_url: row.qr_image_url == null ? null : String(row.qr_image_url),
    }];
  });
}

function accountLines(row: BankQrRow): string {
  return [
    row.bank_name,
    `ชื่อบัญชี: ${row.account_name}`,
    `เลขที่: ${row.account_no}`,
    row.promptpay_note ? `หมายเหตุ: ${row.promptpay_note}` : "",
  ].filter(Boolean).join("\n");
}

function flexMessage(rows: BankQrRow[]): Record<string, unknown> {
  return {
    type: "flex",
    altText: "เลขบัญชีรับโอน",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: rows.map((row) => ({
          type: "box",
          layout: "vertical",
          spacing: "xs",
          contents: [
            { type: "text", text: row.bank_name, weight: "bold", wrap: true },
            { type: "text", text: row.account_name, size: "sm", wrap: true },
            { type: "text", text: row.account_no, size: "sm", wrap: true },
            ...(row.promptpay_note
              ? [{ type: "text", text: row.promptpay_note, size: "xs", color: "#64748B", wrap: true }]
              : []),
          ],
        })),
      },
    },
  };
}

export function buildBankQrMessages(rows: BankQrRow[]): Record<string, unknown>[] {
  const visible = rows.slice(0, 5);
  if (visible.length === 0) return [textMessage("ยังไม่มีบัญชีรับโอนที่เปิดใช้งาน")];
  const images = visible
    .map((row) => safeHttps(row.qr_image_url))
    .filter((url): url is string => Boolean(url))
    .slice(0, 2)
    .map((url) => ({ type: "image", originalContentUrl: url, previewImageUrl: url }));
  return [flexMessage(visible), ...images, textMessage(visible.map(accountLines).join("\n\n"))].slice(0, 5);
}

async function sendBankReply(
  token: string,
  replyToken: string,
  rows: BankQrRow[],
): Promise<BankQrReplyResult> {
  const sent = await replyLineMessages(token, replyToken, buildBankQrMessages(rows));
  if (sent.ok) return { status: "REPLIED_OK", error: null };
  const summary = rows.length
    ? rows.slice(0, 5).map(accountLines).join("\n\n")
    : "ยังไม่มีบัญชีรับโอนที่เปิดใช้งาน";
  const images = rows
    .map((row) => safeHttps(row.qr_image_url))
    .filter((url): url is string => Boolean(url))
    .slice(0, 2)
    .map((url) => ({ type: "image", originalContentUrl: url, previewImageUrl: url }));
  const retry = await replyLineMessages(token, replyToken, [...images, textMessage(summary)].slice(0, 5));
  if (!retry.ok) return { status: "FAILED", error: sent.error };
  return { status: "REPLIED_FALLBACK", error: sent.error };
}

export async function replySupthaveeBankQr(
  token: string,
  replyToken: string,
): Promise<BankQrReplyResult> {
  const admin = schemaAdmin();
  const listed = await admin
    .from("mst_bank_accounts")
    .select("bank_name, account_name, account_no, promptpay_note, qr_image_url, is_primary_company, sort_order")
    .eq("is_active", true)
    .order("is_primary_company", { ascending: false })
    .order("sort_order", { ascending: true })
    .limit(5);
  if (listed.error && /promptpay_note|qr_image_url|PGRST204/i.test(listed.error.message ?? "")) {
    const plain = await admin
      .from("mst_bank_accounts")
      .select("bank_name, account_name, account_no, is_primary_company, sort_order")
      .eq("is_active", true)
      .order("is_primary_company", { ascending: false })
      .order("sort_order", { ascending: true })
      .limit(5);
    return sendBankReply(token, replyToken, mapRows(plain.data));
  }
  return sendBankReply(token, replyToken, mapRows(listed.data));
}

export async function replyHoldingBankQr(params: {
  token: string;
  replyToken: string;
  workspaceKey: WorkspaceKey;
  bankAccountId?: string | null;
}): Promise<BankQrReplyResult> {
  const admin = schemaAdmin();
  const listed = params.bankAccountId
    ? await admin
        .schema("holding")
        .from("bank_accounts")
        .select("bank_name, account_name, account_no, promptpay_note, qr_image_url")
        .eq("id", params.bankAccountId)
        .eq("is_active", true)
        .limit(1)
    : await admin
        .schema("holding")
        .from("bank_accounts")
        .select("bank_name, account_name, account_no, promptpay_note, qr_image_url, is_default_receiving, sort_order")
        .eq("is_active", true)
        .eq("workspace_key", params.workspaceKey)
        .order("is_default_receiving", { ascending: false })
        .order("sort_order", { ascending: true })
        .limit(5);
  if (listed.error && isSchemaUnavailable(listed.error)) {
    return sendBankReply(params.token, params.replyToken, []);
  }
  if (listed.error) return { status: "FAILED", error: listed.error.message ?? "อ่านสมุดบัญชีไม่สำเร็จ" };
  return sendBankReply(params.token, params.replyToken, mapRows(listed.data));
}
