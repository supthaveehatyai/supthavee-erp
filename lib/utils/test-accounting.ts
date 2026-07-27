import { calculateNetCostApportionment, ApportionmentItem } from './accounting';

console.log("🚀 สตาร์ทเครื่องยนต์ทดสอบ Net Cost Apportionment...\n");

// Mock Data อ้างอิงจากบิลจริงของร้านทรัพย์ทวี
const mockItems: ApportionmentItem[] = [
  {
    id: "SKU-NEXTS-001",
    unitPrice: 289.00,
    qty: 6,
    discountText: "41.8%", // เคสส่วนลดทศนิยม
    isFoc: false,
    isFlatDiscountPerLine: true
  },
  {
    id: "SKU-DKK-001",
    unitPrice: 792.00,
    qty: 5,
    discountText: "75", // เคสส่วนลดเหมาบรรทัด 75 บาท
    isFoc: false,
    isFlatDiscountPerLine: true
  },
  {
    id: "SKU-PEGAN-001",
    unitPrice: 397.20,
    qty: 3,
    discountText: "", // ไม่มีส่วนลดบรรทัด แต่เดี๋ยวจะโดนหักท้ายบิล 40%
    isFoc: false,
    isFlatDiscountPerLine: true
  },
  {
    id: "SKU-FOC-001",
    unitPrice: 500.00,
    qty: 2,
    discountText: "",
    isFoc: true, // เคสของแถม ต้นทุนต้องเป็น 0
    isFlatDiscountPerLine: true
  }
];

// จำลองการใส่ส่วนลดท้ายบิล 40% (กระทบเฉพาะ PEGAN เพราะตัวอื่นลดไปแล้ว)
const billDiscount = "40%"; 

const results = calculateNetCostApportionment(mockItems, billDiscount);

console.log("📊 ผลลัพธ์การคำนวณต้นทุนสุทธิ (ตรวจสอบทีละรายการ):\n");

results.forEach(result => {
  const item = mockItems.find(i => i.id === result.id);
  console.log(`[${result.id}] - ${item?.isFoc ? '(ของแถม)' : ''}`);
  console.log(`   ราคาตั้ง: ${result.originalUnitPrice.toFixed(2)} บาท | จำนวน: ${item?.qty} ชิ้น | ส่วนลดที่คีย์: "${item?.discountText || '-'}"`);
  console.log(`   👉 ต้นทุนสุทธิต่อหน่วย: ${result.finalUnitCost} บาท`);
  console.log(`   👉 มูลค่าสุทธิรวมบรรทัด: ${result.finalLineTotal} บาท`);
  console.log("---------------------------------------------------");
});
