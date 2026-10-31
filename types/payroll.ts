export type PayrollChannel = "CORPORATE_OFFICIAL" | "INTERNAL_PRIVATE";

export type PayrollEmployee = {
  id: string;
  empCode: string;
  fullName: string;
  citizenId: string;
  positionTitle: string;
  payrollChannel: PayrollChannel;
  baseSalary: number;
  isSsoEnrolled: boolean;
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
  address: string;
  idCardAttachmentUrl: string;
  bankBookAttachmentUrl: string;
  isActive: boolean;
};

export type PayrollItem = {
  id: string;
  payrollPeriodId: string;
  employeeId: string;
  payrollChannel: PayrollChannel;
  baseSalary: number;
  otAmount: number;
  allowanceAmount: number;
  commissionAmount: number;
  bonusAmount: number;
  grossIncome: number;
  ssoEmployeeAmount: number;
  ssoEmployerAmount: number;
  whtTaxAmount: number;
  otherDeduction: number;
  netPay: number;
  paymentStatus: string;
  paymentDate: string | null;
  paidFromAccount: string;
  paymentSlipUrl: string | null;
  paymentReferenceNo: string | null;
  linkedExpenseId: string | null;
  employee: PayrollEmployee;
};

export type PayrollPeriodView = {
  id: string;
  periodYear: number;
  periodMonth: number;
  periodLabel: string;
  ssoRatePct: number;
  ssoWageCeiling: number;
  officialGrossTotal: number;
  officialNetTotal: number;
  internalGrossTotal: number;
  internalNetTotal: number;
  ssoEmployeeTotal: number;
  ssoEmployerTotal: number;
  ssoTotalRemittance: number;
  ssoPaymentStatus: string;
  ssoPaymentDate: string | null;
  ssoPaymentSlipUrl: string | null;
  ssoReferenceNo: string | null;
  status: string;
  paidCount: number;
  headcount: number;
  items: PayrollItem[];
  employees: PayrollEmployee[];
};

export type PayrollItemCalculationPayload = {
  itemId: string;
  baseSalary: number;
  otAmount: number;
  allowanceAmount: number;
  commissionAmount: number;
  bonusAmount: number;
  ssoEmployeeAmount: number;
  whtTaxAmount: number;
  otherDeduction: number;
};

export type SalaryPaymentPayload = {
  itemId: string;
  paymentDate: string;
  paidFromAccount: string;
  paymentReferenceNo: string;
  slipJpegBase64: string;
};

export type SsoRemittancePayload = {
  periodId: string;
  paymentDate: string;
  referenceNo: string;
  slipJpegBase64: string;
};

export type EmployeeMasterPayload = {
  id: string | null;
  empCode: string;
  fullName: string;
  citizenId: string;
  positionTitle: string;
  payrollChannel: PayrollChannel;
  baseSalary: number;
  isSsoEnrolled: boolean;
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
  address: string;
  idCardAttachmentUrl: string;
  bankBookAttachmentUrl: string;
};

export type PayrollActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type PayrollWorkbookSheetRow = {
  empCode: string;
  fullName: string;
  citizenId: string;
  baseSalary: number;
  otAmount: number;
  allowanceAmount: number;
  extraIncome: number;
  grossIncome: number;
  ssoEmployeeAmount: number;
  ssoEmployerAmount: number;
  whtTaxAmount: number;
  netPay: number;
  slipUrl: string;
  idCardUrl: string;
  isSsoEnrolled: boolean;
  monthCount: number;
};
