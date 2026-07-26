import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = "default" | "sm" | "lg" | "icon";

const variantClass: Record<ButtonVariant, string> = {
  default:
    "bg-blue-600 text-white shadow-sm hover:bg-blue-700 focus-visible:ring-blue-500",
  secondary:
    "bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100 focus-visible:ring-blue-400",
  outline:
    "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-300",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  destructive:
    "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500",
};

const sizeClass: Record<ButtonSize, string> = {
  default: "h-10 px-4 text-sm",
  sm: "h-8 px-3 text-xs",
  lg: "h-11 px-5 text-sm",
  icon: "size-9",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      type = "button",
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition outline-none",
          "focus-visible:ring-2 focus-visible:ring-offset-2",
          "disabled:pointer-events-none disabled:opacity-50",
          variantClass[variant],
          sizeClass[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
