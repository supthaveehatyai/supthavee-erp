"use client";

/**
 * User Profile Form — URL-driven slide-over (`?profile_user_id=`).
 * ABAC fields persist via Server Action only (Zero Client-Side Fetching).
 */

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import { updateUserAbacSettings } from "@/lib/actions/user.actions";
import type { DataAccessScope, ManagedUser } from "@/types/user";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
};

export function UserProfileFormSheet({
  user,
  error,
  closeHref,
}: UserProfileFormSheetProps) {
  const router = useRouter();
  const open = user !== null || error !== null;
  const [dataAccessScope, setDataAccessScope] = useState<DataAccessScope>(
    user?.data_access_scope ?? "OWN",
  );
  const [approvalLimit, setApprovalLimit] = useState(
    String(user?.approval_limit ?? 0),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
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

    setIsSubmitting(true);
    try {
      const result = await updateUserAbacSettings(user.id, {
        data_access_scope: dataAccessScope,
        approval_limit: parsedLimit,
      });
      if (!result.success) {
        toast.error(result.error ?? "บันทึกสิทธิ์ข้อมูลไม่สำเร็จ");
        return;
      }
      toast.success(`อัปเดตโปรไฟล์ของ ${user.full_name} แล้ว`);
      router.push(closeHref);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "บันทึกสิทธิ์ข้อมูลไม่สำเร็จ",
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
            กำหนด Data Access Scope และ Approval Limit — บันทึกลง{" "}
            <span className="font-mono text-xs">user_profiles</span>
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
                  {user.role_name_th}{" "}
                  <span className="font-mono text-[11px] text-slate-400">
                    ({user.role_code})
                  </span>
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>สถานะ</Label>
                <p className="text-sm text-slate-800">
                  {user.is_active ? "Active" : "Inactive"}
                </p>
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
                disabled={isSubmitting}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? "กำลังบันทึก..." : "บันทึกสิทธิ์ข้อมูล"}
              </Button>
            </SheetFooter>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
