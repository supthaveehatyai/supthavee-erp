import type { Metadata } from "next";
import { Suspense } from "react";
import { Package, Warehouse } from "lucide-react";
import {
  getProductStockCard,
  type ProductStockCardData,
  type StockCardMovement,
} from "@/app/actions/inventory-actions";
import { LedgerFilter } from "@/components/inventory/ledger-filter";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "บัตรสต็อก (Stock Card) | Inventory Ledger",
  description: "สมุดบัญชีคลังสินค้า — ยอดยกมาและความเคลื่อนไหวสต็อก",
};

type PageProps = {
  searchParams: Promise<{
    productId?: string;
    startDate?: string;
    endDate?: string;
  }>;
};

function formatQty(value: number): string {
  return value.toLocaleString("th-TH");
}

function formatTxnDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function productLabelFromCard(data: ProductStockCardData): string {
  const p = data.product;
  return [p.sku, p.model || p.name, p.color, p.size].filter(Boolean).join(" · ");
}

function typeBadgeClass(type: string): string {
  const t = type.toUpperCase();
  if (t === "IN") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (t === "OUT") return "bg-red-50 text-red-700 ring-red-200";
  return "bg-amber-50 text-amber-800 ring-amber-200";
}

function qtyInOut(row: StockCardMovement): { qtyIn: number | null; qtyOut: number | null } {
  const t = String(row.transaction_type).toUpperCase();
  if (t === "IN") return { qtyIn: row.quantity, qtyOut: null };
  if (t === "OUT") return { qtyIn: null, qtyOut: row.quantity };
  if (row.signed_qty > 0) return { qtyIn: Math.abs(row.signed_qty), qtyOut: null };
  if (row.signed_qty < 0) return { qtyIn: null, qtyOut: Math.abs(row.signed_qty) };
  return { qtyIn: null, qtyOut: null };
}

function StockCardTable({ data }: { data: ProductStockCardData }) {
  const { product, brought_forward, movements, closing_balance } = data;

  return (
    <div className="flex flex-col gap-4">
      {/* Product header */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Package className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-sm font-bold text-slate-900">
              {product.sku}
            </p>
            <p className="truncate text-base font-semibold text-slate-800">
              {product.model || product.name}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-700">
                สี: {product.color || "—"}
              </span>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-700">
                ไซส์: {product.size || "—"}
              </span>
              {product.name && product.model ? (
                <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-700">
                  ชื่อ: {product.name}
                </span>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">ยอดคงเหลือปลายงวด</p>
            <p className="text-2xl font-bold tabular-nums text-slate-900">
              {formatQty(closing_balance)}
            </p>
          </div>
        </div>
      </div>

      {/* Ledger table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
              <TableHead className="w-[7.5rem]">วันที่</TableHead>
              <TableHead>เลขที่เอกสารอ้างอิง</TableHead>
              <TableHead className="w-[6.5rem] text-center">ประเภท</TableHead>
              <TableHead className="w-[6rem] text-right">จำนวนรับ</TableHead>
              <TableHead className="w-[6rem] text-right">จำนวนจ่าย</TableHead>
              <TableHead className="w-[7rem] text-right">ยอดคงเหลือ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-slate-50/50">
              <TableCell className="text-slate-400">—</TableCell>
              <TableCell className="font-semibold text-slate-800">
                ยอดยกมา (Brought Forward)
              </TableCell>
              <TableCell />
              <TableCell />
              <TableCell />
              <TableCell className="text-right font-bold tabular-nums text-slate-900">
                {formatQty(brought_forward)}
              </TableCell>
            </TableRow>

            {movements.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-sm text-slate-500"
                >
                  ไม่มีความเคลื่อนไหวในช่วงวันที่ที่เลือก
                </TableCell>
              </TableRow>
            ) : (
              movements.map((row) => {
                const { qtyIn, qtyOut } = qtyInOut(row);
                const type = String(row.transaction_type).toUpperCase();
                return (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap tabular-nums text-slate-700">
                      {formatTxnDate(row.transaction_date)}
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium text-slate-800">
                      {row.document_no || "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={cn(
                          "inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset",
                          typeBadgeClass(type),
                        )}
                      >
                        {type}
                      </span>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        qtyIn != null
                          ? "font-semibold text-emerald-600"
                          : "text-slate-300",
                      )}
                    >
                      {qtyIn != null ? formatQty(qtyIn) : "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        qtyOut != null
                          ? "font-semibold text-red-600"
                          : "text-slate-300",
                      )}
                    >
                      {qtyOut != null ? formatQty(qtyOut) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-slate-900">
                      {formatQty(row.running_balance)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5} className="text-right font-semibold">
                ยอดคงเหลือปลายงวด
              </TableCell>
              <TableCell className="text-right text-base font-bold tabular-nums">
                {formatQty(closing_balance)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}

export default async function InventoryLedgerPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const productId = params.productId?.trim() ?? "";
  const startDate = params.startDate?.trim() ?? "";
  const endDate = params.endDate?.trim() ?? "";

  const result = productId
    ? await getProductStockCard(
        productId,
        startDate || undefined,
        endDate || undefined,
      )
    : null;

  const productLabel =
    result?.success && result.data
      ? productLabelFromCard(result.data)
      : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <Warehouse className="h-8 w-8 text-blue-600" />
          บัตรสต็อก (Stock Card)
        </h1>
        <p className="text-sm text-slate-500">
          สมุดบัญชีคลังสินค้า — ยอดยกมา · รับเข้า · จ่ายออก · ยอดคงเหลือรายบรรทัด
        </p>
      </div>

      <Suspense
        fallback={
          <div className="h-28 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
        }
      >
        <LedgerFilter
          productId={productId}
          productLabel={productLabel}
          startDate={startDate}
          endDate={endDate}
        />
      </Suspense>

      {!productId ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <Package className="h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">
            ยังไม่ได้เลือกสินค้า
          </p>
          <p className="max-w-md text-xs text-slate-500">
            ใช้ช่องค้นหาด้านบนเพื่อเลือกสินค้า แล้วระบบจะโหลดความเคลื่อนไหวสต็อกจาก
            Inventory Ledger ให้ทันที
          </p>
        </div>
      ) : null}

      {productId && result && !result.success ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {result.error}
        </div>
      ) : null}

      {productId && result?.success ? (
        <StockCardTable data={result.data} />
      ) : null}
    </div>
  );
}
