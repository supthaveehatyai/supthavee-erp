"use client";

/**
 * Pencil shortcut next to a contact/customer combobox.
 * Loads master data via `getContactDetails` (Server Action) then opens
 * the shared `ManageContactDialog` — no client Supabase.
 */

import { useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { Contact } from "@/app/contacts/contacts";
import { getContactDetails } from "@/app/actions/contacts";
import ManageContactDialog from "@/components/contacts/ManageContactDialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type QuickEditContactButtonProps = {
  contactId: string | null | undefined;
  disabled?: boolean;
  className?: string;
  /** Fired after contact master data is saved successfully. */
  onSaved?: (contact: Contact) => void;
};

export default function QuickEditContactButton({
  contactId,
  disabled = false,
  className,
  onSaved,
}: QuickEditContactButtonProps) {
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState<Contact | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const canEdit = Boolean(contactId?.trim()) && !disabled;

  async function handleOpen() {
    const id = contactId?.trim() ?? "";
    if (!id || isLoading || disabled) return;

    setIsLoading(true);
    try {
      const result = await getContactDetails(id);
      if (result.error || !result.data?.contact) {
        toast.error(result.error ?? "โหลดข้อมูลคู่ค้าไม่สำเร็จ");
        return;
      }
      setContact(result.data.contact);
      setOpen(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "โหลดข้อมูลคู่ค้าไม่สำเร็จ",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={!canEdit || isLoading}
        onClick={() => {
          void handleOpen();
        }}
        title={
          canEdit
            ? "แก้ไขข้อมูลลูกค้า (Master Data)"
            : "เลือกลูกค้าก่อนจึงจะแก้ไขได้"
        }
        aria-label="แก้ไขข้อมูลลูกค้า"
        className={cn("size-10 shrink-0", className)}
      >
        {isLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Pencil className="size-4" />
        )}
      </Button>

      <ManageContactDialog
        contact={contact}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setContact(null);
        }}
        onSaved={onSaved}
      />
    </>
  );
}
