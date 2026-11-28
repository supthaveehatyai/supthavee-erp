import { callFnbRpc } from "@/lib/fnb/rpc";
import { getCurrentAuthUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export async function POST(request: Request) {
  const user = await getCurrentAuthUser();
  if (!user) return Response.json({ ok: false, error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ ok: false, error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  const staffName = user.displayName || user.email || "พนักงาน";
  const action = text(body.action);
  const branchCode = text(body.branchCode);
  const workDate = text(body.workDate);
  if (!branchCode || !workDate) return Response.json({ ok: false, error: "ไม่พบสาขาหรือวันที่" }, { status: 400 });
  const common = { p_branch_code: branchCode, p_work_date: workDate, p_staff_name: staffName, p_user_id: user.userId };
  const saved = action === "CLEANING_SPOT"
    ? await callFnbRpc("upsert_cleaning_spot_log", {
      ...common,
      p_stage_code: text(body.stageCode),
      p_spot_id: text(body.spotId),
      p_status_flag: text(body.statusFlag) || "PASSED",
      p_photo_url: text(body.photoUrl),
      p_issue_note: text(body.issueNote) || null,
    })
    : action === "DISPLAY_ITEM_COUNT"
      ? await callFnbRpc("save_single_display_count_instant", {
        ...common,
        p_stage_code: text(body.stageCode) || "OPENING",
        p_section_key: text(body.sectionKey),
        p_item_id: text(body.itemId),
        p_location_code: text(body.locationCode) || null,
        p_counted_qty: Number(body.countedQty) || 0,
      })
      : action === "SINGLE_WASTE_ITEM"
        ? await callFnbRpc("upsert_single_daily_waste_item", {
          ...common,
          p_item_code: text(body.itemCode),
          p_qty: Number(body.qty) || 0,
          p_uom: text(body.uom) || "ml",
          p_photo_url: text(body.photoUrl),
        })
        : action === "SHIFT_CLOSING_DRAFT"
          ? await callFnbRpc("save_shift_closing_draft_instant", {
            ...common,
            p_shift_type: text(body.shiftType),
            p_draft_json: body.draft && typeof body.draft === "object" ? body.draft : {},
          })
          : null;
  if (!saved) return Response.json({ ok: false, error: "ไม่รู้จักรายการที่บันทึก" }, { status: 400 });
  if (saved.error) return Response.json({ ok: false, error: saved.error.message || "บันทึกไม่สำเร็จ" }, { status: 500 });
  const payload = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
  if (payload.ok === false) return Response.json({ ok: false, error: text(payload.error) || "บันทึกไม่สำเร็จ" }, { status: 400 });
  return Response.json({ ok: true, staffName, checkedAt: new Date().toISOString(), serverTimeISO: new Date().toISOString() });
}
