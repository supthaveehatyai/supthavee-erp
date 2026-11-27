export type IamDirectoryRow = {
  userId: string;
  fullName: string;
  nickname: string;
  username: string;
  email: string;
  workspaceRole: string;
  primaryWorkspace: string;
  brandCode: string | null;
  branchCodes: string[];
  isHrManager: boolean;
  hrWorkspaces: string[];
  hrEntities: string[];
  hrBrands: string[];
  hrCanPreparePayroll: boolean;
  hrCanViewExecPrivatePay: boolean;
  mustChangePin: boolean;
  lastLoginAt: string | null;
  isActive: boolean;
};

export type IamAuditRow = {
  id: string;
  createdAt: string;
  actorName: string;
  actionType: string;
  targetName: string;
  workspaceKey: string;
};

export type HoldingEntityOption = { id: string; name: string };

export type HoldingPeopleHub = {
  choltiratLinked: boolean;
  entities: HoldingEntityOption[];
  people: IamDirectoryRow[];
  audits: IamAuditRow[];
};

export type HrDelegationInput = {
  userId: string;
  isHrManager: boolean;
  hrWorkspaces: string[];
  hrEntities: string[];
  hrBrands: string[];
  hrCanPreparePayroll: boolean;
  hrCanViewExecPrivatePay: boolean;
};

export type FnbEmployeeCard = {
  id: string;
  empCode: string;
  fullNameTh: string;
  nickname: string;
  firstNameEn: string;
  lastNameEn: string;
  username: string | null;
  brandCode: string;
  primaryBranchCode: string;
  allowedBranchCodes: string[];
  hireDate: string;
  employmentType: string;
  compensationTier: string;
  basePayRate: number | null;
  positionAllowance: number | null;
  diligenceAllowance: number | null;
  isSsoEnrolled: boolean;
  bankAccountNo: string | null;
  hasSystemLogin: boolean;
  userId: string | null;
  employmentStatus: string;
  hidePay: boolean;
};

export type FnbBranchChoice = { code: string; name: string; brand: string };

export type FnbPeoplePayload = {
  brands: Array<"LUCKY_CUP" | "CHATORN">;
  branches: FnbBranchChoice[];
  employees: FnbEmployeeCard[];
  canSetTier: boolean;
  canApprovePayroll: boolean;
  actorName: string;
};

export type FnbPayrollDraftLine = {
  employeeId: string;
  name: string;
  employmentType: string;
  baseRate: number;
  isSso: boolean;
  hoursOrDays: number;
  otPay: number;
  salesCommission: number;
  diligenceBonus: number;
  positionAllowance: number;
  otherDeduction: number;
  branchCode: string;
  compensationTier: string;
};

export type FnbPayrollBundle = {
  periodId: string | null;
  status: string;
  lines: FnbPayrollDraftLine[];
};
