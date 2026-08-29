/**
 * Types for ภ.ง.ด.50 ทวิ print (shared — not in `"use server"` modules).
 */

import type { WHTReportSource } from "@/types/tax";

export type Wht50TawiPayee = {
  name: string;
  taxId: string | null;
  taxBranchCode: string | null;
  address: string;
  entityType: string | null;
};

export type Wht50TawiPrintPayload = {
  source: WHTReportSource;
  documentId: string;
  documentNo: string;
  certNo: string;
  payDate: string;
  whtBase: number;
  whtAmount: number;
  whtType: string | null;
  payee: Wht50TawiPayee;
};

export type Wht50TawiPayer = {
  name: string;
  taxId: string;
  address: string;
};

export type LoadWht50TawiResult =
  | { success: true; data: Wht50TawiPrintPayload; payer: Wht50TawiPayer }
  | { success: false; error: string };
