"use client";

/**
 * AR / AP dashboard tabs — Client island for Tabs state only.
 * Data is loaded by the Server Component parent (Zero Client-Side Fetching).
 */

import Link from "next/link";
import { ArrowRight, Building2, Receipt, Users } from "lucide-react";
import type {
  AccountPayableGroup,
  AccountReceivableGroup,
} from "@/types/account-receivable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ApArDashboardProps = {
  arData: AccountReceivableGroup[];
  apData: AccountPayableGroup[];
  arError?: string | null;
  apError?: string | null;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function LedgerTable({
  rows,
  emptyLabel,
  actionHref,
  actionLabel,
}: {
  rows: AccountReceivableGroup[];
  emptyLabel: string;
  actionHref: (contactId: string) => string;
  actionLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-slate-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead>ชื่อ / บริษัท</TableHead>
            <TableHead className="text-center">จำนวนบิลค้าง</TableHead>
            <TableHead className="text-right">มูลค่าหนี้รวม</TableHead>
            <TableHead className="text-right">ชำระแล้วบางส่วน</TableHead>
            <TableHead className="text-right font-bold text-red-600">
              ยอดค้างสุทธิ
            </TableHead>
            <TableHead className="text-center">จัดการ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.contact_id}>
              <TableCell className="font-medium text-slate-900">
                {row.contact_name}
              </TableCell>
              <TableCell className="text-center">
                <Badge variant="slate" className="font-mono">
                  {row.total_invoices} บิล
                </Badge>
              </TableCell>
              <TableCell className="text-right text-slate-500">
                {formatMoney(row.total_debt)}
              </TableCell>
              <TableCell className="text-right text-slate-500">
                {formatMoney(row.total_paid)}
              </TableCell>
              <TableCell className="text-right font-bold text-red-600">
                {formatMoney(row.remaining_balance)}
              </TableCell>
              <TableCell className="text-center">
                <Link href={actionHref(row.contact_id)}>
                  <Button size="sm" className="gap-2">
                    {actionLabel} <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ApArDashboard({
  arData,
  apData,
  arError,
  apError,
}: ApArDashboardProps) {
  const arRemaining = arData.reduce(
    (sum, item) => sum + item.remaining_balance,
    0,
  );
  const apRemaining = apData.reduce(
    (sum, item) => sum + item.remaining_balance,
    0,
  );

  return (
    <Tabs defaultValue="ar" className="w-full">
      <TabsList className="grid w-full max-w-md grid-cols-2">
        <TabsTrigger value="ar">ลูกหนี้การค้า (AR)</TabsTrigger>
        <TabsTrigger value="ap">เจ้าหนี้การค้า (AP)</TabsTrigger>
      </TabsList>

      <TabsContent value="ar" className="space-y-4">
        {arError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {arError}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="border-blue-200 bg-blue-50/50">
            <CardContent className="flex items-center gap-4 p-6">
              <div className="rounded-full bg-blue-100 p-4 text-blue-700">
                <Users className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-blue-600">
                  จำนวนลูกหนี้ทั้งหมด
                </p>
                <h2 className="text-3xl font-bold text-blue-900">
                  {arData.length} ราย
                </h2>
              </div>
            </CardContent>
          </Card>
          <Card className="border-red-200 bg-red-50/50">
            <CardContent className="flex items-center gap-4 p-6">
              <div className="rounded-full bg-red-100 p-4 text-red-700">
                <Receipt className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-red-600">
                  ยอดหนี้รอเรียกเก็บสะสม
                </p>
                <h2 className="text-3xl font-bold text-red-900">
                  ฿{formatMoney(arRemaining)}
                </h2>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>รายการลูกหนี้แยกตามรายบุคคล</CardTitle>
            <CardDescription>
              ยอดใช้ `grand_total` (รวม VAT) · เรียงตามยอดค้างสูงสุด
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LedgerTable
              rows={arData}
              emptyLabel="ไม่มีข้อมูลลูกหนี้ค้างชำระในระบบ"
              actionHref={(id) =>
                `/finance/payments?contact_id=${encodeURIComponent(id)}`
              }
              actionLabel="รับชำระเงิน"
            />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="ap" className="space-y-4">
        {apError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {apError}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="border-amber-200 bg-amber-50/50">
            <CardContent className="flex items-center gap-4 p-6">
              <div className="rounded-full bg-amber-100 p-4 text-amber-800">
                <Building2 className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-amber-700">
                  จำนวนเจ้าหนี้ทั้งหมด
                </p>
                <h2 className="text-3xl font-bold text-amber-950">
                  {apData.length} ราย
                </h2>
              </div>
            </CardContent>
          </Card>
          <Card className="border-orange-200 bg-orange-50/50">
            <CardContent className="flex items-center gap-4 p-6">
              <div className="rounded-full bg-orange-100 p-4 text-orange-700">
                <Receipt className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-orange-700">
                  ยอดหนี้รอจ่ายสะสม
                </p>
                <h2 className="text-3xl font-bold text-orange-950">
                  ฿{formatMoney(apRemaining)}
                </h2>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>รายการเจ้าหนี้แยกตามผู้จำหน่าย</CardTitle>
            <CardDescription>
              เฉพาะ AP_TAX / AP_INV ที่ยัง UNPAID หรือ PARTIAL
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LedgerTable
              rows={apData}
              emptyLabel="ไม่มีข้อมูลเจ้าหนี้ค้างชำระในระบบ"
              actionHref={(id) =>
                `/finance/payments?contact_id=${encodeURIComponent(id)}`
              }
              actionLabel="ดูรายละเอียด"
            />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
