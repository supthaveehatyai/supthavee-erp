/** เวลาปัจจุบัน HH:mm ตามปฏิทินกรุงเทพ */
export function currentBangkokTime(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const hour = read("hour").padStart(2, "0");
  const minute = read("minute").padStart(2, "0");
  if (!/^\d{2}$/.test(hour) || !/^\d{2}$/.test(minute)) return "00:00";
  return `${hour}:${minute}`;
}

/** รวมวันที่และเวลาบนสลิปเป็น TIMESTAMPTZ โซน +07:00 */
export function paymentTimestampIso(date: string, time: string): string {
  const day = date.trim().slice(0, 10);
  const match = /^(\d{2}):(\d{2})$/.exec(time.trim());
  const hour = match?.[1] ?? "00";
  const minute = match?.[2] ?? "00";
  return `${day}T${hour}:${minute}:00+07:00`;
}

export function paymentTimeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return currentBangkokTime(date);
}
