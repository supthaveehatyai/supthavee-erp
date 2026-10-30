"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  deleteOrToggleContactBankAccountAction,
  getContactBankAccountsAction,
  upsertContactBankAccountAction,
} from "@/app/actions/finance/contact-bank-accounts";
import {
  accountDigits,
  contactBankCategoryMeta,
  VENDOR_BANK_OPTIONS,
  vendorBankName,
} from "@/lib/finance/vendor-banks";
import type {
  ContactBankAccount,
  ContactBankCategory,
} from "@/types/contact-bank-account";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ContactBankAccountsPanelProps = {
  contactId: string;
  contactName: string;
  layout: "profile" | "billing" | "payment";
  preferredCategory?: "CORPORATE_TAX" | "PERSONAL_NON_TAX" | null;
};

type FormState = {
  accountId: string | null;
  accountCategory: ContactBankCategory;
  bankCode: string;
  accountNo: string;
  accountName: string;
  branchName: string;
  notes: string;
  isDefault: boolean;
  isActive: boolean;
};

function emptyForm(contactName: string): FormState {
  return {
    accountId: null,
    accountCategory: "CORPORATE_TAX",
    bankCode: "KBANK",
    accountNo: "",
    accountName: contactName,
    branchName: "",
    notes: "",
    isDefault: true,
    isActive: true,
  };
}

function formFromAccount(account: ContactBankAccount): FormState {
  return {
    accountId: account.id,
    accountCategory: account.account_category,
    bankCode: account.bank_code || "KBANK",
    accountNo: account.account_no,
    accountName: account.account_name,
    branchName: account.branch_name ?? "",
    notes: account.notes ?? "",
    isDefault: account.is_default,
    isActive: account.is_active,
  };
}

async function copyText(value: string, success: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(success);
  } catch {
    toast.error("คัดลอกไม่สำเร็จ");
  }
}

