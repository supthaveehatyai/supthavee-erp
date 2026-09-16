import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Ruler } from "lucide-react";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import {
  canAccessPath,
  isAdminRoleCode,
} from "@/lib/auth/module-access";
import { getSizes } from "@/lib/actions/master-data-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SizesManager } from "./sizes-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "จัดการไซส์ | Master Sizes",
  description: "เพิ่ม แก้ไข และปิดใช้งานไซส์มาตรฐาน (mst_sizes) สำหรับ Admin",
};

const SIZES_PATH = "/settings/master-data/sizes";

export default async function MasterSizesPage() {
  const actor = await getCurrentAuthUser();
  if (!actor) {
    redirect(`/login?next=${encodeURIComponent(SIZES_PATH)}`);
  }

  const allowed =
    isAdminRoleCode(actor.roleCode) ||
    canAccessPath(SIZES_PATH, actor.accessibleModules, actor.roleCode);

  if (!allowed) {
    redirect("/dashboard?error=unauthorized");
  }

  const result = await getSizes();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <Ruler className="h-8 w-8 text-blue-600" />
          จัดการไซส์ (mst_sizes)
        </h1>
        <p className="text-slate-500">
          ไซส์มาตรฐานทั้งระบบ เรียงตาม Sort Order — รหัสสูงสุด 2 ตัวอักษร
          (เช่น S, XL, 10) · ปิดใช้งานเป็นการ Soft Delete
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">รายการไซส์</CardTitle>
          <CardDescription>
            {result.success
              ? `${result.data.length} รายการ · ลำดับแนะนำ Gap of 10`
              : "โหลดข้อมูลไม่สำเร็จ"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!result.success ? (
            <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {result.error}
            </p>
          ) : (
            <SizesManager sizes={result.data} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
