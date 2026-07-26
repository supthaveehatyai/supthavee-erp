import type { Metadata } from "next";
import ProductsClient from "./products-client";

/** Opt out of Full Route Cache + Data Cache — always serve fresh Product Master UI */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "สินค้าและราคา | Product Matrix",
  description:
    "สร้างสินค้าแบบ Matrix 2 เฟส พร้อม Auto-SKU ราคาแยกตามไซส์ และผูกผู้จำหน่าย",
};

export default function ProductsPage() {
  return <ProductsClient />;
}
