import {
  getDebtorsList,
  getUnpaidInvoicesByCustomer,
} from "@/lib/actions/finance/payment";
import { getBankAccounts } from "@/lib/actions/bank-accounts";
import { PaymentKnockoffForm } from "@/components/finance/PaymentKnockoffForm";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Wallet, Search } from "lucide-react";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type PaymentsPageProps = {
  searchParams: Promise<{ contact_id?: string }>;
};

export default async function PaymentsPage({ searchParams }: PaymentsPageProps) {
  const params = await searchParams;
  const selectedContactId = params.contact_id?.trim() || "";

  const [debtors, bankAccountsResult, unpaidInvoices] = await Promise.all([
    getDebtorsList(),
    getBankAccounts(),
    getUnpaidInvoicesByCustomer(selectedContactId),
  ]);

  const bankAccounts = bankAccountsResult.data ?? [];

  async function selectCustomer(formData: FormData) {
    "use server";
    const contactId = String(formData.get("contact_id") ?? "").trim();
    if (!contactId) {
      redirect("/finance/payments");
    }
    redirect(`/finance/payments?contact_id=${encodeURIComponent(contactId)}`);
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <Wallet className="h-8 w-8 text-blue-600" />
          รับชำระเงินและตัดยอดหนี้
        </h1>
        <p className="text-slate-500">
          เลือกลูกค้าเพื่อดูบิลที่ค้างชำระ และทำรายการตัดยอด (Knock-off)
          หรือบันทึกภาษีหัก ณ ที่จ่าย
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. เลือกลูกค้า (Select Customer)</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={selectCustomer}
            className="flex max-w-xl items-end gap-4"
          >
            <div className="flex-1 space-y-2">
              <Label htmlFor="contact_id">ลูกหนี้ที่มียอดค้างชำระ</Label>
              <select
                id="contact_id"
                name="contact_id"
                defaultValue={selectedContactId}
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20"
                required
              >
                <option value="">-- ค้นหาและเลือกลูกค้า --</option>
                {debtors.length === 0 ? (
                  <option value="" disabled>
                    ไม่มีลูกหนี้ค้างชำระในขณะนี้
                  </option>
                ) : (
                  debtors.map((debtor) => (
                    <option key={debtor.id} value={debtor.id}>
                      {debtor.name}
                    </option>
                  ))
                )}
              </select>
            </div>
            <Button type="submit" variant="secondary" className="gap-2">
              <Search className="h-4 w-4" /> ค้นหาบิล
            </Button>
          </form>
        </CardContent>
      </Card>

      {selectedContactId ? (
        <Card className="border-blue-200 shadow-sm">
          <CardHeader className="bg-blue-50/50">
            <CardTitle>2. รายการบิลค้างชำระ</CardTitle>
            <CardDescription>
              กรุณาตรวจสอบยอดหนี้ และทำการตัดชำระด้านล่าง
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {unpaidInvoices.length === 0 ? (
              <div className="py-8 text-center text-slate-500">
                ไม่พบบิลค้างชำระสำหรับลูกค้ารายนี้
              </div>
            ) : (
              <div className="mb-6 overflow-hidden rounded-md border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>เลขที่เอกสาร</TableHead>
                      <TableHead>วันที่</TableHead>
                      <TableHead className="text-right">มูลค่าบิลเต็ม</TableHead>
                      <TableHead className="text-right">ยอดค้างสุทธิ</TableHead>
                      <TableHead className="text-center">สถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unpaidInvoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">
                          {inv.display_doc_no}
                        </TableCell>
                        <TableCell>
                          {inv.document_date
                            ? new Date(inv.document_date).toLocaleDateString(
                                "th-TH",
                              )
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right text-slate-500">
                          {inv.net_amount_calc.toLocaleString("th-TH", {
                            minimumFractionDigits: 2,
                          })}
                        </TableCell>
                        <TableCell className="text-right font-bold text-red-600">
                          {inv.remaining_balance.toLocaleString("th-TH", {
                            minimumFractionDigits: 2,
                          })}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="amber">{inv.payment_status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {unpaidInvoices.length > 0 ? (
              <PaymentKnockoffForm
                key={unpaidInvoices.map((inv) => inv.id).join("|")}
                invoices={unpaidInvoices}
                bankAccounts={bankAccounts}
                contactId={selectedContactId}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
