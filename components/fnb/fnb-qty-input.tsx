"use client";

export function FnbQtyInput({
  value,
  onChange,
  unit,
  allowDecimal = false,
  name,
  placeholder,
}: {
  value?: string;
  onChange?: (value: string) => void;
  unit?: string;
  allowDecimal?: boolean;
  name?: string;
  placeholder?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        name={name}
        value={value}
        placeholder={placeholder}
        inputMode={allowDecimal ? "decimal" : "numeric"}
        step={allowDecimal ? "0.1" : "1"}
        min={0}
        max={999}
        className="h-10 w-24 rounded-md border border-slate-200 px-2 text-sm"
        onKeyDown={(event) => {
          if (!allowDecimal && (event.key === "." || event.key === "," || event.key === "e" || event.key === "E")) event.preventDefault();
        }}
        onChange={(event) => {
          const raw = event.target.value;
          if (!onChange) return;
          if (raw === "") {
            onChange("");
            return;
          }
          if (!allowDecimal) {
            const digits = raw.replace(/[^\d]/g, "");
            onChange(digits === "" ? "" : String(Math.trunc(Number(digits))));
            return;
          }
          onChange(raw);
        }}
      />
      {unit ? <span className="text-xs font-medium text-slate-500">{unit}</span> : null}
    </span>
  );
}
