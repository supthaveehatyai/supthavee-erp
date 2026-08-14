"use client";

/**
 * Login form — submits to signInWithPin Server Action only.
 * Loading via useTransition (no client-side Supabase).
 */

import { useState, useTransition } from "react";
import { Loader2, LockKeyhole, Mail } from "lucide-react";
import { signInWithPin } from "@/lib/actions/auth.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await signInWithPin(
        email.trim().toLowerCase(),
        String(pin).trim(),
      );
      // Successful login redirects — result only returns on failure.
      if (result && !result.success) {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="login-email">อีเมล (Email)</Label>
        <div className="relative">
          <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            id="login-email"
            name="email"
            type="email"
            autoComplete="username"
            required
            disabled={isPending}
            placeholder="name@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-11 pl-10"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="login-pin">รหัสผ่าน (PIN 6 หลัก)</Label>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            id="login-pin"
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            required
            disabled={isPending}
            placeholder="••••••"
            maxLength={6}
            pattern="\d{6}"
            value={pin}
            onChange={(event) => {
              const next = event.target.value.replace(/\D/g, "").slice(0, 6);
              setPin(next);
            }}
            className="h-11 pl-10 tracking-[0.35em]"
          />
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      <Button
        type="submit"
        disabled={isPending || pin.length !== 6}
        className="h-11 w-full gap-2 text-sm font-semibold"
      >
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            กำลังตรวจสอบรหัส...
          </>
        ) : (
          "เข้าสู่ระบบ"
        )}
      </Button>
    </form>
  );
}
