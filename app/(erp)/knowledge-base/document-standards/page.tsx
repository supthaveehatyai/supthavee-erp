import type { Metadata } from "next";
import { BookOpen, GitBranch, Scale, ShoppingCart, Store } from "lucide-react";
import { getSystemSettings } from "@/lib/actions/settings";
import { resolvePrintPaperSize } from "@/lib/constants/print-paper-size";
import { DOCUMENT_TYPE_PREFIX } from "@/lib/constants/document";
import type { DocumentPrintSettings } from "@/types/system-settings";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DocumentPaperSizeSelect } from "./document-paper-size-select";

export const metadata: Metadata = {
  title: "มาตรฐานเอกสาร | Knowledge Base",
  description:
    "คู่มือ Document Taxonomy และ Lineage ฝั่งขาย (Sales/AR) และฝั่งซื้อ (Purchases/AP) สำหรับพนักงานอ้างอิง SOP",
};

type DocRow = {
  code: string;
  nameTh: string;
  nameEn: string;
  role: string;
  stock: string;
  payment: string;
  paper: string;
  legalNote: string;
};

type FlowStep = {
  title: string;
  path: string;
  note: string;
};

const SALES_DOCS: DocRow[] = [
  {
    code: "QT",
    nameTh: "ใบเสนอราคา",
    nameEn: "Quotation",
    role: "เสนอราคา · ยังไม่ตั้งหนี้",
    stock: "ไม่ตัดสต็อก",
    payment: "—",
    paper: "A4",
    legalNote: "เอกสารธุรกิจ ไม่ใช่ใบกำกับภาษี",
  },
  {
    code: "SO",
    nameTh: "ใบสั่งขาย",
    nameEn: "Sales Order",
    role: "ยืนยันคำสั่งซื้อ, จองสต็อก (Soft Allocation), และส่งงานสั่งทำ (MTO)",
    stock: "จองสต็อก (ATP)",
    payment: "—",
    paper: "A4",
    legalNote: "เอกสารภายใน / ต้นทางสำหรับส่งผลิตและออกบิล",
  },
  {
    code: "INV_DO",
    nameTh: "ใบส่งของ / แจ้งหนี้",
    nameEn: "Delivery Order / Invoice",
    role: "ส่งของ + ตั้งลูกหนี้ (Credit)",
    stock: "ตัดสต็อก OUT",
    payment: "UNPAID → REC",
    paper: "A5 Landscape",
    legalNote: "ใช้วางบิลได้ · ไม่ใช่ใบกำกับภาษีเต็มรูปแบบ",
  },
  {
    code: "TAX_INV",
    nameTh: "ใบกำกับภาษี",
    nameEn: "Tax Invoice",
    role: "ออกใบกำกับภาษีขาย + ตั้งลูกหนี้",
    stock: "ตัดสต็อก OUT",
    payment: "UNPAID → REC",
    paper: "A4",
    legalNote: "เอกสารภาษีมูลค่าเพิ่ม (ขายเชื่อ)",
  },
  {
    code: "CS_TAX",
    nameTh: "ใบกำกับเงินสด",
    nameEn: "Cash Tax Invoice",
    role: "ขายเงินสด + ใบกำกับภาษี",
    stock: "ตัดสต็อก OUT",
    payment: "PAID ทันที",
    paper: "A4",
    legalNote: "เอกสารภาษีมูลค่าเพิ่ม (ขายเงินสด)",
  },
  {
    code: "ABB",
    nameTh: "ใบเสร็จอย่างย่อ",
    nameEn: "Abbreviated Tax Invoice / Receipt",
    role: "ขายเงินสดแบบย่อ",
    stock: "ตัดสต็อก OUT",
    payment: "PAID ทันที",
    paper: "A5 Landscape",
    legalNote: "ใบเสร็จรับเงินอย่างย่อ (ตามเงื่อนไขสรรพากร)",
  },
  {
    code: "DEP_IN",
    nameTh: "ใบมัดจำรับ",
    nameEn: "Customer Deposit In",
    role: "รับเงินมัดจำลูกค้า",
    stock: "ไม่ตัดสต็อก",
    payment: "ยอดคงเหลือใช้หักที่ REC",
    paper: "A5 Landscape",
    legalNote: "หลักฐานรับเงินมัดจำ · ไม่ใช่ใบกำกับเต็มบิล",
  },
  {
    code: "BN",
    nameTh: "ใบวางบิล",
    nameEn: "Billing Note (AR)",
    role: "รวบรวมบิลลูกหนี้เพื่อเรียกเก็บ",
    stock: "ไม่ตัดสต็อก",
    payment: "PARTIAL / COMPLETED ตาม REC",
    paper: "A5 Landscape",
    legalNote: "เอกสารเรียกเก็บเงิน ไม่ใช่ใบกำกับภาษี",
  },
  {
    code: "REC",
    nameTh: "ใบเสร็จรับเงิน",
    nameEn: "Official Receipt",
    role: "ตัดชำระลูกหนี้ (Knock-off)",
    stock: "ไม่ตัดสต็อก",
    payment: "PAID / PARTIAL บนบิลต้นทาง",
    paper: "A5 Landscape",
    legalNote: "หลักฐานรับชำระ · แนบสลิปได้",
  },
  {
    code: "CN",
    nameTh: "ใบลดหนี้",
    nameEn: "Credit Note",
    role: "ลดยอดลูกหนี้ / คืนสินค้า",
    stock: "ตามนโยบายคืนเข้า",
    payment: "ลดยอดค้างชำระ",
    paper: "A4",
    legalNote: "ใช้คู่กับใบกำกับภาษีต้นทางเมื่อเกี่ยวข้อง VAT",
  },
  {
    code: "AR_REFUND",
    nameTh: "ใบสำคัญจ่ายเงินคืน",
    nameEn: "AR Refund",
    role: "คืนเงินมัดจำ / ยอดเหลือให้ลูกค้า",
    stock: "ไม่ตัดสต็อก",
    payment: "ตัดยอดมัดจำ DEP_IN",
    paper: "A4",
    legalNote: "ใบสำคัญจ่ายเงินคืน (Refund Payment)",
  },
  {
    code: "AR_WRITEOFF",
    nameTh: "ตัดยอดเป็นรายได้",
    nameEn: "AR Write-off",
    role: "ตัดเศษมัดจำรับรู้รายได้",
    stock: "ไม่ตัดสต็อก",
    payment: "ปิดยอดมัดจำ",
    paper: "A4",
    legalNote: "ใบสำคัญปรับปรุงบัญชี — รับรู้รายได้",
  },
];

