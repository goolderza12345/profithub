/**
 * ตรวจความถูกต้องของข้อมูลแต่ละประเภท ใช้ร่วมกันทั้งตอนนำเข้า CSV, บันทึกฟอร์ม และกู้คืน Backup
 */
import { EXPENSE_CATEGORIES, OPTIONAL_SALE_FIELDS, type Expense, type ImportBatch, type Product, type Sale, type SkuAlias } from "./types";

export const LIMITS = {
  skuLength: 64,
  orderIdLength: 64,
  channelLength: 40,
  nameLength: 200,
  noteLength: 300,
  fileNameLength: 255,
  /** จำนวนเงินสูงสุดต่อช่อง (บาท) */
  maxAmount: 100_000_000,
  maxQuantity: 1_000_000,
  maxCsvRows: 20_000,
} as const;

/** SKU: ห้ามมีช่องว่าง จุลภาค หรืออักขระควบคุม (ตัวอักษรภาษาไทยใช้ได้) */
export const SKU_PATTERN = /^[^\s,\u0000-\u001f\u007f]+$/;

export function isISODate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100;
}

const isStr = (v: unknown, max: number, allowEmpty = false): v is string =>
  typeof v === "string" && v.length <= max && (allowEmpty || v.trim().length > 0);

export const isMoney = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= LIMITS.maxAmount;

const isCount = (v: unknown, min: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= LIMITS.maxQuantity;

const isTimestamp = (v: unknown) => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);

export function validateSku(sku: string): string | null {
  if (!sku) return "กรุณาระบุ SKU";
  if (sku.length > LIMITS.skuLength) return `SKU ยาวเกิน ${LIMITS.skuLength} ตัวอักษร`;
  if (!SKU_PATTERN.test(sku)) return "SKU ห้ามมีช่องว่าง เครื่องหมายจุลภาค หรืออักขระพิเศษที่มองไม่เห็น";
  if (sku !== sku.toUpperCase()) return "SKU ต้องเป็นตัวพิมพ์ใหญ่";
  return null;
}

export function productErrors(v: unknown): string[] {
  const p = asRec(v);
  if (!p) return ["ไม่ใช่ข้อมูลสินค้า"];
  const e: string[] = [];
  if (!isStr(p.id, 100)) e.push("id ไม่ถูกต้อง");
  if (typeof p.sku !== "string" || validateSku(p.sku)) e.push(`SKU ไม่ถูกต้อง (${String(p.sku)})`);
  if (!isStr(p.name, LIMITS.nameLength)) e.push("ชื่อสินค้าไม่ถูกต้อง");
  if (!isMoney(p.unitCost)) e.push("ต้นทุนต่อชิ้นไม่ถูกต้อง");
  if (!isTimestamp(p.createdAt) || !isTimestamp(p.updatedAt)) e.push("วันเวลาที่บันทึกไม่ถูกต้อง");
  return e;
}

export function saleErrors(v: unknown): string[] {
  const s = asRec(v);
  if (!s) return ["ไม่ใช่ข้อมูลรายการขาย"];
  const e: string[] = [];
  if (!isStr(s.id, 100)) e.push("id ไม่ถูกต้อง");
  if (!isStr(s.orderId, LIMITS.orderIdLength)) e.push("เลขคำสั่งซื้อไม่ถูกต้อง");
  if (!isISODate(s.date)) e.push(`วันที่ไม่ถูกต้อง (${String(s.date)})`);
  if (!isStr(s.channel, LIMITS.channelLength)) e.push("ช่องทางไม่ถูกต้อง");
  if (typeof s.sku !== "string" || validateSku(s.sku)) e.push(`SKU ไม่ถูกต้อง (${String(s.sku)})`);
  if (!isCount(s.quantity, 1)) e.push("จำนวนชิ้นไม่ถูกต้อง");
  if (!isCount(s.returnedQty, 0)) e.push("จำนวนชิ้นที่ได้รับคืนไม่ถูกต้อง");
  else if (typeof s.quantity === "number" && s.returnedQty > s.quantity) e.push("ชิ้นที่ได้รับคืนมากกว่าจำนวนที่ขาย");
  for (const k of ["unitPrice", "discount", "refund", "platformFee", "shippingFee"] as const) {
    if (!isMoney(s[k])) e.push(`${k} ไม่ถูกต้อง`);
  }
  if (s.unitCost !== undefined && !isMoney(s.unitCost)) e.push("ต้นทุนต่อชิ้น (snapshot) ไม่ถูกต้อง");
  if (s.sourceSku !== undefined && (typeof s.sourceSku !== "string" || validateSku(s.sourceSku))) {
    e.push(`SKU ตามไฟล์ต้นทางไม่ถูกต้อง (${String(s.sourceSku)})`);
  }
  if (s.missingFields !== undefined) {
    const mf = s.missingFields;
    const ok =
      Array.isArray(mf) &&
      mf.every((f) => (OPTIONAL_SALE_FIELDS as readonly unknown[]).includes(f)) &&
      new Set(mf).size === mf.length;
    if (!ok) e.push("รายการช่องที่ไม่มีข้อมูล (missingFields) ไม่ถูกต้อง");
  }
  if (isMoney(s.unitPrice) && isCount(s.quantity, 1) && isMoney(s.discount) && isMoney(s.refund)) {
    if (s.discount + s.refund > s.unitPrice * s.quantity + 0.001) e.push("ส่วนลดรวมเงินคืนมากกว่ายอดขาย");
  }
  if (!isStr(s.dedupeKey, 300)) e.push("dedupeKey ไม่ถูกต้อง");
  if (!isStr(s.batchId, 100)) e.push("batchId ไม่ถูกต้อง");
  return e;
}

