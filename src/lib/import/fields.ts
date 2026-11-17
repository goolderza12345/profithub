/**
 * ช่องข้อมูลที่ ProfitHub ต้องการจากไฟล์ยอดขาย (ไม่ผูกกับรูปแบบไฟล์ของแพลตฟอร์มใด)
 */
import type { OptionalSaleField } from "../types";

export type ImportFieldKey =
  | "orderId"
  | "orderDate"
  | "channel"
  | "sku"
  | "productName"
  | "quantity"
  | "unitPrice"
  | "lineTotal"
  | "discount"
  | "refund"
  | "returnedQty"
  | "platformFee"
  | "shippingFee"
  // v1.3 ข้อมูลเพิ่มเติม
  | "orderStatus"
  | "statusUpdatedAt"
  | "lineId"
  | "platformSubsidy"
  | "unknownDiscount"
  | "refundPlatform"
  | "refundUnknown"
  | "returnedDamagedQty"
  | "notReturnedQty"
  | "commissionFee"
  | "transactionFee"
  | "serviceFee"
  | "feeRefunded"
  | "shippingRefunded"
  | "returnShippingCost";

/** ช่องจำนวนเงินที่อาจเป็น "ค่าระดับคำสั่งซื้อ" (ซ้ำทุกบรรทัดของคำสั่งซื้อเดียวกัน) */
export const SCOPEABLE_FIELDS = [
  "discount",
  "refund",
  "platformFee",
  "shippingFee",
  "platformSubsidy",
  "unknownDiscount",
  "refundPlatform",
  "refundUnknown",
  "commissionFee",
  "transactionFee",
  "serviceFee",
  "feeRefunded",
  "shippingRefunded",
  "returnShippingCost",
] as const;
export type ScopeableField = (typeof SCOPEABLE_FIELDS)[number];
export type AmountScope = "line" | "order";

export interface ImportFieldDef {
  key: ImportFieldKey;
  label: string;
  hint: string;
  kind: "text" | "date" | "int" | "money";
  /** true = บังคับ, "price" = ต้องมี unitPrice หรือ lineTotal อย่างใดอย่างหนึ่ง, "channel" = คอลัมน์หรือเลือกช่องทางคงที่ */
  required: boolean | "price" | "channel";
  /** รวมหลายคอลัมน์ได้ (เช่น ค่าธรรมเนียมหลายประเภท) */
  multi: boolean;
  /** ช่องใน Sale ที่ช่องนี้เป็นแหล่งข้อมูล — ถ้าไม่มีคอลัมน์ใดของช่องนั้นเลย จะถูกบันทึกว่า "ไม่มีข้อมูล" */
  optionalField?: OptionalSaleField;
  /** main = แสดงเสมอ, advanced = อยู่ในส่วน "ข้อมูลเพิ่มเติม" */
  group?: "main" | "advanced";
  /** คำที่ถ้าอยู่ในหัวคอลัมน์ ห้ามเดา (fuzzy) ว่าเป็นช่องนี้ — กันเดาส่วนลดของแพลตฟอร์มเป็นส่วนลดของร้าน */
  fuzzyExclude?: string[];
  /** เป็นรายการหัก (ติดลบในไฟล์ได้ถ้าผู้ใช้เลือกให้ตีความเป็นรายการหัก) */
  deduction: boolean;
  /** ชื่อหัวคอลัมน์ทั่วไปที่ใช้เดา (ไม่ใช่รูปแบบเฉพาะของแพลตฟอร์มใด) */
  aliases: string[];
}

