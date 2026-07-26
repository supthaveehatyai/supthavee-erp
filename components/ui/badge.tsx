import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "slate" | "blue" | "emerald" | "amber";

const variantClass: Record<BadgeVariant, string> = {
  default: "bg-slate-100 text-slate-700",
  slate: "bg-slate-100 text-slate-600",
  blue: "bg-blue-100 text-blue-700",
  emerald: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-800",
};

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
          variantClass[variant],
          className,
        )}
        {...props}
      />
    );
  },
);
Badge.displayName = "Badge";

export { Badge };
