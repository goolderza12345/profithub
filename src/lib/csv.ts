import Papa from "papaparse";
import { toISODate } from "./dates";
import type { Sale } from "./types";

/** คอลัมน์ของไฟล์นำเข้ายอดขาย */
export const SALES_COLUMNS = [
  { key: "order_id", required: true, label: "เลขคำสั่งซื้อ", hint: "เช่น 2611050001" },
  { key: "order_date", required: true, label: "วันที่สั่งซื้อ", hint: "YYYY-MM-DD หรือ DD/MM/YYYY (รองรับ พ.ศ.)" },
  { key: "channel", required: true, label: "ช่องทางขาย", hint: "Shopee, Lazada, TikTok Shop, LINE, Facebook, Website" },
  { key: "sku", required: true, label: "SKU", hint: "ต้องตรงกับ SKU ในหน้าสินค้า" },
  { key: "quantity", required: true, label: "จำนวนชิ้น", hint: "จำนวนเต็มตั้งแต่ 1" },
  { key: "unit_price", required: true, label: "ราคาขายต่อชิ้น", hint: "ก่อนหักส่วนลด" },
  { key: "discount", required: false, label: "ส่วนลดที่ร้านออก", hint: "รวมทั้งบรรทัด ว่างได้ = 0" },
  { key: "refund", required: false, label: "เงินคืนลูกค้า", hint: "รวมทั้งบรรทัด ว่างได้ = 0" },
  { key: "returned_qty", required: false, label: "ชิ้นที่ได้รับคืน", hint: "ชิ้นที่กลับเข้าสต็อก ว่างได้ = 0" },
  { key: "platform_fee", required: false, label: "ค่าธรรมเนียมแพลตฟอร์ม", hint: "ที่ถูกหักในคำสั่งซื้อนี้ ว่างได้ = 0" },
  { key: "shipping_fee", required: false, label: "ค่าขนส่งที่ร้านออก", hint: "ในคำสั่งซื้อนี้ ว่างได้ = 0" },
] as const;

type ColumnKey = (typeof SALES_COLUMNS)[number]["key"];

/** ชื่อหัวคอลัมน์ภาษาไทยที่รับได้ด้วย */
const HEADER_ALIASES: Record<string, ColumnKey> = {
  เลขคำสั่งซื้อ: "order_id",
  วันที่สั่งซื้อ: "order_date",
  วันที่: "order_date",
  ช่องทางขาย: "channel",
  ช่องทาง: "channel",
  sku: "sku",
  จำนวนชิ้น: "quantity",
  จำนวน: "quantity",
  ราคาขายต่อชิ้น: "unit_price",
  ราคาต่อชิ้น: "unit_price",
  ส่วนลด: "discount",
  ส่วนลดที่ร้านออก: "discount",
  เงินคืน: "refund",
  เงินคืนลูกค้า: "refund",
  ชิ้นที่ได้รับคืน: "returned_qty",
  ค่าธรรมเนียมแพลตฟอร์ม: "platform_fee",
  ค่าธรรมเนียม: "platform_fee",
  ค่าขนส่งที่ร้านออก: "shipping_fee",
  ค่าขนส่ง: "shipping_fee",
};

export const SAMPLE_CSV = [
  SALES_COLUMNS.map((c) => c.key).join(","),
  "SHP-2611-0001,2026-11-01,Shopee,TS-001,2,199,20,0,0,23.88,0",
  "SHP-2611-0001,2026-11-01,Shopee,MUG-002,1,250,0,0,0,15,0",
  "LZD-2611-0002,02/11/2569,Lazada,TS-001,1,199,0,0,0,11.94,15",
  "TTS-2611-0003,2026-11-03,TikTok Shop,MUG-002,3,240,30,240,1,36,0",
].join("\n");

const KNOWN_CHANNELS: Record<string, string> = {
  shopee: "Shopee",
  lazada: "Lazada",
  tiktok: "TikTok Shop",
  "tiktok shop": "TikTok Shop",
  tiktokshop: "TikTok Shop",
  line: "LINE",
  "line shopping": "LINE",
  "line oa": "LINE",
  facebook: "Facebook",
  fb: "Facebook",
  website: "Website",
  web: "Website",
};