const PURCHASE_DOCS: DocRow[] = [
  {
    code: "PO",
    nameTh: "ใบสั่งซื้อ",
    nameEn: "Purchase Order",
    role: "สั่งซื้อจากซัพพลายเออร์",
    stock: "ไม่รับเข้า",
    payment: "—",
    paper: "A4",
    legalNote: "เอกสารสั่งซื้อภายใน · ยังไม่ตั้งเจ้าหนี้",
  },
  {
    code: "AP_TAX",
    nameTh: "ใบส่งของ/ใบกำกับซื้อ (ตั้งหนี้)",
    nameEn: "AP Tax Invoice",
    role: "รับของ + ตั้งเจ้าหนี้ (มี VAT)",
    stock: "รับเข้า IN + อัปเดต LPP",
    payment: "UNPAID → PAY",
    paper: "A4",
    legalNote: "คู่กับใบกำกับภาษีซื้อจาก Vendor",
  },
  {
    code: "AP_INV",
    nameTh: "บิลธรรมดา (ตั้งหนี้ Non-VAT)",
    nameEn: "AP Invoice (Non-VAT)",
    role: "รับของ + ตั้งเจ้าหนี้ (ไม่มี VAT)",
    stock: "รับเข้า IN + อัปเดต LPP",
    payment: "UNPAID → PAY",
    paper: "A4",
    legalNote: "บิลซื้อ Non-VAT / ใบส่งของอย่างเดียว",
  },
  {
    code: "AP_CASH",
    nameTh: "บิลเงินสด/ใบกำกับ (จ่ายทันที)",
    nameEn: "AP Cash Bill",
    role: "รับของและจ่ายทันที",
    stock: "รับเข้า IN + อัปเดต LPP",
    payment: "PAID ทันที",
    paper: "A4",
    legalNote: "ซื้อเงินสด · ไม่ค้างเจ้าหนี้",
  },
  {
    code: "DEP_OUT",
    nameTh: "มัดจำจ่าย",
    nameEn: "Vendor Deposit Out",
    role: "จ่ายมัดจำให้ซัพพลายเออร์",
    stock: "ไม่รับเข้า",
    payment: "ยอดคงเหลือใช้หักที่ PAY",
    paper: "A5 Landscape",
    legalNote: "หลักฐานจ่ายมัดจำ",
  },
  {
    code: "BR",
    nameTh: "ใบรับวางบิล",
    nameEn: "Bill Receipt (AP)",
    role: "รับวางบิลจากเจ้าหนี้เพื่อจัดคิวจ่าย",
    stock: "ไม่รับเข้า",
    payment: "PARTIAL / COMPLETED ตาม PAY",
    paper: "A5 Landscape",
    legalNote: "เอกสารจัดคิวจ่าย · ไม่ใช่ใบกำกับภาษี",
  },
  {
    code: "PAY",
    nameTh: "ใบจ่ายชำระ",
    nameEn: "Payment Voucher",
    role: "ตัดชำระเจ้าหนี้ (Knock-off)",
    stock: "ไม่รับเข้า",
    payment: "PAID / PARTIAL บนบิลต้นทาง",
    paper: "A5 Landscape",
    legalNote: "หลักฐานจ่ายชำระ · แนบสลิปได้",
  },
  {
    code: "AP_REFUND",
    nameTh: "ใบสำคัญรับเงินคืน",
    nameEn: "AP Refund",
    role: "รับคืนมัดจำจากซัพพลายเออร์",
    stock: "ไม่รับเข้า",
    payment: "ตัดยอดมัดจำ DEP_OUT",
    paper: "A4",
    legalNote: "ใบสำคัญรับเงินคืน (Refund Receipt)",
  },
  {
    code: "AP_WRITEOFF",
    nameTh: "ตัดยอดเป็นค่าใช้จ่าย",
    nameEn: "AP Write-off",
    role: "ตัดเศษมัดจำเป็นค่าใช้จ่าย",
    stock: "ไม่รับเข้า",
    payment: "ปิดยอดมัดจำ",
    paper: "A4",
    legalNote: "ใบสำคัญปรับปรุงบัญชี — ตัดเป็นค่าใช้จ่าย",
  },
];

