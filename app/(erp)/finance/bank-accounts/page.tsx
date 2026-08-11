import {
  getBankAccounts,
  createBankAccount,
  toggleBankAccountStatus,
} from "@/lib/actions/bank-accounts";
import type { BankAccount } from "@/types/bank-account";
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
import { Building2, Landmark } from "lucide-react";

/** บังคับไม่ให้ Next.js cache ข้อมูลหน้าบัญชี */
export const dynamic = "force-dynamic";

async function loadBankAccounts(): Promise<{
  accounts: BankAccount[];
  error: string | null;
}> {
  try {
    const result = await getBankAccounts();
    const accounts = Array.isArray(result?.data) ? result.data : [];
    return { accounts, error: result?.error ?? null };
  } catch (err) {
    return {
      accounts: [],
      error:
        err instanceof Error
          ? err.message
          : "ไม่สามารถดึงข้อมูลสมุดบัญชีได้",
    };
  }
}

export default async function BankAccountsPage() {
  const { accounts: bankAccounts, error } = await loadBankAccounts();
  const hasAccounts = Boolean(bankAccounts?.length);

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
            <form
              action={async (formData) => {
                await createBankAccount(formData);
              }}
              className="space-y-4"
            >
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
            {!hasAccounts ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-14 text-center">
                <Landmark className="h-10 w-10 text-slate-300" />
                <p className="text-sm font-semibold text-slate-700">
                  ยังไม่มีบัญชีธนาคาร
                </p>
                <p className="max-w-sm text-sm text-slate-500">
                  ให้กดเพิ่มบัญชีทางซ้าย เพื่อเริ่มรับโอนเงินและตัดชำระหนี้
                </p>
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
                    {bankAccounts?.map((account) => {
                      if (!account?.id) return null;
                      const isActive = Boolean(account.is_active);
                      return (
                        <TableRow
                          key={account.id}
                          className={
                            !isActive ? "bg-slate-50/50 opacity-50" : undefined
                          }
                        >
                          <TableCell className="font-medium text-slate-900">
                            {account.bank_name ?? "—"}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {account.account_no ?? "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span>{account.account_name ?? "—"}</span>
                              {account.branch_name ? (
                                <span className="text-xs text-slate-500">
                                  สาขา: {account.branch_name}
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant={isActive ? "emerald" : "slate"}>
                              {isActive ? "ใช้งาน" : "ระงับชั่วคราว"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <form
                              action={async (_formData) => {
                                await toggleBankAccountStatus(
                                  account.id,
                                  isActive,
                                );
                              }}
                            >
                              <Button
                                type="submit"
                                variant={isActive ? "destructive" : "outline"}
                                size="sm"
                              >
                                {isActive ? "ปิดการใช้งาน" : "เปิดการใช้งาน"}
                              </Button>
                            </form>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
