const SEQUENTIAL = new Set([
  "123456",
  "234567",
  "345678",
  "456789",
  "012345",
  "654321",
  "543210",
  "987654",
]);

export function weakPinReason(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return "รหัส PIN ต้องเป็นตัวเลข 6 หลัก";
  if (pin === "555555") return "ห้ามใช้รหัสเริ่มต้น 555555";
  if (/^(\d)\1{5}$/.test(pin)) return "ห้ามใช้รหัสที่ซ้ำกันทั้ง 6 หลัก";
  if (SEQUENTIAL.has(pin)) return "ห้ามใช้รหัสเรียงกัน";
  return null;
}
