import { requireSuperAdmin } from "@/lib/holding/workspace-access";

export const dynamic = "force-dynamic";

const BLOCKS = [
  { code: "RENT", title: "บ้านเช่า", detail: "สัญญาเช่า ค่าเช่ารายเดือน และ QR รับค่าเช่า เตรียมไว้สำหรับขั้นบันทึกบิล" },
  { code: "LAND", title: "ที่ดินเช่า", detail: "โฉนดและภ.ด.ส. แยกตามแปลงในสงขลาและกรุงเทพฯ" },
  { code: "TAX", title: "ภาษีที่ดิน", detail: "โครงสร้างภาระภาษีรายปีพร้อมแนบสำเนาโฉนดจากคลังเอกสาร" },
];

export default async function PropertyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-amber-900">PR</p>
        <h1 className="text-2xl font-bold text-slate-900">บ้านเช่าและที่ดิน</h1>
        <p className="text-sm text-slate-500">
          โครงสร้างพร้อมสำหรับขั้นถัดไป {params.tab === "land-tax" ? "· โฟกัสทะเบียนโฉนดและภาษีที่ดิน" : ""}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {BLOCKS.map((block) => (
          <article key={block.code} className="rounded-xl border border-amber-200 bg-white p-5">
            <p className="text-xs font-semibold text-amber-950">{block.code}</p>
            <h2 className="text-lg font-semibold text-slate-900">{block.title}</h2>
            <p className="text-sm text-slate-500">{block.detail}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