export const IMPORT_FIELDS: ImportFieldDef[] = [
  {
    key: "orderId",
    label: "เลขคำสั่งซื้อ",
    hint: "ใช้ร่วมกับช่องทางและ SKU เพื่อกันรายการซ้ำ",
    kind: "text",
    required: true,
    multi: false,
    deduction: false,
    aliases: ["order_id", "เลขคำสั่งซื้อ", "หมายเลขคำสั่งซื้อ", "รหัสคำสั่งซื้อ", "order id", "order number", "order no", "order sn"],
  },
  {
    key: "orderDate",
    label: "วันที่สั่งซื้อ",
    hint: "YYYY-MM-DD, DD/MM/YYYY (รองรับ พ.ศ.) หรือช่องวันที่ของ Excel",
    kind: "date",
    required: true,
    multi: false,
    deduction: false,
    aliases: ["order_date", "วันที่สั่งซื้อ", "วันที่", "วันที่สร้างคำสั่งซื้อ", "order date", "date", "created time", "order created time", "order creation date"],
  },
  {
    key: "channel",
    label: "ช่องทางขาย",
    hint: "ถ้าไฟล์ไม่มีคอลัมน์นี้ ให้เลือกช่องทางเดียวสำหรับทั้งไฟล์",
    kind: "text",
    required: "channel",
    multi: false,
    deduction: false,
    aliases: ["channel", "ช่องทางขาย", "ช่องทาง", "platform", "marketplace", "แพลตฟอร์ม"],
  },
  {
    key: "sku",
    label: "SKU",
    hint: "ใช้จับคู่กับสินค้าในระบบ",
    kind: "text",
    required: true,
    multi: false,
    deduction: false,
    aliases: ["sku", "seller sku", "รหัสสินค้า", "sku สินค้า", "เลข sku", "product sku", "sku reference no", "รหัส sku"],
  },
  {
    key: "productName",
    label: "ชื่อสินค้า",
    hint: "ใช้แสดงในหน้าตรวจสอบและตอนจับคู่สินค้า (ไม่บังคับ)",
    kind: "text",
    required: false,
    multi: false,
    deduction: false,
    aliases: ["ชื่อสินค้า", "สินค้า", "product name", "item name", "product", "name"],
  },
  {
    key: "quantity",
    label: "จำนวนชิ้น",
    hint: "จำนวนเต็มตั้งแต่ 1",
    kind: "int",
    required: true,
    multi: false,
    deduction: false,
    aliases: ["quantity", "จำนวนชิ้น", "จำนวน", "qty", "จำนวนที่สั่ง"],
  },
  {
    key: "unitPrice",
    label: "ราคาขายต่อชิ้น",
    hint: "ก่อนหักส่วนลด — ใช้ช่องนี้ หรือยอดขายรวมของบรรทัด อย่างใดอย่างหนึ่ง",
    kind: "money",
    required: "price",
    multi: false,
    deduction: false,
    aliases: ["unit_price", "ราคาขายต่อชิ้น", "ราคาต่อชิ้น", "ราคา", "unit price", "price", "original price"],
  },
  {
    key: "lineTotal",
    label: "ยอดขายรวมของบรรทัด",
    hint: "ราคา × จำนวน ก่อนหักส่วนลด — ใช้เมื่อไฟล์ไม่มีราคาต่อชิ้น",
    kind: "money",
    required: "price",
    multi: false,
    deduction: false,
    aliases: ["line_total", "ยอดขายรวม", "ยอดรวม", "line total", "subtotal", "item subtotal"],
  },
  {
    key: "discount",
    label: "ส่วนลดที่ร้านออก",
    hint: "เฉพาะส่วนลดที่ร้านจ่ายเอง (ไม่รวมส่วนลดที่แพลตฟอร์มออกให้)",
    kind: "money",
    required: false,
    multi: true,
    optionalField: "discount",
    deduction: true,
    aliases: ["discount", "ส่วนลด", "ส่วนลดที่ร้านออก", "seller discount", "seller voucher"],
    fuzzyExclude: ["แพลตฟอร์ม", "platform", "shopee", "lazada", "tiktok", "coin", "เหรียญ", "subsid", "สนับสนุน"],
  },
  {
    key: "refund",
    label: "เงินคืนลูกค้า",
    hint: "เงินที่คืนลูกค้าจากการยกเลิก/คืนสินค้า",
    kind: "money",
    required: false,
    multi: true,
    optionalField: "refund",
    deduction: true,
    aliases: ["refund", "เงินคืน", "เงินคืนลูกค้า", "refund amount", "ยอดคืนเงิน"],
    fuzzyExclude: ["แพลตฟอร์ม", "platform", "ค่าธรรมเนียม", "fee", "ค่าส่ง", "shipping"],
  },
  {
    key: "returnedQty",
    label: "ชิ้นที่ได้รับคืน",
    hint: "ชิ้นที่กลับเข้าสต็อก (ไม่คิดต้นทุนสินค้า)",
    kind: "int",
    required: false,
    multi: false,
    optionalField: "returnedQty",
    deduction: false,
    aliases: ["returned_qty", "ชิ้นที่ได้รับคืน", "จำนวนคืน", "returned quantity", "return quantity"],
  },
  {
    key: "platformFee",
    label: "ค่าธรรมเนียมแพลตฟอร์ม",
    hint: "เลือกได้หลายคอลัมน์ (ระบบจะรวมให้) เช่น ค่าคอมมิชชัน ค่าบริการ ค่าธุรกรรม",
    kind: "money",
    required: false,
    multi: true,
    optionalField: "platformFee",
    deduction: true,
    aliases: ["platform_fee", "ค่าธรรมเนียมแพลตฟอร์ม", "ค่าธรรมเนียม", "commission fee", "service fee", "transaction fee", "platform fee"],
  },
  {
    key: "shippingFee",
    label: "ค่าขนส่งที่ร้านออก",
    hint: "เฉพาะส่วนที่ร้านจ่าย (ไม่รวมค่าส่งที่ลูกค้าจ่าย)",
    kind: "money",
    required: false,
    multi: true,
    optionalField: "shippingFee",
    deduction: true,
    aliases: ["shipping_fee", "ค่าขนส่งที่ร้านออก", "ค่าขนส่ง", "seller shipping fee", "shipping fee paid by seller"],
  },
  // ---------- v1.3: ข้อมูลเพิ่มเติม (ไม่บังคับ) ----------
  adv("orderStatus", "สถานะคำสั่งซื้อ", "รอชำระและยกเลิกจะไม่นับในกำไร — สถานะที่ระบบไม่รู้จักต้องจับคู่เอง", "text", ["order_status", "สถานะคำสั่งซื้อ", "สถานะ", "status", "order status"]),
  adv("statusUpdatedAt", "เวลาอัปเดตสถานะ", "ใช้กันไม่ให้ไฟล์เก่าบันทึกทับข้อมูลใหม่", "text", ["status_updated_at", "เวลาอัปเดตสถานะ", "updated at", "update time"]),
  adv("lineId", "รหัสบรรทัดสินค้า", "รหัสของแต่ละรายการสินค้าในคำสั่งซื้อจากแพลตฟอร์ม (ถ้ามี) ช่วยจับคู่การอัปเดตได้แม่นยำ", "text", ["line_id", "รหัสบรรทัด", "item id", "line item id"]),
  adv("platformSubsidy", "ส่วนลดที่แพลตฟอร์มสนับสนุน", "โค้ด/เหรียญ/แคมเปญที่แพลตฟอร์มออกเงิน — ไม่หักจากรายได้ร้าน", "money", ["platform_subsidy", "ส่วนลดจากแพลตฟอร์ม", "ส่วนลดที่แพลตฟอร์มสนับสนุน"]),
  adv("unknownDiscount", "ส่วนลดที่ไม่รู้ผู้รับภาระ", "ระบบคิดเป็นของร้าน (ระมัดระวัง) และแสดงว่ากำไรอาจสูงขึ้นได้เท่าใด", "money", ["unknown_discount", "ส่วนลดไม่ระบุผู้รับภาระ"], "discount"),
  adv("refundPlatform", "เงินคืนที่แพลตฟอร์มรับภาระ", "ไม่กระทบรายได้ร้าน", "money", ["refund_platform", "เงินคืนที่แพลตฟอร์มรับภาระ"]),
  adv("refundUnknown", "เงินคืนที่ไม่รู้ผู้รับภาระ", "ระบบคิดเป็นของร้าน (ระมัดระวัง)", "money", ["refund_unknown", "เงินคืนไม่ระบุผู้รับภาระ"], "refund"),
  adv("returnedDamagedQty", "ชิ้นที่คืนแต่ชำรุด", "ได้สินค้าคืนแต่ขายต่อไม่ได้ — ยังคิดต้นทุนสินค้า", "int", ["returned_damaged_qty", "ชิ้นที่คืนแต่ชำรุด"]),
  adv("notReturnedQty", "ชิ้นที่ไม่ต้องส่งคืน", "คืนเงินโดยลูกค้าไม่ต้องส่งสินค้าคืน — ยังคิดต้นทุนสินค้า", "int", ["not_returned_qty", "ชิ้นที่ไม่ต้องส่งคืน"]),
  adv("commissionFee", "ค่าคอมมิชชัน", "", "money", ["commission_fee", "ค่าคอมมิชชัน"], "platformFee"),
  adv("transactionFee", "ค่าธรรมเนียมธุรกรรม", "", "money", ["transaction_fee", "ค่าธรรมเนียมธุรกรรม"], "platformFee"),
  adv("serviceFee", "ค่าบริการ", "", "money", ["service_fee", "ค่าบริการ"], "platformFee"),
  adv("feeRefunded", "ค่าธรรมเนียมที่ได้คืน", "เช่น เมื่อคืนเงินลูกค้า แพลตฟอร์มคืนค่าธรรมเนียมให้ร้าน", "money", ["fee_refunded", "ค่าธรรมเนียมที่ได้คืน"]),
  adv("shippingRefunded", "ค่าส่งที่ได้คืน", "", "money", ["shipping_refunded", "ค่าส่งที่ได้คืน"]),
  adv("returnShippingCost", "ค่าส่งสินค้าคืนที่ร้านจ่าย", "", "money", ["return_shipping_cost", "ค่าส่งสินค้าคืน"]),
];

