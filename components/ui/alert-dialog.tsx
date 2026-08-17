"use client";

/**
 * Lightweight AlertDialog (shadcn/ui-compatible API) — no extra Radix dependency.
 * Mirrors Dialog styling used across the ERP.
 *
 * Must portal to `document.body` with z-index ABOVE Radix Dialog
 * (`DialogOverlay`/`DialogContent` use z-[10000]/z-[10001]). Otherwise a
 * confirm dialog opened from inside ManageContactDialog (etc.) sits behind
 * the parent dialog and looks like a silent no-op on Save.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type AlertDialogContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  dismissible: boolean;
};

const AlertDialogContext =
  React.createContext<AlertDialogContextValue | null>(null);

function useAlertDialog(component: string): AlertDialogContextValue {
  const ctx = React.useContext(AlertDialogContext);
  if (!ctx) {
    throw new Error(`${component} must be used within <AlertDialog>`);
  }
  return ctx;
}

type AlertDialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** When false, Escape / overlay click will not dismiss (e.g. while saving). */
  dismissible?: boolean;
  children: React.ReactNode;
};

function AlertDialog({
  open: controlledOpen,
  onOpenChange,
  dismissible = true,
  children,
}: AlertDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = controlledOpen ?? uncontrolledOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!next && !dismissible) return;
      if (controlledOpen === undefined) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [controlledOpen, dismissible, onOpenChange],
  );

  return (
    <AlertDialogContext.Provider value={{ open, setOpen, dismissible }}>
      {children}
    </AlertDialogContext.Provider>
  );
}

function AlertDialogTrigger({
  children,
  asChild,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const { setOpen } = useAlertDialog("AlertDialogTrigger");

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<{ onClick?: React.MouseEventHandler }>, {
      onClick: (event: React.MouseEvent) => {
        (children as React.ReactElement<{ onClick?: React.MouseEventHandler }>).props.onClick?.(event);
        setOpen(true);
      },
    });
  }

  return (
    <button type="button" {...props} onClick={() => setOpen(true)}>
      {children}
    </button>
  );
}

function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { open, setOpen } = useAlertDialog("AlertDialogContent");

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  // Portal + z-[11000]: sit above Radix Dialog (z-10000/10001).
  // `pointer-events-auto` is required when nested above a Radix Dialog:
  // Radix sets `pointer-events: none` on `body`, so without this the
  // confirm layer would ignore all clicks.
  return createPortal(
    <div className="fixed inset-0 z-[11000] flex pointer-events-auto items-center justify-center p-4">
      <div
        role="presentation"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        className={cn(
          "relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl outline-none pointer-events-auto",
          className,
        )}
        onMouseDown={(event) => event.stopPropagation()}
        {...props}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div className={cn("mb-4 flex flex-col gap-1.5", className)} {...props} />
  );
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mt-6 flex flex-wrap items-center justify-end gap-2",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn("text-base font-semibold text-slate-800", className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p className={cn("text-sm text-slate-500", className)} {...props} />
  );
}

function AlertDialogCancel({
  className,
  children = "ยกเลิก",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { setOpen } = useAlertDialog("AlertDialogCancel");
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50",
        className,
      )}
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) setOpen(false);
      }}
    >
      {children}
    </button>
  );
}

function AlertDialogAction({
  className,
  children = "ยืนยัน",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
};
