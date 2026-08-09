import { Building2 } from "lucide-react";
import { getSystemSettings } from "@/lib/actions/settings";
import { CompanySettingsForm } from "@/components/settings/CompanySettingsForm";

/** บังคับไม่ให้ Next.js cache ข้อมูลตั้งค่าบริษัท */
export const dynamic = "force-dynamic";

export default async function CompanySettingsPage() {
  const result = await getSystemSettings();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <Building2 className="h-8 w-8 text-blue-600" />
          ตั้งค่าข้อมูลบริษัท
        </h1>
        <p className="text-slate-500">
          จัดการชื่อ ที่อยู่ เลขภาษี และอัตรา VAT มาตรฐาน
          ให้เป็น Single Source of Truth ของทั้งระบบ
        </p>
      </div>

      {!result.success ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {result.error}
        </div>
      ) : (
        <CompanySettingsForm initialData={result.data} />
      )}
    </div>
  );
}