function adv(
  key: ImportFieldKey,
  label: string,
  hint: string,
  kind: ImportFieldDef["kind"],
  aliases: string[],
  optionalField?: OptionalSaleField,
): ImportFieldDef {
  return { key, label, hint, kind, required: false, multi: kind === "money", deduction: kind === "money", aliases, group: "advanced", ...(optionalField ? { optionalField } : {}) };
}

export const FIELD_BY_KEY = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, f])) as Record<ImportFieldKey, ImportFieldDef>;

/** หัวคอลัมน์ของแม่แบบ ProfitHub (ไฟล์ตัวอย่างที่ดาวน์โหลดได้) */
export const TEMPLATE_HEADERS: Partial<Record<ImportFieldKey, string>> = {
  orderId: "order_id",
  orderDate: "order_date",
  channel: "channel",
  sku: "sku",
  quantity: "quantity",
  unitPrice: "unit_price",
  discount: "discount",
  refund: "refund",
  returnedQty: "returned_qty",
  platformFee: "platform_fee",
  shippingFee: "shipping_fee",
  orderStatus: "order_status",
  statusUpdatedAt: "status_updated_at",
  lineId: "line_id",
  platformSubsidy: "platform_subsidy",
  unknownDiscount: "unknown_discount",
  refundPlatform: "refund_platform",
  refundUnknown: "refund_unknown",
  returnedDamagedQty: "returned_damaged_qty",
  notReturnedQty: "not_returned_qty",
  commissionFee: "commission_fee",
  transactionFee: "transaction_fee",
  serviceFee: "service_fee",
  feeRefunded: "fee_refunded",
  shippingRefunded: "shipping_refunded",
  returnShippingCost: "return_shipping_cost",
};
