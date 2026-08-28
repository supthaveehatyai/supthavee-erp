"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  createWhtRate,
  setWhtRateActive,
} from "@/lib/actions/wht-rate-actions";
import type { MstWhtRate } from "@/types/wht-rate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type WhtRatesTableProps = {
  rows: MstWhtRate[];
  isAdmin: boolean;
};

function formatRatePercent(rate: number): string {
  const rounded = Math.round((rate + Number.EPSILON) * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/\.?0+$/, "");
}

export function WhtRatesTable({ rows, isAdmin }: WhtRatesTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState("3");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  function handleCreate() {
    if (!isAdmin) {
      toast.error("เฉพาะ Admin เท่านั้นที่เพิ่มรายการได้");
      return;
    }

    const rate = Number(newRate);
    startTransition(async () => {
      const result = await createWhtRate(newName, rate);
      if (!result.success) {
        toast.error(result.error ?? "เพิ่มรายการไม่สำเร็จ");
        return;
      }
      toast.success("เพิ่มอัตราหัก ณ ที่จ่ายสำเร็จ");
      setNewName("");
      setNewRate("3");
      router.refresh();
    });
  }

  function handleToggle(row: MstWhtRate) {
    if (!isAdmin) {
      toast.error("เฉพาะ Admin เท่านั้นที่แก้ไขสถานะได้");
      return;
    }

    setTogglingId(row.id);
    startTransition(async () => {
      const result = await setWhtRateActive(row.id, !row.is_active);
      setTogglingId(null);
      if (!result.success) {
        toast.error(result.error ?? "อัปเดตสถานะไม่สำเร็จ");
        return;
      }
      toast.success(
        result.data?.is_active
          ? `เปิดใช้งาน "${row.wht_name}" แล้ว`
          : `ปิดใช้งาน "${row.wht_name}" แล้ว`,
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">อัตราหัก ณ ที่จ่าย (WHT Master)</CardTitle>
        <CardDescription>
          รายการที่เปิดใช้งานจะแสดงใน Dropdown ฟอร์มค่าใช้จ่าย — จัดการผ่าน
          Server Actions (Zero Client-Side Fetching)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ชื่อประเภท</TableHead>
                <TableHead className="text-right">อัตรา (%)</TableHead>
                <TableHead className="text-center">สถานะ</TableHead>
                {isAdmin ? (
                  <TableHead className="text-right">การจัดการ</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={isAdmin ? 4 : 3}
                    className="text-center text-sm text-slate-500"
                  >
                    ยังไม่มีรายการ — เพิ่มอัตราหัก ณ ที่จ่ายด้านล่าง
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.wht_name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRatePercent(row.wht_rate)}%
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={row.is_active ? "emerald" : "slate"}>
                        {row.is_active ? "ใช้งาน" : "ปิด"}
                      </Badge>
                    </TableCell>
                    {isAdmin ? (
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isPending && togglingId === row.id}
                          onClick={() => handleToggle(row)}
                        >
                          {isPending && togglingId === row.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : row.is_active ? (
                            "ปิดใช้งาน"
                          ) : (
                            "เปิดใช้งาน"
                          )}
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {isAdmin ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <p className="mb-3 text-sm font-semibold text-slate-800">
              เพิ่มประเภทหัก ณ ที่จ่าย
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px_auto] sm:items-end">
              <div>
                <Label htmlFor="wht_new_name">ชื่อประเภท</Label>
                <Input
                  id="wht_new_name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="เช่น ค่าขนส่ง"
                  disabled={isPending}
                />
              </div>
              <div>
                <Label htmlFor="wht_new_rate">อัตรา (%)</Label>
                <Input
                  id="wht_new_rate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={newRate}
                  onChange={(e) => setNewRate(e.target.value)}
                  disabled={isPending}
                />
              </div>
              <Button
                type="button"
                onClick={handleCreate}
                disabled={isPending || !newName.trim()}
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                เพิ่ม
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            เฉพาะผู้ใช้สิทธิ์ Admin เท่านั้นที่เพิ่มหรือปิดสถานะรายการได้
          </p>
        )}
      </CardContent>
    </Card>
  );
}
