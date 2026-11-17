/**
 * จับคู่คอลัมน์ในไฟล์กับช่องข้อมูลของ ProfitHub
 */
import { checksum } from "../checksum";
import type { ImportAdapter } from "./adapters";
import { FIELD_BY_KEY, IMPORT_FIELDS, SCOPEABLE_FIELDS, type AmountScope, type ImportFieldKey, type ScopeableField } from "./fields";
import { normalizeHeader } from "./table";

/** ช่องข้อมูล → ดัชนีคอลัมน์ (ช่องที่ multi รวมได้หลายคอลัมน์) */
export type ColumnMapping = Partial<Record<ImportFieldKey, number[]>>;

/**
 * verified = ตรงกับรูปแบบที่ยืนยันแล้ว, alias = ชื่อคอลัมน์ตรงกับชื่อทั่วไป,
 * fuzzy = ชื่อคล้าย (เดา), saved = ผู้ใช้เคยจับคู่ไว้กับหัวตารางชุดนี้, manual = ผู้ใช้เลือกเอง
 */
export type MatchConfidence = "verified" | "alias" | "fuzzy" | "saved" | "manual";

export interface MappingOptions {
  /** ช่องทางขายของทั้งไฟล์ เมื่อไม่ได้จับคู่คอลัมน์ช่องทาง */
  fixedChannel: string | null;
  scopes: Record<ScopeableField, AmountScope>;
  /** ตีความค่าติดลบในช่องรายการหักเป็นจำนวนบวก (บางระบบแสดงรายการหักเป็นค่าติดลบ) */
  negativeAsDeduction: boolean;
}

export interface MappingSuggestion {
  mapping: ColumnMapping;
  confidence: Partial<Record<ImportFieldKey, MatchConfidence>>;
}

export function defaultOptions(adapter: ImportAdapter): MappingOptions {
  const scopes = Object.fromEntries(SCOPEABLE_FIELDS.map((f) => [f, adapter.defaultScopes[f] ?? "line"])) as Record<
    ScopeableField,
    AmountScope
  >;
  return { fixedChannel: adapter.channel, scopes, negativeAsDeduction: false };
}

/**
 * เสนอการจับคู่คอลัมน์อัตโนมัติ:
 * 1) ชื่อที่ยืนยันแล้วของรูปแบบนี้  2) ชื่อทั่วไปที่ตรงทั้งคำ  3) ชื่อที่มีคำนั้นอยู่ (เดา)
 * แต่ละคอลัมน์ถูกใช้ได้กับช่องเดียว
 */
export function suggestMapping(headers: string[], adapter: ImportAdapter): MappingSuggestion {
  const norm = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  const confidence: Partial<Record<ImportFieldKey, MatchConfidence>> = {};

  const take = (key: ImportFieldKey, idx: number, c: MatchConfidence) => {
    used.add(idx);
    mapping[key] = [idx];
    confidence[key] = c;
  };
  const find = (pred: (h: string, i: number) => boolean) => norm.findIndex((h, i) => !used.has(i) && h !== "" && pred(h, i));

  // รอบที่ 1: ชื่อที่ยืนยันแล้ว
  for (const f of IMPORT_FIELDS) {
    const names = (adapter.verifiedHeaders[f.key] ?? []).map(normalizeHeader);
    if (!names.length) continue;
    const i = find((h) => names.includes(h));
    if (i >= 0) take(f.key, i, "verified");
  }
  // รอบที่ 2: ชื่อทั่วไปตรงทั้งคำ
  for (const f of IMPORT_FIELDS) {
    if (mapping[f.key]) continue;
    const names = f.aliases.map(normalizeHeader);
    const i = find((h) => names.includes(h));
    if (i >= 0) take(f.key, i, "alias");
  }
  // รอบที่ 3: ชื่อที่มีคำทั่วไปอยู่ (เฉพาะคำที่ยาวพอ เพื่อลดการเดาผิด)
  for (const f of IMPORT_FIELDS) {
    if (mapping[f.key]) continue;
    const names = f.aliases.map(normalizeHeader).filter((n) => n.length >= 4);
    const exclude = (f.fuzzyExclude ?? []).map((x) => x.toLowerCase());
    const i = find((h) => names.some((n) => h.includes(n)) && !exclude.some((x) => h.includes(x)));
    if (i >= 0) take(f.key, i, "fuzzy");
  }
  // ช่องทางคงที่ของแพลตฟอร์ม: ไม่ใช้คอลัมน์ช่องทาง
  if (adapter.channel) {
    delete mapping.channel;
    delete confidence.channel;
  }
  // มีทั้งราคาต่อชิ้นและยอดรวม: ใช้ราคาต่อชิ้น
  if (mapping.unitPrice && mapping.lineTotal) {
    delete mapping.lineTotal;
    delete confidence.lineTotal;
  }
  return { mapping, confidence };
}

