/**
 * อ่านไฟล์ CSV / XLSX ให้เป็นตารางข้อความ (string[][]) พร้อมเลขแถวตามไฟล์จริง
 * ไม่ตีความความหมายของคอลัมน์ในขั้นนี้
 */
import Papa from "papaparse";
import { checksumBytes } from "../checksum";
import { toISODate } from "../dates";
import { IMPORT_FIELDS } from "./fields";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const HEADER_SCAN_ROWS = 20;

export interface SheetRows {
  name: string;
  /** แต่ละแถวเป็นข้อความ (ช่องว่าง = "") */
  rows: string[][];
  /** เลขแถวตามไฟล์ (เริ่ม 1) ของ rows[i] */
  rowNumbers: number[];
}

export interface SourceFile {
  fileName: string;
  kind: "csv" | "xlsx";
  /** การเข้ารหัสตัวอักษรที่ใช้อ่าน (CSV เท่านั้น) */
  encoding?: string;
  fileHash: string;
  sheets: SheetRows[];
}

export type ReadResult = { ok: true; file: SourceFile } | { ok: false; error: string };

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

/** ถอดรหัสข้อความ: BOM UTF-8/UTF-16 → UTF-8 (ถ้าถูกต้อง) → Windows-874 (ไฟล์ภาษาไทยจาก Excel รุ่นเก่า) */
export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "UTF-8 (BOM)" };
  if (startsWith(bytes, [0xff, 0xfe])) return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "UTF-16LE" };
  if (startsWith(bytes, [0xfe, 0xff])) return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "UTF-16BE" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
  } catch {
    try {
      return { text: new TextDecoder("windows-874").decode(bytes), encoding: "Windows-874 (TIS-620)" };
    } catch {
      return { text: new TextDecoder("utf-8").decode(bytes), encoding: "UTF-8 (มีอักขระเสีย)" };
    }
  }
}

/** แปลง CSV เป็นแถว โดยเก็บเลขแถวเดิมและข้ามแถวว่าง */
export function csvToSheet(text: string, name = "CSV"): SheetRows {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { header: false, skipEmptyLines: false });
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  parsed.data.forEach((r, i) => {
    const cells = r.map((c) => (c ?? "").trim());
    if (cells.some((c) => c !== "")) {
      rows.push(cells);
      rowNumbers.push(i + 1);
    }
  });
  return { name, rows, rowNumbers };
}

/** วันที่จาก Excel มีเศษมิลลิวินาที (เช่น 14:29:59.999) จึงปัดเป็นวินาทีก่อนตัดเหลือวันที่ */
export function excelDateToISO(d: Date): string {
  const t = new Date(Math.round(d.getTime() / 1000) * 1000);
  return toISODate(new Date(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
}

export function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : excelDateToISO(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v).trim();
}

async function readXlsx(buf: ArrayBuffer): Promise<SheetRows[]> {
  const { default: readXlsxFile } = await import("read-excel-file/universal");
  // parseNumber: คืนตัวเลขเป็นข้อความตามที่เก็บในไฟล์ เพื่อไม่ให้เลขยาว ๆ ถูกปัดเศษเพิ่ม
  const sheets = await readXlsxFile(buf, { parseNumber: (s: string) => s });
  return sheets.map((s) => {
    const rows: string[][] = [];
    const rowNumbers: number[] = [];
    s.data.forEach((r, i) => {
      const cells = r.map(cellToString);
      if (cells.some((c) => c !== "")) {
        rows.push(cells);
        rowNumbers.push(i + 1);
      }
    });
    return { name: s.sheet, rows, rowNumbers };
  });
}

export async function readSourceFile(fileName: string, buf: ArrayBuffer): Promise<ReadResult> {
  const bytes = new Uint8Array(buf);
  if (bytes.length === 0) return { ok: false, error: "ไฟล์ว่างเปล่า (0 ไบต์)" };
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, error: "ไฟล์ใหญ่เกิน 10 MB กรุณาแบ่งไฟล์" };
  const fileHash = checksumBytes(bytes);
  const lower = fileName.toLowerCase();

  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]) || lower.endsWith(".xls")) {
    return { ok: false, error: "ไม่รองรับไฟล์ Excel รุ่นเก่า (.xls) — กรุณาบันทึกเป็น .xlsx หรือ CSV UTF-8 ก่อน" };
  }
  const isZip = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  if (isZip || lower.endsWith(".xlsx")) {
    if (!isZip) return { ok: false, error: "ไฟล์ .xlsx เสียหายหรือไม่ใช่ไฟล์ Excel จริง" };
    try {
      const sheets = await readXlsx(buf);
      if (sheets.length === 0) return { ok: false, error: "ไม่พบชีตในไฟล์ Excel" };
      return { ok: true, file: { fileName, kind: "xlsx", fileHash, sheets } };
    } catch (e) {
      return { ok: false, error: `อ่านไฟล์ Excel ไม่ได้ — ไฟล์อาจเสียหายหรือมีรหัสผ่าน (${e instanceof Error ? e.message : String(e)})` };
    }
  }
  if (!/\.(csv|txt|tsv)$/.test(lower) && bytes.slice(0, 512).some((b) => b === 0) && !startsWith(bytes, [0xff, 0xfe]) && !startsWith(bytes, [0xfe, 0xff])) {
    return { ok: false, error: "ไม่ใช่ไฟล์ CSV หรือ Excel (.xlsx)" };
  }
  const { text, encoding } = decodeText(bytes);
  return { ok: true, file: { fileName, kind: "csv", encoding, fileHash, sheets: [csvToSheet(text)] } };
}

