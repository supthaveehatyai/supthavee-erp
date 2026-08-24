"use client";

/**
 * Per-row actions for User Management table.
 * Active → Deactivate · Inactive → Reactivate
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Shield, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import {
  deactivateUser,
  reactivateUser,
} from "@/lib/actions/user.actions";
import type { ManagedUser } from "@/types/user";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditUserAbacDialog } from "./edit-user-abac-dialog";

export type UserRowActionsProps = {
  user: ManagedUser;
};

type ConfirmMode = "deactivate" | "reactivate" | null;

export function UserRowActions({ user }: UserRowActionsProps) {
  const router = useRouter();
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null);
  const [abacOpen, setAbacOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    if (isPending || !confirmMode) return;

    startTransition(async () => {
      if (confirmMode === "deactivate") {
        const result = await deactivateUser(user.id);
        if (!result.success) {
          toast.error(result.error ?? "ระงับสิทธิ์ไม่สำเร็จ");
          return;
        }
        toast.success(`ระงับสิทธิ์ ${user.full_name || user.email} แล้ว`);
      } else {
        const result = await reactivateUser(user.id);
        if (!result.success) {
          toast.error(result.error ?? "เปิดใช้งานไม่สำเร็จ");
          return;
        }
        toast.success(
          `เปิดใช้งาน ${user.full_name || user.email} อีกครั้งแล้ว`,
        );
      }
      setConfirmMode(null);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-slate-500"
            aria-label={`จัดการ ${user.full_name}`}
            disabled={isPending}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[11rem] max-w-[16rem]">
          <DropdownMenuItem
            onSelect={() => setAbacOpen(true)}
            disabled={isPending}
            className="break-words whitespace-normal"
          >
            <Shield className="size-4 shrink-0" />
            <span className="break-words">แก้ไขสิทธิ์ข้อมูล (ABAC)</span>
          </DropdownMenuItem>
          {user.is_active ? (
            <DropdownMenuItem
              destructive
              onSelect={() => setConfirmMode("deactivate")}
              disabled={isPending}
              className="break-words whitespace-normal"
            >
              <UserX className="size-4 shrink-0" />
              <span className="break-words">ระงับการใช้งาน (Deactivate)</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() => setConfirmMode("reactivate")}
              disabled={isPending}
              className="break-words whitespace-normal text-emerald-700 hover:bg-emerald-50"
            >
              <UserCheck className="size-4 shrink-0" />
              <span className="break-words">เปิดใช้งานอีกครั้ง (Reactivate)</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirmMode !== null}
        onOpenChange={(next) => {
          if (isPending) return;
          if (!next) setConfirmMode(null);
        }}
        dismissible={!isPending}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmMode === "reactivate"
                ? "ยืนยันการเปิดใช้งานอีกครั้ง?"
                : "ยืนยันการระงับสิทธิ์?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmMode === "reactivate" ? (
                <>
                  จะเปิดใช้งานบัญชี{" "}
                  <span className="font-semibold text-slate-800">
                    {user.full_name}
                  </span>{" "}
                  ({user.email}) อีกครั้ง — ผู้ใช้สามารถล็อกอินด้วย PIN
                  เดิมได้ทันที
                </>
              ) : (
                <>
                  จะระงับบัญชี{" "}
                  <span className="font-semibold text-slate-800">
                    {user.full_name}
                  </span>{" "}
                  ({user.email}) — ผู้ใช้จะไม่สามารถล็อกอินได้อีก
                  (Soft Delete ไม่ลบประวัติจากระบบ)
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirmMode === "reactivate"
                  ? "bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400"
                  : "bg-red-600 hover:bg-red-700 disabled:bg-red-400"
              }
              disabled={isPending}
              onClick={handleConfirm}
            >
              {isPending
                ? confirmMode === "reactivate"
                  ? "กำลังเปิดใช้งาน..."
                  : "กำลังระงับ..."
                : confirmMode === "reactivate"
                  ? "ยืนยันเปิดใช้งาน"
                  : "ยืนยันระงับสิทธิ์"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EditUserAbacDialog
        user={user}
        open={abacOpen}
        onOpenChange={setAbacOpen}
      />
    </>
  );
}
