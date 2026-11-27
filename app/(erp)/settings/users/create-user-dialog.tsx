"use client";

/**
 * Create User dialog — Admin sets email + PIN (password) + ABAC attributes.
 * Submit via Server Action (Zero Client-Side Fetching).
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { createUserWithPin, previewSupthaveeUsername } from "@/lib/actions/user.actions";
import type { AppRoleOption, DataAccessScope } from "@/types/user";
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
import { UserAbacFields } from "./user-abac-fields";

export type CreateUserDialogProps = {
  roles: AppRoleOption[];
};

/** @deprecated ชื่อเดิม — ใช้ CreateUserDialog */
export type InviteUserDialogProps = CreateUserDialogProps;

function defaultScopeForRole(roleCode: string): DataAccessScope {
  return roleCode.trim().toLowerCase() === "admin" ? "ALL" : "OWN";
}

export function CreateUserDialog({ roles }: CreateUserDialogProps) {
  const router = useRouter();
  const defaultRole = roles[0]?.role_code ?? "sales";
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [firstEn, setFirstEn] = useState("");
  const [lastEn, setLastEn] = useState("");
  const [username, setUsername] = useState("");
  const [roleCode, setRoleCode] = useState(defaultRole);
  const [dataAccessScope, setDataAccessScope] = useState<DataAccessScope>(
    defaultScopeForRole(defaultRole),
  );
  const [approvalLimit, setApprovalLimit] = useState("0");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function resetForm() {
    setEmail("");
    setFullName("");
    setFirstEn("");
    setLastEn("");
    setUsername("");
    setRoleCode(defaultRole);
    setDataAccessScope(defaultScopeForRole(defaultRole));
    setApprovalLimit("0");
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
      const result = await createUserWithPin(email, "555555", roleCode, fullName, {
        data_access_scope: dataAccessScope,
        approval_limit: parsedLimit,
      }, { firstNameEn: firstEn, lastNameEn: lastEn });
      if (!result.success) {
        toast.error(result.error ?? "สร้างผู้ใช้งานไม่สำเร็จ");
        return;
      }
      toast.success(`สร้างผู้ใช้ ${email.trim()} สำเร็จ`);
      resetForm();
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "สร้างผู้ใช้งานไม่สำเร็จ",
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
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" className="gap-2" disabled={isSubmitting}>
          <UserPlus className="size-4" />
          สร้างผู้ใช้งานใหม่
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>สร้างผู้ใช้งานใหม่</DialogTitle>
          <DialogDescription>
            ตั้งอีเมล PIN และสิทธิ์ข้อมูล (ABAC) — บันทึกลง{" "}
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
              disabled={isSubmitting}
              required
              autoComplete="name"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="create-first-en">ชื่อภาษาอังกฤษ (First Name EN)</Label>
              <Input id="create-first-en" value={firstEn} disabled={isSubmitting} onChange={(event) => {
                const value = event.target.value;
                setFirstEn(value);
                void previewSupthaveeUsername(value, lastEn).then(setUsername);
              }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-last-en">นามสกุลภาษาอังกฤษ (Last Name EN)</Label>
              <Input id="create-last-en" value={lastEn} disabled={isSubmitting} onChange={(event) => {
                const value = event.target.value;
                setLastEn(value);
                void previewSupthaveeUsername(firstEn, value).then(setUsername);
              }} />
            </div>
          </div>
          <p className="text-sm text-slate-600">Username: <span className="font-semibold text-slate-900">{username || "firstname.las"}</span></p>
          <div className="space-y-1.5">
            <Label htmlFor="create-email">อีเมลส่วนตัว (ไม่บังคับ)</Label>
            <Input id="create-email" type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="เว้นว่างได้ ระบบจะใช้อีเมลภายใน" disabled={isSubmitting} />
          </div>
          <p className="text-xs text-slate-500">รหัสเริ่มต้นคือ 555555 และต้องเปลี่ยนเมื่อเข้าสู่ระบบครั้งแรก</p>

          <div className="space-y-1.5">
            <Label htmlFor="create-role">สิทธิ์ (Role)</Label>
            <Select
              id="create-role"
              value={roleCode}
              onChange={(e) => {
                const nextRole = e.target.value;
                setRoleCode(nextRole);
                setDataAccessScope(defaultScopeForRole(nextRole));
              }}
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
            idPrefix="create-abac"
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
              onClick={() => setOpen(false)}
            >
              ยกเลิก
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || roles.length === 0}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? "กำลังสร้างผู้ใช้..." : "สร้างผู้ใช้งาน"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** @deprecated ใช้ CreateUserDialog */
export const InviteUserDialog = CreateUserDialog;
