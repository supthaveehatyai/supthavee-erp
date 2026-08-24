"use client";

/**
 * Shared ABAC fields for User Profile Form.
 * Mutations go through Server Actions only (Zero Client-Side Fetching).
 */

import type { DataAccessScope } from "@/types/user";
import {
  DATA_ACCESS_SCOPE_LABELS,
  DATA_ACCESS_SCOPES,
} from "@/types/user";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export type UserAbacFieldsProps = {
  dataAccessScope: DataAccessScope;
  approvalLimit: string;
  disabled?: boolean;
  idPrefix?: string;
  onDataAccessScopeChange: (value: DataAccessScope) => void;
  onApprovalLimitChange: (value: string) => void;
};

export function UserAbacFields({
  dataAccessScope,
  approvalLimit,
  disabled = false,
  idPrefix = "user-abac",
  onDataAccessScopeChange,
  onApprovalLimitChange,
}: UserAbacFieldsProps) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-scope`}>Data Access Scope</Label>
        <Select
          id={`${idPrefix}-scope`}
          value={dataAccessScope}
          disabled={disabled}
          required
          onChange={(event) =>
            onDataAccessScopeChange(event.target.value as DataAccessScope)
          }
        >
          {DATA_ACCESS_SCOPES.map((scope) => (
            <option key={scope} value={scope}>
              {DATA_ACCESS_SCOPE_LABELS[scope]}
            </option>
          ))}
        </Select>
        <p className="text-xs text-slate-500">
          ALL = เห็นข้อมูลทั้งหมด · OWN = เห็นเฉพาะเอกสารที่ตนเองสร้าง
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-limit`}>Approval Limit (บาท)</Label>
        <Input
          id={`${idPrefix}-limit`}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={approvalLimit}
          disabled={disabled}
          required
          onChange={(event) => onApprovalLimitChange(event.target.value)}
        />
        <p className="text-xs text-slate-500">
          วงเงินอนุมัติสูงสุด — 0 = ไม่มีวงเงินอนุมัติ
        </p>
      </div>
    </>
  );
}