const SALES_FLOWS: FlowStep[] = [
  {
    title: "ขายเชื่อ (Credit) — มาตรฐาน",
    path: "QT → SO → (ส่งผลิต MTO) → TAX_INV / INV_DO → (BN) → REC",
    note: "แปลง QT เป็น SO เพื่อยืนยันคำสั่งซื้อและจองสต็อก → ส่งผลิต (ถ้ามี) → ออกบิลขาย → วางบิล BN → รับชำระด้วย REC",
  },
  {
    title: "ขายเงินสด (Cash)",
    path: "QT → SO → CS_TAX / ABB",
    note: "ออกบิลเงินสดจาก SO แล้วสถานะชำระเป็น PAID ทันที ไม่ต้องสร้าง REC ซ้ำ",
  },
  {
    title: "รับมัดจำแล้วตัดชำระ",
    path: "DEP_IN → SO → TAX_INV / INV_DO → REC (+ หักมัดจำ)",
    note: "รับมัดจำก่อน → สร้าง SO จองสต็อก → ออกบิลขาย → ใช้ยอดมัดจำหักตอน REC",
  },
  {
    title: "คืนมัดจำ / ตัดเศษ",
    path: "DEP_IN → AR_REFUND หรือ AR_WRITEOFF",
    note: "คืนเงินลูกค้าด้วย AR_REFUND หรือรับรู้รายได้ด้วย AR_WRITEOFF",
  },
];

