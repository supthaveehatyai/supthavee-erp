import * as React from "react";
import { cn } from "@/lib/utils";

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(
          "mb-1.5 block text-xs font-semibold text-slate-700",
          className,
        )}
        {...props}
      />
    );
  },
);
Label.displayName = "Label";

export { Label };
