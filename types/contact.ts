/**
 * Contact edit / contact_persons types (shared by Server Actions + UI).
 * Kept outside `"use server"` modules — Next.js only allows async function
 * exports from Server Action files.
 */

import type { Contact, ContactType } from "@/app/contacts/contacts";

export type UpdateContactPayload = {
  companyName?: string;
  taxId?: string | null;
  branchCode?: string | null;
  phone?: string | null;
  address?: string | null;
  /** Multi-role tags — required on edit; written to contact_roles only. */
  contactRoles?: ContactType[];
  contact_roles?: ContactType[];
};

export type AddContactPersonPayload = {
  name?: string;
  phone?: string | null;
  email?: string | null;
  role?: string | null;
};

export type ContactPersonRow = {
  id: string;
  contact_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  department_or_role: string | null;
  is_primary: boolean;
};

export type ActionResult<T> = {
  data: T | null;
  error: string | null;
};

export type ContactDetails = {
  contact: Contact;
  persons: ContactPersonRow[];
};
