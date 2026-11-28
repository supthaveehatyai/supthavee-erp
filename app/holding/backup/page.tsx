import { BackupCenter } from "@/app/holding/backup/backup-center";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";

export const dynamic = "force-dynamic";

export default async function HoldingBackupPage() {
  await requireSuperAdmin();
  return <BackupCenter />;
}
