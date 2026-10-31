"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  confirmEmployeeSalaryPaymentAction,
  confirmSsoRemittancePaymentAction,
  exportPayrollWorkbookAction,
  getOrCreatePayrollPeriodAction,
  setPayrollSsoRateAction,
  updateEmployeeIdCardAction,
  updatePayrollItemCalculationAction,
  uploadEmployeeIdCardAction,
  upsertEmployeeMasterAction,
} from "@/app/finance/payroll/actions";
import type {
  EmployeeMasterPayload,
  PayrollChannel,
  PayrollEmployee,
  PayrollItem,
  PayrollPeriodView,
} from "@/types/payroll";

const MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

type Draft = {
  baseSalary: string;
  otAmount: string;
  allowanceAmount: string;
  commissionAmount: string;
  bonusAmount: string;
  ssoEmployeeAmount: string;
  whtTaxAmount: string;
  otherDeduction: string;
};

function money(value: number) {
  return `฿${value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function todayBangkok() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
  }).format(new Date());
}

const SSO_RECEIPT_NO = "900169EF0038985";
const SSO_REFERENCE_NO = "M33690024288788";
const SSO_PAID_FROM = "กรุงไทย • 9020746510";

function periodEndDate(year: number, month: number) {
  const last = new Date(Date.UTC(year, month, 0));
  const monthText = String(last.getUTCMonth() + 1).padStart(2, "0");
  const dayText = String(last.getUTCDate()).padStart(2, "0");
  return `${last.getUTCFullYear()}-${monthText}-${dayText}`;
}

function readFileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("อ่านไฟล์ใบเสร็จไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

function draftFrom(item: PayrollItem): Draft {
  return {
    baseSalary: String(item.baseSalary),
    otAmount: String(item.otAmount),
    allowanceAmount: String(item.allowanceAmount),
    commissionAmount: String(item.commissionAmount),
    bonusAmount: String(item.bonusAmount),
    ssoEmployeeAmount: String(item.ssoEmployeeAmount),
    whtTaxAmount: String(item.whtTaxAmount),
    otherDeduction: String(item.otherDeduction),
  };
}

function previewNet(draft: Draft) {
  const gross =
    Number(draft.baseSalary || 0) +
    Number(draft.otAmount || 0) +
    Number(draft.allowanceAmount || 0) +
    Number(draft.commissionAmount || 0) +
    Number(draft.bonusAmount || 0);
  return (
    gross -
    Number(draft.ssoEmployeeAmount || 0) -
    Number(draft.whtTaxAmount || 0) -
    Number(draft.otherDeduction || 0)
  );
}

async function fileToJpeg(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("แปลงรูปสลิปไม่สำเร็จ");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.9);
}

type PdfJsLib = {
  getDocument: (src: { data: Uint8Array }) => {
    promise: Promise<{
      getPage: (pageNumber: number) => Promise<{
        getViewport: (params: { scale: number }) => { width: number; height: number };
        render: (params: {
          canvasContext: CanvasRenderingContext2D;
          viewport: { width: number; height: number };
        }) => { promise: Promise<void> };
      }>;
    }>;
  };
  GlobalWorkerOptions: { workerSrc: string };
};

function loadPdfJs(): Promise<PdfJsLib> {
  const host = window as Window & { pdfjsLib?: PdfJsLib };
  if (host.pdfjsLib) return Promise.resolve(host.pdfjsLib);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.async = true;
    script.onload = () => {
      if (!host.pdfjsLib) {
        reject(new Error("โหลดตัวอ่าน PDF ไม่สำเร็จ"));
        return;
      }
      host.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(host.pdfjsLib);
    };
    script.onerror = () => reject(new Error("โหลดตัวอ่าน PDF ไม่สำเร็จ"));
    document.head.appendChild(script);
  });
}

async function pdfToIdCardJpeg(file: File) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(1400 / base.width, 3) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("แปลงไฟล์บัตรประชาชนไม่สำเร็จ");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.9);
}

async function fileToIdCardJpeg(file: File) {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (isPdf) return pdfToIdCardJpeg(file);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("แปลงไฟล์บัตรประชาชนไม่สำเร็จ");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.9);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function printIdCards(
  cards: { fullName: string; citizenId: string; empCode: string; url: string }[],
) {
  const popup = window.open("", "_blank");
  if (!popup) {
    toast.error("เบราว์เซอร์บล็อกหน้าต่างพิมพ์");
    return;
  }
  const pages = cards
    .map(
      (card) => `<section class="page">
        <h1>สำเนาบัตรประชาชน</h1>
        <p>${escapeHtml(card.empCode)} · ${escapeHtml(card.fullName)}</p>
        <p>เลขประจำตัวประชาชน ${escapeHtml(card.citizenId || "—")}</p>
        <img src="${escapeHtml(card.url)}" alt="สำเนาบัตรประชาชน" />
      </section>`,
    )
    .join("");
  popup.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8" />
    <title>สำเนาบัตรประชาชนพนักงาน</title>
    <style>
      @page { size: A4 portrait; margin: 12mm; }
      body { font-family: "Sarabun", "Segoe UI", sans-serif; color: #0f172a; }
      .page { break-after: page; }
      h1 { font-size: 18px; margin: 0 0 8px; }
      p { margin: 0 0 6px; }
      img { display: block; width: auto; max-width: 100%; max-height: 230mm; object-fit: contain; border: 1px solid #cbd5e1; }
    </style></head><body>${pages}
    <script>window.addEventListener("load", () => setTimeout(() => window.print(), 400));</script>
    </body></html>`);
  popup.document.close();
}

