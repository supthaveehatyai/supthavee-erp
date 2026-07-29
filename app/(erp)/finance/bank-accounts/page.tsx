import {
  getBankAccounts,
  createBankAccount,
  toggleBankAccountStatus,
} from "@/lib/actions/bank-accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Building2 } from "lucide-react";

/** บังคับไม่ให้ Next.js cache ข้อมูลหน้าบัญชี */
export const dynamic = "force-dynamic";

export default async function BankAccountsPage() {
  const { data: bankAccounts, error } = await getBankAccounts();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <Building2 className="h-8 w-8 text-blue-600" />
          สมุดบัญชีบริษัท (Bank Accounts)
        </h1>
        <p className="text-slate-500">
          เพิ่มและจัดการบัญชีธนาคารของบริษัท ทรัพย์ทวี
          เพื่อรองรับการโอนเงินชำระหนี้จากลูกค้า
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* คอลัมน์ซ้าย: ฟอร์มเพิ่มบัญชี */}
        <Card className="col-span-1 h-fit">
          <CardHeader>
            <CardTitle>เพิ่มบัญชีธนาคาร</CardTitle>
            <CardDescription>ระบุข้อมูลบัญชีให้ครบถ้วน</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createBankAccount} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bank_name">
                  ธนาคาร (เช่น KBANK){" "}
                  <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="bank_name"
                  name="bank_name"
                  placeholder="เช่น กสิกรไทย"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account_no">
                  เลขที่บัญชี <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="account_no"
                  name="account_no"
                  placeholder="xxx-x-xxxxx-x"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account_name">
                  ชื่อบัญชี <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="account_name"
                  name="account_name"
                  placeholder="บจก. ทรัพย์ทวี หาดใหญ่"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch_name">สาขา (ถ้ามี)</Label>
                <Input
                  id="branch_name"
                  name="branch_name"
                  placeholder="เช่น สาขาหาดใหญ่"
                />
              </div>
              <Button type="submit" className="mt-4 w-full">
                บันทึกบัญชี
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* คอลัมน์ขวา: ตารางแสดงบัญชีทั้งหมด */}
        <Card className="col-span-1 md:col-span-2">
          <CardHeader>
            <CardTitle>รายการบัญชีทั้งหมด</CardTitle>
          </CardHeader>
          <CardContent>
            {bankAccounts.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/80 py-12 text-center text-slate-500">
                ยังไม่มีข้อมูลบัญชีธนาคารในระบบ
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>ธนาคาร</TableHead>
                      <TableHead>เลขที่บัญชี</TableHead>
                      <TableHead>ชื่อบัญชี</TableHead>
                      <TableHead className="text-center">สถานะ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bankAccounts.map((account) => (
                      <TableRow
                        key={account.id}
                        className={
                          !account.is_active
                            ? "bg-slate-50/50 opacity-50"
                            : undefined
                        }
                      >
                        <TableCell className="font-medium text-slate-900">
                          {account.bank_name}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {account.account_no}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span>{account.account_name}</span>
                            {account.branch_name ? (
                              <span className="text-xs text-slate-500">
                                สาขา: {account.branch_name}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={
                              account.is_active ? "emerald" : "slate"
                            }
                          >
                            {account.is_active
                              ? "ใช้งาน"
                              : "ระงับชั่วคราว"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <form
                            action={toggleBankAccountStatus.bind(
                              null,
                              account.id,
                              account.is_active ?? false,
                            )}
                          >
                            <Button
                              type="submit"
                              variant={
                                account.is_active ? "destructive" : "outline"
                              }
                              size="sm"
                            >
                              {account.is_active
                                ? "ปิดการใช้งาน"
                                : "เปิดการใช้งาน"}
                            </Button>
                          </form>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
