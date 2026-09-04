import type { Metadata } from "next";
import { listActiveCustomers } from "@/lib/actions/document-actions";
import SalesOrderWorkspace from "./sales-order-workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "สร้างใบสั่งขาย | Sales Order",
  description:
    "Phase 17 — สร้างใบสั่งขาย (SO) เพื่อจองสต็อกและส่งงานผลิต MTO",
};

export default async function CreateSalesOrderPage() {
  const customersResult = await listActiveCustomers();

  return (
    <SalesOrderWorkspace
      customers={customersResult.data}
      customersError={customersResult.error}
    />
  );
}
