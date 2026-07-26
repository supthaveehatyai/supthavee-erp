import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition",
          "placeholder:text-slate-400",
          "focus:border-blue-400 focus:ring-2 focus:ring-blue-100",
          "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
