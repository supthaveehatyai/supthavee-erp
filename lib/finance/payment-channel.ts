export const PAYMENT_CHANNELS = ["COMPANY_BANK", "CASH", "OTHER_BANK"] as const;

export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export const COMPANY_BANK_LABEL = "โอนเข้าบัญชีบริษัท (KTB x-6510)";
export const CASH_RECEIPT_LABEL = "เงินสดหน้าร้าน";
export const OTHER_BANK_LABEL = "โอนเข้าบัญชีอื่น (รอโอนเข้าบริษัท)";

export const RECEIPT_REGISTER_DOC_TYPES = [
  "DEP_IN",
  "CS_TAX",
  "ABB",
  "TAX_INV",
  "INV_DO",
] as const;

export function isPaymentChannel(
  value: string | null | undefined,
): value is PaymentChannel {
  return (PAYMENT_CHANNELS as readonly string[]).includes(
    String(value ?? "").trim(),
  );
}

export function paymentChannelLabel(
  channel: string | null | undefined,
  otherBankName?: string | null,
): string {
  if (channel === "COMPANY_BANK") return COMPANY_BANK_LABEL;
  if (channel === "CASH") return CASH_RECEIPT_LABEL;
  if (channel === "OTHER_BANK") {
    const name = String(otherBankName ?? "").trim();
    return name ? `โอนเข้าบัญชีอื่น (${name})` : OTHER_BANK_LABEL;
  }
  return "—";
}

export function otherBankNameFromLabel(
  label: string | null | undefined,
): string {
  const text = String(label ?? "").trim();
  if (!text || text === OTHER_BANK_LABEL || text === COMPANY_BANK_LABEL) return "";
  const wrapped = text.match(/^โอนเข้าบัญชีอื่น \((.+)\)$/);
  if (wrapped && wrapped[1] !== "รอโอนเข้าบริษัท") return wrapped[1];
  if (text.startsWith("โอนเข้าบัญชี")) return "";
  return text;
}

export function receiptMethodText(input: {
  payment_channel?: string | null;
  receiving_bank_label?: string | null;
  is_swept_to_company?: boolean | null;
}): string {
  const channel = String(input.payment_channel ?? "").trim();
  const stored = String(input.receiving_bank_label ?? "").trim();
  if (channel === "COMPANY_BANK") return `🏦 ${stored || COMPANY_BANK_LABEL}`;
  if (channel === "CASH") {
    return input.is_swept_to_company
      ? "💵 เงินสดหน้าร้าน (โอนเข้าบริษัทแล้ว)"
      : "💵 เงินสดหน้าร้าน (รอโอนเข้าบริษัท)";
  }
  if (channel === "OTHER_BANK") {
    if (stored && !stored.startsWith("โอนเข้าบัญชีอื่น")) {
      return `📱 โอนเข้าบัญชีอื่น (${stored})`;
    }
    return `📱 ${stored || OTHER_BANK_LABEL}`;
  }
  return stored;
}

export function initialCashReceiptChannel(input: {
  docType: string;
  salesChannel?: string | null;
  storedChannel?: string | null;
}): PaymentChannel {
  if (isPaymentChannel(input.storedChannel)) return input.storedChannel;
  const channel = String(input.salesChannel ?? "STORE").trim().toUpperCase();
  const storefront =
    channel === "STORE" ||
    channel === "DIRECT" ||
    channel === "RETAIL" ||
    channel === "WHOLESALE" ||
    channel === "";
  if ((input.docType === "ABB" || input.docType === "CS_TAX") && storefront) {
    return "CASH";
  }
  return "COMPANY_BANK";
}

export function isSweptOnReceipt(channel: PaymentChannel): boolean {
  return channel === "COMPANY_BANK";
}

export type ActiveBankAccount = {
  id: string;
  bank_name: string;
  account_no: string;
  account_name: string;
  branch_name: string | null;
  is_company_account: boolean;
  channel_type: "COMPANY_BANK" | "OTHER_BANK";
  display_label: string;
};

export type UnsweptReceiptRow = {
  id: string;
  doc_no: string;
  doc_date: string;
  doc_type: string;
  contact_name: string;
  payment_channel: "CASH" | "OTHER_BANK";
  amount: number;
  receiving_bank_label: string | null;
  bank_account_id: string | null;
};

export type SlipPayeeHint = {
  channel: "COMPANY_BANK" | "OTHER_BANK";
  otherBankName: string;
  notice: string;
};

export function normalizeActiveBankAccount(raw: unknown): ActiveBankAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  if (!id) return null;
  const isCompany = row.is_company_account === true || row.is_company_account === "true";
  const channelRaw = String(row.channel_type ?? "").trim();
  const channelType =
    channelRaw === "COMPANY_BANK" || channelRaw === "OTHER_BANK"
      ? channelRaw
      : isCompany
        ? "COMPANY_BANK"
        : "OTHER_BANK";
  return {
    id,
    bank_name: String(row.bank_name ?? "").trim(),
    account_no: String(row.account_no ?? "").trim(),
    account_name: String(row.account_name ?? "").trim(),
    branch_name: row.branch_name == null ? null : String(row.branch_name),
    is_company_account: isCompany,
    channel_type: channelType,
    display_label: String(row.display_label ?? "").trim(),
  };
}