const PURCHASE_FLOWS: FlowStep[] = [
  {
    title: "ซื้อเชื่อ (Credit) — มาตรฐาน",
    path: "PO → รับสินค้า (AP_TAX / AP_INV) → (BR) → PAY",
    note: "สั่งซื้อ → รับของเข้าคลังและตั้งเจ้าหนี้ → รับวางบิล BR (ถ้ามี) → จ่ายด้วย PAY",
  },
  {
    title: "ซื้อเงินสด",
    path: "รับสินค้า AP_CASH",
    note: "รับของและปิดชำระทันที (PAID) ไม่ค้างเจ้าหนี้",
  },
  {
    title: "จ่ายมัดจำแล้วตัดชำระ",
    path: "DEP_OUT → AP_TAX / AP_INV → PAY (+ หักมัดจำ)",
    note: "จ่ายมัดจำให้ Vendor แล้วนำยอดคงเหลือมาหักตอน PAY",
  },
  {
    title: "รับคืนมัดจำ / ตัดเศษ",
    path: "DEP_OUT → AP_REFUND หรือ AP_WRITEOFF",
    note: "รับเงินคืนด้วย AP_REFUND หรือตัดเป็นค่าใช้จ่ายด้วย AP_WRITEOFF",
  },
];

function prefixOf(code: string): string {
  return (
    DOCUMENT_TYPE_PREFIX[code as keyof typeof DOCUMENT_TYPE_PREFIX] ?? code
  );
}

