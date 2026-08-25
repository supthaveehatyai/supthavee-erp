"use client";

/**
 * User Profile Form — URL-driven slide-over (`?profile_user_id=`).
 * Mutations go through Server Actions only (Zero Client-Side Fetching).
 */

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import { updateUserProfile } from "@/lib/actions/user.actions";
import type { AppRoleOption, DataAccessScope, ManagedUser } from "@/types/user";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { UserAbacFields } from "./user-abac-fields";

export type UserProfileFormSheetProps = {
  user: ManagedUser | null;
  error: string | null;
  closeHref: string;
  roles: AppRoleOption[];
};

export function UserProfileFormSheet({
  user,
  error,
  closeHref,
  roles,
}: UserProfileFormSheetProps) {
  const router = useRouter();
  const open = user !== null || error !== null;
  const [roleCode, setRoleCode] = useState(user?.role_code ?? "");
  const [dataAccessScope, setDataAccessScope] = useState<DataAccessScope>(
    user?.data_access_scope ?? "OWN",
  );
  const [approvalLimit, setApprovalLimit] = useState(
    String(user?.approval_limit ?? 0),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    setRoleCode(user.role_code);
    setDataAccessScope(user.data_access_scope);
    setApprovalLimit(String(user.approval_limit ?? 0));
  }, [user]);

  function closeSheet() {
    if (isSubmitting) return;
    router.push(closeHref);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || isSubmitting) return;

    const parsedLimit = Number(approvalLimit);
    if (!Number.isFinite(parsedLimit) || parsedLimit < 0) {
      toast.error("วงเงินอนุมัติต้องเป็นตัวเลขที่ไม่ติดลบ");
      return;
    }
    if (!roleCode.trim()) {
      toast.error("กรุณาเลือกสิทธิ์ (Role)");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await updateUserProfile(user.id, {
        role_code: roleCode,
        data_access_scope: dataAccessScope,
        approval_limit: parsedLimit,
      });
      if (!result.success) {
        toast.error(result.error ?? "บันทึกโปรไฟล์ไม่สำเร็จ");
        return;
      }
      toast.success(`อัปเดตโปรไฟล์ของ ${user.full_name} แล้ว`);
      router.push(closeHref);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "บันทึกโปรไฟล์ไม่สำเร็จ",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSheet();
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Shield className="size-4 text-blue-600" />
            User Profile Form
          </SheetTitle>
          <SheetDescription>
            แก้ไข Role, Data Access Scope และ Approval Limit — บันทึกผ่าน Server
            Action ลง <span className="font-mono text-xs">user_profiles</span>
          </SheetDescription>
        </SheetHeader>

        {error ? (
          <div className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {user ? (
          <form onSubmit={handleSubmit} className="flex flex-col" noValidate>
            <div className="space-y-4 px-6 py-4">
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-sm font-semibold text-slate-900">
                  {user.full_name}
                </p>
                <p className="break-all text-xs text-slate-500">{user.email}</p>
                <p className="mt-1 text-xs text-slate-600">
                  สถานะ: {user.is_active ? "Active" : "Inactive"}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`profile-role-${user.id}`}>สิทธิ์ (Role)</Label>
                <Select
                  id={`profile-role-${user.id}`}
                  value={roleCode}
                  onChange={(event) => setRoleCode(event.target.value)}
                  disabled={isSubmitting || roles.length === 0}
                  required
                >
                  {roles.length === 0 ? (
                    <option value="">ไม่พบรายการสิทธิ์</option>
                  ) : (
                    roles.map((role) => (
                      <option key={role.role_code} value={role.role_code}>
                        {role.role_name_th} ({role.role_code})
                      </option>
                    ))
                  )}
                </Select>
              </div>

              <UserAbacFields
                idPrefix={`profile-abac-${user.id}`}
                dataAccessScope={dataAccessScope}
                approvalLimit={approvalLimit}
                disabled={isSubmitting}
                onDataAccessScopeChange={setDataAccessScope}
                onApprovalLimitChange={setApprovalLimit}
              />
            </div>

            <SheetFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={closeSheet}
              >
                ยกเลิก
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || roles.length === 0}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? "กำลังบันทึก..." : "บันทึกโปรไฟล์"}
              </Button>
            </SheetFooter>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
