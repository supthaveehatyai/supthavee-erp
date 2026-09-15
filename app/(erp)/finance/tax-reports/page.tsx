import type { Metadata } from "next";
import { FileSpreadsheet } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TaxReportsPanel } from "./tax-reports-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "รายงานภาษีซื้อ-ภาษีขาย | Tax Reports",
  description: "ส่งออกสมุดภาษีซื้อ / ภาษีขาย เป็นไฟล์ Excel ตามฟอร์แมตกรมสรรพากร",
};

export default async function TaxReportsPage() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
          <FileSpreadsheet className="size-7 text-blue-600" />
          รายงานภาษีซื้อ-ภาษีขาย
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          ส่งออกสมุดภาษีรายเดือนเป็นไฟล์ Excel (.xlsx) ตามคอลัมน์กรมสรรพากร —
          ภาษีขายดึงจาก TAX_INV / CS_TAX / ABB และภาษีซื้อดึงจาก AP_TAX
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">เลือกงวดบัญชีแล้วดาวน์โหลด</CardTitle>
          <CardDescription>
            เอกสารที่ยกเลิก (VOID) จะยังปรากฏในรายงานภาษีขาย แต่ยอดเงินเป็น 0
            และหมายเหตุเป็น &quot;ยกเลิก&quot; — ลูกค้าแพลตฟอร์มใช้ชื่อจาก
            ecommerce_buyer_name
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TaxReportsPanel year={year} month={month} />
        </CardContent>
      </Card>
    </div>
  );
}
