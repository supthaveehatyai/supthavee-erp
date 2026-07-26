import * as React from "react";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 border-b border-slate-100 px-5 py-4", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      className={cn("text-sm font-bold tracking-tight text-slate-900", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p className={cn("text-xs text-slate-400", className)} {...props} />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-5", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center border-t border-slate-100 px-5 py-4", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
};
