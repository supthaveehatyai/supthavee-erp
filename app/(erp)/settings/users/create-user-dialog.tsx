"use client";

/**
 * Create User dialog — Admin sets email + PIN (password) directly.
 * Submit via Server Action + useTransition (Zero Client-Side Fetching).
 */

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { createUserWithPin } from "@/lib/actions/user.actions";
import type { AppRoleOption } from "@/types/user";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export type CreateUserDialogProps = {
  roles: AppRoleOption[];
};

/** @deprecated ชื่อเดิม — ใช้ CreateUserDialog */
export type InviteUserDialogProps = CreateUserDialogProps;

export function CreateUserDialog({ roles }: CreateUserDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [pin, setPin] = useState("");
  const [roleCode, setRoleCode] = useState(roles[0]?.role_code ?? "sales");
  const [pinError, setPinError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resetForm() {
    setEmail("");
    setFullName("");
    setPin("");
    setPinError(null);
    setRoleCode(roles[0]?.role_code ?? "sales");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;

    if (pin.length < 6) {
      setPinError("รหัสผ่าน (PIN) ต้องมีอย่างน้อย 6 ตัวอักษร");
      return;
    }
    setPinError(null);

    startTransition(async () => {
      const result = await createUserWithPin(email, pin, roleCode, fullName);
      if (!result.success) {
        toast.error(result.error ?? "สร้างผู้ใช้งานไม่สำเร็จ");
        return;
      }
      toast.success(`สร้างผู้ใช้ ${email.trim()} สำเร็จ`);
      resetForm();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return;
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" className="gap-2" disabled={isPending}>
          <UserPlus className="size-4" />
          สร้างผู้ใช้งานใหม่
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>สร้างผู้ใช้งานใหม่</DialogTitle>
          <DialogDescription>
            ตั้งอีเมลและรหัสผ่าน (PIN) ทันทีผ่าน Auth Admin — บันทึกลง{" "}
            <span className="font-mono text-xs">user_profiles</span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="create-full-name">ชื่อ-นามสกุล</Label>
            <Input
              id="create-full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="เช่น สมชาย ใจดี"
              disabled={isPending}
              required
              autoComplete="name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-email">อีเมล</Label>
            <Input
              id="create-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@company.com"
              disabled={isPending}
              required
              autoComplete="email"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-pin">รหัสผ่าน (PIN 6 หลัก)</Label>
            <Input
              id="create-pin"
              type="password"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                if (pinError && e.target.value.length >= 6) {
                  setPinError(null);
                }
              }}
              placeholder="อย่างน้อย 6 ตัวอักษร"
              disabled={isPending}
              required
              minLength={6}
              autoComplete="new-password"
              inputMode="numeric"
            />
            {pinError ? (
              <p className="text-xs text-red-600">{pinError}</p>
            ) : (
              <p className="text-xs text-slate-500">
                ใช้เป็นรหัสเข้าสู่ระบบ — บังคับอย่างน้อย 6 ตัวอักษร
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-role">สิทธิ์ (Role)</Label>
            <Select
              id="create-role"
              value={roleCode}
              onChange={(e) => setRoleCode(e.target.value)}
              disabled={isPending || roles.length === 0}
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

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setOpen(false)}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={isPending || roles.length === 0}>
              {isPending ? "กำลังสร้างผู้ใช้..." : "สร้างผู้ใช้งาน"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** @deprecated ใช้ CreateUserDialog */
export const InviteUserDialog = CreateUserDialog;