export function ContactBankAccountsPanel({
  contactId,
  contactName,
  layout,
  preferredCategory = null,
}: ContactBankAccountsPanelProps) {
  const [accounts, setAccounts] = useState<ContactBankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(contactName));
  const [saving, setSaving] = useState(false);

  async function reload() {
    setLoading(true);
    const result = await getContactBankAccountsAction(contactId);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      setAccounts([]);
      return;
    }
    setError("");
    setAccounts(result.data);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getContactBankAccountsAction(contactId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.error) {
        setError(result.error);
        setAccounts([]);
        return;
      }
      setError("");
      setAccounts(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const rows = useMemo(() => {
    if (layout !== "payment" || !preferredCategory) return accounts;
    const rank = (account: ContactBankAccount) => {
      if (!account.is_active) return 3;
      if (account.account_category === preferredCategory && account.is_default) return 0;
      if (account.account_category === preferredCategory) return 1;
      return 2;
    };
    return [...accounts].sort((left, right) => rank(left) - rank(right));
  }, [accounts, layout, preferredCategory]);

  function openCreate() {
    setForm(emptyForm(contactName));
    setEditorOpen(true);
  }

  function openEdit(account: ContactBankAccount) {
    setForm(formFromAccount(account));
    setEditorOpen(true);
  }

  function setCategory(category: ContactBankCategory) {
    setForm((current) => {
      if (category === "PROMPTPAY") {
        return { ...current, accountCategory: category, bankCode: "PROMPTPAY" };
      }
      return {
        ...current,
        accountCategory: category,
        bankCode: current.bankCode === "PROMPTPAY" ? "KBANK" : current.bankCode,
      };
    });
  }

  async function save() {
    setSaving(true);
    try {
      const bankName =
        form.accountCategory === "PROMPTPAY" ? "พร้อมเพย์" : vendorBankName(form.bankCode);
      const result = await upsertContactBankAccountAction({
        contactId,
        accountId: form.accountId,
        accountCategory: form.accountCategory,
        bankCode: form.accountCategory === "PROMPTPAY" ? "PROMPTPAY" : form.bankCode,
        bankName,
        accountNo: form.accountNo,
        accountName: form.accountName,
        branchName: form.branchName,
        notes: form.notes,
        isDefault: form.isDefault,
        isActive: form.isActive,
      });
      if (!result.success) {
        toast.error(result.error ?? "บันทึกบัญชีไม่สำเร็จ");
        return;
      }
      toast.success(form.accountId ? "แก้ไขบัญชีรับเงินแล้ว" : "เพิ่มบัญชีรับเงินแล้ว");
      setEditorOpen(false);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function toggleAccount(account: ContactBankAccount) {
    const result = await deleteOrToggleContactBankAccountAction(account.id, "TOGGLE_ACTIVE");
    if (!result.success) {
      toast.error(result.error ?? "เปลี่ยนสถานะบัญชีไม่สำเร็จ");
      return;
    }
    toast.success(account.is_active ? "พักใช้งานบัญชีนี้แล้ว" : "เปิดใช้งานบัญชีนี้แล้ว");
    await reload();
  }

  async function removeAccount(account: ContactBankAccount) {
    const confirmed = window.confirm(
      `ลบบัญชี ${account.bank_name} ${account.account_no} ของ ${contactName} ?`,
    );
    if (!confirmed) return;
    const result = await deleteOrToggleContactBankAccountAction(account.id, "DELETE");
    if (!result.success) {
      toast.error(result.error ?? "ลบบัญชีไม่สำเร็จ");
      return;
    }
    toast.success("ลบบัญชีรับเงินแล้ว");
    await reload();
  }

  const title =
    layout === "billing"
      ? `🏦 บัญชีรับโอนของคู่ค้า (${contactName})`
      : layout === "payment"
        ? "🏦 โอนเข้าบัญชีคู่ค้า (Vendor Receiving Account)"
        : "🏦 บัญชีธนาคารสำหรับโอนเงิน (Vendor Bank Accounts)";

  const suggestion =
    preferredCategory === "CORPORATE_TAX"
      ? "บิลที่เลือกมีภาษี (AP_TAX) — แนะนำบัญชีบริษัทที่ออกใบกำกับภาษี"
      : preferredCategory === "PERSONAL_NON_TAX"
        ? "บิลที่เลือกไม่มีภาษี (AP_INV / TB) — แนะนำบัญชีบุคคลธรรมดา"
        : null;

  const editor = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1 sm:col-span-2">
        <Label>ประเภทบัญชี</Label>
        <select
          value={form.accountCategory}
          onChange={(event) => setCategory(event.target.value as ContactBankCategory)}
          className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
        >
          <option value="CORPORATE_TAX">บริษัท (มี VAT / ออกใบกำกับภาษี)</option>
          <option value="PERSONAL_NON_TAX">บุคคลธรรมดา (ไม่มี VAT / โอนส่วนตัว)</option>
          <option value="PROMPTPAY">พร้อมเพย์ (PromptPay)</option>
          {form.accountCategory === "OTHER" ? <option value="OTHER">บัญชีอื่น</option> : null}
        </select>
      </div>
      <div className="space-y-1">
        <Label>ธนาคาร</Label>
        <select
          value={form.accountCategory === "PROMPTPAY" ? "PROMPTPAY" : form.bankCode}
          disabled={form.accountCategory === "PROMPTPAY"}
          onChange={(event) => setForm((current) => ({ ...current, bankCode: event.target.value }))}
          className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-50"
        >
          {VENDOR_BANK_OPTIONS.filter((bank) =>
            form.accountCategory === "PROMPTPAY" ? bank.code === "PROMPTPAY" : bank.code !== "PROMPTPAY",
          ).map((bank) => (
            <option key={bank.code} value={bank.code}>
              {bank.name}
            </option>
          ))}
          {!VENDOR_BANK_OPTIONS.some((bank) => bank.code === form.bankCode) ? (
            <option value={form.bankCode}>{form.bankCode}</option>
          ) : null}
        </select>
      </div>
      <div className="space-y-1">
        <Label>{form.accountCategory === "PROMPTPAY" ? "เลขพร้อมเพย์" : "เลขที่บัญชี"}</Label>
        <Input
          value={form.accountNo}
          onChange={(event) => setForm((current) => ({ ...current, accountNo: event.target.value }))}
          placeholder={form.accountCategory === "PROMPTPAY" ? "เบอร์โทรหรือเลขประจำตัว" : "1234567890"}
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label>ชื่อบัญชี</Label>
        <Input
          value={form.accountName}
          onChange={(event) => setForm((current) => ({ ...current, accountName: event.target.value }))}
        />
      </div>
      <div className="space-y-1">
        <Label>สาขา</Label>
        <Input
          value={form.branchName}
          onChange={(event) => setForm((current) => ({ ...current, branchName: event.target.value }))}
        />
      </div>
      <div className="space-y-1">
        <Label>หมายเหตุ</Label>
        <Input
          value={form.notes}
          onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={(event) => setForm((current) => ({ ...current, isDefault: event.target.checked }))}
        />
        ใช้เป็นบัญชีหลักของประเภทนี้
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
        />
        เปิดใช้งาน
      </label>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="outline" onClick={() => setEditorOpen(false)} disabled={saving}>
          ยกเลิก
        </Button>
        <Button type="button" onClick={() => void save()} disabled={saving || !form.accountNo.trim()}>
          {saving ? "กำลังบันทึก..." : "บันทึกบัญชี"}
        </Button>
      </div>
    </div>
  );

  return (
    <section
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault();
      }}
      className={
        layout === "profile"
          ? "rounded-xl border border-slate-200 bg-white p-4"
          : "rounded-xl border border-emerald-200 bg-emerald-50/40 p-3"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {suggestion ? <p className="mt-1 text-xs font-medium text-emerald-800">{suggestion}</p> : null}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={openCreate}>
          {layout === "profile" ? "+ เพิ่มบัญชีธนาคาร" : "+ เพิ่ม / แก้ไขบัญชีคู่ค้า"}
        </Button>
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-slate-500">กำลังโหลดบัญชีรับเงิน...</p>
      ) : error ? (
        <p className="mt-3 text-xs text-red-700">{error}</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          ยังไม่มีบัญชีรับเงินของคู่ค้ารายนี้ กรอกครั้งเดียว ระบบจะจำไว้ใช้ทุกครั้งที่โอน
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((account) => {
            const meta = contactBankCategoryMeta(account.account_category);
            const suggested =
              layout === "payment" &&
              account.is_active &&
              preferredCategory != null &&
              account.account_category === preferredCategory;
            return (
              <article
                key={account.id}
                className={`rounded-lg border bg-white px-3 py-2 ${
                  suggested ? "border-emerald-400 ring-2 ring-emerald-200" : "border-slate-200"
                } ${account.is_active ? "" : "opacity-60"}`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${meta.className}`}>
                    {meta.label}
                  </span>
                  {account.is_default ? (
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                      บัญชีหลัก
                    </span>
                  ) : null}
                  {suggested ? (
                    <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                      แนะนำตามประเภทบิล
                    </span>
                  ) : null}
                  {!account.is_active ? (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                      พักใช้งาน
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {account.bank_name}
                  <span className="ml-2 font-mono text-base tracking-wide">{account.account_no}</span>
                </p>
                <p className="text-xs text-slate-600">
                  {account.account_name || "—"}
                  {account.branch_name ? ` · สาขา ${account.branch_name}` : ""}
                  {account.notes ? ` · ${account.notes}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      void copyText(accountDigits(account.account_no), "คัดลอกเลขบัญชีแล้ว วางในแอปธนาคารได้ทันที")
                    }
                  >
                    📋 คัดลอกเลขบัญชี
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      void copyText(
                        [
                          account.bank_name,
                          `เลขที่บัญชี ${accountDigits(account.account_no)}`,
                          `ชื่อบัญชี ${account.account_name}`,
                          account.branch_name ? `สาขา ${account.branch_name}` : "",
                          account.notes ? `หมายเหตุ ${account.notes}` : "",
                        ]
                          .filter(Boolean)
                          .join("\n"),
                        "คัดลอกข้อมูลบัญชีทั้งหมดแล้ว",
                      )
                    }
                  >
                    คัดลอกข้อมูลบัญชีทั้งหมด
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => openEdit(account)}
                  >
                    ✏️ แก้ไข / เปลี่ยนบัญชี
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => void toggleAccount(account)}
                  >
                    {account.is_active ? "พักใช้งาน" : "เปิดใช้งาน"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs text-red-700"
                    onClick={() => void removeAccount(account)}
                  >
                    ลบ
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {layout === "profile" && editorOpen ? <div className="mt-4 border-t border-slate-100 pt-4">{editor}</div> : null}
      {layout !== "profile" ? (
        <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{form.accountId ? "แก้ไขบัญชีรับเงิน" : "เพิ่มบัญชีรับเงิน"}</DialogTitle>
              <DialogDescription>
                ผูกกับ {contactName} แล้วใช้ซ้ำได้ทุกครั้งที่โอน โดยไม่ต้องออกจากหน้านี้
              </DialogDescription>
            </DialogHeader>
            {editor}
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
