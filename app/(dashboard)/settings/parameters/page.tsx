import type { Metadata } from "next";
import { SlidersHorizontal } from "lucide-react";
import { getParameterSettingsPageData } from "@/lib/actions/parameter-actions";
import { ParameterApprovalTable } from "./parameter-approval-table";
import { ParameterSettingsForm } from "./parameter-settings-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ตั้งค่าระบบ | System Parameters",
  description:
    "จัดการพารามิเตอร์ระบบผ่าน Maker-Checker — NAS Backup Path และอัตราหัก ณ ที่จ่าย",
};

export default async function SystemParametersPage() {
  const result = await getParameterSettingsPageData();

  if (!result.success) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {result.error}
        </div>
      </div>
    );
  }

  const { parameters, pendingRequests, isAdmin } = result.data;

  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <SlidersHorizontal className="h-8 w-8 text-blue-600" />
          ตั้งค่าระบบ (System Parameters)
        </h1>
        <p className="text-slate-500">
          แก้ไขค่าพารามิเตอร์สำคัญของระบบ — ต้องยืนยัน PIN 6 หลักก่อนส่งคำขอ
          และรอ Admin อนุมัติ (Maker-Checker)
        </p>
      </div>

      <ParameterSettingsForm
        parameters={parameters}
        pendingParamKeys={pendingRequests.map((row) => row.param_key)}
      />

      <ParameterApprovalTable
        rows={pendingRequests}
        isAdmin={isAdmin}
      />
    </div>
  );
}
