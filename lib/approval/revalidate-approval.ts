import { revalidatePath } from "next/cache";

const APPROVALS_PATH = "/approvals";

/** Refresh Approval Center when a new PENDING item is created. */
export function revalidateApprovalCenterIfPending(pending: boolean): void {
  if (!pending) return;
  revalidatePath(APPROVALS_PATH);
  revalidatePath(APPROVALS_PATH, "layout");
}
