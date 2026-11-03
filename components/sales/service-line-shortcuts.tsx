"use client";

export function ServiceLineShortcuts({
  disabled = false,
  onIncludeInGarment,
  onFreeGift,
}: {
  disabled?: boolean;
  onIncludeInGarment: () => void;
  onFreeGift: () => void;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={onIncludeInGarment}
        className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        [รวมในราคาเสื้อ (0 ฿)]
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onFreeGift}
        className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        [แถมฟรี (ลด 100%)]
      </button>
    </div>
  );
}
