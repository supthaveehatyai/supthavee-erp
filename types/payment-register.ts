export type PaymentRegisterDirection = "ALL" | "AP" | "AR";

export type PaymentRegisterQuery = {
  direction: PaymentRegisterDirection;
  fromDate: string;
  toDate: string;
  /** null = ทุกช่องทาง, CASH = เงินสด, อื่น ๆ = mst_bank_accounts.id */
  channelId: string | null;
};

export type PaymentRegisterBank = {
  id: string;
  bankName: string;
  accountNo: string;
};

export type PaymentRegisterLine = {
  invoiceDocNo: string;
  referenceNo: string | null;
  billingNoteNo: string | null;
  billAmount: number;
  whtAmount: number;
  netAmount: number;
};

export type PaymentRegisterEntry = {
  id: string;
  direction: "AP" | "AR";
  paidAt: string;
  docNo: string;
  contactName: string;
  taxId: string | null;
  channelLabel: string;
  accountNo: string | null;
  referenceNo: string | null;
  slipUrl: string | null;
  notes: string | null;
  amount: number;
  lines: PaymentRegisterLine[];
  billLabel: string;
};

export type PaymentRegisterChannelTotal = {
  key: string;
  label: string;
  accountNo: string | null;
  inbound: number;
  outbound: number;
};

export type PaymentRegisterData = {
  rows: PaymentRegisterEntry[];
  banks: PaymentRegisterBank[];
  channels: PaymentRegisterChannelTotal[];
  error: string | null;
};
