import type { Metadata } from "next";
import {
  getCatalogFilterMetadataAction,
  searchColorwayCatalogAction,
} from "@/lib/actions/colorway-catalog-actions";
import { SalesCatalogWorkspace } from "./sales-catalog-workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "แคตตาล็อกรูป & สต็อก",
  description: "แคตตาล็อกสินค้าแยกตามรุ่นและสี พร้อมสต็อกพร้อมส่ง",
};

type PageProps = {
  searchParams: Promise<{
    q?: string;
    family?: string;
    category?: string;
    instock?: string;
  }>;
};

export default async function SalesCatalogPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = {
    q: params.q ?? "",
    family: params.family ?? "",
    categoryId: params.category ?? "",
    inStockOnly: params.instock === "1" || params.instock === "true",
  };

  const [catalog, metadata] = await Promise.all([
    searchColorwayCatalogAction(query),
    getCatalogFilterMetadataAction(),
  ]);

  return (
    <SalesCatalogWorkspace
      filters={query}
      items={catalog.items}
      truncated={catalog.truncated}
      error={catalog.error ?? metadata.error}
      categories={metadata.categories}
      families={metadata.families}
    />
  );
}
