export type PayrollInput = {
  employmentType: string;
  baseRate: number;
  isSso: boolean;
  hoursOrDays: number;
  otPay: number;
  salesCommission: number;
  diligenceBonus: number;
  positionAllowance: number;
  otherDeduction: number;
};

export type PayrollAmounts = {
  calculatedBase: number;
  gross: number;
  ssoEmployee: number;
  ssoEmployer: number;
  net: number;
};

function money(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function payrollAmounts(input: PayrollInput): PayrollAmounts {
  const rate = Math.max(0, input.baseRate);
  const units = Math.max(0, input.hoursOrDays);
  const calculatedBase = input.employmentType === "FULL_TIME_MONTHLY" ? rate : money(rate * units);
  const gross = money(
    calculatedBase +
      Math.max(0, input.otPay) +
      Math.max(0, input.salesCommission) +
      Math.max(0, input.diligenceBonus) +
      Math.max(0, input.positionAllowance),
  );
  const sso = input.isSso ? money(Math.min(750, Math.min(gross, 15000) * 0.05)) : 0;
  const net = money(gross - sso - Math.max(0, input.otherDeduction));
  return { calculatedBase, gross, ssoEmployee: sso, ssoEmployer: sso, net };
}
