"use client";

const idleClass =
  "rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50";
const includedClass =
  "rounded border border-violet-700 bg-violet-700 px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50";
const freeClass =
  "rounded border border-emerald-700 bg-emerald-700 px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50";

export function ServiceLineShortcuts({
  disabled = false,
  includedActive = false,
  freeActive = false,
  onIncludeInGarment,
  onFreeGift,
}: {
  disabled?: boolean;
  includedActive?: boolean;
  freeActive?: boolean;
  onIncludeInGarment: () => void;
  onFreeGift: () => void;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={onIncludeInGarment}
        className={includedActive ? includedClass : idleClass}
      >
        [รวมในราคาเสื้อ (0 ฿)]
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onFreeGift}
        className={freeActive ? freeClass : idleClass}
      >
        [แถมฟรี (ลด 100%)]
      </button>
    </div>
  );
}