export function expenseErrors(v: unknown): string[] {
  const x = asRec(v);
  if (!x) return ["ไม่ใช่ข้อมูลค่าใช้จ่าย"];
  const e: string[] = [];
  if (!isStr(x.id, 100)) e.push("id ไม่ถูกต้อง");
  if (!isISODate(x.date)) e.push(`วันที่ไม่ถูกต้อง (${String(x.date)})`);
  if (!(EXPENSE_CATEGORIES as readonly unknown[]).includes(x.category)) e.push(`ประเภทค่าใช้จ่ายไม่ถูกต้อง (${String(x.category)})`);
  if (!isMoney(x.amount) || x.amount <= 0) e.push("จำนวนเงินไม่ถูกต้อง");
  if (!isStr(x.channel, LIMITS.channelLength, true)) e.push("ช่องทางไม่ถูกต้อง");
  if (!isStr(x.note, LIMITS.noteLength, true)) e.push("หมายเหตุไม่ถูกต้อง");
  if (!isTimestamp(x.createdAt)) e.push("วันเวลาที่บันทึกไม่ถูกต้อง");
  return e;
}

export function batchErrors(v: unknown): string[] {
  const b = asRec(v);
  if (!b) return ["ไม่ใช่ข้อมูลชุดนำเข้า"];
  const e: string[] = [];
  if (!isStr(b.id, 100)) e.push("id ไม่ถูกต้อง");
  if (!isStr(b.fileName, LIMITS.fileNameLength)) e.push("ชื่อไฟล์ไม่ถูกต้อง");
  if (!isTimestamp(b.importedAt)) e.push("วันเวลานำเข้าไม่ถูกต้อง");
  if (!isCount(b.rowCount, 0)) e.push("จำนวนแถวไม่ถูกต้อง");
  if (b.adapterId !== undefined && !isStr(b.adapterId, 40)) e.push("รูปแบบไฟล์ (adapterId) ไม่ถูกต้อง");
  if (b.fileHash !== undefined && !isStr(b.fileHash, 64)) e.push("checksum ของไฟล์ไม่ถูกต้อง");
  return e;
}

export function skuAliasErrors(v: unknown): string[] {
  const a = asRec(v);
  if (!a) return ["ไม่ใช่ข้อมูลการจับคู่ SKU"];
  const e: string[] = [];
  if (typeof a.alias !== "string" || validateSku(a.alias)) e.push(`SKU ในไฟล์ไม่ถูกต้อง (${String(a.alias)})`);
  if (!isStr(a.productId, 100)) e.push("productId ไม่ถูกต้อง");
  if (!isTimestamp(a.createdAt)) e.push("วันเวลาที่บันทึกไม่ถูกต้อง");
  return e;
}

/** ใช้ type guard หลังผ่านการตรวจแล้ว */
export const isProduct = (v: unknown): v is Product => productErrors(v).length === 0;
export const isSale = (v: unknown): v is Sale => saleErrors(v).length === 0;
export const isExpense = (v: unknown): v is Expense => expenseErrors(v).length === 0;
export const isBatch = (v: unknown): v is ImportBatch => batchErrors(v).length === 0;
export const isSkuAlias = (v: unknown): v is SkuAlias => skuAliasErrors(v).length === 0;
