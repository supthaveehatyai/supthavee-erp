import { Scale } from "lucide-react";
import {
  getAccountPayables,
  getAccountReceivables,
} from "@/lib/actions/finance/ar";
import { ApArDashboard } from "./ap-ar-dashboard";

export const dynamic = "force-dynamic";

export default async function ApArPage() {
  const [arResult, apResult] = await Promise.all([
    getAccountReceivables(),
    getAccountPayables(),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <Scale className="h-8 w-8 text-blue-600" />
          ลูกหนี้ / เจ้าหนี้ (AR / AP)
        </h1>
        <p className="text-slate-500">
          ภาพรวมยอดค้างรับจากลูกค้า และยอดค้างจ่ายให้ผู้จำหน่าย — คำนวณจาก
          grand_total (รวม VAT)
        </p>
      </div>

      <ApArDashboard
        arData={arResult.data}
        apData={apResult.data}
        arError={arResult.error}
        apError={apResult.error}
      />
    </div>
  );
}