export interface MappingProblem {
  field?: ImportFieldKey;
  message: string;
}

/** ตรวจว่าการจับคู่ครบและไม่ขัดกันก่อนตรวจข้อมูลรายแถว */
export function mappingProblems(mapping: ColumnMapping, options: MappingOptions, headers: string[]): MappingProblem[] {
  const out: MappingProblem[] = [];
  const has = (k: ImportFieldKey) => (mapping[k]?.length ?? 0) > 0;
  for (const f of IMPORT_FIELDS) {
    if (f.required === true && !has(f.key)) out.push({ field: f.key, message: `ยังไม่ได้เลือกคอลัมน์สำหรับ “${f.label}”` });
  }
  if (!has("unitPrice") && !has("lineTotal")) {
    out.push({ field: "unitPrice", message: "ต้องเลือกคอลัมน์ “ราคาขายต่อชิ้น” หรือ “ยอดขายรวมของบรรทัด”" });
  }
  if (has("unitPrice") && has("lineTotal")) {
    out.push({ field: "lineTotal", message: "เลือกได้เพียงอย่างเดียว: ราคาขายต่อชิ้น หรือ ยอดขายรวมของบรรทัด" });
  }
  if (!has("channel") && !options.fixedChannel?.trim()) {
    out.push({ field: "channel", message: "ต้องเลือกคอลัมน์ช่องทางขาย หรือเลือกช่องทางเดียวสำหรับทั้งไฟล์" });
  }
  const owner = new Map<number, ImportFieldKey>();
  for (const f of IMPORT_FIELDS) {
    for (const col of mapping[f.key] ?? []) {
      if (col < 0 || col >= headers.length) {
        out.push({ field: f.key, message: `คอลัมน์ที่เลือกสำหรับ “${f.label}” ไม่มีในไฟล์` });
        continue;
      }
      const prev = owner.get(col);
      if (prev && prev !== f.key) {
        out.push({ field: f.key, message: `คอลัมน์ “${headers[col]}” ถูกใช้ทั้ง “${FIELD_BY_KEY[prev].label}” และ “${f.label}”` });
      }
      owner.set(col, f.key);
    }
  }
  return out;
}

/** ระบุชุดหัวตาราง เพื่อจำการจับคู่ที่ผู้ใช้ยืนยันแล้ว */
export function headerFingerprint(adapterId: string, headers: string[]): string {
  return `${adapterId}:${checksum(headers.map(normalizeHeader).join("\u0001"))}`;
}

/** การจับคู่ต้องให้ผู้ใช้ยืนยันหรือไม่ (มีช่องที่ระบบเดา หรือรูปแบบไฟล์ยังไม่ผ่านการตรวจสอบ) */
export function needsConfirmation(adapter: ImportAdapter, s: MappingSuggestion): boolean {
  const all = Object.values(s.confidence);
  // ผู้ใช้เคยยืนยันการจับคู่กับหัวตารางชุดนี้แล้ว
  if (all.length > 0 && all.every((c) => c === "saved")) return false;
  if (!adapter.verified) return true;
  return Object.values(s.confidence).some((c) => c === "fuzzy");
}

/** แปลงการจับคู่ที่บันทึกไว้ (ตามชื่อหัวตาราง) กลับเป็นดัชนี ถ้าหัวตารางเปลี่ยนจะไม่ใช้ */
export function mappingFromSaved(saved: Partial<Record<ImportFieldKey, string[]>>, headers: string[]): MappingSuggestion | null {
  const mapping: ColumnMapping = {};
  const confidence: Partial<Record<ImportFieldKey, MatchConfidence>> = {};
  for (const [k, names] of Object.entries(saved) as [ImportFieldKey, string[]][]) {
    if (!FIELD_BY_KEY[k]) return null;
    const idx = names.map((n) => headers.indexOf(n));
    if (idx.some((i) => i < 0)) return null;
    mapping[k] = idx;
    confidence[k] = "saved";
  }
  return { mapping, confidence };
}

export function mappingToSaved(mapping: ColumnMapping, headers: string[]): Partial<Record<ImportFieldKey, string[]>> {
  return Object.fromEntries(
    Object.entries(mapping)
      .filter(([, cols]) => cols && cols.length)
      .map(([k, cols]) => [k, cols!.map((c) => headers[c])]),
  );
}
