/** ชุดข้อมูลแยกกันคนละฐานข้อมูล: ข้อมูลจริงกับข้อมูล Demo ไม่มีทางปะปนกัน */
export type DatasetId = "real" | "demo";

export interface Product {
  id: string;
  sku: string;
  name: string;
  /** ต้นทุนสินค้าต่อชิ้น (บาท) */
  unitCost: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * รายการขาย 1 บรรทัด (1 SKU ใน 1 คำสั่งซื้อ)
 * ทุกจำนวนเงินเป็นบาท และแต่ละรายการถูกเก็บไว้ที่เดียว เพื่อไม่ให้หักซ้ำ
 */
export interface Sale {
  id: string;
  orderId: string;
  /** YYYY-MM-DD (ปี ค.ศ.) */
  date: string;
  channel: string;
  sku: string;
  quantity: number;
  /** ราคาขายต่อชิ้น ก่อนหักส่วนลด */
  unitPrice: number;
  /** ส่วนลดที่ร้านออกเอง (รวมทั้งบรรทัด) */
  discount: number;
  /** เงินที่คืนให้ลูกค้า (รวมทั้งบรรทัด) */
  refund: number;
  /** จำนวนชิ้นที่ได้รับคืนเข้าสต็อก (ไม่คิดต้นทุนสินค้าสำหรับชิ้นเหล่านี้) */
  returnedQty: number;
  /** ค่าธรรมเนียมแพลตฟอร์มที่ถูกหักในคำสั่งซื้อนี้ */
  platformFee: number;
  /** ค่าขนส่งที่ร้านออกเองในคำสั่งซื้อนี้ */
  shippingFee: number;
  /**
   * ต้นทุนต่อชิ้น ณ เวลาที่นำเข้า (Historical Cost Snapshot)
   * แก้ต้นทุนในหน้าสินค้าภายหลังจะไม่เปลี่ยนค่านี้ จึงไม่กระทบกำไรย้อนหลัง
   * undefined = ข้อมูลเก่าก่อนมี snapshot (ระบบจะใช้ต้นทุนปัจจุบันแทน)
   */
  unitCost?: number;
  dedupeKey: string;
  batchId: string;
}

export const EXPENSE_CATEGORIES = [
  "platform_fee",
  "shipping",
  "ads",
  "packaging",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  platform_fee: "ค่าธรรมเนียมแพลตฟอร์ม",
  shipping: "ค่าขนส่งที่ร้านออก",
  ads: "ค่าโฆษณา",
  packaging: "ค่าบรรจุภัณฑ์",
  other: "ค่าใช้จ่ายอื่น",
};

/** ค่าใช้จ่ายที่บันทึกเอง (ไม่ได้มาจากไฟล์ยอดขาย) */
export interface Expense {
  id: string;
  date: string;
  category: ExpenseCategory;
  amount: number;
  /** "" = ไม่ระบุช่องทาง (ใช้ร่วมกันทั้งร้าน) */
  channel: string;
  note: string;
  createdAt: string;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  importedAt: string;
  rowCount: number;
}

export interface DateRange {
  /** YYYY-MM-DD หรือ null = ไม่จำกัด */
  from: string | null;
  to: string | null;
}
