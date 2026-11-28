export const FNB_OVERVIEW_CATEGORIES = [
  { key: "RAW_MATERIAL", label: "วัตถุดิบชงเครื่องดื่ม" },
  { key: "BAKERY_FROZEN", label: "เบเกอรี่และเค้กตู้แช่" },
  { key: "ICE_CREAM", label: "ไอศกรีมและโคน" },
  { key: "PACKAGING", label: "บรรจุภัณฑ์ (แก้ว ฝา หลอด ถุง)" },
  { key: "MERCHANDISE", label: "สินค้าพรีเมียมหน้าร้าน" },
  { key: "CLEANING_SUPPLY", label: "น้ำยาและของใช้สิ้นเปลือง" },
  { key: "EQUIPMENT_CAPEX", label: "อุปกรณ์ประจำร้าน" },
] as const;

const RAW_GROUPS: [string, string[]][] = [
  ["ใบชาและเมล็ดกาแฟ", ["ชา", "กาแฟ", "เมล็ด", "มัทฉะ", "โกโก้", "tea", "coffee"]],
  ["นม ครีม และน้ำมะพร้าว", ["นม", "ครีม", "มะพร้าว", "วิป"]],
  ["ไซรัปและน้ำเชื่อม", ["ไซรัป", "น้ำเชื่อม", "syrup", "น้ำผึ้ง"]],
  ["แยม ซอส ท็อปปิ้ง และผลไม้สด", ["แยม", "ซอส", "ท็อป", "ผลไม้", "เลมอน", "ส้ม", "สตรอ"]],
];

const BAKERY_GROUPS = ["กลุ่มครัวซองต์", "กลุ่มพัฟและพาย", "กลุ่มเค้กบอกซ์และมูส", "กลุ่มฮานจุกุชีสเค้ก"];

export function inventorySubgroup(category: string, name: string, stored?: string | null): string {
  const saved = (stored || "").trim();
  const blob = `${saved} ${name}`.toLowerCase();
  if (category === "RAW_MATERIAL") {
    const known = RAW_GROUPS.find(([label]) => saved === label || saved.includes(label));
    if (known) return known[0];
    const hit = RAW_GROUPS.find(([, words]) => words.some((word) => blob.includes(word.toLowerCase())));
    return hit?.[0] || saved || "อื่นๆ";
  }
  if (category === "BAKERY_FROZEN") {
    const known = BAKERY_GROUPS.find((label) => saved === label || blob.includes(label.replace("กลุ่ม", "").toLowerCase()));
    if (known) return known;
    if (blob.includes("ครัวซอง")) return BAKERY_GROUPS[0];
    if (blob.includes("พัฟ") || blob.includes("พาย")) return BAKERY_GROUPS[1];
    if (blob.includes("มูส") || blob.includes("บอกซ์")) return BAKERY_GROUPS[2];
    if (blob.includes("ฮานจุ") || blob.includes("ชีส")) return BAKERY_GROUPS[3];
    return saved || "อื่นๆ";
  }
  return "";
}

export function subgroupOrder(category: string, names: string[]): string[] {
  const preferred = category === "RAW_MATERIAL" ? RAW_GROUPS.map(([label]) => label) : category === "BAKERY_FROZEN" ? BAKERY_GROUPS : [];
  const rest = names.filter((name) => name && !preferred.includes(name)).sort((a, b) => a.localeCompare(b, "th"));
  return [...preferred.filter((name) => names.includes(name)), ...rest];
}
