export async function postFnbInstantSave(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; staffName?: string; checkedAt?: string }> {
  const response = await fetch("/api/fnb/instant-save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; staffName?: string; checkedAt?: string };
  if (!response.ok || data.ok !== true) return { ok: false, error: data.error || "บันทึกไม่สำเร็จ" };
  return { ok: true, staffName: data.staffName, checkedAt: data.checkedAt };
}

export function sectionDraftKey(branchCode: string, workDate: string, sectionKey: string): string {
  return `fnb-draft:${branchCode}:${workDate}:${sectionKey}`;
}

export function readSectionDraft(branchCode: string, workDate: string, sectionKey: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(sectionDraftKey(branchCode, workDate, sectionKey));
    const parsed = raw ? JSON.parse(raw) as Record<string, string> : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSectionDraft(branchCode: string, workDate: string, sectionKey: string, patch: Record<string, string>) {
  const next = { ...readSectionDraft(branchCode, workDate, sectionKey), ...patch };
  window.localStorage.setItem(sectionDraftKey(branchCode, workDate, sectionKey), JSON.stringify(next));
}

export function clearSectionDraft(branchCode: string, workDate: string, sectionKey: string) {
  window.localStorage.removeItem(sectionDraftKey(branchCode, workDate, sectionKey));
}
