import type { Metadata } from "next";
import {
  BookOpen,
  FileSpreadsheet,
  GitBranch,
  Globe,
  Scale,
  ShoppingCart,
  Store,
  Undo2,
} from "lucide-react";
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
    "คู่มือ Document Taxonomy และ Lineage ฝั่งขาย/ซื้อ จนถึง Phase 19 — One-Time Customer (CPD), Reverse Logistics และ Report Center",
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
    nameEn: "AR Refund (SRF)",
    role: "จ่ายเงินคืนลูกค้า เช่น คืนมัดจำ DEP_IN",
    stock: "ไม่ตัดสต็อก",
    payment: "มีกระแสเงินสดออก",
    paper: "A4",
    legalNote: "Prefix SRF · ใบสำคัญจ่ายเงินคืน (Refund Payment)",
  },
  {
    code: "AR_WRITEOFF",
    nameTh: "ใบสำคัญตัดหนี้สูญ / ตัดเศษลูกหนี้",
    nameEn: "AR Write-off (SWO)",
    role: "ปิดยอดลูกหนี้เป็น PAID โดยไม่มีกระแสเงินสด",
    stock: "ไม่ตัดสต็อก",
    payment: "PAID (ไม่มีเงินสด)",
    paper: "A4",
    legalNote: "Prefix SWO · ตัดหนี้สูญ / ตัดเศษบัญชีลูกหนี้",
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
    nameEn: "AP Refund (PRF)",
    role: "รับเงินคืนจาก Vendor เช่น ได้รับมัดจำคืน",
    stock: "ไม่รับเข้า",
    payment: "มีกระแสเงินสดเข้า",
    paper: "A4",
    legalNote: "Prefix PRF · ใบสำคัญรับเงินคืน (Refund Receipt)",
  },
  {
    code: "AP_WRITEOFF",
    nameTh: "ใบสำคัญตัดเศษบัญชีเจ้าหนี้",
    nameEn: "AP Write-off (PWO)",
    role: "ปิดยอดเจ้าหนี้โดยไม่มีกระแสเงินสด",
    stock: "ไม่รับเข้า",
    payment: "PAID (ไม่มีเงินสด)",
    paper: "A4",
    legalNote: "Prefix PWO · ตัดเศษบัญชีเจ้าหนี้",
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
    title: "คืนมัดจำ / ตัดหนี้สูญ (Reverse Logistics)",
    path: "DEP_IN / บิลค้าง → AR_REFUND (SRF) หรือ AR_WRITEOFF (SWO)",
    note: "มีเงินคืนลูกค้าใช้ SRF — ปิดยอดลูกหนี้โดยไม่มีเงินสดใช้ SWO (สถานะ PAID)",
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
    title: "รับคืนมัดจำ / ตัดเศษเจ้าหนี้ (Reverse Logistics)",
    path: "DEP_OUT / บิลค้าง → AP_REFUND (PRF) หรือ AP_WRITEOFF (PWO)",
    note: "ได้รับเงินคืนจาก Vendor ใช้ PRF — ปิดยอดเจ้าหนี้โดยไม่มีเงินสดใช้ PWO",
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
          SOP อ้างอิง Document Taxonomy และ Lineage ของ Supthavee ERP จนถึง
          Phase 19 (Omnichannel / CPD, Reverse Logistics, Report Center) —
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

      <Card className="border-violet-200 bg-violet-50/30 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-violet-950">
            <Globe className="size-4" />
            ระบบลูกค้า E-Commerce และลูกค้าขาจร (One-Time Customer / SAP CPD)
          </CardTitle>
          <CardDescription className="text-violet-900/80">
            Phase 19 — ห้ามสร้าง Contact ใหม่สำหรับลูกค้าแพลตฟอร์มและเงินสดหน้าร้าน
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-violet-950/90">
          <p>
            เอกสารขายที่มาจาก{" "}
            <span className="font-semibold">Shopee, Lazada, TikTok</span> หรือ
            ลูกค้าเงินสดหน้าร้าน ระบบใช้บัญชีลูกค้าระบบกลาง (Dummy Contact) อัตโนมัติ
            เพื่อป้องกัน Master Data ขยะ — ไม่สร้างคู่ค้าใน{" "}
            <span className="font-mono text-xs">contacts</span> รายใหม่
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-violet-200/80 bg-white/80 p-3">
              <p className="font-semibold text-violet-900">บัญชีกลาง (Dummy)</p>
              <p className="mt-1 text-violet-900/75">
                ระบบ stamp Contact ID ตามช่องทาง เช่น ลูกค้า Shopee / Lazada /
                เงินสดหน้าร้าน — พนักงานไม่ต้องค้นหาหรือสร้างชื่อใน Master
              </p>
            </div>
            <div className="rounded-lg border border-violet-200/80 bg-white/80 p-3">
              <p className="font-semibold text-violet-900">ข้อมูลฝังในบิล</p>
              <p className="mt-1 text-violet-900/75">
                ชื่อผู้ซื้อจริง, เลขคำสั่งซื้อแพลตฟอร์ม และเลขพัสดุ เก็บที่หัวเอกสาร
                โดยตรง ไม่ไปปนในทะเบียนคู่ค้า
              </p>
            </div>
            <div className="rounded-lg border border-violet-200/80 bg-white/80 p-3">
              <p className="font-semibold text-violet-900">ฟิลด์บน Document Header</p>
              <ul className="mt-1 space-y-1 font-mono text-[11px] text-violet-800">
                <li>ecommerce_buyer_name</li>
                <li>ecommerce_order_no</li>
                <li>tracking_no · one_time_address</li>
                <li>sales_channel (SHOPEE / LAZADA / TIKTOK / STORE)</li>
              </ul>
            </div>
          </div>
          <p className="rounded-lg border border-violet-200/70 bg-white/70 px-3 py-2 text-violet-900/80">
            พิมพ์บิลใช้ชื่อและที่อยู่จาก Header เหล่านี้ก่อน Master Data —
            ใบกำกับภาษีเต็มรูปแบบ (<span className="font-mono">TAX_INV</span> +
            ช่องทาง STORE) ยังบังคับเลือกคู่ค้าจริงตามกฎหมาย
          </p>
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
              <li>
                ลูกค้า Shopee / Lazada / เงินสดหน้าร้าน ใช้ Dummy Contact +
                ชื่อจริงที่หัวบิล (CPD) ไม่สร้าง Master Data ใหม่
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

      <Card className="border-rose-200 bg-rose-50/30 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-rose-950">
            <Undo2 className="size-5 text-rose-700" />
            ใบสำคัญรับ/จ่ายเงินคืน และตัดหนี้สูญ (Reverse Logistics)
          </CardTitle>
          <CardDescription className="text-rose-900/75">
            แยกกระแสเงินสด (Refund) ออกจากการปิดยอดบัญชีโดยไม่มีเงินสด (Write-off)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {[
              {
                code: "AR_REFUND",
                prefix: "SRF",
                title: "ใบสำคัญจ่ายเงินคืน",
                example: "เช่น คืนมัดจำให้ลูกค้า",
                cash: "มีเงินสดจ่ายออก",
              },
              {
                code: "AP_REFUND",
                prefix: "PRF",
                title: "ใบสำคัญรับเงินคืน",
                example: "เช่น ได้รับมัดจำคืนจาก Vendor",
                cash: "มีเงินสดรับเข้า",
              },
              {
                code: "AR_WRITEOFF",
                prefix: "SWO",
                title: "ใบสำคัญตัดหนี้สูญ / ตัดเศษบัญชีลูกหนี้",
                example: "ปิดยอดเป็น PAID โดยไม่มีกระแสเงินสด",
                cash: "ไม่มีเงินสด",
              },
              {
                code: "AP_WRITEOFF",
                prefix: "PWO",
                title: "ใบสำคัญตัดเศษบัญชีเจ้าหนี้",
                example: "ปิดยอดเจ้าหนี้โดยไม่จ่ายเงินเพิ่ม",
                cash: "ไม่มีเงินสด",
              },
            ].map((item) => (
              <div
                key={item.code}
                className="rounded-xl border border-rose-200/80 bg-white/80 p-4"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge className="border-rose-200 bg-rose-50 font-mono text-rose-800 hover:bg-rose-50">
                    {item.code}
                  </Badge>
                  <Badge className="border-slate-200 bg-slate-50 font-mono text-slate-700 hover:bg-slate-50">
                    {item.prefix}
                  </Badge>
                </div>
                <p className="font-semibold text-slate-900">{item.title}</p>
                <p className="mt-1 text-sm text-slate-600">{item.example}</p>
                <p className="mt-2 text-xs font-medium text-rose-800">
                  {item.cash}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-emerald-200 bg-emerald-50/30 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-emerald-950">
            <FileSpreadsheet className="size-5 text-emerald-700" />
            ศูนย์รายงานและสมุดรายวัน (Report Center & Tax Ledger)
          </CardTitle>
          <CardDescription className="text-emerald-900/75">
            หน้า{" "}
            <span className="font-mono text-xs">/finance/tax-reports</span> —
            พรีวิวตารางแล้ว Export Excel (สิทธิ์ Admin / การเงิน / บัญชี)
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-emerald-200/80 bg-white/80 p-4 text-sm">
            <p className="font-mono text-xs font-semibold text-emerald-800">
              OUTPUT_TAX
            </p>
            <p className="mt-1 font-semibold text-slate-900">รายงานภาษีขาย</p>
            <p className="mt-2 text-slate-600">
              ดึงจากเอกสาร{" "}
              <span className="font-mono text-xs">TAX_INV, CS_TAX, ABB</span>{" "}
              ที่สถานะ ISSUED และแสดงบิล VOID (ยอด 0 บาท) เพื่อป้องกันเลขกำกับภาษีแหว่ง
            </p>
          </div>
          <div className="rounded-xl border border-emerald-200/80 bg-white/80 p-4 text-sm">
            <p className="font-mono text-xs font-semibold text-emerald-800">
              INPUT_TAX
            </p>
            <p className="mt-1 font-semibold text-slate-900">รายงานภาษีซื้อ</p>
            <p className="mt-2 text-slate-600">
              ดึงจากเอกสาร{" "}
              <span className="font-mono text-xs">AP_TAX</span> ที่สถานะ ISSUED /
              PAID สำหรับยื่นภาษีซื้อตามงวดบัญชี
            </p>
          </div>
          <div className="rounded-xl border border-emerald-200/80 bg-white/80 p-4 text-sm">
            <p className="font-mono text-xs font-semibold text-emerald-800">
              INV_DO · EXP · PAY
            </p>
            <p className="mt-1 font-semibold text-slate-900">
              ทะเบียนเอกสาร (Document Register)
            </p>
            <p className="mt-2 text-slate-600">
              Export Excel ทะเบียนคุมบิลใบส่งของ (INV_DO), บิลค่าใช้จ่าย (EXP)
              และใบสำคัญจ่าย (PAY) เพื่อการ Audit ภายใน
            </p>
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
              ["จ่ายเงินคืนลูกค้า", "AR_REFUND / SRF"],
              ["รับเงินคืนจาก Vendor", "AP_REFUND / PRF"],
              ["ตัดหนี้สูญลูกหนี้", "AR_WRITEOFF / SWO"],
              ["ตัดเศษเจ้าหนี้", "AP_WRITEOFF / PWO"],
              ["สมุดภาษีขาย / ภาษีซื้อ", "OUTPUT_TAX / INPUT_TAX"],
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
