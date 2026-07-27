// lib/utils/accounting.ts

export interface ApportionmentItem {
  id: string; // SKU หรือ Row ID
  unitPrice: number; // ราคาตั้งต่อหน่วย
  qty: number; // จำนวนที่รับเข้า
  discountText?: string | null; // ข้อความส่วนลดระดับบรรทัด เช่น "41.8%", "75", "20+5"
  isFoc?: boolean; // ของแถม (Free of Charge)
  isFlatDiscountPerLine?: boolean; // ส่วนลดเงินบาทเป็นแบบ "เหมาทั้งบรรทัด" หรือไม่ (Default: true)
}

export interface ApportionmentResult {
  id: string;
  originalUnitPrice: number;
  finalUnitCost: number; // ต้นทุนสุทธิต่อหน่วย (ทศนิยม 4 ตำแหน่ง)
  finalLineTotal: number; // ราคารวมสุทธิของบรรทัดนั้น
}

/**
 * บังคับปัดเศษทศนิยม 4 ตำแหน่ง สำหรับการบันทึกบัญชี (Internal Cost Precision)
 */
export function roundTo4Decimals(num: number): number {
  return Math.round(num * 10000) / 10000;
}

/**
 * Engine แปลงข้อความส่วนลดเป็นตัวเลข และหักออกจากยอดตั้งต้น
 */
function applyLineDiscount(
  baseAmount: number,
  discountText: string | null | undefined,
  qty: number,
  isFlatPerLine: boolean = true
): number {
  if (!discountText) return baseAmount;
  
  let currentAmount = baseAmount;
  
  // Clean string: ลบช่องว่าง, คำว่า บาท, B, หรือเครื่องหมายลบออก
  const cleanText = discountText.replace(/\s|บาท|B|-/gi, '').trim();
  if (!cleanText) return baseAmount;

  // รองรับส่วนลดขั้นบันได (Chain Discount) เช่น "20%+5%" หรือ "20+5"
  const steps = cleanText.split('+');

  for (const step of steps) {
    const match = step.match(/[\d.]+/);
    if (!match) continue;
    
    const val = parseFloat(match[0]);
    if (isNaN(val)) continue;

    // ตรวจสอบว่าเป็นเปอร์เซ็นต์หรือไม่ (ถ้ามี % หรือเป็น Chain Discount ให้ตีเป็น % ไว้ก่อน)
    // Business Rule: Chain discount terms like "20+5" are always treated as percentages.
    const isPercent = step.includes('%') || steps.length > 1;

    if (isPercent) {
      currentAmount = currentAmount * (1 - (val / 100));
    } else {
      // กรณีเป็นส่วนลดเงินบาท (Flat Discount)
      const flatDiscount = isFlatPerLine ? val : val * qty;
      currentAmount = currentAmount - flatDiscount;
    }
  }

  return Math.max(0, currentAmount); // ป้องกันไม่ให้ยอดติดลบ
}

/**
 * Main Function: คำนวณต้นทุนสุทธิและการกระจายส่วนลดท้ายบิล (Prorate Apportionment)
 */
export function calculateNetCostApportionment(
  items: ApportionmentItem[],
  billDiscountText?: string | null
): ApportionmentResult[] {
  let totalValueBeforeBillDiscount = 0;

  // Step 1: คำนวณยอดรวมของแต่ละบรรทัด (หักส่วนลดบรรทัดแล้ว แต่ยังไม่หักท้ายบิล)
  const lineResults = items.map(item => {
    // ถ้าเป็นของแถม (FOC) ต้นทุนบรรทัดเป็น 0 ทันที
    if (item.isFoc) {
      return { ...item, lineTotalBeforeBillDisc: 0 };
    }

    const baseLineTotal = item.unitPrice * item.qty;
    const lineTotalBeforeBillDisc = applyLineDiscount(
      baseLineTotal,
      item.discountText,
      item.qty,
      item.isFlatDiscountPerLine !== false // Default เป็น true เสมอ
    );

    totalValueBeforeBillDiscount += lineTotalBeforeBillDisc;
    return { ...item, lineTotalBeforeBillDisc };
  });

  // Step 2: คำนวณมูลค่าส่วนลดท้ายบิล (ถ้ามี)
  let billDiscountAmount = 0;
  if (billDiscountText && totalValueBeforeBillDiscount > 0) {
     const cleanBillText = billDiscountText.replace(/\s|บาท|B|-/gi, '').trim();
     const match = cleanBillText.match(/[\d.]+/);
     if (match) {
        const val = parseFloat(match[0]);
        if (cleanBillText.includes('%')) {
           billDiscountAmount = totalValueBeforeBillDiscount * (val / 100);
        } else {
           billDiscountAmount = val; // ส่วนลดท้ายบิลแบบเงินบาท
        }
     }
  }

  // Step 3: กระจายส่วนลดท้ายบิลลงแต่ละรายการตามสัดส่วน (Prorate)
  return lineResults.map(item => {
    if (item.isFoc || totalValueBeforeBillDiscount === 0) {
      return {
        id: item.id,
        originalUnitPrice: item.unitPrice,
        finalUnitCost: 0,
        finalLineTotal: 0
      };
    }

    // หาสัดส่วนมูลค่าของสินค้านี้ ต่อยอดรวมทั้งบิล (Weight Ratio)
    const prorateRatio = item.lineTotalBeforeBillDisc / totalValueBeforeBillDiscount;
    
    // มูลค่าส่วนลดท้ายบิลที่ต้องนำมาหักออกจากสินค้านี้
    const apportionedDiscount = billDiscountAmount * prorateRatio;
    
    // ยอดรวมสุทธิของบรรทัดนี้
    const finalLineTotal = item.lineTotalBeforeBillDisc - apportionedDiscount;
    
    // ต้นทุนสุทธิต่อหน่วย (เฉลี่ยกลับเป็นรายชิ้น) — กัน Division by Zero
    const finalUnitCost = item.qty > 0 ? finalLineTotal / item.qty : 0;

    return {
      id: item.id,
      originalUnitPrice: item.unitPrice,
      finalUnitCost: roundTo4Decimals(finalUnitCost),
      finalLineTotal: roundTo4Decimals(finalLineTotal)
    };
  });
}
