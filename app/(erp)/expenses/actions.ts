"use server";

import { updateExpenseDirectAction as updateExpenseDirect } from "@/app/actions/expenses";

export async function updateExpenseDirectAction(formData: FormData) {
  return updateExpenseDirect(formData);
}