function DocTaxonomyTable({
  rows,
  printSettings,
}: {
  rows: DocRow[];
  printSettings: DocumentPrintSettings;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[88px]">รหัส</TableHead>
          <TableHead className="min-w-[160px]">เอกสาร</TableHead>
          <TableHead className="min-w-[180px]">บทบาทในระบบ</TableHead>
          <TableHead>สต็อก</TableHead>
          <TableHead>สถานะชำระ</TableHead>
          <TableHead className="min-w-[140px]">กระดาษ</TableHead>
          <TableHead className="min-w-[200px]">กฎหมาย / มาตรฐาน</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.code}>
            <TableCell>
              <div className="space-y-1">
                <Badge className="border-blue-200 bg-blue-50 font-mono text-blue-800 hover:bg-blue-50">
                  {row.code}
                </Badge>
                <p className="text-[11px] text-slate-400">
                  Prefix {prefixOf(row.code)}-
                </p>
              </div>
            </TableCell>
            <TableCell>
              <p className="font-medium text-slate-900">{row.nameTh}</p>
              <p className="text-xs text-slate-500">{row.nameEn}</p>
            </TableCell>
            <TableCell className="text-slate-700">{row.role}</TableCell>
            <TableCell className="text-slate-600">{row.stock}</TableCell>
            <TableCell className="text-slate-600">{row.payment}</TableCell>
            <TableCell>
              <DocumentPaperSizeSelect
                docType={row.code}
                value={resolvePrintPaperSize(row.code, printSettings)}
              />
            </TableCell>
            <TableCell className="text-slate-600">{row.legalNote}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function LineageCard({ flows }: { flows: FlowStep[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {flows.map((flow) => (
        <div
          key={flow.title}
          className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"
        >
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <GitBranch className="size-4 text-blue-600" />
            {flow.title}
          </div>
          <p className="mb-2 font-mono text-xs leading-relaxed text-blue-800">
            {flow.path}
          </p>
          <p className="text-sm text-slate-600">{flow.note}</p>
        </div>
      ))}
    </div>
  );
}

export default async function DocumentStandardsPage() {
  const settingsResult = await getSystemSettings();
  const printSettings: DocumentPrintSettings = settingsResult.success
    ? settingsResult.data.document_print_settings
    : {};

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <BookOpen className="size-7 text-blue-700" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
            มาตรฐานเอกสาร (Document Standards)
          </h1>
        </div>
        <p className="max-w-3xl text-sm text-slate-500 md:text-base">
          SOP อ้างอิง Document Taxonomy และ Lineage ของ Supthavee ERP —
          ตั้งค่าขนาดกระดาษพิมพ์ได้ต่อประเภทเอกสาร (บันทึกลง{" "}
          <span className="font-mono text-xs">system_settings.document_print_settings</span>
          ) และใช้เป็นคู่มือพนักงานฝ่ายขาย การเงิน และจัดซื้อ
        </p>
        {!settingsResult.success ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            โหลดการตั้งค่ากระดาษไม่สำเร็จ — แสดงค่าเริ่มต้นของระบบ ·{" "}
            {settingsResult.error}
          </p>
        ) : null}
      </div>

      <Card className="border-amber-200 bg-amber-50/40 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-amber-950">
            <Scale className="size-4" />
            กฎวงจรชีวิตเอกสาร (Lifecycle) — ใช้ร่วมทั้งระบบ
          </CardTitle>
          <CardDescription className="text-amber-900/80">
            Late Numbering · DRAFT / ISSUED · ห้ามลบเอกสารที่ออกเลขแล้ว
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-amber-950/90 md:grid-cols-3">
          <div className="rounded-lg border border-amber-200/80 bg-white/70 p-3">
            <p className="font-semibold">1. Late Numbering</p>
            <p className="mt-1 text-amber-900/80">
              เอกสารใหม่ใช้รหัสชั่วคราว{" "}
              <span className="font-mono">DRAFT-YYYYMMDDHHmmss</span>{" "}
              ดึงเลขรันนิ่งจริงตอนกดยืนยัน (ISSUED) เท่านั้น
            </p>
          </div>
          <div className="rounded-lg border border-amber-200/80 bg-white/70 p-3">
            <p className="font-semibold">2. DRAFT = Delete</p>
            <p className="mt-1 text-amber-900/80">
              สถานะร่างลบได้ — ยังไม่กระทบสต็อก / ลูกหนี้-เจ้าหนี้จริง
            </p>
          </div>
          <div className="rounded-lg border border-amber-200/80 bg-white/70 p-3">
            <p className="font-semibold">3. ISSUED = Void</p>
            <p className="mt-1 text-amber-900/80">
              เอกสารที่ยืนยันแล้วห้ามลบ ใช้ยกเลิก (Void) และคืนสต็อกอัตโนมัติเมื่อจำเป็น
            </p>
          </div>
        </CardContent>
      </Card>

      {/* —— Sales / AR —— */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Store className="size-5 text-sky-700" />
            ฝั่งขาย (Sales / AR) — กฎหมายและมาตรฐานเอกสาร
          </CardTitle>
          <CardDescription>
            ลูกหนี้การค้า · ใบกำกับภาษีขาย · วางบิล (BN) · รับชำระ (REC)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="mb-3 text-sm font-semibold tracking-wide text-slate-700 uppercase">
              Document Taxonomy
            </h3>
            <DocTaxonomyTable rows={SALES_DOCS} printSettings={printSettings} />
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold tracking-wide text-slate-700 uppercase">
              Document Lineage (ลำดับการออกเอกสาร)
            </h3>
            <LineageCard flows={SALES_FLOWS} />
          </div>

          <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-4 text-sm text-slate-700">
            <p className="font-semibold text-sky-900">สรุปกฎหมายฝั่งขาย</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <span className="font-mono font-semibold">TAX_INV / CS_TAX</span>{" "}
                = ใบกำกับภาษีขาย (VAT) ตามประเภทเชื่อ/เงินสด
              </li>
              <li>
                <span className="font-mono font-semibold">ABB</span> =
                ใบเสร็จรับเงินอย่างย่อ ใช้กรณีขายเงินสดที่เข้าเงื่อนไข
              </li>
              <li>
                <span className="font-mono font-semibold">BN</span> = ใบวางบิล
                รวบรวมยอดเรียกเก็บ ไม่ทดแทนใบกำกับภาษี
              </li>
              <li>
                <span className="font-mono font-semibold">REC</span> =
                ใบเสร็จรับเงินตัดชำระลูกหนี้ แนบสลิปโอนเงินเป็นหลักฐาน
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* —— Purchases / AP —— */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShoppingCart className="size-5 text-orange-700" />
            ฝั่งซื้อ (Purchases / AP) — กฎหมายและมาตรฐานเอกสาร
          </CardTitle>
          <CardDescription>
            เจ้าหนี้การค้า · รับสินค้า · รับวางบิล (BR) · จ่ายชำระ (PAY)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="mb-3 text-sm font-semibold tracking-wide text-slate-700 uppercase">
              Document Taxonomy
            </h3>
            <DocTaxonomyTable
              rows={PURCHASE_DOCS}
              printSettings={printSettings}
            />
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold tracking-wide text-slate-700 uppercase">
              Document Lineage (ลำดับการออกเอกสาร)
            </h3>
            <LineageCard flows={PURCHASE_FLOWS} />
          </div>

          <div className="rounded-xl border border-orange-100 bg-orange-50/50 p-4 text-sm text-slate-700">
            <p className="font-semibold text-orange-900">สรุปกฎหมายฝั่งซื้อ</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <span className="font-mono font-semibold">AP_TAX</span> =
                รับของพร้อมใบกำกับภาษีซื้อ (ตั้งเจ้าหนี้ + VAT ซื้อ)
              </li>
              <li>
                <span className="font-mono font-semibold">AP_INV</span> =
                บิลซื้อ Non-VAT / ใบส่งของอย่างเดียว
              </li>
              <li>
                <span className="font-mono font-semibold">BR</span> =
                ใบรับวางบิลจากเจ้าหนี้ ใช้จัดคิวจ่าย ไม่ใช่เอกสารภาษี
              </li>
              <li>
                <span className="font-mono font-semibold">PAY</span> =
                ใบจ่ายชำระตัดเจ้าหนี้ แนบสลิปโอนเงิน · อัปเดต LPP จากต้นทุนสุทธิเมื่อรับของ
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Quick Map — รหัสที่พบบ่อย</CardTitle>
          <CardDescription>
            จับคู่คำพูดพนักงาน ↔ รหัสในระบบ (Single Source of Truth)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["เสนอราคา", "QT"],
              ["ใบสั่งขาย / จองสต็อก / ส่งผลิต", "SO"],
              ["ส่งของ / แจ้งหนี้", "INV_DO"],
              ["ใบกำกับภาษีขาย", "TAX_INV"],
              ["วางบิลลูกค้า", "BN"],
              ["เสร็จรับเงิน / ตัดหนี้ลูกค้า", "REC"],
              ["สั่งซื้อ", "PO"],
              ["รับของตั้งหนี้ (มี VAT)", "AP_TAX"],
              ["รับของตั้งหนี้ (Non-VAT)", "AP_INV"],
              ["รับวางบิลเจ้าหนี้", "BR"],
              ["จ่ายชำระ / ตัดหนี้เจ้าหนี้", "PAY"],
            ].map(([label, code]) => (
              <div
                key={code}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <span className="text-slate-600">{label}</span>
                <Badge className="border-slate-200 bg-slate-50 font-mono text-slate-800 hover:bg-slate-50">
                  {code}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
