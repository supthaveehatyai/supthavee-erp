import type { Metadata } from "next";
import MaterialsWorkspace from "@/app/products/materials/materials-workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ทะเบียนวัตถุดิบและวัสดุสิ้นเปลือง",
  description: "จัดการ mst_materials แยกจากสินค้าสำเร็จรูป",
};

export default function MaterialsPage() {
  return <MaterialsWorkspace />;
}
