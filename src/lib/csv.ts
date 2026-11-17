import Papa from "papaparse";
import type { Sale } from "./types";
import { validateSku } from "./validation";
import { genericAdapter } from "./import/adapters/generic";
import { TEMPLATE_HEADERS, type ImportFieldKey } from "./import/fields";
import { defaultOptions, suggestMapping, type ColumnMapping } from "./import/mapping";
import { buildTable, csvToSheet } from "./import/table";
import { validateImport } from "./import/validate";

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

export { CHANNEL_OPTIONS, makeDedupeKey, normalizeChannel, parseAmount, parseDate } from "./import/parse";

/** รายการขายที่ผ่านการตรวจแล้ว พร้อมต้นทุนต่อชิ้น ณ เวลาตรวจ */
export type SaleDraft = Omit<Sale, "id" | "batchId" | "unitCost"> & { unitCost: number };

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
  /** SKU (ตัวพิมพ์ใหญ่) → ต้นทุนต่อชิ้นปัจจุบัน */
  productCosts: Map<string, number>;
  existingKeys: Set<string>;
}

export function mapHeader(h: string): string {
  const t = h.replace(/^﻿/, "").trim();
  const lower = t.toLowerCase().replace(/\s+/g, "_");
  if (SALES_COLUMNS.some((c) => c.key === lower)) return lower;
  return HEADER_ALIASES[t] ?? HEADER_ALIASES[lower] ?? t;
}

/**
 * ตรวจไฟล์แม่แบบ ProfitHub (CSV) — รักษารูปแบบผลลัพธ์เดิมของ v1.0/v1.1
 * ภายในใช้ระบบนำเข้าใหม่ (src/lib/import) ด้วยหัวคอลัมน์แม่แบบเท่านั้น และ SKU ต้องมีในหน้าสินค้า
 */
export function validateSalesCsv(text: string, opts: ValidateOptions): ValidationResult {
  const sheet = csvToSheet(text);
  const table = buildTable(sheet, 0, true);
  const suggestion = suggestMapping(table.headers, genericAdapter);
  // แม่แบบ: รับเฉพาะชื่อที่ตรงกับแม่แบบหรือชื่อภาษาไทยของแม่แบบ ไม่เดา
  const mapping: ColumnMapping = {};
  for (const [k, conf] of Object.entries(suggestion.confidence)) {
    if (conf === "verified" || conf === "alias") mapping[k as ImportFieldKey] = suggestion.mapping[k as ImportFieldKey];
  }
  const fileErrors: string[] = [];
  const has = (k: ImportFieldKey) => (mapping[k]?.length ?? 0) > 0;
  const missing = SALES_COLUMNS.filter((c) => {
    if (!c.required) return false;
    const key = (Object.entries(TEMPLATE_HEADERS).find(([, v]) => v === c.key)?.[0] ?? "") as ImportFieldKey;
    return key === "unitPrice" ? !has("unitPrice") : !has(key);
  });
  if (missing.length) {
    fileErrors.push(`ไม่พบคอลัมน์ที่จำเป็น: ${missing.map((c) => `${c.key} (${c.label})`).join(", ")}`);
  }
  if (!fileErrors.length && table.rows.length === 0) fileErrors.push("ไฟล์ไม่มีข้อมูล");
  if (fileErrors.length) return { fileErrors, rows: [], okCount: 0, errorCount: 0, duplicateCount: 0 };

  const now = new Date().toISOString();
  const products = [...opts.productCosts].map(([sku, unitCost]) => ({ id: sku, sku, name: sku, unitCost, createdAt: now, updatedAt: now }));
  const preview = validateImport(table, mapping, { ...defaultOptions(genericAdapter), fixedChannel: null }, {
    products,
    aliases: [],
    existingKeys: opts.existingKeys,
    skuDecisions: {},
  });
  if (preview.fileErrors.length) return { fileErrors: preview.fileErrors, rows: [], okCount: 0, errorCount: 0, duplicateCount: 0 };

  const rows: RowResult[] = preview.rows.map((r) => {
    let status: RowStatus = r.status === "unmapped" ? "error" : r.status;
    const errors = r.errors.map((e) =>
      e.startsWith("รอจับคู่ SKU") ? `ไม่พบ SKU "${r.sourceSku}" ในหน้าสินค้า กรุณาเพิ่มสินค้าและต้นทุนก่อน` : e,
    );
    if (r.status === "error" && r.sourceSku && !r.product && !validateSku(r.sourceSku)) {
      errors.push(`ไม่พบ SKU "${r.sourceSku}" ในหน้าสินค้า กรุณาเพิ่มสินค้าและต้นทุนก่อน`);
      status = "error";
    }
    const raw: Record<string, string> = {};
    table.headers.forEach((h, i) => (raw[mapHeader(h)] = r.cells[i] ?? ""));
    return { row: r.rowNumber, status, errors, raw, sale: status === "ok" ? r.draft : undefined };
  });
  return {
    fileErrors: [],
    rows,
    okCount: rows.filter((r) => r.status === "ok").length,
    errorCount: rows.filter((r) => r.status === "error").length,
    duplicateCount: rows.filter((r) => r.status === "duplicate").length,
  };
}

/**
 * ป้องกัน CSV/Formula Injection: ข้อความที่ขึ้นต้นด้วย = + - @ tab หรือ CR
 * จะถูกเติม ' ข้างหน้า เพื่อไม่ให้ Excel/Google Sheets ตีความเป็นสูตร (ค่าที่เป็นตัวเลขไม่ถูกแก้)
 */
export function sanitizeCell(v: string | number): string | number {
  if (typeof v !== "string") return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** สร้างข้อความ CSV (มี BOM เพื่อให้ Excel แสดงภาษาไทยถูกต้อง) */
export function toCsv(rows: (string | number)[][]): string {
  return "﻿" + Papa.unparse(rows.map((r) => r.map(sanitizeCell)));
}
