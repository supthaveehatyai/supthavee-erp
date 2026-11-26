import { replyLineMessages } from "@/lib/line/line-oa";
import { isSchemaUnavailable, schemaAdmin } from "@/lib/holding/schema-db";
import type { WorkspaceKey } from "@/types/holding";

type BankQrRow = {
  id: string;
  bank_name: string;
  account_name: string;
  account_no: string;
  promptpay_note: string | null;
  qr_label: string | null;
  qr_image_url: string | null;
  account_channel: string | null;
  is_primary_company: boolean;
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

function normalizeQrQuery(value: string): string {
  return value.toLowerCase().replace(/[\s\-_.]+/g, "");
}

function mapRows(data: unknown): BankQrRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    if (row.is_qr_customer_visible === false) return [];
    const accountNo = String(row.account_no ?? "").trim();
    const bankName = String(row.bank_name ?? "").trim();
    const accountChannel = row.account_channel == null ? null : String(row.account_channel);
    if (!accountNo || !bankName) return [];
    if (/wallet/i.test(accountNo) || accountChannel === "PLATFORM_WALLET") return [];
    const note = row.promptpay_note ?? row.payment_instruction;
    return [{
      id: String(row.id ?? ""),
      bank_name: bankName,
      account_name: String(row.account_name ?? "").trim() || "-",
      account_no: accountNo,
      promptpay_note: note == null ? null : String(note).trim() || null,
      qr_label: row.qr_label == null ? null : String(row.qr_label).trim() || null,
      qr_image_url: row.qr_image_url == null ? null : String(row.qr_image_url),
      account_channel: accountChannel,
      is_primary_company: row.is_primary_company === true || row.is_default_receiving === true,
    }];
  });
}

function bankHeading(name: string): string {
  return name.startsWith("ธนาคาร") ? name : `ธนาคาร${name}`;
}

function accountLines(row: BankQrRow): string {
  return [
    bankHeading(row.bank_name),
    `ชื่อบัญชี: ${row.account_name}`,
    `เลขที่บัญชี: ${row.account_no}`,
    row.promptpay_note ?? "",
  ].filter(Boolean).join("\n");
}

function accountDigits(accountNo: string): string {
  return accountNo.replace(/[\s\-_.]+/g, "");
}

function officialCompanyAccount(rows: BankQrRow[]): BankQrRow[] {
  const official = rows.find((row) => accountDigits(row.account_no) === "9020746510");
  if (official) return [official];
  const withQr = rows.find((row) => safeHttps(row.qr_image_url));
  return withQr ? [withQr] : rows.slice(0, 1);
}

function selectAccounts(rows: BankQrRow[], query: string): { selected: BankQrRow[]; notice: string | null } {
  const visible = rows.filter((row) => !/wallet/i.test(row.account_no) && row.account_channel !== "PLATFORM_WALLET");
  const trimmed = query.trim();
  const normalized = normalizeQrQuery(trimmed);
  if (!trimmed || normalized === "บริษัท") {
    return { selected: officialCompanyAccount(visible), notice: null };
  }
  if (normalized === "ทั้งหมด" || normalized === "all") {
    return { selected: visible.slice(0, 4), notice: null };
  }
  const matched = visible.filter((row) =>
    [row.qr_label, row.bank_name, row.account_name, row.account_no].some((part) =>
      normalizeQrQuery(part ?? "").includes(normalized),
    ),
  );
  if (matched.length === 0) {
    const hints = visible.map((row) => `#qr ${row.qr_label || row.bank_name}`).join(", ");
    return {
      selected: [],
      notice: `ไม่พบบัญชี QR ที่ตรงกับ "${trimmed}"\nคำสั่งที่ใช้ได้: ${hints || "#qr"}`,
    };
  }
  return { selected: matched.slice(0, 4), notice: null };
}

function customerMessages(rows: BankQrRow[], query: string): Record<string, unknown>[] {
  if (rows.length === 0) return [textMessage("ยังไม่มีบัญชี QR ที่เปิดให้ลูกค้าเห็น")];
  const picked = selectAccounts(rows, query);
  if (picked.notice) return [textMessage(picked.notice)];
  if (picked.selected.length === 0) return [textMessage("ยังไม่มีบัญชี QR ที่เปิดให้ลูกค้าเห็น")];
  const images = picked.selected.flatMap((row) => {
    const url = safeHttps(row.qr_image_url);
    return url ? [{ type: "image", originalContentUrl: url, previewImageUrl: url }] : [];
  });
  return [...images, textMessage(picked.selected.map(accountLines).join("\n\n"))].slice(0, 5);
}

async function sendOnce(
  token: string,
  replyToken: string,
  messages: Record<string, unknown>[],
): Promise<BankQrReplyResult> {
  const sent = await replyLineMessages(token, replyToken, messages.slice(0, 5));
  if (!sent.ok) return { status: "FAILED", error: sent.error };
  return { status: "REPLIED_OK", error: null };
}

export async function replySupthaveeBankQr(
  token: string,
  replyToken: string,
  query = "",
): Promise<BankQrReplyResult> {
  const listed = await schemaAdmin()
    .from("mst_bank_accounts")
    .select("id, bank_name, account_name, account_no, account_channel, promptpay_note, qr_label, qr_image_url, is_primary_company, is_qr_customer_visible, sort_order")
    .eq("is_active", true)
    .eq("is_qr_customer_visible", true)
    .order("is_primary_company", { ascending: false })
    .order("sort_order", { ascending: true })
    .limit(50);
  if (listed.error) {
    return sendOnce(token, replyToken, [textMessage("ยังตั้งค่าการแสดง QR ให้ลูกค้าไม่พร้อม")]);
  }
  return sendOnce(token, replyToken, customerMessages(mapRows(listed.data), query));
}

export async function replyHoldingBankQr(params: {
  token: string;
  replyToken: string;
  workspaceKey: WorkspaceKey;
  query?: string;
  bankAccountId?: string | null;
}): Promise<BankQrReplyResult> {
  const listed = await schemaAdmin()
    .schema("holding")
    .from("bank_accounts")
    .select("id, bank_name, account_name, account_no, payment_instruction, qr_label, qr_image_url, is_default_receiving, is_qr_customer_visible, sort_order")
    .eq("is_active", true)
    .eq("is_qr_customer_visible", true)
    .eq("workspace_key", params.workspaceKey)
    .order("is_default_receiving", { ascending: false })
    .order("sort_order", { ascending: true })
    .limit(50);
  if (listed.error) {
    const message = isSchemaUnavailable(listed.error)
      ? "ยังตั้งค่าการแสดง QR ให้ลูกค้าไม่พร้อม"
      : "อ่านสมุดบัญชีไม่สำเร็จ";
    return sendOnce(params.token, params.replyToken, [textMessage(message)]);
  }
  const rows = mapRows(listed.data).map((row) => ({
    ...row,
    is_primary_company: row.is_primary_company || row.id === params.bankAccountId,
  }));
  return sendOnce(params.token, params.replyToken, customerMessages(rows, params.query ?? ""));
}
