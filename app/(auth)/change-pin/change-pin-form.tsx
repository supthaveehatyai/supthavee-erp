"use client";

import { useState, useTransition } from "react";
import { changeOwnPin } from "@/lib/actions/auth.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChangePinForm() {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        start(async () => {
          const saved = await changeOwnPin(pin, confirm);
          if (saved && !saved.success) setError(saved.error);
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="new-pin">รหัส PIN 6 หลักใหม่</Label>
        <Input id="new-pin" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-pin">ยืนยันรหัส PIN 6 หลักใหม่</Label>
        <Input id="confirm-pin" type="password" inputMode="numeric" maxLength={6} value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
      </div>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <Button type="submit" disabled={pending} className="w-full">{pending ? "กำลังบันทึก..." : "บันทึกรหัสและเข้าใช้งาน"}</Button>
    </form>
  );
}