export function bankAccountDisplay(account: ActiveBankAccount): string {
  const label = account.display_label.trim();
  if (label) return label;
  const head = [account.bank_name, account.account_no].filter(Boolean).join(" ");
  return account.account_name ? `${head} — ${account.account_name}` : head;
}

export function accountsForChannel(
  accounts: ActiveBankAccount[],
  channel: PaymentChannel,
): ActiveBankAccount[] {
  if (channel === "COMPANY_BANK") {
    return accounts.filter((account) => account.is_company_account);
  }
  if (channel === "OTHER_BANK") {
    return accounts.filter((account) => !account.is_company_account);
  }
  return [];
}

export function lastFourDigits(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

export function selectedBankAccount(
  accounts: ActiveBankAccount[],
  channel: PaymentChannel,
  bankAccountId?: string | null,
): ActiveBankAccount | null {
  const pool = accountsForChannel(accounts, channel);
  if (pool.length === 0) return null;
  return pool.find((account) => account.id === bankAccountId) ?? pool[0] ?? null;
}

export function initialBankAccountId(
  accounts: ActiveBankAccount[],
  channel: PaymentChannel,
  storedId?: string | null,
  storedLabel?: string | null,
): string | null {
  const pool = accountsForChannel(accounts, channel);
  if (pool.length === 0) return null;
  if (storedId && pool.some((account) => account.id === storedId)) return storedId;
  const label = String(storedLabel ?? "");
  const matched = pool.find((account) => {
    if (!label) return false;
    if (label === account.display_label) return true;
    const tail = lastFourDigits(account.account_no);
    return Boolean(tail) && label.replace(/\D/g, "").includes(tail);
  });
  return matched?.id ?? pool[0]?.id ?? null;
}

export function matchBankAccountBySlip(
  accounts: ActiveBankAccount[],
  payeeAccount: string | null | undefined,
): ActiveBankAccount | null {
  const tail = lastFourDigits(payeeAccount);
  if (!tail) return null;
  return (
    accounts.find((account) => lastFourDigits(account.account_no) === tail) ?? null
  );
}

export function resolveSlipBankAccount(
  accounts: ActiveBankAccount[],
  payeeName: string | null | undefined,
  payeeAccount: string | null | undefined,
): { channel: PaymentChannel; bankAccountId: string | null; notice: string } | null {
  const matched = matchBankAccountBySlip(accounts, payeeAccount);
  if (matched) {
    const channel: PaymentChannel =
      matched.is_company_account || matched.channel_type === "COMPANY_BANK"
        ? "COMPANY_BANK"
        : "OTHER_BANK";
    return {
      channel,
      bankAccountId: matched.id,
      notice: `ตรวจพบสลิปเข้า ${bankAccountDisplay(matched)} — เลือกบัญชีนี้ให้อัตโนมัติ`,
    };
  }
  const hint = classifySlipPayee(payeeName, payeeAccount);
  if (!hint) return null;
  const pool = accountsForChannel(accounts, hint.channel);
  return {
    channel: hint.channel,
    bankAccountId: pool[0]?.id ?? null,
    notice: hint.notice,
  };
}

export function otherAccountSweepLines(
  accounts: ActiveBankAccount[],
  rows: Array<{
    payment_channel: string;
    amount: number;
    bank_account_id?: string | null;
    receiving_bank_label?: string | null;
  }>,
): Array<{ id: string; label: string; amount: number }> {
  const others = accounts.filter((account) => !account.is_company_account);
  const totals = new Map(others.map((account) => [account.id, 0]));
  for (const row of rows) {
    if (row.payment_channel !== "OTHER_BANK") continue;
    const storedId = String(row.bank_account_id ?? "");
    const matchedId = totals.has(storedId)
      ? storedId
      : others.find((account) => {
          const tail = lastFourDigits(account.account_no);
          const digits = String(row.receiving_bank_label ?? "").replace(/\D/g, "");
          return Boolean(tail) && digits.includes(tail);
        })?.id;
    if (!matchedId) continue;
    totals.set(
      matchedId,
      Math.round(((totals.get(matchedId) ?? 0) + row.amount) * 100) / 100,
    );
  }
  return others.map((account) => ({
    id: account.id,
    label: `${account.bank_name} ${account.account_no}`.trim(),
    amount: totals.get(account.id) ?? 0,
  }));
}

/** ถ้าสลิประบุบัญชีบริษัท ให้เลือกบริษัท ถ้าเป็นชื่อบัญชีอื่นให้สลับเป็นบัญชีอื่น */
export function classifySlipPayee(
  payeeName: string | null | undefined,
  payeeAccount: string | null | undefined,
): SlipPayeeHint | null {
  const name = String(payeeName ?? "").trim();
  const account = String(payeeAccount ?? "").replace(/\s+/g, "");
  const digits = account.replace(/\D/g, "");
  const isCompany =
    name.includes("ทรัพย์ทวี") ||
    account.includes("6510") ||
    digits.includes("6510");
  if (isCompany) {
    return {
      channel: "COMPANY_BANK",
      otherBankName: "",
      notice: "ตรวจพบสลิปเข้าบัญชีบริษัท (KTB x-6510) — เลือกช่องทางนี้ให้อัตโนมัติ",
    };
  }
  if (name) {
    return {
      channel: "OTHER_BANK",
      otherBankName: name.slice(0, 80),
      notice: `ตรวจพบสลิปเข้าบัญชีอื่น (${name}) — สลับเป็นรอโอนเข้าบริษัท`,
    };
  }
  return null;
}
