"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Contact, ContactType } from "@/app/contacts/contacts";
import {
  CONTACT_ROLE_OPTIONS,
  contactHasRole,
  contactRoleBadgeClass,
  contactRoleLabel,
  normalizeContactRoles,
} from "@/app/contacts/contacts";
import {
  addContactPerson,
  getContactDetails,
  listContactPersons,
  updateContact,
  type ContactPersonRow,
} from "@/app/actions/contacts";
import { SkillRateCard } from "@/components/contacts/skill-rate-card";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type ContactFormState = {
  companyName: string;
  taxId: string;
  branchCode: string;
  phone: string;
  address: string;
  contactRoles: ContactType[];
};

type PersonFormState = {
  name: string;
  phone: string;
  email: string;
  role: string;
};

const emptyPersonForm = (): PersonFormState => ({
  name: "",
  phone: "",
  email: "",
  role: "",
});

function toContactForm(contact: Contact): ContactFormState {
  const roles = normalizeContactRoles(contact.contact_roles);
  return {
    companyName: contact.company_name ?? "",
    taxId: contact.tax_id ?? "",
    branchCode: contact.branch_code ?? "สำนักงานใหญ่",
    phone: contact.phone ?? "",
    address: contact.address ?? "",
    // Never leave undefined — empty DB/legacy rows default to Customer
    contactRoles: roles.length > 0 ? roles : (["Customer"] as ContactType[]),
  };
}

function personFormHasAnyValue(form: PersonFormState): boolean {
  return Boolean(
    form.name.trim() ||
      form.phone.trim() ||
      form.email.trim() ||
      form.role.trim(),
  );
}

type ManageContactDialogProps = {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful master-data save (before dialog closes). */
  onSaved?: (contact: Contact) => void;
};