export const CHANNEL_OPTIONS = ["Shopee", "Lazada", "TikTok Shop", "LINE", "Facebook", "Website"];

export function normalizeChannel(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  return KNOWN_CHANNELS[t.toLowerCase()] ?? t;
}

export function makeDedupeKey(channel: string, orderId: string, sku: string): string {
  return `${channel.trim().toLowerCase()}|${orderId.trim()}|${sku.trim().toUpperCase()}`;
}

/** แปลงตัวเลข: ตัดคอมมา ช่องว่าง และสัญลักษณ์ ฿ ; คืน null ถ้าไม่ใช่ตัวเลข */
export function parseAmount(raw: string | undefined): number | null | "empty" {
  const t = (raw ?? "").replace(/[,\s฿]/g, "").replace(/บาท$/, "");
  if (t === "") return "empty";
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** รับ YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, DD-MM-YYYY (ปี พ.ศ. แปลงอัตโนมัติ) และตัดเวลาทิ้ง */
export function parseDate(raw: string | undefined): string | null {
  const t = (raw ?? "").trim().split(/[ T]/)[0];
  let y: number, m: number, d: number;
  let match = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  if (y > 2400) y -= 543;
  if (y < 2000 || y > 2100) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return toISODate(dt);
}

export type SaleDraft = Omit<Sale, "id" | "batchId">;

export type RowStatus = "ok" | "error" | "duplicate";

export interface RowResult {
  /** เลขแถวตามไฟล์ (หัวตาราง = แถว 1) */
  row: number;
  status: RowStatus;
  errors: string[];
  sale?: SaleDraft;
  raw: Record<string, string>;
}

export interface ValidationResult {
  fileErrors: string[];
  rows: RowResult[];
  okCount: number;
  errorCount: number;
  duplicateCount: number;
}

export interface ValidateOptions {
  knownSkus: Set<string>;
  existingKeys: Set<string>;
}

export function mapHeader(h: string): string {
  const t = h.replace(/^﻿/, "").trim();
  const lower = t.toLowerCase().replace(/\s+/g, "_");
  if (SALES_COLUMNS.some((c) => c.key === lower)) return lower;
  return HEADER_ALIASES[t] ?? HEADER_ALIASES[lower] ?? t;
}

export function validateSalesCsv(text: string, opts: ValidateOptions): ValidationResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: mapHeader,
  });

  const fileErrors: string[] = [];
  const headers = parsed.meta.fields ?? [];
  const missing = SALES_COLUMNS.filter((c) => c.required && !headers.includes(c.key));
  if (missing.length) {
    fileErrors.push(`ไม่พบคอลัมน์ที่จำเป็น: ${missing.map((c) => `${c.key} (${c.label})`).join(", ")}`);
  }
  if (parsed.data.length === 0 && fileErrors.length === 0) fileErrors.push("ไฟล์ไม่มีข้อมูล");
  for (const e of parsed.errors) {
    if (e.code === "UndetectableDelimiter") continue;
    if (e.row === undefined) fileErrors.push(`อ่านไฟล์ไม่ได้: ${e.message}`);
  }
  if (fileErrors.length) return { fileErrors, rows: [], okCount: 0, errorCount: 0, duplicateCount: 0 };

  const parseErrorRows = new Map<number, string>();
  for (const e of parsed.errors) {
    if (e.row !== undefined && e.code === "TooManyFields") parseErrorRows.set(e.row, "จำนวนคอลัมน์มากกว่าหัวตาราง");
    else if (e.row !== undefined && e.code === "TooFewFields") parseErrorRows.set(e.row, "จำนวนคอลัมน์น้อยกว่าหัวตาราง");
  }

  const seenInFile = new Map<string, number>();
  const rows: RowResult[] = parsed.data.map((raw, i) => {
    const rowNo = i + 2;
    const errors: string[] = [];
    const structural = parseErrorRows.get(i);
    if (structural) errors.push(structural);

    const str = (k: ColumnKey) => (raw[k] ?? "").trim();

    const orderId = str("order_id");
    if (!orderId) errors.push("ไม่มีเลขคำสั่งซื้อ (order_id)");

    const date = parseDate(raw.order_date);
    if (!date) errors.push(`วันที่ไม่ถูกต้อง "${str("order_date")}" (ใช้ YYYY-MM-DD หรือ DD/MM/YYYY)`);

    const channel = normalizeChannel(str("channel"));
    if (!channel) errors.push("ไม่มีช่องทางขาย (channel)");

    const sku = str("sku").toUpperCase();
    if (!sku) errors.push("ไม่มี SKU");
    else if (!opts.knownSkus.has(sku)) errors.push(`ไม่พบ SKU "${sku}" ในหน้าสินค้า กรุณาเพิ่มสินค้าและต้นทุนก่อน`);

    const num = (k: ColumnKey, label: string, required: boolean, integer = false): number => {
      const v = parseAmount(raw[k]);
      if (v === "empty") {
        if (required) errors.push(`ไม่มี${label} (${k})`);
        return 0;
      }
      if (v === null) {
        errors.push(`${label}ไม่ใช่ตัวเลข "${str(k)}"`);
        return 0;
      }
      if (v < 0) errors.push(`${label}ต้องไม่ติดลบ`);
      if (integer && !Number.isInteger(v)) errors.push(`${label}ต้องเป็นจำนวนเต็ม`);
      return v;
    };

    const quantity = num("quantity", "จำนวนชิ้น", true, true);
    if (parseAmount(raw.quantity) === 0) errors.push("จำนวนชิ้นต้องมากกว่า 0");
    const unitPrice = num("unit_price", "ราคาขายต่อชิ้น", true);
    const discount = num("discount", "ส่วนลด", false);
    const refund = num("refund", "เงินคืน", false);
    const returnedQty = num("returned_qty", "ชิ้นที่ได้รับคืน", false, true);
    const platformFee = num("platform_fee", "ค่าธรรมเนียมแพลตฟอร์ม", false);
    const shippingFee = num("shipping_fee", "ค่าขนส่ง", false);

    const gross = unitPrice * quantity;
    if (discount > gross) errors.push("ส่วนลดมากกว่ายอดขายของบรรทัด");
    if (discount + refund > gross + 0.001) errors.push("ส่วนลดรวมเงินคืนมากกว่ายอดขายของบรรทัด");
    if (returnedQty > quantity) errors.push("ชิ้นที่ได้รับคืนมากกว่าจำนวนชิ้นที่ขาย");

    const dedupeKey = makeDedupeKey(channel, orderId, sku);
    let status: RowStatus = errors.length ? "error" : "ok";
    if (status === "ok") {
      if (opts.existingKeys.has(dedupeKey)) {
        status = "duplicate";
        errors.push("รายการนี้ถูกนำเข้าแล้ว (ช่องทาง + เลขคำสั่งซื้อ + SKU ซ้ำ)");
      } else if (seenInFile.has(dedupeKey)) {
        status = "duplicate";
        errors.push(`ซ้ำกับแถว ${seenInFile.get(dedupeKey)} ในไฟล์นี้ (หากเป็นสินค้าเดียวกัน ให้รวมจำนวนเป็นแถวเดียว)`);
      } else {
        seenInFile.set(dedupeKey, rowNo);
      }
    }

    return {
      row: rowNo,
      status,
      errors,
      raw,
      sale:
        status === "ok"
          ? {
              orderId,
              date: date!,
              channel,
              sku,
              quantity,
              unitPrice,
              discount,
              refund,
              returnedQty,
              platformFee,
              shippingFee,
              dedupeKey,
            }
          : undefined,
    };
  });

  return {
    fileErrors: [],
    rows,
    okCount: rows.filter((r) => r.status === "ok").length,
    errorCount: rows.filter((r) => r.status === "error").length,
    duplicateCount: rows.filter((r) => r.status === "duplicate").length,
  };
}

/** สร้างข้อความ CSV (มี BOM เพื่อให้ Excel แสดงภาษาไทยถูกต้อง) */
export function toCsv(rows: (string | number)[][]): string {
  return "﻿" + Papa.unparse(rows);
}
