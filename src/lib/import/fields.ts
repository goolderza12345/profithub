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
  | "shippingFee";

/** ช่องจำนวนเงินที่อาจเป็น "ค่าระดับคำสั่งซื้อ" (ซ้ำทุกบรรทัดของคำสั่งซื้อเดียวกัน) */
export const SCOPEABLE_FIELDS = ["discount", "refund", "platformFee", "shippingFee"] as const;
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
  /** ช่องใน Sale ที่ถ้าไม่มีคอลัมน์ จะถูกบันทึกว่า "ไม่มีข้อมูล" */
  optionalField?: OptionalSaleField;
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
];

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
};
