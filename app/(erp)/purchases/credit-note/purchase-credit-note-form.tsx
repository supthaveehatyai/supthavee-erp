"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { searchProductsForPurchases } from "@/lib/actions/document-actions";
import {
  getPurchaseVendor,
  listVendorApTaxBills,
  savePurchaseCreditNote,
  searchPurchaseVendors,
  uploadPurchaseCreditNoteFile,
} from "@/lib/actions/purchase-credit-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type VatMode = "INCLUSIVE" | "EXCLUSIVE" | "NONE";

type Line = {
  key: string;
  productId: string;
  sku: string;
  description: string;
  qty: string;
  uom: string;
  unitPrice: string;
  discountText: string;
};

type Vendor = { id: string; company_name: string; tax_id: string | null };
type Bill = {
  id: string;
  doc_no: string;
  doc_date: string;
  reference_no: string | null;
  grand_total: number;
};

const VAT_OPTIONS: { value: VatMode; label: string }[] = [
  { value: "EXCLUSIVE", label: "แยก VAT 7% (Exclusive)" },
  { value: "INCLUSIVE", label: "รวม VAT 7% (Inclusive)" },
  { value: "NONE", label: "ไม่คิด VAT (Non-VAT)" },
];

function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseDiscount(gross: number, text: string): number {
  const raw = text.trim();
  if (!raw) return 0;
  if (raw.endsWith("%")) {
    const rate = Number(raw.slice(0, -1));
    if (!Number.isFinite(rate) || rate < 0) return 0;
    return round2(gross * (Math.min(rate, 100) / 100));
  }
  const amount = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return round2(Math.min(amount, gross));
}

function lineMoney(line: Line, vatType: VatMode) {
  const qty = Number(line.qty);
  const price = Number(line.unitPrice);
  const gross = round2((Number.isFinite(qty) ? qty : 0) * (Number.isFinite(price) ? price : 0));
  const discount = parseDiscount(gross, line.discountText);
  const net = round2(Math.max(0, gross - discount));
  let vat = 0;
  let grand = net;
  if (vatType === "EXCLUSIVE") {
    vat = round2(net * 0.07);
    grand = round2(net + vat);
  } else if (vatType === "INCLUSIVE") {
    vat = round2(net * (7 / 107));
    grand = net;
  }
  return { gross, discount, net, vat, grand };
}

function blankLine(): Line {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    productId: "",
    sku: "",
    description: "",
    qty: "1",
    uom: "ตัว",
    unitPrice: "",
    discountText: "",
  };
}