/** ทำให้ชื่อหัวคอลัมน์เทียบกันได้: ตัวพิมพ์เล็ก ตัด BOM วงเล็บ และรวมช่องว่าง/ขีด */
export function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, "")
    .toLowerCase()
    .replace(/[()[\]{}:.*#]/g, " ")
    .replace(/[\s_\-/]+/g, " ")
    .trim();
}

const KNOWN_HEADERS = new Set(IMPORT_FIELDS.flatMap((f) => f.aliases.map(normalizeHeader)));

/**
 * หาแถวหัวตาราง (ไฟล์ส่งออกจากระบบต่าง ๆ มักมีแถวชื่อรายงานอยู่ด้านบน)
 * เลือกแถวที่มีชื่อคอลัมน์ที่รู้จักมากที่สุด ถ้าไม่มีเลย เลือกแถวแรกที่มีข้อมูลหลายช่อง
 */
export function detectHeaderRow(rows: string[][]): number {
  const scan = rows.slice(0, HEADER_SCAN_ROWS);
  let best = -1;
  let bestScore = 1;
  scan.forEach((r, i) => {
    const score = r.filter((c) => KNOWN_HEADERS.has(normalizeHeader(c))).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  if (best >= 0) return best;
  const filled = scan.map((r) => r.filter((c) => c !== "").length);
  const max = Math.max(0, ...filled);
  const idx = filled.findIndex((n) => n >= Math.max(2, Math.ceil(max * 0.6)));
  return idx >= 0 ? idx : 0;
}

export interface DataRow {
  /** เลขแถวตามไฟล์ */
  rowNumber: number;
  cells: string[];
  /** ปัญหาโครงสร้างของแถว (เช่น จำนวนคอลัมน์ไม่ตรง) */
  issue?: string;
}

export interface Table {
  headers: string[];
  headerRowNumber: number;
  rows: DataRow[];
}

/**
 * สร้างตารางจากแถวหัวตารางที่เลือก ชื่อคอลัมน์ว่างหรือซ้ำจะถูกตั้งชื่อให้ไม่ซ้ำ
 * @param strictWidth ตรวจจำนวนคอลัมน์ทุกแถว (ใช้กับ CSV; Excel มักตัดช่องว่างท้ายแถวอยู่แล้ว)
 */
export function buildTable(sheet: SheetRows, headerIndex: number, strictWidth: boolean): Table {
  const raw = sheet.rows[headerIndex] ?? [];
  const seen = new Map<string, number>();
  const headers = raw.map((h, i) => {
    const base = h || `คอลัมน์ ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
  const rows: DataRow[] = [];
  for (let i = headerIndex + 1; i < sheet.rows.length; i++) {
    const cells = sheet.rows[i];
    let issue: string | undefined;
    if (strictWidth && cells.length > headers.length && cells.slice(headers.length).some((c) => c !== "")) {
      issue = "จำนวนคอลัมน์มากกว่าหัวตาราง";
    } else if (strictWidth && cells.length < headers.length) {
      issue = "จำนวนคอลัมน์น้อยกว่าหัวตาราง";
    }
    const padded = headers.map((_, c) => cells[c] ?? "");
    rows.push({ rowNumber: sheet.rowNumbers[i], cells: padded, issue });
  }
  return { headers, headerRowNumber: sheet.rowNumbers[headerIndex] ?? 1, rows };
}
