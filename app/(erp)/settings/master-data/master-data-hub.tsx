"use client";

import { useRouter } from "next/navigation";
import { FolderTree, Ruler } from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { MasterCategoryRow } from "@/types/master-category";
import type { MasterSizeRow } from "@/types/master-size";
import { CategoryManagement } from "./category-management";
import { SizesManager } from "./sizes/sizes-manager";

export type MasterDataTab = "sizes" | "categories";

const HUB_PATH = "/settings/master-data";

export function MasterDataHub({
  tab,
  sizes,
  sizesError,
  categories,
  categoriesError,
}: {
  tab: MasterDataTab;
  sizes: MasterSizeRow[];
  sizesError: string | null;
  categories: MasterCategoryRow[];
  categoriesError: string | null;
}) {
  const router = useRouter();

  function onValueChange(next: string) {
    const href =
      next === "categories" ? `${HUB_PATH}?tab=categories` : HUB_PATH;
    router.replace(href, { scroll: false });
  }

  return (
    <Tabs value={tab} onValueChange={onValueChange} className="w-full">
      <TabsList className="h-auto w-full justify-start gap-1 bg-slate-100 p-1 sm:w-auto">
        <TabsTrigger value="sizes" className="gap-1.5 px-4">
          <Ruler className="size-3.5" />
          จัดการไซส์ (Sizes)
        </TabsTrigger>
        <TabsTrigger value="categories" className="gap-1.5 px-4">
          <FolderTree className="size-3.5" />
          จัดการหมวดหมู่ (Categories)
        </TabsTrigger>
      </TabsList>

      <TabsContent value="sizes">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">รายการไซส์</CardTitle>
            <CardDescription>
              {sizesError
                ? "โหลดข้อมูลไม่สำเร็จ"
                : `${sizes.length} รายการ · ลำดับแนะนำ Gap of 10`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sizesError ? (
              <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                {sizesError}
              </p>
            ) : (
              <SizesManager sizes={sizes} />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="categories">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">รายการหมวดหมู่</CardTitle>
            <CardDescription>
              {categoriesError
                ? "โหลดข้อมูลไม่สำเร็จ"
                : `${categories.length} รายการ · หมวดหลักขึ้นก่อน แล้วตามด้วยหมวดย่อย`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {categoriesError ? (
              <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                {categoriesError}
              </p>
            ) : (
              <CategoryManagement categories={categories} />
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