export function PurchaseCreditNoteForm({
  initialVendorId = "",
  initialRefId = "",
}: {
  initialVendorId?: string;
  initialRefId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [vendorQuery, setVendorQuery] = useState("");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [refId, setRefId] = useState(initialRefId);
  const [referenceNo, setReferenceNo] = useState("");
  const [docDate, setDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reportMonth, setReportMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState("");
  const [returnStock, setReturnStock] = useState(true);
  const [vatType, setVatType] = useState<VatMode>("EXCLUSIVE");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [file, setFile] = useState<File | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [productHits, setProductHits] = useState<
    { id: string; sku: string; name: string; base_uom: string | null; cost_price: number | null }[]
  >([]);

  useEffect(() => {
    setReportMonth(docDate.slice(0, 7));
  }, [docDate]);

  useEffect(() => {
    if (!initialVendorId) return;
    let cancelled = false;
    void getPurchaseVendor(initialVendorId).then((result) => {
      if (cancelled || !result.data) return;
      setVendor(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [initialVendorId]);

  useEffect(() => {
    if (!vendor) {
      setBills([]);
      return;
    }
    let cancelled = false;
    void listVendorApTaxBills(vendor.id).then((result) => {
      if (cancelled) return;
      setBills(result.data);
      if (result.error) toast.error(result.error);
      const linked = result.data.find((row) => row.id === initialRefId);
      if (linked) {
        setRefId(linked.id);
        if (linked.reference_no) {
          setVendorInvoiceNo((current) => current || `${linked.reference_no} ลงวันที่ ${linked.doc_date}`);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [vendor, initialRefId]);

  const totals = useMemo(() => {
    return lines.reduce(
      (sum, line) => {
        const row = lineMoney(line, vatType);
        return {
          net: round2(sum.net + row.net),
          vat: round2(sum.vat + row.vat),
          grand: round2(sum.grand + row.grand),
        };
      },
      { net: 0, vat: 0, grand: 0 },
    );
  }, [lines, vatType]);

  function patchLine(key: string, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function onSearchVendors() {
    startTransition(async () => {
      const result = await searchPurchaseVendors(vendorQuery);
      if (result.error) toast.error(result.error);
      setVendors(result.data);
    });
  }

  function onSearchProducts() {
    startTransition(async () => {
      const result = await searchProductsForPurchases(productQuery);
      if (result.error) toast.error(result.error);
      setProductHits(
        (result.data ?? []).map((row) => ({
          id: row.id,
          sku: row.sku,
          name: row.display_name,
          base_uom: row.base_uom,
          cost_price: Number(row.cost_price ?? 0),
        })),
      );
    });
  }

  function addProduct(hit: (typeof productHits)[number]) {
    setLines((current) => {
      const empty = current.find((line) => !line.productId && !line.description);
      const next = {
        productId: hit.id,
        sku: hit.sku,
        description: hit.name,
        uom: hit.base_uom || "ตัว",
        unitPrice: hit.cost_price != null ? hit.cost_price.toFixed(2) : "",
      };
      if (empty) return current.map((line) => (line.key === empty.key ? { ...line, ...next } : line));
      return [...current, { ...blankLine(), ...next }];
    });
    setProductHits([]);
    setProductQuery("");
  }

  function onSave() {
    if (!vendor) {
      toast.error("กรุณาเลือกผู้ขาย");
      return;
    }
    startTransition(async () => {
      const saved = await savePurchaseCreditNote({
        contact_id: vendor.id,
        reference_no: referenceNo,
        doc_date: docDate,
        vat_reporting_date: reportMonth,
        ref_document_id: refId || null,
        vendor_ref_invoice_no: vendorInvoiceNo || null,
        return_stock_flag: returnStock,
        vat_type: vatType,
        lines: lines.map((line) => ({
          product_id: line.productId || null,
          description: line.description,
          qty: Number(line.qty),
          uom: line.uom,
          unit_price: Number(line.unitPrice),
          discount_text: line.discountText,
        })),
      });
      if (saved.error || !saved.data) {
        toast.error(saved.error ?? "บันทึกใบลดหนี้ซื้อไม่สำเร็จ");
        return;
      }
      if (file) {
        const body = new FormData();
        body.set("document_id", saved.data.id);
        body.set("file", file);
        const uploaded = await uploadPurchaseCreditNoteFile(body);
        if (!uploaded.success) toast.error(uploaded.error ?? "บันทึกแล้ว แต่อัปโหลดไฟล์ไม่สำเร็จ");
      }
      toast.success(`บันทึกใบลดหนี้ซื้อ ${saved.data.doc_no} แล้ว`);
      router.push(`/purchases/${encodeURIComponent(saved.data.doc_no)}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>ผู้ขาย (Vendor)</Label>
          <div className="flex gap-2">
            <Input
              value={vendor ? vendor.company_name : vendorQuery}
              placeholder="ค้นหาชื่อผู้ขาย"
              onChange={(event) => {
                setVendor(null);
                setVendorQuery(event.target.value);
              }}
            />
            <Button type="button" variant="outline" disabled={pending} onClick={onSearchVendors}>
              ค้นหา
            </Button>
          </div>
          {vendors.length > 0 && !vendor ? (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200">
              {vendors.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    setVendor(row);
                    setVendors([]);
                  }}
                >
                  {row.company_name}
                  {row.tax_id ? ` · ${row.tax_id}` : ""}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pcn-ref">เลขที่ใบลดหนี้ของผู้ขาย</Label>
          <Input id="pcn-ref" value={referenceNo} placeholder="SR6910008" onChange={(event) => setReferenceNo(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pcn-date">วันที่ออกใบลดหนี้</Label>
          <Input id="pcn-date" type="date" value={docDate} onChange={(event) => setDocDate(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pcn-month">งวดเดือนที่ยื่นภาษีซื้อ ภ.พ.30</Label>
          <Input id="pcn-month" type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pcn-bill">อ้างถึงบิลซื้อ APT ในระบบ</Label>
          <select
            id="pcn-bill"
            value={refId}
            onChange={(event) => {
              const next = event.target.value;
              setRefId(next);
              const bill = bills.find((row) => row.id === next);
              if (bill?.reference_no) {
                setVendorInvoiceNo(`${bill.reference_no} ลงวันที่ ${bill.doc_date}`);
              }
            }}
            className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
          >
            <option value="">ไม่ผูกบิลในระบบ</option>
            {bills.map((bill) => (
              <option key={bill.id} value={bill.id}>
                {bill.doc_no} · {bill.doc_date} · {money(bill.grand_total)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pcn-vendor-invoice">เลขใบกำกับภาษีเดิมของผู้ขาย</Label>
          <Input
            id="pcn-vendor-invoice"
            value={vendorInvoiceNo}
            placeholder="IV6910000456 ลงวันที่ 14/10/69"
            onChange={(event) => setVendorInvoiceNo(event.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-800 sm:col-span-2">
          <input
            type="checkbox"
            checked={returnStock}
            onChange={(event) => setReturnStock(event.target.checked)}
          />
          คืนสต็อกสินค้าจริงให้ผู้ขาย (ตัดสต็อกออก)
        </label>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pcn-file">ไฟล์ PDF/รูปภาพใบลดหนี้</Label>
          <Input
            id="pcn-file"
            type="file"
            accept="application/pdf,image/*"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1.5">
            <Label>ประเภท VAT</Label>
            <div className="flex flex-wrap gap-1.5">
              {VAT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setVatType(option.value)}
                  className={
                    vatType === option.value
                      ? "rounded-lg bg-blue-800 px-3 py-1.5 text-xs font-semibold text-white"
                      : "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex min-w-[240px] gap-2">
            <Input
              value={productQuery}
              placeholder="ค้นหา SKU / ชื่อสินค้า"
              onChange={(event) => setProductQuery(event.target.value)}
            />
            <Button type="button" variant="outline" disabled={pending} onClick={onSearchProducts}>
              เพิ่ม SKU
            </Button>
          </div>
        </div>
        {productHits.length > 0 ? (
          <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200">
            {productHits.map((hit) => (
              <button
                key={hit.id}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => addProduct(hit)}
              >
                {hit.sku} · {hit.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="px-2 py-2">รายการ</th>
                <th className="px-2 py-2">จำนวน</th>
                <th className="px-2 py-2">หน่วย</th>
                <th className="px-2 py-2">ราคา/หน่วย</th>
                <th className="px-2 py-2">ส่วนลด</th>
                <th className="px-2 py-2 text-right">หลังหักส่วนลด</th>
                <th className="px-2 py-2 text-right">VAT</th>
                <th className="px-2 py-2 text-right">ยอดลดหนี้</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const row = lineMoney(line, vatType);
                return (
                  <tr key={line.key} className="border-t border-slate-100">
                    <td className="px-2 py-2">
                      <Input
                        value={line.description}
                        placeholder="รายละเอียดสินค้า"
                        onChange={(event) => patchLine(line.key, { description: event.target.value })}
                      />
                      {line.sku ? <p className="mt-1 text-xs text-slate-500">{line.sku}</p> : null}
                    </td>
                    <td className="px-2 py-2">
                      <Input value={line.qty} onChange={(event) => patchLine(line.key, { qty: event.target.value })} />
                    </td>
                    <td className="px-2 py-2">
                      <Input value={line.uom} onChange={(event) => patchLine(line.key, { uom: event.target.value })} />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        value={line.unitPrice}
                        onChange={(event) => patchLine(line.key, { unitPrice: event.target.value })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        value={line.discountText}
                        placeholder="40% หรือ 714.75"
                        onChange={(event) => patchLine(line.key, { discountText: event.target.value })}
                      />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(row.net)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(row.vat)}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{money(row.grand)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, blankLine()])}>
          เพิ่มรายการ
        </Button>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800">
          มูลค่าหลังหักส่วนลด {money(totals.net)} ฿ · VAT {money(totals.vat)} ฿ · ยอดลดหนี้สุทธิ{" "}
          <span className="font-semibold">{money(totals.grand)} ฿</span>
        </p>
      </section>

      <div className="flex justify-end">
        <Button type="button" className="bg-blue-800 text-white hover:bg-blue-900" disabled={pending} onClick={onSave}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          ยืนยันบันทึกใบลดหนี้ซื้อ
        </Button>
      </div>
    </div>
  );
}
