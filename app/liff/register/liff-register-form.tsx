"use client";

import { useState, useTransition } from "react";
import { submitLiffRegistrationAction } from "@/lib/actions/holding-entities";
import { WORKSPACE_THEMES, type WorkspaceKey } from "@/types/holding";
import { Button } from "@/components/ui/button";

const WORKSPACES: WorkspaceKey[] = ["fnb", "agri", "prop", "holding"];

export function LiffRegisterForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="mx-auto max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await submitLiffRegistrationAction(formData);
          setMessage(result.error ?? "ส่งคำขอแล้ว รอผู้ดูแลอนุมัติ");
        });
      }}
    >
      <h1 className="text-xl font-bold text-slate-900">ขอสิทธิ์เข้าใช้งาน</h1>
      <input name="display_name" placeholder="ชื่อที่แสดง" className="h-11 w-full rounded border border-slate-200 px-3" />
      <input name="line_user_id" required placeholder="LINE user id" className="h-11 w-full rounded border border-slate-200 px-3" />
      <input name="channel_code" required placeholder="รหัสช่อง เช่น fnb" className="h-11 w-full rounded border border-slate-200 px-3" />
      <select name="workspace_key" className="h-11 w-full rounded border border-slate-200 px-3">
        {WORKSPACES.map((key) => <option key={key} value={key}>{WORKSPACE_THEMES[key].label}</option>)}
      </select>
      <Button type="submit" className="w-full" disabled={pending}>ส่งคำขอ</Button>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
    </form>
  );
}
