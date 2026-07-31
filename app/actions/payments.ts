/**
 * Payment helpers live in:
 * - `@/app/actions/billing` — getInvoicesByBillingNote, getOpenBillingNotesForContact
 * - `@/lib/actions/finance/billing-note-status` — syncBillingNotesAfterInvoicePayment
 *
 * Do not re-export from a `"use server"` file (Next.js only allows async
 * function exports there — type/value re-exports cause build errors).
 */

export {};
