import { redirect } from "next/navigation";

/** Legacy path → canonical dashboard route */
export default function LegacyGoodsReceiptRedirect() {
  redirect("/dashboard/procurement/goods-receipt");
}
