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
 * ช่องจำนวนเงิน/จำนวนที่ไม่บังคับในไฟล์ยอดขาย
 * ถ้าไฟล์ไม่มีคอลัมน์นี้ จะเก็บค่า 0 ไว้ในตัวเลข แต่ระบุชื่อช่องไว้ใน Sale.missingFields
 * เพื่อแยก "ไม่มีข้อมูล" ออกจาก "มีค่าเป็นศูนย์"
 */
export const OPTIONAL_SALE_FIELDS = ["discount", "refund", "returnedQty", "platformFee", "shippingFee"] as const;
export type OptionalSaleField = (typeof OPTIONAL_SALE_FIELDS)[number];

export const OPTIONAL_FIELD_LABELS: Record<OptionalSaleField, string> = {
  discount: "ส่วนลด",
  refund: "เงินคืนลูกค้า",
  returnedQty: "ชิ้นที่ได้รับคืน",
  platformFee: "ค่าธรรมเนียมแพลตฟอร์ม",
  shippingFee: "ค่าขนส่งที่ร้านออก",
};

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
  /**
   * SKU ตามไฟล์ต้นทาง (v1.2+) ถ้าไม่ตรงกับ SKU ในระบบ ผู้ใช้จับคู่ให้เป็น sku ของสินค้า
   * undefined = ข้อมูลก่อน v1.2 (ถือว่าเท่ากับ sku)
   */
  sourceSku?: string;
  /**
   * ช่องที่ไฟล์ต้นทางไม่มีข้อมูล (v1.2+) ค่าตัวเลขของช่องเหล่านี้เป็น 0 แต่ไม่ใช่ศูนย์จริง
   * ทำให้กำไรเป็น "กำไรโดยประมาณ"  undefined = ข้อมูลก่อน v1.2 (ไม่ได้ติดตาม)
   */
  missingFields?: OptionalSaleField[];
  /** v1.3+: คำสั่งซื้อที่บรรทัดนี้สังกัด (undefined = ข้อมูลก่อน v1.3 นับเหมือนเดิม) */
  orderKey?: string;
  lineKey?: string;
  /** v1.3+: เหตุผลที่ตัวเลขเป็นค่าประมาณ */
  estimateReasons?: EstimateReason[];
  /** v1.3+: กำไรอาจสูงขึ้นได้ถึง (บาท) เมื่อส่วนลด/เงินคืนที่ไม่รู้ผู้รับภาระเป็นของแพลตฟอร์ม */
  estimateUpside?: number;
  dedupeKey: string;
  batchId: string;
}

export const ESTIMATE_REASONS = ["unknown_discount_funding", "unknown_refund_funding", "provisional_status"] as const;
export type EstimateReason = (typeof ESTIMATE_REASONS)[number];
export const ESTIMATE_REASON_LABELS: Record<EstimateReason, string> = {
  unknown_discount_funding: "ส่วนลดที่ไม่รู้ว่าร้านหรือแพลตฟอร์มรับภาระ (คิดเป็นของร้าน)",
  unknown_refund_funding: "เงินคืนที่ไม่รู้ว่าร้านหรือแพลตฟอร์มรับภาระ (คิดเป็นของร้าน)",
  provisional_status: "คำสั่งซื้อยังไม่สำเร็จ ค่าธรรมเนียมอาจยังไม่ใช่ยอดสุดท้าย",
};

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
  /** v1.3+: สร้างจากรายงานการเงิน (อ่านอย่างเดียว) */
  source?: { kind: "settlement"; entryKey: string };
  /** v1.3+: ค่าใช้จ่ายที่กรอกเองซึ่งถูกแทนด้วยรายการในรายงานการเงิน (ไม่นับ แต่ไม่ลบ) */
  supersededBy?: string;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  importedAt: string;
  rowCount: number;
  /** รูปแบบไฟล์ที่ใช้นำเข้า (v1.2+) เช่น generic, shopee */
  adapterId?: string;
  /** checksum ของไฟล์ (v1.2+) ใช้เตือนเมื่อนำเข้าไฟล์เดิมซ้ำ */
  fileHash?: string;
}

/**
 * SKU จากไฟล์ต้นทางที่ผู้ใช้จับคู่กับสินค้าในระบบไว้ (v1.2+)
 * ครั้งต่อไปที่พบ SKU นี้ ระบบจะจับคู่ให้อัตโนมัติ
 */
export interface SkuAlias {
  /** SKU จากไฟล์ (ตัวพิมพ์ใหญ่) */
  alias: string;
  productId: string;
  createdAt: string;
}

export interface DateRange {
  /** YYYY-MM-DD หรือ null = ไม่จำกัด */
  from: string | null;
  to: string | null;
}
