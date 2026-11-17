/**
 * ตรวจความถูกต้องของข้อมูลแต่ละประเภท ใช้ร่วมกันทั้งตอนนำเข้า CSV, บันทึกฟอร์ม และกู้คืน Backup
 */
import { ESTIMATE_REASONS, EXPENSE_CATEGORIES, OPTIONAL_SALE_FIELDS, type Expense, type ImportBatch, type Product, type Sale, type SkuAlias } from "./types";

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
  if (s.orderKey !== undefined && !isStr(s.orderKey, 200)) e.push("orderKey ไม่ถูกต้อง");
  if (s.lineKey !== undefined && !isStr(s.lineKey, 400)) e.push("lineKey ไม่ถูกต้อง");
  if (s.estimateUpside !== undefined && !isMoney(s.estimateUpside)) e.push("estimateUpside ไม่ถูกต้อง");
  if (s.estimateReasons !== undefined) {
    const er = s.estimateReasons;
    if (!Array.isArray(er) || !er.every((r) => (ESTIMATE_REASONS as readonly unknown[]).includes(r))) e.push("estimateReasons ไม่ถูกต้อง");
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
  if (x.source !== undefined) {
    const src = asRec(x.source);
    if (!src || src.kind !== "settlement" || !isStr(src.entryKey, 400)) e.push("ที่มาของค่าใช้จ่ายไม่ถูกต้อง");
  }
  if (x.supersededBy !== undefined && !isStr(x.supersededBy, 400)) e.push("supersededBy ไม่ถูกต้อง");
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

// ---------- v1.3: คำสั่งซื้อและรายงานการเงิน (จำนวนเงินเป็นสตางค์ จำนวนเต็ม) ----------
const isInt = (v: unknown, min = Number.MIN_SAFE_INTEGER): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const ORDER_STATUS_VALUES = ["pending_payment", "paid", "processing", "shipped", "completed", "cancelled", "unspecified"];
const FEE_KEYS = ["commission", "transaction", "service", "shipping", "other"];

export function orderErrors(v: unknown): string[] {
  const o = asRec(v);
  if (!o) return ["ไม่ใช่ข้อมูลคำสั่งซื้อ"];
  const e: string[] = [];
  if (!isStr(o.key, 200)) e.push("key ไม่ถูกต้อง");
  if (!isStr(o.channel, LIMITS.channelLength)) e.push("ช่องทางไม่ถูกต้อง");
  if (!isStr(o.orderId, LIMITS.orderIdLength)) e.push("เลขคำสั่งซื้อไม่ถูกต้อง");
  if (!isISODate(o.orderDate)) e.push("วันที่ไม่ถูกต้อง");
  if (!ORDER_STATUS_VALUES.includes(o.status as string)) e.push(`สถานะไม่ถูกต้อง (${String(o.status)})`);
  if (typeof o.rawStatus !== "string") e.push("สถานะตามไฟล์ไม่ถูกต้อง");
  if (o.sourceUpdatedAt !== undefined && !isTimestamp(o.sourceUpdatedAt)) e.push("เวลาอัปเดตตามไฟล์ไม่ถูกต้อง");
  if (!isStr(o.contentHash, 64) || !isInt(o.revisionCount, 0)) e.push("ข้อมูลประวัติไม่ถูกต้อง");
  if (!isStr(o.firstBatchId, 100) || !isStr(o.lastBatchId, 100)) e.push("ชุดนำเข้าไม่ถูกต้อง");
  if (!isTimestamp(o.createdAt) || !isTimestamp(o.updatedAt)) e.push("วันเวลาที่บันทึกไม่ถูกต้อง");
  if (!Array.isArray(o.lines) || o.lines.length === 0) {
    e.push("ไม่มีบรรทัดสินค้า");
    return e;
  }
  const keys = new Set<string>();
  o.lines.forEach((raw, i) => {
    const l = asRec(raw);
    const at = `บรรทัด ${i + 1}`;
    if (!l) return e.push(`${at}: ไม่ถูกต้อง`);
    if (!isStr(l.lineKey, 400) || keys.has(l.lineKey)) e.push(`${at}: lineKey ไม่ถูกต้องหรือซ้ำ`);
    else keys.add(l.lineKey);
    if (!isStr(l.saleId, 100)) e.push(`${at}: saleId ไม่ถูกต้อง`);
    if (!isCount(l.quantity, 1)) e.push(`${at}: จำนวนไม่ถูกต้อง`);
    for (const k of ["grossSatang", "sellerDiscount", "platformSubsidy", "unknownDiscount", "refundSeller", "refundPlatform", "refundUnknown", "feeRefunded", "shippingRefunded", "returnShippingCost"]) {
      if (!isInt(l[k], 0)) e.push(`${at}: ${k} ต้องเป็นจำนวนเต็มสตางค์ไม่ติดลบ`);
    }
    for (const k of ["returnedResellable", "returnedDamaged", "notReturned"]) if (!isInt(l[k], 0)) e.push(`${at}: ${k} ไม่ถูกต้อง`);
    const fees = asRec(l.fees);
    if (!fees || !FEE_KEYS.every((k) => isInt(fees[k], 0))) e.push(`${at}: ค่าธรรมเนียมไม่ถูกต้อง`);
    if (isCount(l.quantity, 1) && isInt(l.returnedResellable) && isInt(l.returnedDamaged) && isInt(l.notReturned)) {
      if (l.returnedResellable + l.returnedDamaged + l.notReturned > l.quantity) e.push(`${at}: จำนวนชิ้นที่คืนรวมกันเกินจำนวนที่ขาย`);
    }
  });
  return e;
}

export function orderRevisionErrors(v: unknown): string[] {
  const r = asRec(v);
  if (!r) return ["ไม่ใช่ข้อมูลประวัติ"];
  const e: string[] = [];
  if (r.seq !== undefined && !isInt(r.seq, 1)) e.push("ลำดับไม่ถูกต้อง");
  if (!isStr(r.orderKey, 200)) e.push("orderKey ไม่ถูกต้อง");
  if (!isStr(r.batchId, 100)) e.push("batchId ไม่ถูกต้อง");
  if (!isTimestamp(r.appliedAt)) e.push("วันเวลาไม่ถูกต้อง");
  if (!["create", "update", "adopt", "settlement", "user"].includes(r.kind as string)) e.push("ประเภทไม่ถูกต้อง");
  if (!Array.isArray(r.changes)) e.push("รายการเปลี่ยนแปลงไม่ถูกต้อง");
  return e;
}

export function settlementReportErrors(v: unknown): string[] {
  const r = asRec(v);
  if (!r) return ["ไม่ใช่ข้อมูลรายงานการเงิน"];
  const e: string[] = [];
  if (!isStr(r.id, 100)) e.push("id ไม่ถูกต้อง");
  if (!isStr(r.adapterId, 40) || !isStr(r.fileName, LIMITS.fileNameLength) || !isStr(r.fileHash, 64)) e.push("ข้อมูลไฟล์ไม่ถูกต้อง");
  if (r.periodFrom !== undefined && !isISODate(r.periodFrom)) e.push("ช่วงเวลาไม่ถูกต้อง");
  if (r.periodTo !== undefined && !isISODate(r.periodTo)) e.push("ช่วงเวลาไม่ถูกต้อง");
  if (!isTimestamp(r.importedAt) || !isInt(r.entryCount, 0)) e.push("ข้อมูลการนำเข้าไม่ถูกต้อง");
  return e;
}

export function settlementEntryErrors(v: unknown): string[] {
  const x = asRec(v);
  if (!x) return ["ไม่ใช่รายการในรายงานการเงิน"];
  const e: string[] = [];
  if (!isStr(x.entryKey, 400)) e.push("entryKey ไม่ถูกต้อง");
  if (!Array.isArray(x.reportIds) || x.reportIds.length === 0 || !x.reportIds.every((id) => isStr(id, 100))) e.push("reportIds ไม่ถูกต้อง");
  if (x.orderKey !== undefined && !isStr(x.orderKey, 200)) e.push("orderKey ไม่ถูกต้อง");
  if (![...FEE_KEYS, "fee_refund", "payout", "adjustment"].includes(x.type as string)) e.push(`ประเภทไม่ถูกต้อง (${String(x.type)})`);
  if (!isInt(x.amount) || Math.abs(x.amount as number) > LIMITS.maxAmount * 100) e.push("จำนวนเงินต้องเป็นจำนวนเต็มสตางค์");
  if (!isISODate(x.occurredAt)) e.push("วันที่ไม่ถูกต้อง");
  if (typeof x.description !== "string" || x.description.length > LIMITS.noteLength) e.push("คำอธิบายไม่ถูกต้อง");
  return e;
}
