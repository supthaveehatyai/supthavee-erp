"use client";

/**
 * Edit ABAC attributes on an existing user_profiles row.
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import { updateUserAbacSettings } from "@/lib/actions/user.actions";
import type { DataAccessScope, ManagedUser } from "@/types/user";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAbacFields } from "./user-abac-fields";

export type EditUserAbacDialogProps = {
  user: ManagedUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditUserAbacDialog({
  user,
  open,
  onOpenChange,
}: EditUserAbacDialogProps) {
  const router = useRouter();
  const [dataAccessScope, setDataAccessScope] = useState<DataAccessScope>(
    user.data_access_scope,
  );
  const [approvalLimit, setApprovalLimit] = useState(
    String(user.approval_limit ?? 0),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  function resetFromUser() {
    setDataAccessScope(user.data_access_scope);
    setApprovalLimit(String(user.approval_limit ?? 0));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

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
      toast.success(`อัปเดตสิทธิ์ข้อมูลของ ${user.full_name} แล้ว`);
      onOpenChange(false);
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isSubmitting) return;
        onOpenChange(next);
        if (!next) resetFromUser();
        if (next) resetFromUser();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="size-4 text-blue-600" />
            แก้ไขสิทธิ์ข้อมูล (ABAC)
          </DialogTitle>
          <DialogDescription>
            {user.full_name} · {user.email} — บันทึกลง{" "}
            <span className="font-mono text-xs">user_profiles</span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <UserAbacFields
            idPrefix={`edit-abac-${user.id}`}
            dataAccessScope={dataAccessScope}
            approvalLimit={approvalLimit}
            disabled={isSubmitting}
            onDataAccessScopeChange={setDataAccessScope}
            onApprovalLimitChange={setApprovalLimit}
          />

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
              {isSubmitting ? "กำลังบันทึก..." : "บันทึกสิทธิ์ข้อมูล"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
