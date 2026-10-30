"use client";

type PaidSettlementBarProps = {
  docNo: string;
  dateLabel: string;
  channelLabel: string;
  lineSent: boolean;
  slipUrl?: string | null;
  onSendLine: () => void;
  onCopy: () => void;
  onReplaceSlip?: () => void;
};

const actionClass =
  "inline-flex h-7 items-center whitespace-nowrap rounded-md bg-white px-2.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100";

export function PaidSettlementBar({
  docNo,
  dateLabel,
  channelLabel,
  lineSent,
  slipUrl,
  onSendLine,
  onCopy,
  onReplaceSlip,
}: PaidSettlementBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/90 px-3 py-1.5 text-xs text-emerald-950">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="font-semibold">✅ จ่ายแล้ว</span>
        <span aria-hidden="true">•</span>
        <span className="font-mono font-semibold">{docNo}</span>
        <span aria-hidden="true">•</span>
        <span>{dateLabel}</span>
        <span aria-hidden="true">•</span>
        <span>{channelLabel}</span>
        {lineSent ? (
          <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
            [ส่ง LINE แล้ว]
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5">
        {slipUrl ? (
          <a href={slipUrl} target="_blank" rel="noreferrer" className={actionClass}>
            🖼️ ดูสลิป
          </a>
        ) : null}
        {onReplaceSlip ? (
          <button type="button" onClick={onReplaceSlip} className={actionClass}>
            🔄 เปลี่ยนสลิป
          </button>
        ) : null}
        <button type="button" onClick={onSendLine} className={actionClass}>
          📲 ส่งสลิปทาง LINE
        </button>
        <button type="button" onClick={onCopy} className={actionClass}>
          📋 คัดลอกข้อความ
        </button>
      </div>
    </div>
  );
}
