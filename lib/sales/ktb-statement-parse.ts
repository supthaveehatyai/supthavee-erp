import * as XLSX from "xlsx";
import { normalizeIsoDate } from "@/lib/sales/sales-ocr-parse";
import type { ParsedKtbLine } from "@/types/bank-reconcile";

/** Krungthai statement files are often locked with the company tax id. */
export const KTB_STATEMENT_PASSWORD = "0905564000520";

const HEADER_ALIASES: Record<string, string[]> = {
  date: ["วันที่/ เวลา", "วันที่/เวลา", "วันที่ทำรายการ", "วันที่รายการ", "วันที่", "transaction date", "value date", "date"],
  time: ["เวลาทำรายการ", "เวลา", "time"],
  code: ["รหัสรายการ", "รหัสทำรายการ", "รหัส", "txn code", "code"],
  description: [
    "รายละเอียดรายการ",
    "รายละเอียด",
    "คำอธิบาย",
    "รายการ",
    "description",
    "narrative",
  ],
  withdrawal: ["จำนวนเงินถอน", "ยอดเงินถอน", "ยอดถอน", "ถอนเงิน", "ถอน", "withdrawal", "debit"],
  deposit: ["จำนวนเงินฝาก", "ยอดเงินฝาก", "ยอดฝาก", "ฝากเงิน", "ฝาก", "deposit", "credit"],
  balance: ["ยอดเงินคงเหลือ", "ยอดคงเหลือ", "คงเหลือ", "balance"],
  signed: ["ถอนเงิน/ฝากเงิน", "ฝากเงิน/ถอนเงิน"],
  cheque: ["หมายเลขเช็ค", "เลขที่เช็ค"],
};

const SUMMARY_ROW =
  /ยอดคงเหลือยกมา|ยอดยกมา|ยอดยกไป|รายการถอนเงิน|รายการฝากเงิน|opening balance|closing balance/i;

function headerKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("th")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function pickColumn(headers: string[], aliases: string[]): number {
  const normalized = headers.map(headerKey);
  for (const alias of aliases) {
    const key = headerKey(alias);
    const index = normalized.findIndex(
      (header) => header === key || (key.length >= 3 && header.includes(key)),
    );
    if (index >= 0) return index;
  }
  return -1;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseAmount(value: string): number | null {
  const raw = value.replace(/บาท/g, "").replace(/\s/g, "").trim();
  if (!raw || raw === "-" || raw === "—") return null;
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith("-");
  const parsed = Number(raw.replace(/[(),]/g, "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return roundMoney(negative ? -Math.abs(parsed) : parsed);
}

function padTime(value: string): string {
  const match = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!match) return "00:00:00";
  const hour = match[1].padStart(2, "0");
  const second = (match[3] ?? "00").padStart(2, "0");
  return `${hour}:${match[2]}:${second}`;
}

function splitDateAndTime(value: string): { date: string; time: string } {
  const raw = value.trim();
  const timed = /^(.+?)\s+(\d{1,2}:\d{2}(?::\d{2})?)$/.exec(raw);
  if (timed) return { date: timed[1], time: padTime(timed[2]) };
  return { date: raw, time: "" };
}

function excelSerialToText(serial: number): string {
  const whole = Math.floor(serial);
  const fraction = serial - whole;
  const utc = new Date(Date.UTC(1899, 11, 30) + whole * 86400000);
  const iso = `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
  if (fraction < 1 / 86400) return iso;
  const seconds = Math.round(fraction * 86400);
  const hour = Math.floor(seconds / 3600);
  const minute = Math.floor((seconds % 3600) / 60);
  const second = seconds % 60;
  return `${iso} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    const hour = value.getHours();
    const minute = value.getMinutes();
    const second = value.getSeconds();
    const date = `${year}-${month}-${day}`;
    if (!hour && !minute && !second) return date;
    return `${date} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  }
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

function dateCell(value: string): string {
  if (!value || value.includes("/") || value.includes("-") || value.includes(":")) return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 20000 && numeric < 80000) {
    return excelSerialToText(numeric);
  }
  return value;
}

function timeCell(value: string): string {
  if (!value || value.includes(":")) return value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric >= 1) return value;
  const seconds = Math.round(numeric * 86400);
  const hour = Math.floor(seconds / 3600);
  const minute = Math.floor((seconds % 3600) / 60);
  const second = seconds % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function decodeEntities(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseHtmlTable(html: string): string[][] {
  const rows: string[][] = [];
  for (const rowHtml of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) =>
      decodeEntities(match[1] ?? ""),
    );
    if (cells.some((cell) => cell)) rows.push(cells);
  }
  return rows;
}

function parseSpreadsheetMl(xml: string): string[][] {
  const rows: string[][] = [];
  for (const rowXml of xml.split(/<Row[\s>]/i).slice(1)) {
    const cells = [...rowXml.matchAll(/<Data[^>]*>([\s\S]*?)<\/Data>/gi)].map((match) =>
      decodeEntities(match[1] ?? ""),
    );
    if (cells.some((cell) => cell)) rows.push(cells);
  }
  return rows;
}

function readWorkbookRows(buffer: Buffer): string[][] {
  const head = buffer.subarray(0, 240).toString("utf8").replace(/^\uFEFF/, "");
  if (/<table[\s>]/i.test(head) || /<html[\s>]/i.test(head)) {
    return parseHtmlTable(buffer.toString("utf8"));
  }
  if (/<Workbook[\s>]/i.test(head) || /urn:schemas-microsoft-com:office:spreadsheet/i.test(head)) {
    return parseSpreadsheetMl(buffer.toString("utf8"));
  }

  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const isOle = buffer[0] === 0xd0 && buffer[1] === 0xcf;
  const readOptions = { cellDates: false, codepage: 65001 } as const;
  let workbook: XLSX.WorkBook;
  try {
    workbook = isZip || isOle
      ? XLSX.read(buffer, { type: "buffer", ...readOptions })
      : XLSX.read(buffer.toString("utf8").replace(/^\uFEFF/, ""), {
          type: "string",
          ...readOptions,
        });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/password|encrypt/i.test(message)) {
      try {
        workbook = XLSX.read(buffer, {
          type: "buffer",
          ...readOptions,
          password: KTB_STATEMENT_PASSWORD,
        });
      } catch {
        throw new Error(
          `ไฟล์ Statement ถูกล็อกรหัส เปิดด้วยเลขผู้เสียภาษี ${KTB_STATEMENT_PASSWORD} แล้วบันทึกเป็น .xlsx อีกครั้ง`,
        );
      }
    } else {
      throw new Error(message || "อ่านไฟล์ Statement ไม่สำเร็จ");
    }
  }

  const sheetName =
    workbook.SheetNames.find((name) => /statement|เดินบัญชี|krungthai|ktb/i.test(name)) ??
    workbook.SheetNames[0];
  if (!sheetName) throw new Error("ไม่พบแผ่นงานในไฟล์ Statement");
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  return matrix.map((row) => (Array.isArray(row) ? row.map((cell) => cellText(cell)) : []));
}

function findAccountNo(rows: string[][]): string | null {
  const blob = rows
    .slice(0, 15)
    .flat()
    .join(" ");
  const formatted = /(\d{3}-\d-\d{5}-\d)/.exec(blob);
  if (formatted) return formatted[1];
  if (blob.includes("9020746510") || blob.includes("902-0-74651-0")) return "902-0-74651-0";
  return null;
}

export function statementRowHash(line: {
  tx_date: string;
  tx_time: string;
  deposit_amount: number;
  withdrawal_amount: number;
  balance_amount: number | null;
  description: string;
}): string {
  const money = (value: number | null) =>
    value == null || !Number.isFinite(value) ? "" : value.toFixed(2);
  return [
    line.tx_date,
    line.tx_time,
    money(line.deposit_amount),
    money(line.withdrawal_amount),
    money(line.balance_amount),
    line.description.replace(/\s+/g, " ").trim(),
  ].join("|");
}

function payerHintFromText(description: string, explicit: string): string {
  const given = explicit.trim();
  if (given) return given.slice(0, 120);
  const account = description.match(/\b\d{3}-?\d{1,2}-?\d{5,12}-?\d?\b/);
  if (account) return account[0].slice(0, 120);
  const from = /(?:จาก|โอนจาก|รับโอนจาก|โดย)\s+(.{2,60})/.exec(description);
  if (from) return from[1].replace(/\s+/g, " ").trim().slice(0, 120);
  return "";
}

function finalizeLine(input: {
  tx_date: string;
  tx_time?: string;
  tx_code?: string;
  description?: string;
  payer_hint?: string;
  withdrawal_amount?: number | null;
  deposit_amount?: number | null;
  balance_amount?: number | null;
}): ParsedKtbLine | null {
  const split = splitDateAndTime(input.tx_date);
  const txDate = normalizeIsoDate(split.date);
  if (!txDate) return null;
  const txTime = padTime(input.tx_time || split.time);
  const description = (input.description ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
  let withdrawal = roundMoney(input.withdrawal_amount ?? 0);
  let deposit = roundMoney(input.deposit_amount ?? 0);
  if (deposit < 0 && withdrawal <= 0) {
    withdrawal = roundMoney(Math.abs(deposit));
    deposit = 0;
  }
  if (withdrawal < 0) withdrawal = roundMoney(Math.abs(withdrawal));
  deposit = roundMoney(Math.max(0, deposit));
  const balance =
    input.balance_amount == null || !Number.isFinite(input.balance_amount)
      ? null
      : roundMoney(input.balance_amount);
  if (withdrawal <= 0 && deposit <= 0) return null;
  const line = {
    tx_date: txDate,
    tx_time: txTime,
    tx_code: (input.tx_code ?? "").trim().slice(0, 40),
    description,
    payer_hint: payerHintFromText(description, input.payer_hint ?? ""),
    withdrawal_amount: withdrawal,
    deposit_amount: deposit,
    balance_amount: balance,
    tx_direction: (withdrawal > 0 && deposit <= 0 ? "OUT" : "IN") as "IN" | "OUT",
  };
  return { ...line, row_hash: statementRowHash(line) };
}

function rowsToLines(rows: string[][]): ParsedKtbLine[] {
  const headerIndex = rows.findIndex((row) => {
    const blob = row.map(headerKey).join(" | ");
    const hasDate = HEADER_ALIASES.date.some((alias) => blob.includes(headerKey(alias)));
    const hasMoney = [...HEADER_ALIASES.deposit, ...HEADER_ALIASES.withdrawal, ...HEADER_ALIASES.balance].some(
      (alias) => blob.includes(headerKey(alias)),
    );
    return hasDate && hasMoney;
  });
  if (headerIndex < 0) {
    throw new Error("ไม่พบหัวตารางของ Statement กรุงไทย (วันที่ / ฝาก / ถอน / คงเหลือ)");
  }

  const headers = rows[headerIndex];
  const dateCol = pickColumn(headers, HEADER_ALIASES.date);
  const timeCol = pickColumn(headers, HEADER_ALIASES.time);
  const codeCol = pickColumn(headers, [...HEADER_ALIASES.cheque, ...HEADER_ALIASES.code]);
  const descriptionCol = pickColumn(headers, HEADER_ALIASES.description);
  const listCol = headers.findIndex((header) => headerKey(header) === "รายการ");
  const signedCol = pickColumn(headers, HEADER_ALIASES.signed);
  const withdrawalCol =
    signedCol >= 0 ? -1 : pickColumn(headers, HEADER_ALIASES.withdrawal);
  const depositCol = signedCol >= 0 ? -1 : pickColumn(headers, HEADER_ALIASES.deposit);
  const balanceCol = pickColumn(headers, HEADER_ALIASES.balance);
  const lines: ParsedKtbLine[] = [];
  const seen = new Set<string>();

  for (const row of rows.slice(headerIndex + 1)) {
    const rowText = row.join(" ");
    if (SUMMARY_ROW.test(rowText)) continue;
    const description = descriptionCol >= 0 ? row[descriptionCol] ?? "" : "";
    const itemText =
      listCol >= 0 && listCol !== descriptionCol ? row[listCol] ?? "" : "";
    const narrative = [itemText, description].filter(Boolean).join(" ").trim();
    const signed = signedCol >= 0 ? parseAmount(row[signedCol] ?? "") : null;
    const depositAmount =
      signed != null ? (signed > 0 ? signed : 0) : depositCol >= 0 ? parseAmount(row[depositCol] ?? "") : null;
    const withdrawalAmount =
      signed != null
        ? signed < 0
          ? Math.abs(signed)
          : 0
        : withdrawalCol >= 0
          ? parseAmount(row[withdrawalCol] ?? "")
          : null;
    const line = finalizeLine({
      tx_date: dateCol >= 0 ? dateCell(row[dateCol] ?? "") : "",
      tx_time: timeCol >= 0 && timeCol !== dateCol ? timeCell(row[timeCol] ?? "") : "",
      tx_code: codeCol >= 0 ? row[codeCol] ?? "" : "",
      description: narrative,
      withdrawal_amount: withdrawalAmount,
      deposit_amount: depositAmount,
      balance_amount: balanceCol >= 0 ? parseAmount(row[balanceCol] ?? "") : null,
    });
    if (!line || seen.has(line.row_hash)) continue;
    seen.add(line.row_hash);
    lines.push(line);
  }
  return lines;
}

export function parseKtbSpreadsheet(buffer: Buffer): {
  account_no: string | null;
  lines: ParsedKtbLine[];
} {
  const rows = readWorkbookRows(buffer);
  if (rows.length === 0) throw new Error("ไฟล์ Statement ว่าง");
  const lines = rowsToLines(rows);
  if (lines.length === 0) throw new Error("ไม่พบรายการเดินบัญชีในไฟล์");
  return { account_no: findAccountNo(rows), lines };
}

export function ktbStatementOcrPrompt(): string {
  return `
You read a Krungthai Bank (ธนาคารกรุงไทย / KTB) account statement from a photo or PDF.
Return ONLY JSON, no markdown.
Convert every Buddhist year (พ.ศ.) to Gregorian YYYY-MM-DD by subtracting 543.
A 2-digit year such as 69 means พ.ศ. 2569, then 2569-543=2026.
tx_time is HH:mm:ss or "".
The signed amount column ถอนเงิน/ฝากเงิน: a negative number is money out. Put it in withdrawal_amount as a positive number and set deposit_amount to 0. A positive number is money in: deposit_amount = that number and withdrawal_amount = 0. Never leave a real payment as zero.
balance_amount is the running balance, or null when absent.
payer_hint is the counterparty name or their bank account number when visible, else "".
tx_code is the bank transaction code, else "".
{"account_no":"","lines":[{"tx_date":"","tx_time":"","tx_code":"","description":"","payer_hint":"","withdrawal_amount":0,"deposit_amount":0,"balance_amount":0}]}
`.trim();
}

export function linesFromOcrJson(root: Record<string, unknown>): {
  account_no: string | null;
  lines: ParsedKtbLine[];
} {
  const rows = Array.isArray(root.lines) ? root.lines : [];
  const lines: ParsedKtbLine[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const item = (row ?? {}) as Record<string, unknown>;
    const balanceRaw = item.balance_amount;
    const line = finalizeLine({
      tx_date: String(item.tx_date ?? ""),
      tx_time: String(item.tx_time ?? ""),
      tx_code: String(item.tx_code ?? ""),
      description: String(item.description ?? ""),
      payer_hint: String(item.payer_hint ?? ""),
      withdrawal_amount: Number(item.withdrawal_amount) || 0,
      deposit_amount: Number(item.deposit_amount) || 0,
      balance_amount:
        balanceRaw == null || balanceRaw === "" ? null : Number(balanceRaw),
    });
    if (!line || seen.has(line.row_hash)) continue;
    seen.add(line.row_hash);
    lines.push(line);
  }
  const account = String(root.account_no ?? "").trim();
  return { account_no: account || null, lines };
}
