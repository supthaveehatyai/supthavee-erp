"use client";

/**
 * Role Permission Matrix — Accordion + module toggles.
 * Persist via Server Action only (Zero Client-Side Fetching).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import { updateRoleAccessibleModules } from "@/lib/actions/role-permissions";
import {
  ERP_MODULE_KEYS,
  ERP_MODULE_LABELS,
  isAdminRoleCode,
} from "@/lib/auth/module-access";
import type { AccessibleModules, RolePermissionRow } from "@/types/rbac";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type RolePermissionsPanelProps = {
  roles: RolePermissionRow[];
};

function grantedCount(modules: AccessibleModules): number {
  return ERP_MODULE_KEYS.filter((key) => modules[key]).length;
}

export function RolePermissionsPanel({ roles }: RolePermissionsPanelProps) {
  if (roles.length === 0) {
    return (
      <p className="px-2 py-10 text-center text-sm text-slate-500">
        ยังไม่มีบทบาทในตาราง app_roles
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <Table wrapperClassName="overflow-x-auto rounded-xl border border-slate-200">
        <TableHeader>
          <TableRow>
            <TableHead>บทบาท</TableHead>
            {ERP_MODULE_KEYS.map((key) => (
              <TableHead key={key} className="text-center text-xs">
                {key}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((role) => (
            <TableRow key={role.role_code}>
              <TableCell className="font-medium text-slate-900">
                {role.role_name_th}
                <p className="font-mono text-[11px] font-normal text-slate-400">
                  {role.role_code}
                </p>
              </TableCell>
              {ERP_MODULE_KEYS.map((key) => (
                <TableCell key={key} className="text-center">
                  {role.accessible_modules[key] ? (
                    <span className="font-semibold text-emerald-600">เปิด</span>
                  ) : (
                    <span className="text-slate-400">ปิด</span>
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Accordion type="multiple" className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {roles.map((role) => (
          <RolePermissionItem key={role.role_code} role={role} />
        ))}
      </Accordion>
    </div>
  );
}

function RolePermissionItem({ role }: { role: RolePermissionRow }) {
  const router = useRouter();
  const isAdmin = isAdminRoleCode(role.role_code);
  const [modules, setModules] = useState<AccessibleModules>(
    role.accessible_modules,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setModules(role.accessible_modules);
  }, [role.accessible_modules]);

  function toggleModule(key: (typeof ERP_MODULE_KEYS)[number], checked: boolean) {
    if (isAdmin) return;
    setModules((prev) => ({ ...prev, [key]: checked }));
  }

  async function handleSave() {
    if (isSubmitting || isAdmin) return;
    setIsSubmitting(true);
    try {
      const result = await updateRoleAccessibleModules(role.role_code, modules);
      if (!result.success) {
        toast.error(result.error ?? "บันทึกสิทธิ์บทบาทไม่สำเร็จ");
        return;
      }
      toast.success(`อัปเดตสิทธิ์ของ ${role.role_name_th} แล้ว`);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "บันทึกสิทธิ์บทบาทไม่สำเร็จ",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AccordionItem value={role.role_code} className="px-4">
      <AccordionTrigger>
        <span className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <span className="truncate font-semibold text-slate-900">
            {role.role_name_th}
          </span>
          <span className="font-mono text-[11px] font-normal text-slate-400">
            {role.role_code}
          </span>
          <Badge className="w-fit border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-50">
            {grantedCount(modules)}/{ERP_MODULE_KEYS.length} โมดูล
          </Badge>
        </span>
      </AccordionTrigger>
      <AccordionContent>
        {role.description ? (
          <p className="mb-3 text-xs text-slate-500">{role.description}</p>
        ) : null}

        {isAdmin ? (
          <p className="mb-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            บทบาท Admin มีสิทธิ์ทุกโมดูลเสมอ — ไม่สามารถปิดได้ (ITGC / SoD)
          </p>
        ) : null}

        <ul className="space-y-2">
          {ERP_MODULE_KEYS.map((key) => (
            <li
              key={key}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5"
            >
              <label
                htmlFor={`role-${role.role_code}-${key}`}
                className="text-sm font-medium text-slate-800"
              >
                {ERP_MODULE_LABELS[key]}
              </label>
              <Switch
                id={`role-${role.role_code}-${key}`}
                checked={modules[key]}
                disabled={isSubmitting || isAdmin}
                onCheckedChange={(checked) => toggleModule(key, checked)}
                aria-label={ERP_MODULE_LABELS[key]}
              />
            </li>
          ))}
        </ul>

        {!isAdmin ? (
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              onClick={handleSave}
              className="gap-2"
            >
              <Shield className="size-4" />
              {isSubmitting ? "กำลังบันทึก..." : "บันทึกสิทธิ์บทบาท"}
            </Button>
          </div>
        ) : null}
      </AccordionContent>
    </AccordionItem>
  );
}