async function downloadIdCard(url: string, empCode: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("ดาวน์โหลดสำเนาบัตรประชาชนไม่สำเร็จ");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `${empCode || "employee"}-id-card.jpg`;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

async function copyText(value: string, emptyMessage: string) {
  const clean = value.replace(/\s/g, "");
  if (!clean) {
    toast.error(emptyMessage);
    return;
  }
  await navigator.clipboard.writeText(clean);
  toast.success("คัดลอกเลขบัญชีแล้ว");
}

export function PayrollCenter() {
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(10);
  const [bundle, setBundle] = useState<PayrollPeriodView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [payItem, setPayItem] = useState<PayrollItem | null>(null);
  const [ssoOpen, setSsoOpen] = useState(false);
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [editing, setEditing] = useState<PayrollEmployee | null>(null);
  const [cardViewer, setCardViewer] = useState<PayrollEmployee | null>(null);
  const cardInputRef = useRef<HTMLInputElement>(null);
  const cardTargetRef = useRef<PayrollEmployee | null>(null);

  async function load(nextYear = year, nextMonth = month) {
    setLoading(true);
    const result = await getOrCreatePayrollPeriodAction(nextYear, nextMonth);
    setLoading(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setBundle(result.data);
    setDrafts(Object.fromEntries(result.data.items.map((item) => [item.id, draftFrom(item)])));
  }

  useEffect(() => {
    void load(2026, 10);
    // โหลดงวดเริ่มต้นตุลาคม 2569 ครั้งเดียวตอนเปิดหน้า
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const official = useMemo(
    () => bundle?.items.filter((item) => item.payrollChannel === "CORPORATE_OFFICIAL") ?? [],
    [bundle],
  );
  const internal = useMemo(
    () => bundle?.items.filter((item) => item.payrollChannel === "INTERNAL_PRIVATE") ?? [],
    [bundle],
  );
  const internalNames = internal.map((item) => item.employee.fullName).join(", ");

  async function changePeriod(nextYear: number, nextMonth: number) {
    setYear(nextYear);
    setMonth(nextMonth);
    await load(nextYear, nextMonth);
  }

  async function changeRate(rate: number) {
    setBusyId("rate");
    const result = await setPayrollSsoRateAction(year, month, rate);
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setBundle(result.data);
    setDrafts(Object.fromEntries(result.data.items.map((item) => [item.id, draftFrom(item)])));
    toast.success(`ใช้อัตราประกันสังคม ${rate}% แล้ว (เพดาน 750 บาท)`);
  }

  async function saveItem(item: PayrollItem) {
    const draft = drafts[item.id];
    if (!draft) return;
    setBusyId(item.id);
    const result = await updatePayrollItemCalculationAction({
      itemId: item.id,
      baseSalary: Number(draft.baseSalary || 0),
      otAmount: Number(draft.otAmount || 0),
      allowanceAmount: Number(draft.allowanceAmount || 0),
      commissionAmount: Number(draft.commissionAmount || 0),
      bonusAmount: Number(draft.bonusAmount || 0),
      ssoEmployeeAmount: Number(draft.ssoEmployeeAmount || 0),
      whtTaxAmount: Number(draft.whtTaxAmount || 0),
      otherDeduction: Number(draft.otherDeduction || 0),
    });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setBundle(result.data);
    setDrafts(Object.fromEntries(result.data.items.map((row) => [row.id, draftFrom(row)])));
    toast.success(`บันทึกยอดของ ${item.employee.fullName} แล้ว`);
  }

  async function exportExcel() {
    if (!bundle) return;
    setBusyId("excel");
    const result = await exportPayrollWorkbookAction(bundle.id);
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const binary = atob(result.data.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const url = URL.createObjectURL(
      new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = result.data.filename;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("ส่งออก Excel สำหรับสำนักงานบัญชีแล้ว");
  }

  function patchIdCard(employeeId: string, url: string) {
    setBundle((current) => {
      if (!current) return current;
      const patch = (employee: PayrollEmployee) =>
        employee.id === employeeId ? { ...employee, idCardAttachmentUrl: url } : employee;
      return {
        ...current,
        employees: current.employees.map(patch),
        items: current.items.map((item) => ({ ...item, employee: patch(item.employee) })),
      };
    });
    setCardViewer((current) =>
      current?.id === employeeId ? { ...current, idCardAttachmentUrl: url } : current,
    );
  }

  async function storeIdCard(employee: PayrollEmployee, file: File) {
    setBusyId(`card-${employee.id}`);
    try {
      const jpeg = await fileToIdCardJpeg(file);
      const uploaded = await uploadEmployeeIdCardAction(employee.empCode, jpeg);
      if (!uploaded.ok) {
        toast.error(uploaded.error);
        return null;
      }
      const saved = await updateEmployeeIdCardAction(employee.id, uploaded.data.url);
      if (!saved.ok) {
        toast.error(saved.error);
        return null;
      }
      patchIdCard(employee.id, uploaded.data.url);
      toast.success(`แนบสำเนาบัตรประชาชนของ ${employee.fullName} แล้ว`);
      return uploaded.data.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "แนบสำเนาบัตรประชาชนไม่สำเร็จ");
      return null;
    } finally {
      setBusyId(null);
    }
  }

  function printOfficialIdCards() {
    const people = official.filter((item) => item.employee.idCardAttachmentUrl);
    const missing = official
      .filter((item) => !item.employee.idCardAttachmentUrl)
      .map((item) => item.employee.fullName);
    if (people.length === 0) {
      toast.error("ยังไม่มีสำเนาบัตรประชาชนของพนักงานในระบบบัญชี");
      return;
    }
    if (missing.length > 0) {
      toast.error(`ยังไม่มีไฟล์บัตรของ ${missing.join(", ")}`);
    }
    printIdCards(
      people.map((item) => ({
        fullName: item.employee.fullName,
        citizenId: item.employee.citizenId,
        empCode: item.employee.empCode,
        url: item.employee.idCardAttachmentUrl,
      })),
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            ระบบพนักงาน เงินเดือน และประกันสังคม
          </h1>
          <p className="text-sm text-slate-500">
            งวด {MONTHS[month - 1]} {year + 543} · แยกพนักงานในระบบบัญชีกับจ่ายส่วนตัว
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={month}
            onChange={(event) => void changePeriod(year, Number(event.target.value))}
          >
            {MONTHS.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={year}
            onChange={(event) => void changePeriod(Number(event.target.value), month)}
          >
            {[2025, 2026, 2027].map((value) => (
              <option key={value} value={value}>
                {value + 543}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant={bundle?.ssoRatePct === 5 ? "default" : "outline"}
            disabled={busyId === "rate"}
            onClick={() => void changeRate(5)}
          >
            ประกันสังคม 5%
          </Button>
          <Button
            type="button"
            variant={bundle?.ssoRatePct === 3 ? "default" : "outline"}
            disabled={busyId === "rate"}
            onClick={() => void changeRate(3)}
          >
            ประกันสังคม 3%
          </Button>
          <Button type="button" variant="outline" onClick={() => setEmployeeOpen(true)}>
            ตั้งค่าพนักงาน
          </Button>
        </div>
      </header>

      {loading || !bundle ? (
        <p className="text-sm text-slate-500">กำลังโหลดงวดเงินเดือน...</p>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Kpi
              title={`ยอดโอนเงินเดือนสุทธิ (ในระบบบัญชี - ${official.length} คน)`}
              value={money(bundle.officialNetTotal)}
              detail={`เงินเดือนรวม ${money(bundle.officialGrossTotal)} หักประกันสังคม ${money(bundle.ssoEmployeeTotal)}`}
            />
            <Kpi
              title="ยอดนำส่งประกันสังคม สปส.1-10 (รวม 10%)"
              value={money(bundle.ssoTotalRemittance)}
              detail={`หักพนักงาน ${bundle.ssoRatePct}% ${money(bundle.ssoEmployeeTotal)} + บริษัทสมทบ ${money(bundle.ssoEmployerTotal)} · เพดาน 750 บาท`}
              action={
                bundle.ssoPaymentStatus === "PAID" ? (
                  <div className="flex flex-col items-start gap-2">
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                      ✅ ชำระ สปส. แล้ว (ใบเสร็จ: {bundle.ssoReceiptNo || SSO_RECEIPT_NO})
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {bundle.ssoPaymentSlipUrl ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            window.open(bundle.ssoPaymentSlipUrl ?? "", "_blank", "noopener,noreferrer")
                          }
                        >
                          📄 ดูใบเสร็จ สปส. (PDF)
                        </Button>
                      ) : null}
                      <Button type="button" size="sm" variant="outline" onClick={() => setSsoOpen(true)}>
                        🔄 เปลี่ยนไฟล์ใบเสร็จ
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" size="sm" onClick={() => setSsoOpen(true)}>
                    🏛️ แนบสลิป / ใบเสร็จจ่ายประกันสังคม
                  </Button>
                )
              }
            />
            <Kpi
              title={`ยอดจ่ายพนักงานภายใน (จ่ายส่วนตัว - ${internal.length} คน${internalNames ? `: ${internalNames}` : ""})`}
              value={money(bundle.internalNetTotal)}
              detail="🔒 บิลภายใน (ไม่ส่งสำนักงานบัญชี)"
            />
            <Kpi
              title="สถานะการโอนเงินเดือนงวดนี้"
              value={`โอนแล้ว ${bundle.paidCount} / ${bundle.headcount} คน`}
              detail={bundle.status === "COMPLETED" ? "ครบทุกคนแล้ว" : "ยังโอนไม่ครบ"}
            />
          </section>

          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busyId === "excel"} onClick={() => void exportExcel()}>
              📊 ส่งออก Excel รายงานเงินเดือน & ประกันสังคม (ส่งสำนักงานบัญชี)
            </Button>
            <Button type="button" variant="outline" onClick={printOfficialIdCards}>
              🖨️ พิมพ์รวมสำเนาบัตร ปชช. พนักงานทุกคน (PDF/A4)
            </Button>
          </div>
          <input
            ref={cardInputRef}
            type="file"
            accept="image/*,.pdf,application/pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              const target = cardTargetRef.current;
              event.target.value = "";
              if (!file || !target) return;
              void storeIdCard(target, file);
            }}
          />

          <PayrollTable
            title="🏢 พนักงานในระบบ (ส่งสำนักงานบัญชี)"
            items={official}
            drafts={drafts}
            busyId={busyId}
            onDraft={(id, patch) =>
              setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
            }
            onSave={(item) => void saveItem(item)}
            onPay={setPayItem}
            onViewCard={setCardViewer}
            onAttachCard={(employee) => {
              cardTargetRef.current = employee;
              cardInputRef.current?.click();
            }}
          />
          <PayrollTable
            title="🔒 พนักงานจ่ายส่วนตัว (Internal)"
            items={internal}
            drafts={drafts}
            busyId={busyId}
            onDraft={(id, patch) =>
              setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
            }
            onSave={(item) => void saveItem(item)}
            onPay={setPayItem}
            onViewCard={setCardViewer}
            onAttachCard={(employee) => {
              cardTargetRef.current = employee;
              cardInputRef.current?.click();
            }}
          />
        </>
      )}

      <PaySlipDialog
        item={payItem}
        onClose={() => setPayItem(null)}
        onSaved={(next) => {
          setBundle(next);
          setDrafts(Object.fromEntries(next.items.map((row) => [row.id, draftFrom(row)])));
          setPayItem(null);
        }}
      />
      <SsoSlipDialog
        open={ssoOpen}
        periodId={bundle?.id ?? ""}
        periodYear={bundle?.periodYear ?? year}
        periodMonth={bundle?.periodMonth ?? month}
        amount={bundle?.ssoTotalRemittance ?? 0}
        savedDate={bundle?.ssoPaymentDate ?? ""}
        savedReceipt={bundle?.ssoReceiptNo ?? ""}
        savedReference={bundle?.ssoReferenceNo ?? ""}
        savedAccount={bundle?.paidSsoFromAccount ?? ""}
        onClose={() => setSsoOpen(false)}
        onSaved={(next) => {
          setBundle(next);
          setSsoOpen(false);
        }}
      />
      <EmployeeDialog
        open={employeeOpen}
        employees={bundle?.employees ?? []}
        editing={editing}
        onEdit={setEditing}
        onClose={() => {
          setEmployeeOpen(false);
          setEditing(null);
        }}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
        onCardUploaded={patchIdCard}
      />
      <IdCardViewer
        employee={cardViewer}
        busy={busyId === `card-${cardViewer?.id ?? ""}`}
        onClose={() => setCardViewer(null)}
        onReplace={(file) => {
          if (!cardViewer) return;
          void storeIdCard(cardViewer, file);
        }}
      />
    </div>
  );
}

function Kpi({
  title,
  value,
  detail,
  action,
}: {
  title: string;
  value: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="text-xs text-slate-500">{detail}</p>
      {action}
    </article>
  );
}

function PayrollTable({
  title,
  items,
  drafts,
  busyId,
  onDraft,
  onSave,
  onPay,
  onViewCard,
  onAttachCard,
}: {
  title: string;
  items: PayrollItem[];
  drafts: Record<string, Draft>;
  busyId: string | null;
  onDraft: (id: string, patch: Partial<Draft>) => void;
  onSave: (item: PayrollItem) => void;
  onPay: (item: PayrollItem) => void;
  onViewCard: (employee: PayrollEmployee) => void;
  onAttachCard: (employee: PayrollEmployee) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
        {title} · {items.length} คน
      </h2>
      <div className="overflow-x-auto">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">รหัส/ชื่อ-สกุล</th>
              <th className="px-3 py-2">เลขบัตร ปชช. & บัญชีรับเงิน</th>
              <th className="px-3 py-2">เงินเดือนฐาน</th>
              <th className="px-3 py-2">+ OT / เบี้ยเลี้ยง / โบนัส</th>
              <th className="px-3 py-2">- หักประกันสังคม</th>
              <th className="px-3 py-2">- หัก ณ ที่จ่าย / อื่นๆ</th>
              <th className="px-3 py-2">เงินได้สุทธิ (ยอดต้องโอน)</th>
              <th className="px-3 py-2">สถานะ & สลิปโอนเงิน</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const draft = drafts[item.id] ?? draftFrom(item);
              const paid = item.paymentStatus === "PAID";
              return (
                <tr key={item.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-3">
                    <div className="font-medium text-slate-900">{item.employee.fullName}</div>
                    <div className="text-xs text-slate-500">
                      {item.employee.empCode}
                      {item.employee.isSsoEnrolled ? " · ผู้ประกันตน" : ""}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-600">
                    <div>ปชช. {item.employee.citizenId || "—"}</div>
                    <div>
                      {item.employee.bankName || "ธนาคาร"} {item.employee.bankAccountNo || "ยังไม่มีเลขบัญชี"}
                    </div>
                    <div>{item.employee.bankAccountName}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void copyText(item.employee.bankAccountNo, "ยังไม่มีเลขบัญชีให้คัดลอก")
                        }
                      >
                        📋 คัดลอกเลขบัญชี
                      </Button>
                      {item.employee.idCardAttachmentUrl ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                          onClick={() => onViewCard(item.employee)}
                        >
                          🪪 ดูบัตร ปชช.
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100"
                          disabled={busyId === `card-${item.employee.id}`}
                          onClick={() => onAttachCard(item.employee)}
                        >
                          📤 แนบบัตร ปชช.
                        </Button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Input
                      className="h-8 w-28"
                      inputMode="decimal"
                      disabled={paid}
                      value={draft.baseSalary}
                      onChange={(event) => onDraft(item.id, { baseSalary: event.target.value })}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1">
                      <Mini label="OT" value={draft.otAmount} disabled={paid} onChange={(value) => onDraft(item.id, { otAmount: value })} />
                      <Mini label="เบี้ย" value={draft.allowanceAmount} disabled={paid} onChange={(value) => onDraft(item.id, { allowanceAmount: value })} />
                      <Mini label="คอม" value={draft.commissionAmount} disabled={paid} onChange={(value) => onDraft(item.id, { commissionAmount: value })} />
                      <Mini label="โบนัส" value={draft.bonusAmount} disabled={paid} onChange={(value) => onDraft(item.id, { bonusAmount: value })} />
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Input
                      className="h-8 w-24"
                      inputMode="decimal"
                      disabled={paid || item.payrollChannel === "INTERNAL_PRIVATE"}
                      value={draft.ssoEmployeeAmount}
                      onChange={(event) => onDraft(item.id, { ssoEmployeeAmount: event.target.value })}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1">
                      <Mini label="หัก ณ ที่จ่าย" value={draft.whtTaxAmount} disabled={paid} onChange={(value) => onDraft(item.id, { whtTaxAmount: value })} />
                      <Mini label="อื่น ๆ" value={draft.otherDeduction} disabled={paid} onChange={(value) => onDraft(item.id, { otherDeduction: value })} />
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-base font-semibold text-slate-900">{money(previewNet(draft))}</div>
                    {!paid ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        disabled={busyId === item.id}
                        onClick={() => onSave(item)}
                      >
                        บันทึกยอด
                      </Button>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <div className="mb-2 text-xs">{paid ? "โอนแล้ว" : "ยังไม่โอน"}</div>
                    {item.paymentSlipUrl ? (
                      <a className="mb-2 block text-xs text-blue-700 underline" href={item.paymentSlipUrl} target="_blank" rel="noreferrer">
                        ดูสลิป
                      </a>
                    ) : null}
                    <Button type="button" size="sm" onClick={() => onPay(item)}>
                      {paid ? "🔄 เปลี่ยนสลิป" : "💸 โอนเงินเดือน / แนบสลิป"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Mini({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-slate-500">
      <span className="w-16">{label}</span>
      <Input
        className="h-7 w-24"
        inputMode="decimal"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function PaySlipDialog({
  item,
  onClose,
  onSaved,
}: {
  item: PayrollItem | null;
  onClose: () => void;
  onSaved: (bundle: PayrollPeriodView) => void;
}) {
  const [date, setDate] = useState(todayBangkok());
  const [reference, setReference] = useState("");
  const [account, setAccount] = useState("");
  const [preview, setPreview] = useState("");
  const [jpeg, setJpeg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setDate(item.paymentDate ?? todayBangkok());
    setReference(item.paymentReferenceNo ?? "");
    setAccount(item.paidFromAccount);
    setPreview("");
    setJpeg("");
  }, [item]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await fileToJpeg(file);
      setPreview(dataUrl);
      setJpeg(dataUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "แปลงรูปสลิปไม่สำเร็จ");
    }
  }

  async function save() {
    if (!item) return;
    if (!jpeg) {
      toast.error("กรุณาเลือกไฟล์สลิปก่อนบันทึก");
      return;
    }
    setSaving(true);
    const result = await confirmEmployeeSalaryPaymentAction({
      itemId: item.id,
      paymentDate: date,
      paidFromAccount: account,
      paymentReferenceNo: reference,
      slipJpegBase64: jpeg,
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`บันทึกการโอนของ ${item.employee.fullName} แล้ว`);
    onSaved(result.data);
  }

  return (
    <Dialog open={item != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>โอนเงินเดือน / แนบสลิป</DialogTitle>
        </DialogHeader>
        {item ? (
          <div className="flex flex-col gap-3">
            <p className="text-lg font-semibold text-slate-900">{item.employee.fullName}</p>
            <p className="text-3xl font-semibold text-slate-900">{money(item.netPay)}</p>
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <div>บัญชีรับเงิน {item.employee.bankName || "—"}</div>
              <div className="font-medium">{item.employee.bankAccountNo || "ยังไม่มีเลขบัญชี"}</div>
              <div>{item.employee.bankAccountName}</div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => void copyText(item.employee.bankAccountNo, "ยังไม่มีเลขบัญชีให้คัดลอก")}
              >
                📋 คัดลอกเลขบัญชี
              </Button>
            </div>
            <label className="text-sm text-slate-600">
              วันที่โอน
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label className="text-sm text-slate-600">
              จ่ายจากบัญชี
              <Input value={account} onChange={(event) => setAccount(event.target.value)} />
            </label>
            <label className="text-sm text-slate-600">
              เลขอ้างอิง
              <Input value={reference} onChange={(event) => setReference(event.target.value)} />
            </label>
            <label className="text-sm text-slate-600">
              รูปสลิปโอนเงินเดือน
              <Input
                type="file"
                accept="image/*"
                onChange={(event) => void onFile(event.target.files?.[0])}
              />
            </label>
            {preview ? (
              // ตัวอย่างสลิปขนาดใหญ่ให้ตรวจชื่อผู้รับและยอดก่อนบันทึก
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="ตัวอย่างสลิปโอนเงินเดือน" className="max-h-[420px] w-full rounded-xl border object-contain" />
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            ปิด
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            บันทึกการโอน
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SsoSlipDialog({
  open,
  periodId,
  periodYear,
  periodMonth,
  amount,
  savedDate,
  savedReceipt,
  savedReference,
  savedAccount,
  onClose,
  onSaved,
}: {
  open: boolean;
  periodId: string;
  periodYear: number;
  periodMonth: number;
  amount: number;
  savedDate: string;
  savedReceipt: string;
  savedReference: string;
  savedAccount: string;
  onClose: () => void;
  onSaved: (bundle: PayrollPeriodView) => void;
}) {
  const [date, setDate] = useState(periodEndDate(2026, 10));
  const [receiptNo, setReceiptNo] = useState(SSO_RECEIPT_NO);
  const [reference, setReference] = useState(SSO_REFERENCE_NO);
  const [account, setAccount] = useState(SSO_PAID_FROM);
  const [previewUrl, setPreviewUrl] = useState("");
  const [fileKind, setFileKind] = useState<"pdf" | "jpeg" | "">("");
  const [fileBase64, setFileBase64] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate((savedDate || periodEndDate(periodYear, periodMonth)).slice(0, 10));
    setReceiptNo(savedReceipt || SSO_RECEIPT_NO);
    setReference(savedReference || SSO_REFERENCE_NO);
    setAccount(savedAccount || SSO_PAID_FROM);
    setPreviewUrl("");
    setFileKind("");
    setFileBase64("");
  }, [open, periodYear, periodMonth, savedDate, savedReceipt, savedReference, savedAccount]);

  useEffect(() => {
    return () => {
      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    try {
      if (isPdf) {
        setFileKind("pdf");
        setPreviewUrl(URL.createObjectURL(file));
        setFileBase64(await readFileBase64(file));
        return;
      }
      setFileKind("jpeg");
      const jpeg = await fileToJpeg(file);
      setPreviewUrl(jpeg);
      setFileBase64(jpeg);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "เปิดไฟล์ใบเสร็จไม่สำเร็จ");
    }
  }

  async function save() {
    if (!fileBase64 || !fileKind) {
      toast.error("กรุณาเลือกไฟล์ใบเสร็จก่อนบันทึก");
      return;
    }
    setSaving(true);
    const result = await confirmSsoRemittancePaymentAction({
      periodId,
      periodYear,
      periodMonth,
      paymentDate: date,
      receiptNo,
      referenceNo: reference,
      paidFromAccount: account,
      fileKind,
      fileBase64,
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("บันทึกใบเสร็จประกันสังคมและรายการค่าใช้จ่ายแล้ว");
    onSaved(result.data);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>แนบสลิป / ใบเสร็จจ่ายประกันสังคม</DialogTitle>
        </DialogHeader>
        <p className="text-3xl font-semibold text-slate-900">{money(amount)}</p>
        <p className="text-sm text-emerald-700">
          ✅ ระบบจะบันทึกเป็นหลักฐานการนำส่ง สปส.1-10 และสร้างรายการค่าใช้จ่ายบริษัท (Expenses) ให้อัตโนมัติโดยไม่ต้องคีย์แยก
        </p>
        <label className="text-sm text-slate-600">
          วันที่ชำระเงิน
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className="mt-2 block text-sm text-slate-600">
          เลขที่ใบเสร็จรับเงิน สปส.
          <Input value={receiptNo} onChange={(event) => setReceiptNo(event.target.value)} />
        </label>
        <label className="mt-2 block text-sm text-slate-600">
          หมายเลขอ้างอิง (Reference No.)
          <Input value={reference} onChange={(event) => setReference(event.target.value)} />
        </label>
        <label className="mt-2 block text-sm text-slate-600">
          ชำระจากบัญชีธนาคาร
          <Input value={account} onChange={(event) => setAccount(event.target.value)} />
        </label>
        <label className="mt-2 block text-sm text-slate-600">
          ไฟล์ใบเสร็จ (.pdf, .jpg, .png)
          <Input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/*"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
        </label>
        {previewUrl && fileKind === "pdf" ? (
          <iframe title="ตัวอย่างใบเสร็จประกันสังคม" src={previewUrl} className="w-full h-[420px] rounded-xl border" />
        ) : null}
        {previewUrl && fileKind === "jpeg" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="ตัวอย่างใบเสร็จประกันสังคม"
            className="max-h-[420px] w-full rounded-xl border object-contain"
          />
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            ปิด
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            บันทึกใบเสร็จ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeDialog({
  open,
  employees,
  editing,
  onEdit,
  onClose,
  onSaved,
  onCardUploaded,
}: {
  open: boolean;
  employees: PayrollEmployee[];
  editing: PayrollEmployee | null;
  onEdit: (employee: PayrollEmployee | null) => void;
  onClose: () => void;
  onSaved: () => void;
  onCardUploaded: (employeeId: string, url: string) => void;
}) {
  const [form, setForm] = useState<EmployeeMasterPayload>({
    id: null,
    empCode: "",
    fullName: "",
    citizenId: "",
    positionTitle: "พนักงาน",
    payrollChannel: "CORPORATE_OFFICIAL",
    baseSalary: 0,
    isSsoEnrolled: false,
    bankName: "กรุงไทย",
    bankAccountNo: "",
    bankAccountName: "",
    address: "",
    idCardAttachmentUrl: "",
    bankBookAttachmentUrl: "",
  });
  const [saving, setSaving] = useState(false);
  const [cardPreview, setCardPreview] = useState("");
  const [pendingJpeg, setPendingJpeg] = useState("");
  const [cardUploading, setCardUploading] = useState(false);
  const cardFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) {
      setForm({
        id: null,
        empCode: "",
        fullName: "",
        citizenId: "",
        positionTitle: "พนักงาน",
        payrollChannel: "CORPORATE_OFFICIAL",
        baseSalary: 0,
        isSsoEnrolled: false,
        bankName: "กรุงไทย",
        bankAccountNo: "",
        bankAccountName: "",
        address: "",
        idCardAttachmentUrl: "",
        bankBookAttachmentUrl: "",
      });
      setCardPreview("");
      setPendingJpeg("");
      return;
    }
    setCardPreview(editing.idCardAttachmentUrl);
    setPendingJpeg("");
    setForm({
      id: editing.id,
      empCode: editing.empCode,
      fullName: editing.fullName,
      citizenId: editing.citizenId,
      positionTitle: editing.positionTitle || "พนักงาน",
      payrollChannel: editing.payrollChannel,
      baseSalary: editing.baseSalary,
      isSsoEnrolled: editing.isSsoEnrolled,
      bankName: editing.bankName,
      bankAccountNo: editing.bankAccountNo,
      bankAccountName: editing.bankAccountName,
      address: editing.address,
      idCardAttachmentUrl: editing.idCardAttachmentUrl,
      bankBookAttachmentUrl: editing.bankBookAttachmentUrl,
    });
  }, [editing]);

  async function save() {
    setSaving(true);
    const result = await upsertEmployeeMasterAction(form);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (pendingJpeg && result.data.employeeId) {
      const uploaded = await uploadEmployeeIdCardAction(form.empCode, pendingJpeg);
      if (!uploaded.ok) {
        toast.error(uploaded.error);
      } else {
        const linked = await updateEmployeeIdCardAction(result.data.employeeId, uploaded.data.url);
        if (!linked.ok) toast.error(linked.error);
        else onCardUploaded(result.data.employeeId, uploaded.data.url);
      }
    }
    toast.success("บันทึกข้อมูลพนักงานแล้ว");
    onSaved();
  }

  async function onCardFile(file: File | undefined) {
    if (!file) return;
    setCardUploading(true);
    try {
      const jpeg = await fileToIdCardJpeg(file);
      setCardPreview(jpeg);
      if (!form.id) {
        setPendingJpeg(jpeg);
        return;
      }
      const uploaded = await uploadEmployeeIdCardAction(form.empCode, jpeg);
      if (!uploaded.ok) {
        toast.error(uploaded.error);
        return;
      }
      const linked = await updateEmployeeIdCardAction(form.id, uploaded.data.url);
      if (!linked.ok) {
        toast.error(linked.error);
        return;
      }
      setPendingJpeg("");
      setForm((current) => ({ ...current, idCardAttachmentUrl: uploaded.data.url }));
      setCardPreview(uploaded.data.url);
      onCardUploaded(form.id, uploaded.data.url);
      toast.success("แนบสำเนาบัตรประชาชนแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "แปลงไฟล์บัตรประชาชนไม่สำเร็จ");
    } finally {
      setCardUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ข้อมูลพนักงาน</DialogTitle>
        </DialogHeader>
        <div className="mb-3 flex flex-col gap-1">
          {employees.map((employee) => (
            <button
              key={employee.id}
              type="button"
              className="rounded-lg px-2 py-1 text-left text-sm hover:bg-slate-50"
              onClick={() => onEdit(employee)}
            >
              {employee.empCode} · {employee.fullName}
            </button>
          ))}
          <Button type="button" variant="outline" onClick={() => onEdit(null)}>
            เพิ่มพนักงานใหม่
          </Button>
        </div>
        <div className="grid gap-2">
          <Input placeholder="รหัสพนักงาน" value={form.empCode} onChange={(event) => setForm({ ...form, empCode: event.target.value })} />
          <Input placeholder="ชื่อ-สกุล" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
          <Input placeholder="เลขบัตรประชาชน 13 หลัก" value={form.citizenId} onChange={(event) => setForm({ ...form, citizenId: event.target.value })} />
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-800">
              🪪 สำเนาบัตรประชาชนพนักงาน (สำหรับส่งสำนักงานบัญชี / ประกันสังคม)
            </p>
            <input
              ref={cardFileRef}
              type="file"
              accept="image/*,.pdf,application/pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void onCardFile(file);
              }}
            />
            {cardPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cardPreview}
                alt="สำเนาบัตรประชาชน"
                className="mt-3 max-h-[280px] w-auto rounded-lg border object-contain"
              />
            ) : (
              <p className="mt-2 text-xs text-slate-500">ยังไม่ได้แนบสำเนาบัตรประชาชน</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {cardPreview ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const url = form.idCardAttachmentUrl || cardPreview;
                    window.open(url, "_blank", "noopener,noreferrer");
                    if (form.idCardAttachmentUrl) {
                      void downloadIdCard(form.idCardAttachmentUrl, form.empCode).catch((error: unknown) => {
                        toast.error(error instanceof Error ? error.message : "ดาวน์โหลดสำเนาบัตรประชาชนไม่สำเร็จ");
                      });
                    }
                  }}
                >
                  🔍 เปิดดูรูปเต็ม / ดาวน์โหลด
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="outline" onClick={() => cardFileRef.current?.click()}>
                {cardPreview ? "🔄 เปลี่ยนไฟล์บัตร ปชช." : "📤 แนบบัตร ปชช."}
              </Button>
            </div>
          </div>
          <Input placeholder="ที่อยู่" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
          <Input placeholder="ตำแหน่ง" value={form.positionTitle} onChange={(event) => setForm({ ...form, positionTitle: event.target.value })} />
          <select
            className="h-9 rounded-md border border-slate-200 px-2 text-sm"
            value={form.payrollChannel}
            onChange={(event) =>
              setForm({
                ...form,
                payrollChannel: event.target.value as PayrollChannel,
                isSsoEnrolled: event.target.value === "INTERNAL_PRIVATE" ? false : form.isSsoEnrolled,
              })
            }
          >
            <option value="CORPORATE_OFFICIAL">ในระบบบัญชี (CORPORATE_OFFICIAL)</option>
            <option value="INTERNAL_PRIVATE">จ่ายส่วนตัว (INTERNAL_PRIVATE)</option>
          </select>
          <Input
            inputMode="decimal"
            placeholder="เงินเดือนฐาน"
            value={String(form.baseSalary)}
            onChange={(event) => setForm({ ...form, baseSalary: Number(event.target.value || 0) })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isSsoEnrolled}
              disabled={form.payrollChannel === "INTERNAL_PRIVATE"}
              onChange={(event) => setForm({ ...form, isSsoEnrolled: event.target.checked })}
            />
            ขึ้นประกันสังคม
          </label>
          <Input placeholder="ธนาคาร" value={form.bankName} onChange={(event) => setForm({ ...form, bankName: event.target.value })} />
          <Input placeholder="เลขบัญชีรับเงินเดือน" value={form.bankAccountNo} onChange={(event) => setForm({ ...form, bankAccountNo: event.target.value })} />
          <Input placeholder="ชื่อบัญชี" value={form.bankAccountName} onChange={(event) => setForm({ ...form, bankAccountName: event.target.value })} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            ปิด
          </Button>
          <Button type="button" disabled={saving || cardUploading} onClick={() => void save()}>
            บันทึกพนักงาน
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IdCardViewer({
  employee,
  busy,
  onClose,
  onReplace,
}: {
  employee: PayrollEmployee | null;
  busy: boolean;
  onClose: () => void;
  onReplace: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={employee != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            สำเนาบัตรประชาชน {employee?.fullName ?? ""}
          </DialogTitle>
        </DialogHeader>
        {employee?.idCardAttachmentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={employee.idCardAttachmentUrl}
            alt={`สำเนาบัตรประชาชน ${employee.fullName}`}
            className="max-h-[70vh] w-auto rounded-lg border object-contain"
          />
        ) : null}
        <p className="text-sm text-slate-500">
          {employee?.empCode} · เลขประจำตัวประชาชน {employee?.citizenId || "—"}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf,application/pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onReplace(file);
          }}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={!employee?.idCardAttachmentUrl}
            onClick={() => {
              if (!employee?.idCardAttachmentUrl) return;
              void downloadIdCard(employee.idCardAttachmentUrl, employee.empCode).catch((error: unknown) => {
                toast.error(error instanceof Error ? error.message : "ดาวน์โหลดสำเนาบัตรประชาชนไม่สำเร็จ");
              });
            }}
          >
            ⬇️ ดาวน์โหลดไฟล์บัตร ปชช.
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!employee?.idCardAttachmentUrl}
            onClick={() => {
              if (!employee?.idCardAttachmentUrl) return;
              printIdCards([
                {
                  fullName: employee.fullName,
                  citizenId: employee.citizenId,
                  empCode: employee.empCode,
                  url: employee.idCardAttachmentUrl,
                },
              ]);
            }}
          >
            🖨️ พิมพ์สำเนาบัตร ปชช. (A4)
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
            🔄 เปลี่ยนไฟล์ใหม่
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
