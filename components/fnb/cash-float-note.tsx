"use client";

import { useEffect, useState } from "react";
import { getCashFloatContextAction } from "@/lib/actions/fnb-sop";

export function CashFloatNote({
  branch,
  workDate,
  shiftType,
  counted,
  cashPos,
}: {
  branch: string;
  workDate: string;
  shiftType: "MORNING" | "AFTERNOON" | "SHIFT_3";
  counted: number;
  cashPos: number;
}) {
  const [floatAmount, setFloatAmount] = useState(0);
  const [held, setHeld] = useState(0);
  useEffect(() => {
    void getCashFloatContextAction(branch, workDate, shiftType).then((loaded) => {
      setFloatAmount(loaded.data.standard_cash_float);
      setHeld(loaded.data.prev_shift_held_cash);
    });
  }, [branch, workDate, shiftType]);
  const net = counted - floatAmount;
  const expected = cashPos + held;
  return (
    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-950">
      <p>วงเงินทอนประจำเก๊ะ {floatAmount.toFixed(2)} บาท{floatAmount <= 0 ? " (ไม่บังคับยอดคงที่ บันทึกยอดนับจริง)" : ""}</p>
      <p>เงินสดขายยกมาจากกะก่อนหน้า {held.toFixed(2)} บาท</p>
      <p>เงินสดนับรวมในเก๊ะ {counted.toFixed(2)} − เงินทอนเก็บติดเก๊ะ {floatAmount.toFixed(2)} = เงินสดสุทธิสำหรับส่งกะ/นำฝาก {net.toFixed(2)}</p>
      <p>เงินสดตาม POS รวมยอดยกมากะก่อน {expected.toFixed(2)}</p>
    </div>
  );
}
