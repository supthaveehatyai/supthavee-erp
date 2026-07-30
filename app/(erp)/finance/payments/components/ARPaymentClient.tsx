"use client";

/**
 * Phase 5 — AR Payment Client island.
 * Customer selection → URL `?contact_id=` (Server re-fetch).
 * Knock-off persist via PaymentKnockoffForm Server Action.
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { BankAccount } from "@/types/bank-account";
import type {
  AvailableDeposit,
  DebtorOption,
  UnpaidInvoice,
} from "@/types/payment";
import { OutstandingPartyCombobox } from "@/components/finance/OutstandingPartyCombobox";
import { PaymentKnockoffForm } from "@/components/finance/PaymentKnockoffForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { ArrowLeft, Eye, Wallet } from "lucide-react";

export type ARPaymentClientProps = {
  debtors: DebtorOption[];
  invoices: UnpaidInvoice[];
  availableDeposits: AvailableDeposit[];
  bankAccounts: BankAccount[];
  selectedContactId: string;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("th-TH");
}

function salesDocumentHref(docNo: string): string {
  return `/sales/${encodeURIComponent(docNo)}`;
}

export function ARPaymentClient({
  debtors,
  invoices,
  availableDeposits,
  bankAccounts,
  selectedContactId,
}: ARPaymentClientProps) {
  const router = useRouter();

  const summaryGrandTotal = useMemo(
    () => debtors.reduce((sum, row) => sum + row.outstanding_total, 0),
    [debtors],
  );

  function handleCustomerChange(contactId: string) {
    if (!contactId) {
      router.push("/finance/payments");
      return;
    }
    router.push(
      `/finance/payments?contact_id=${encodeURIComponent(contactId)}`,
    );
  }

  const selectedDebtor =
    debtors.find((d) => d.id === selectedContactId) ?? null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <Wallet className="h-8 w-8 text-blue-600" />
          รับชำระเงินและตัดยอดหนี้
        </h1>
        <p className="text-slate-500">
          เลือกลูกค้าที่มียอดค้าง เพื่อทำรายการตัดยอด (Knock-off)
          หรือบันทึกภาษีหัก ณ ที่จ่าย
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. เลือกลูกค้า (Smart Combobox)</CardTitle>
          <CardDescription>
            แสดงเฉพาะลูกหนี้ที่ยอดค้าง &gt; 0 · ผูกสถานะกับ URL (`?contact_id=`)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-xl space-y-2">
            <Label>ลูกหนี้ที่มียอดค้างชำระ</Label>
            <OutstandingPartyCombobox
              options={debtors}
              value={selectedContactId}
              onChange={handleCustomerChange}
              accent="blue"
              placeholder="ค้นหาลูกค้าที่มียอดค้างชำระ..."
              searchPlaceholder="พิมพ์ชื่อลูกค้า..."
              emptyMessage="ไม่มีลูกหนี้ค้างชำระในขณะนี้"
            />
          </div>
        </CardContent>
      </Card>

      {!selectedContactId ? (
        <Card className="border-blue-200 shadow-sm">
          <CardHeader className="bg-blue-50/50">
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-blue-600" />
              ตารางสรุปยอดหนี้รายตัว (Outstanding Summary)
            </CardTitle>
            <CardDescription>
              รวมยอดค้างทั้งหมด{" "}
              <strong className="text-blue-800">
                ฿{formatMoney(summaryGrandTotal)}
              </strong>{" "}
              จาก {debtors.length} ราย
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {debtors.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-slate-500">
                ไม่มีข้อมูลลูกหนี้ค้างชำระในระบบ
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>ชื่อลูกค้า</TableHead>
                      <TableHead className="text-center">จำนวนบิลค้าง</TableHead>
                      <TableHead className="text-right">ยอดหนี้รวม</TableHead>
                      <TableHead className="text-right">
                        ยอดเกินกำหนด
                      </TableHead>
                      <TableHead>บิลเก่าสุด</TableHead>
                      <TableHead className="text-center">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {debtors.map((debtor) => (
                      <TableRow key={debtor.id}>
                        <TableCell className="font-medium text-slate-900">
                          {debtor.name}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="slate">{debtor.invoice_count} บิล</Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold text-red-600">
                          {formatMoney(debtor.outstanding_total)}
                        </TableCell>
                        <TableCell
                          className={
                            debtor.overdue_amount > 0
                              ? "text-right font-semibold text-red-600"
                              : "text-right text-slate-400"
                          }
                        >
                          {formatMoney(debtor.overdue_amount)}
                        </TableCell>
                        <TableCell className="text-slate-600">
                          {formatDate(debtor.oldest_invoice_date ?? "")}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            type="button"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => handleCustomerChange(debtor.id)}
                          >
                            รับชำระเงิน
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-blue-200 shadow-sm">
          <CardHeader className="bg-blue-50/50">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>2. รายการบิลค้างชำระ (Knock-off)</CardTitle>
                <CardDescription>
                  {selectedDebtor
                    ? `ลูกค้า: ${selectedDebtor.name} · ตรวจสอบยอดแล้วตัดชำระด้านล่าง`
                    : "กรุณาตรวจสอบยอดหนี้ และทำการตัดชำระด้านล่าง"}
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => handleCustomerChange("")}
              >
                <ArrowLeft className="h-4 w-4" />
                กลับไปสรุป
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {invoices.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-slate-500">
                ไม่พบบิลค้างชำระสำหรับลูกค้ารายนี้
              </div>
            ) : (
              <>
                <div className="mb-6 overflow-hidden rounded-md border border-slate-200">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead>เลขที่เอกสาร</TableHead>
                        <TableHead>วันที่</TableHead>
                        <TableHead className="text-right">มูลค่าบิลเต็ม</TableHead>
                        <TableHead className="text-right">ยอดค้างสุทธิ</TableHead>
                        <TableHead className="text-center">สถานะ</TableHead>
                        <TableHead className="text-center">ดูบิล</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell>
                            <a
                              href={salesDocumentHref(inv.display_doc_no)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-blue-700 underline-offset-2 hover:underline"
                            >
                              {inv.display_doc_no}
                            </a>
                          </TableCell>
                          <TableCell>
                            {formatDate(inv.document_date)}
                          </TableCell>
                          <TableCell className="text-right text-slate-500">
                            {formatMoney(inv.net_amount_calc)}
                          </TableCell>
                          <TableCell className="text-right font-bold text-red-600">
                            {formatMoney(inv.remaining_balance)}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="amber">{inv.payment_status}</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <a
                              href={salesDocumentHref(inv.display_doc_no)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-8 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              ดูบิล
                            </a>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <PaymentKnockoffForm
                  key={[
                    ...invoices.map((inv) => inv.id),
                    ...availableDeposits.map((d) => d.id),
                  ].join("|")}
                  invoices={invoices}
                  availableDeposits={availableDeposits}
                  bankAccounts={bankAccounts}
                  contactId={selectedContactId}
                />
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
