import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Database } from "lucide-react";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import {
  canAccessPath,
  isAdminRoleCode,
} from "@/lib/auth/module-access";
import {
  getCategories,
  getSizes,
} from "@/lib/actions/master-data-actions";
import { MasterDataHub, type MasterDataTab } from "./master-data-hub";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Master Data Hub | ข้อมูลหลัก",
  description:
    "จัดการไซส์มาตรฐาน (mst_sizes) และหมวดหมู่สินค้า (mst_categories) ในหน้าเดียว",
};

const HUB_PATH = "/settings/master-data";

type PageProps = {
  searchParams: Promise<{ tab?: string }>;
};

function resolveTab(raw: string | undefined): MasterDataTab {
  return raw === "categories" ? "categories" : "sizes";
}

export default async function MasterDataHubPage({ searchParams }: PageProps) {
  const actor = await getCurrentAuthUser();
  if (!actor) {
    redirect(`/login?next=${encodeURIComponent(HUB_PATH)}`);
  }

  const allowed =
    isAdminRoleCode(actor.roleCode) ||
    canAccessPath(HUB_PATH, actor.accessibleModules, actor.roleCode);

  if (!allowed) {
    redirect("/dashboard?error=unauthorized");
  }

  const params = await searchParams;
  const tab = resolveTab(params.tab);

  const [sizesResult, categoriesResult] = await Promise.all([
    getSizes(),
    getCategories(),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <Database className="h-8 w-8 text-blue-600" />
          Master Data Hub
        </h1>
        <p className="text-slate-500">
          จัดการข้อมูลหลักของสินค้า — ไซส์มาตรฐานและหมวดหมู่ (แม่-ลูก)
          ปิดใช้งานเป็นการ Soft Delete เท่านั้น ไม่ลบข้อมูลทิ้ง
        </p>
      </div>

      <MasterDataHub
        tab={tab}
        sizes={sizesResult.data}
        sizesError={sizesResult.success ? null : sizesResult.error}
        categories={categoriesResult.data}
        categoriesError={
          categoriesResult.success ? null : categoriesResult.error
        }
      />
    </div>
  );
}