export default function ManageContactDialog({
  contact,
  open,
  onOpenChange,
  onSaved,
}: ManageContactDialogProps) {
  const router = useRouter();
  const [tab, setTab] = useState("details");
  const [contactForm, setContactForm] = useState<ContactFormState>(
    toContactForm(
      contact ?? {
        id: "",
        created_at: "",
        contact_roles: ["Customer"],
        customer_type: null,
        company_name: "",
        tax_id: null,
        branch_code: null,
        address: null,
        phone: null,
        default_price_tier: null,
        credit_days: null,
        ocr_pattern_config: {},
        is_active: true,
      },
    ),
  );
  const [personForm, setPersonForm] = useState<PersonFormState>(emptyPersonForm);
  const [persons, setPersons] = useState<ContactPersonRow[]>([]);
  const [personsError, setPersonsError] = useState("");
  const [formError, setFormError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open || !contact) return;
    setTab("details");
    setContactForm(toContactForm(contact));
    setPersonForm(emptyPersonForm());
    setFormError("");
    setPersonsError("");
    setShowConfirm(false);
    setIsSaving(false);

    console.info("[ManageContactDialog] load contact", {
      id: contact.id,
      raw_contact_roles: contact.contact_roles,
      form_contact_roles: toContactForm(contact).contactRoles,
    });

    let cancelled = false;
    void Promise.all([
      getContactDetails(contact.id),
      listContactPersons(contact.id),
    ]).then(([detailsResult, personsResult]) => {
      if (cancelled) return;

      if (detailsResult.error) {
        console.error(
          "[ManageContactDialog] getContactDetails failed",
          detailsResult.error,
        );
      } else if (detailsResult.data?.contact) {
        const fresh = detailsResult.data.contact;
        console.info("[ManageContactDialog] fresh contact_roles", {
          id: fresh.id,
          contact_roles: fresh.contact_roles,
        });
        setContactForm(toContactForm(fresh));
      }

      if (personsResult.error) {
        setPersons([]);
        setPersonsError(personsResult.error);
        return;
      }
      setPersons(personsResult.data ?? []);
    });

    return () => {
      cancelled = true;
    };
  }, [open, contact]);

  const canEditRates =
    contactHasRole({ contact_roles: contactForm.contactRoles }, "Vendor") ||
    contactHasRole({ contact_roles: contactForm.contactRoles }, "Technician");

  function toggleRole(role: ContactType) {
    setContactForm((current) => {
      const hasRole = current.contactRoles.includes(role);
      const next = hasRole
        ? current.contactRoles.filter((item) => item !== role)
        : [...current.contactRoles, role];
      return {
        ...current,
        contactRoles: next.length > 0 ? next : current.contactRoles,
      };
    });
  }

  function closeMainDialog() {
    if (isSaving) return;
    setShowConfirm(false);
    onOpenChange(false);
  }

  function closeConfirmDialog() {
    if (isSaving) return;
    setShowConfirm(false);
  }

  function updateContactField<Key extends keyof ContactFormState>(
    key: Key,
    value: ContactFormState[Key],
  ) {
    setContactForm((current) => ({ ...current, [key]: value }));
  }

  function updatePersonField<Key extends keyof PersonFormState>(
    key: Key,
    value: PersonFormState[Key],
  ) {
    setPersonForm((current) => ({ ...current, [key]: value }));
  }

  function validateBeforeConfirm(): boolean {
    setFormError("");
    if (!contact) {
      const message = "ไม่พบข้อมูลคู่ค้า";
      setFormError(message);
      toast.error(message);
      return false;
    }
    if (!contactForm.companyName.trim()) {
      const message = "กรุณากรอกชื่อบริษัทหรือชื่อคู่ค้า";
      setFormError(message);
      toast.error(message);
      setTab("details");
      return false;
    }
    if (contactForm.contactRoles.length === 0) {
      const message = "กรุณาเลือกอย่างน้อย 1 สถานะ";
      setFormError(message);
      toast.error(message);
      setTab("details");
      return false;
    }
    if (personFormHasAnyValue(personForm) && !personForm.name.trim()) {
      const message = "กรุณากรอกชื่อผู้ประสานงานให้ครบถ้วน";
      setFormError(message);
      toast.error(message);
      setTab("person");
      return false;
    }
    return true;
  }

  function handleSaveClick() {
    if (!validateBeforeConfirm()) return;
    setShowConfirm(true);
  }

  async function handleConfirmSave() {
    if (!contact || isSaving) return;

    setIsSaving(true);
    setFormError("");

    const contact_roles = Array.isArray(contactForm.contactRoles)
      ? contactForm.contactRoles.map((role) => String(role))
      : [];

    console.info("[ManageContactDialog] submit payload", {
      id: contact.id,
      contact_roles,
    });

    try {
      // Payload: contact_roles only (no contact_type). Plain array for RSC serialization.
      const updateResult = await updateContact(contact.id, {
        companyName: contactForm.companyName.trim(),
        taxId: contactForm.taxId.trim() || null,
        branchCode: contactForm.branchCode.trim() || "สำนักงานใหญ่",
        phone: contactForm.phone.trim() || null,
        address: contactForm.address.trim() || null,
        contact_roles,
      });

      if (updateResult.error || !updateResult.data) {
        const message = updateResult.error ?? "อัปเดตข้อมูลคู่ค้าไม่สำเร็จ";
        console.error("Submit Error:", updateResult.error, {
          contact_roles,
        });
        setFormError(message);
        setShowConfirm(false);
        toast.error(message);
        return;
      }

      let personAdded = false;
      if (personForm.name.trim()) {
        const personResult = await addContactPerson(contact.id, {
          name: personForm.name.trim(),
          phone: personForm.phone.trim() || null,
          email: personForm.email.trim() || null,
          role: personForm.role.trim() || null,
        });

        if (personResult.error) {
          console.error("Submit Error:", personResult.error);
          setFormError(
            `อัปเดตคู่ค้าสำเร็จ แต่เพิ่มผู้ประสานงานไม่สำเร็จ: ${personResult.error}`,
          );
          setShowConfirm(false);
          toast.error(personResult.error);
          router.refresh();
          return;
        }
        personAdded = true;
      }

      toast.success(
        personAdded
          ? "อัปเดตข้อมูลคู่ค้าและเพิ่มผู้ประสานงานแล้ว"
          : "อัปเดตข้อมูลคู่ค้าแล้ว",
      );
      onSaved?.(updateResult.data);
      setShowConfirm(false);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      console.error("Submit Error:", error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "บันทึกข้อมูลไม่สำเร็จ";
      setFormError(message);
      setShowConfirm(false);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (isSaving) return;
          if (!next && showConfirm) {
            // Prefer closing the confirm layer first; don't dismiss parent under it.
            setShowConfirm(false);
            return;
          }
          if (!next) {
            setShowConfirm(false);
          }
          onOpenChange(next);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] max-w-2xl overflow-y-auto"
          onPointerDownOutside={(event) => {
            if (showConfirm || isSaving) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (showConfirm || isSaving) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (isSaving) {
              event.preventDefault();
              return;
            }
            if (showConfirm) {
              event.preventDefault();
              setShowConfirm(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>จัดการข้อมูลคู่ค้า</DialogTitle>
            <DialogDescription>
              แก้ไขข้อมูลหลักและเพิ่มผู้ประสานงานของ{" "}
              <span className="font-medium text-slate-700">
                {contact?.company_name ?? "—"}
              </span>
            </DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={setTab} className="mt-2">
            <TabsList
              className={cn(
                "grid w-full",
                canEditRates ? "grid-cols-3" : "grid-cols-2",
              )}
            >
              <TabsTrigger value="details">ข้อมูลคู่ค้า</TabsTrigger>
              <TabsTrigger value="person">ผู้ประสานงาน</TabsTrigger>
              {canEditRates ? (
                <TabsTrigger value="rates">ทักษะและค่าแรง</TabsTrigger>
              ) : null}
            </TabsList>

            <TabsContent value="details" className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>
                    ประเภทคู่ค้า (เลือกได้หลายสถานะ){" "}
                    <span className="text-red-500">*</span>
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {CONTACT_ROLE_OPTIONS.map((option) => {
                      const checked = contactForm.contactRoles.includes(
                        option.value,
                      );
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={checked}
                          disabled={isSaving}
                          onClick={() => toggleRole(option.value)}
                          className={cn(
                            "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                            checked
                              ? `${contactRoleBadgeClass(option.value)} border-transparent shadow-sm`
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                            "disabled:opacity-50",
                          )}
                        >
                          <span
                            className={cn(
                              "grid size-3.5 place-items-center rounded border text-[9px]",
                              checked
                                ? "border-current bg-white/70"
                                : "border-slate-300 bg-white",
                            )}
                          >
                            {checked ? "✓" : ""}
                          </span>
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="manage-company-name">
                    ชื่อบริษัท / ชื่อคู่ค้า{" "}
                    <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="manage-company-name"
                    value={contactForm.companyName}
                    onChange={(event) =>
                      updateContactField("companyName", event.target.value)
                    }
                    disabled={isSaving}
                    placeholder="ชื่อบริษัท ร้านค้า หรือบุคคล"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="manage-tax-id">เลขประจำตัวผู้เสียภาษี</Label>
                  <Input
                    id="manage-tax-id"
                    inputMode="numeric"
                    maxLength={20}
                    value={contactForm.taxId}
                    onChange={(event) =>
                      updateContactField("taxId", event.target.value)
                    }
                    disabled={isSaving}
                    placeholder="เลขประจำตัว 13 หลัก"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="manage-branch">สาขา</Label>
                  <Input
                    id="manage-branch"
                    value={contactForm.branchCode}
                    onChange={(event) =>
                      updateContactField("branchCode", event.target.value)
                    }
                    disabled={isSaving}
                    placeholder="สำนักงานใหญ่"
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="manage-phone">เบอร์โทร</Label>
                  <Input
                    id="manage-phone"
                    type="tel"
                    value={contactForm.phone}
                    onChange={(event) =>
                      updateContactField("phone", event.target.value)
                    }
                    disabled={isSaving}
                    placeholder="เช่น 074-000-000"
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="manage-address">ที่อยู่</Label>
                  <textarea
                    id="manage-address"
                    rows={3}
                    value={contactForm.address}
                    onChange={(event) =>
                      updateContactField("address", event.target.value)
                    }
                    disabled={isSaving}
                    placeholder="ที่อยู่สำหรับออกเอกสาร"
                    className={cn(
                      "flex w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition",
                      "placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100",
                      "disabled:cursor-not-allowed disabled:bg-slate-50",
                    )}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="person" className="mt-4 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <p className="text-xs font-semibold text-slate-700">
                  ผู้ประสานงานปัจจุบัน
                </p>
                {personsError ? (
                  <p className="mt-2 text-xs text-red-600">{personsError}</p>
                ) : persons.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-400">
                    ยังไม่มีผู้ประสานงาน
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {persons.map((person) => (
                      <li
                        key={person.id}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-800">
                            {person.name}
                          </span>
                          {person.is_primary && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                              หลัก
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {[
                            person.department_or_role,
                            person.phone,
                            person.email,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    เพิ่มผู้ประสานงาน
                  </p>
                  <p className="text-[11px] text-slate-400">
                    กรอกแล้วกดบันทึก — ระบบจะเพิ่มพร้อมอัปเดตข้อมูลคู่ค้า
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="person-name">
                      ชื่อ-นามสกุล <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="person-name"
                      value={personForm.name}
                      onChange={(event) =>
                        updatePersonField("name", event.target.value)
                      }
                      disabled={isSaving}
                      placeholder="ชื่อผู้ติดต่อ"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="person-phone">เบอร์โทร</Label>
                    <Input
                      id="person-phone"
                      type="tel"
                      value={personForm.phone}
                      onChange={(event) =>
                        updatePersonField("phone", event.target.value)
                      }
                      disabled={isSaving}
                      placeholder="เบอร์โทรศัพท์"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="person-email">อีเมล</Label>
                    <Input
                      id="person-email"
                      type="email"
                      value={personForm.email}
                      onChange={(event) =>
                        updatePersonField("email", event.target.value)
                      }
                      disabled={isSaving}
                      placeholder="name@example.com"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="person-role">ตำแหน่ง / บทบาท</Label>
                    <Input
                      id="person-role"
                      value={personForm.role}
                      onChange={(event) =>
                        updatePersonField("role", event.target.value)
                      }
                      disabled={isSaving}
                      placeholder="เช่น ฝ่ายจัดซื้อ"
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            {canEditRates && contact ? (
              <TabsContent value="rates" className="mt-4">
                <SkillRateCard
                  technicianId={contact.id}
                  technicianName={contact.company_name}
                />
              </TabsContent>
            ) : null}
          </Tabs>

          {formError ? (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"
            >
              {formError}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={() => {
                closeMainDialog();
              }}
            >
              {tab === "rates" ? "ปิด" : "ยกเลิก"}
            </Button>
            {tab !== "rates" ? (
              <Button
                type="button"
                disabled={isSaving || !contact}
                onClick={handleSaveClick}
              >
                บันทึก
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={showConfirm}
        onOpenChange={(next) => {
          if (isSaving) return;
          setShowConfirm(next);
        }}
        dismissible={!isSaving}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการอัปเดต</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to update this contact&apos;s information?
              <span className="mt-2 block text-slate-600">
                ยืนยันว่าต้องการอัปเดตข้อมูลคู่ค้า
                {personForm.name.trim()
                  ? " และเพิ่มผู้ประสานงานใหม่"
                  : ""}
                หรือไม่?
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={() => {
                closeConfirmDialog();
              }}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              disabled={isSaving}
              onClick={() => {
                void handleConfirmSave();
              }}
            >
              {isSaving ? "กำลังบันทึก..." : "ยืนยัน"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
