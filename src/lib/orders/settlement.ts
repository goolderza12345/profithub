/**
 * รายงานการเงิน (Settlement) และการกระทบยอด — จำนวนเงินเป็นสตางค์
 *
 * กันนำเข้าซ้ำ 3 ชั้น:
 *  1) ไฟล์เดิม (fileHash) → ปฏิเสธทั้งไฟล์
 *  2) มีรหัสรายการ → entryKey = id:<รหัส>:<ประเภท> นับครั้งเดียวแม้อยู่หลายรายงาน
 *     รายงานใหม่กว่าให้จำนวนเงินต่างไป = ปรับย้อนหลัง (เก็บค่าเดิมใน history)
 *  3) ไม่มีรหัส → ลายนิ้วมือ + ลำดับภายในรายงาน (#1, #2, …)
 *     รายงานที่ช่วงเวลาซ้อนกันให้ key เดิม จึงนับ "จำนวนสูงสุดที่พบในรายงานใดรายงานหนึ่ง" ไม่ใช่ผลรวม
 *
 * กติกานับครั้งเดียว: ค่าธรรมเนียมแต่ละประเภทของคำสั่งซื้อ ใช้รายงานการเงินแทนไฟล์คำสั่งซื้อเมื่อมี
 * รายการที่ไม่มีเลขคำสั่งซื้อ → ค่าใช้จ่ายระดับร้าน (อ่านอย่างเดียว) ค่าใช้จ่ายที่กรอกเองซึ่งผู้ใช้ให้แทน จะไม่ถูกนับ
 */
import { checksum } from "../checksum";
import { allocate, parseSatang, toBaht } from "../money/satang";
import { parseDate } from "../import/parse";
import type { Table } from "../import/table";
import type { Expense, ExpenseCategory } from "../types";
import { orderKeyOf } from "./plan";
import { emptyFees, FEE_TYPES, type FeeBreakdown, type FeeType, type Order, type SettlementEntry, type SettlementEntryType } from "./types";

export const SETTLEMENT_FIELDS = [
  { key: "orderId", label: "เลขคำสั่งซื้อ", hint: "ว่างได้ — รายการที่ไม่มีเลขคำสั่งซื้อเป็นค่าใช้จ่ายระดับร้าน", aliases: ["order_id", "เลขคำสั่งซื้อ"] },
  { key: "date", label: "วันที่รายการ", hint: "จำเป็น", aliases: ["date", "วันที่", "transaction_date"] },
  { key: "entryId", label: "รหัสรายการ", hint: "ถ้ามี ช่วยกันนับซ้ำได้แม่นยำที่สุด", aliases: ["entry_id", "รหัสรายการ", "transaction_id"] },
  { key: "commission", label: "ค่าคอมมิชชัน", hint: "", aliases: ["commission_fee", "ค่าคอมมิชชัน"] },
  { key: "transaction", label: "ค่าธรรมเนียมธุรกรรม", hint: "", aliases: ["transaction_fee", "ค่าธรรมเนียมธุรกรรม"] },
  { key: "service", label: "ค่าบริการ", hint: "", aliases: ["service_fee", "ค่าบริการ"] },
  { key: "shipping", label: "ค่าขนส่งที่ร้านจ่าย", hint: "", aliases: ["shipping_fee", "ค่าขนส่งที่ร้านจ่าย"] },
  { key: "other", label: "ค่าธรรมเนียมอื่น", hint: "", aliases: ["other_fee", "ค่าธรรมเนียมอื่น"] },
  { key: "feeRefund", label: "ค่าธรรมเนียมที่ได้คืน", hint: "ลดค่าธรรมเนียมของคำสั่งซื้อนั้น", aliases: ["fee_refund", "ค่าธรรมเนียมที่ได้คืน"] },
  { key: "payout", label: "ยอดโอนให้ร้าน", hint: "ใช้กระทบยอดเท่านั้น ไม่ใช่ยอดขาย", aliases: ["payout", "ยอดโอน", "ยอดโอนให้ร้าน"] },
  { key: "description", label: "คำอธิบาย", hint: "", aliases: ["description", "คำอธิบาย", "รายละเอียด"] },
] as const;
export type SettlementFieldKey = (typeof SETTLEMENT_FIELDS)[number]["key"];
export type SettlementMapping = Partial<Record<SettlementFieldKey, number>>;

const AMOUNT_FIELDS: { key: SettlementFieldKey; type: SettlementEntryType }[] = [
  { key: "commission", type: "commission" },
  { key: "transaction", type: "transaction" },
  { key: "service", type: "service" },
  { key: "shipping", type: "shipping" },
  { key: "other", type: "other" },
  { key: "feeRefund", type: "fee_refund" },
  { key: "payout", type: "payout" },
];

const norm = (h: string) => h.replace(/^﻿/, "").toLowerCase().replace(/[\s_\-]+/g, " ").trim();

/** จับคู่เฉพาะชื่อคอลัมน์ของแม่แบบ ProfitHub ที่ตรงทั้งคำ (ไม่เดาชื่อคอลัมน์ของแพลตฟอร์ม) */
export function suggestSettlementMapping(headers: string[]): SettlementMapping {
  const m: SettlementMapping = {};
  const used = new Set<number>();
  for (const f of SETTLEMENT_FIELDS) {
    const names = f.aliases.map(norm);
    const i = headers.findIndex((h, idx) => !used.has(idx) && names.includes(norm(h)));
    if (i >= 0) {
      m[f.key] = i;
      used.add(i);
    }
  }
  return m;
}

export function settlementMappingProblems(m: SettlementMapping): string[] {
  const p: string[] = [];
  if (m.date === undefined) p.push("ต้องเลือกคอลัมน์ “วันที่รายการ”");
  if (!AMOUNT_FIELDS.some((f) => m[f.key] !== undefined)) p.push("ต้องเลือกอย่างน้อยหนึ่งคอลัมน์จำนวนเงิน");
  const cols = Object.values(m).filter((v) => v !== undefined);
  if (new Set(cols).size !== cols.length) p.push("คอลัมน์เดียวกันถูกเลือกหลายช่อง");
  return p;
}

export interface ParsedEntry {
  rowNumber: number;
  entry: SettlementEntry;
}

export interface SettlementParse {
  entries: ParsedEntry[];
  errors: { rowNumber: number; message: string }[];
  periodFrom?: string;
  periodTo?: string;
}

/**
 * แปลงแต่ละแถวเป็นรายการ (หนึ่งแถวอาจได้หลายรายการ ตามคอลัมน์จำนวนเงินที่ไม่เป็นศูนย์)
 * เครื่องหมาย: ค่าธรรมเนียม + = ร้านจ่าย, ค่าธรรมเนียมที่ได้คืนเก็บเป็นค่าลบ, ยอดโอน + = เงินเข้าร้าน
 */
export function parseSettlement(
  table: Table,
  m: SettlementMapping,
  opts: { channel: string; reportId: string; negativeAsDeduction: boolean },
): SettlementParse {
  const out: SettlementParse = { entries: [], errors: [] };
  const occurrence = new Map<string, number>();
  const dates: string[] = [];
  for (const r of table.rows) {
    const cell = (k: SettlementFieldKey) => (m[k] === undefined ? "" : (r.cells[m[k]!] ?? "").trim());
    const date = parseDate(cell("date"));
    if (!date) {
      out.errors.push({ rowNumber: r.rowNumber, message: `วันที่ไม่ถูกต้อง "${cell("date")}"` });
      continue;
    }
    dates.push(date);
    const orderId = cell("orderId");
    const orderKey = orderId ? orderKeyOf(opts.channel, orderId) : undefined;
    const entryId = cell("entryId");
    const description = cell("description").slice(0, 300);
    for (const f of AMOUNT_FIELDS) {
      const raw = cell(f.key);
      const p = parseSatang(raw);
      if (!p.ok) {
        if (p.reason !== "empty") out.errors.push({ rowNumber: r.rowNumber, message: `${SETTLEMENT_FIELDS.find((x) => x.key === f.key)!.label}ไม่ถูกต้อง "${raw}"` });
        continue;
      }
      let amount: number = p.value;
      if (amount === 0) continue;
      if (f.type === "payout" || f.type === "fee_refund") {
        // ยอดโอน: เก็บตามเครื่องหมายในไฟล์ · ค่าธรรมเนียมที่ได้คืน: เป็นเงินคืนเสมอ ไม่ว่าไฟล์จะแสดงเป็นบวกหรือลบ
      } else if (amount < 0) {
        if (!opts.negativeAsDeduction) {
          out.errors.push({ rowNumber: r.rowNumber, message: `${SETTLEMENT_FIELDS.find((x) => x.key === f.key)!.label}ติดลบ (เลือก “ไฟล์แสดงรายการหักเป็นค่าติดลบ” ถ้าเป็นรูปแบบของไฟล์)` });
          continue;
        }
        amount = -amount;
      }
      if (f.type === "fee_refund") amount = -Math.abs(amount);
      let entryKey: string;
      if (entryId) entryKey = `id:${entryId}:${f.type}`;
      else {
        const fp = `fp:${checksum(`${orderKey ?? ""}|${f.type}|${amount}|${date}|${description.toLowerCase()}`)}`;
        const n = (occurrence.get(fp) ?? 0) + 1;
        occurrence.set(fp, n);
        entryKey = `${fp}#${n}`;
      }
      out.entries.push({
        rowNumber: r.rowNumber,
        entry: { entryKey, reportIds: [opts.reportId], ...(orderKey ? { orderKey } : {}), type: f.type, amount, occurredAt: date, description },
      });
    }
  }
  dates.sort();
  if (dates.length) {
    out.periodFrom = dates[0];
    out.periodTo = dates[dates.length - 1];
  }
  return out;
}

export interface SettlementPlan {
  newEntries: SettlementEntry[];
  /** มีอยู่แล้ว (จากรายงานที่ช่วงเวลาซ้อนกัน) — นับครั้งเดียว */
  alreadyCounted: SettlementEntry[];
  /** รหัสเดิมแต่จำนวนเงินเปลี่ยน — ปรับย้อนหลัง */
  revised: { before: SettlementEntry; after: SettlementEntry }[];
  /** รายการซ้ำภายในไฟล์เดียวกัน (รหัสรายการซ้ำ) */
  duplicateInFile: ParsedEntry[];
  affectedOrders: string[];
  unassigned: SettlementEntry[];
}

export function buildSettlementPlan(parsed: ParsedEntry[], existing: Map<string, SettlementEntry>): SettlementPlan {
  const plan: SettlementPlan = { newEntries: [], alreadyCounted: [], revised: [], duplicateInFile: [], affectedOrders: [], unassigned: [] };
  const seen = new Set<string>();
  const affected = new Set<string>();
  for (const p of parsed) {
    const e = p.entry;
    if (seen.has(e.entryKey)) {
      plan.duplicateInFile.push(p);
      continue;
    }
    seen.add(e.entryKey);
    const old = existing.get(e.entryKey);
    if (!old) plan.newEntries.push(e);
    else if (old.amount === e.amount && old.orderKey === e.orderKey && old.type === e.type) plan.alreadyCounted.push(old);
    else plan.revised.push({ before: old, after: e });
    if (!old || old.amount !== e.amount) {
      if (e.orderKey) affected.add(e.orderKey);
      else if (e.type !== "payout") plan.unassigned.push(e);
    }
  }
  plan.affectedOrders = [...affected];
  return plan;
}

export interface SettlementTotals {
  /** ค่าธรรมเนียมที่ถูกเก็บ แยกตามประเภท (มีเฉพาะประเภทที่อยู่ในรายงาน) */
  charges: Partial<FeeBreakdown>;
  /** ค่าธรรมเนียมที่ได้คืน (ค่าลบ) */
  refunds: number;
  payout: number | null;
}

export function settlementTotals(orderKey: string, entries: SettlementEntry[]): SettlementTotals | null {
  const own = entries.filter((e) => e.orderKey === orderKey);
  if (!own.length) return null;
  const t: SettlementTotals = { charges: {}, refunds: 0, payout: null };
  for (const e of own) {
    if (e.type === "payout") t.payout = (t.payout ?? 0) + e.amount;
    else if (e.type === "fee_refund") t.refunds += e.amount;
    else {
      const type: FeeType = e.type === "adjustment" ? "other" : e.type;
      t.charges[type] = (t.charges[type] ?? 0) + e.amount;
    }
  }
  return t;
}

export interface SettlementFees {
  /** ค่าธรรมเนียมที่ใช้คำนวณต่อบรรทัด */
  perLine: FeeBreakdown[];
  /** รายงานมีค่าธรรมเนียมที่ได้คืน → ไม่ใช้ค่าธรรมเนียมที่ได้คืนจากไฟล์คำสั่งซื้อ (กันหักซ้ำ) */
  replacesLineFeeRefund: boolean;
  /** มีค่าธรรมเนียมที่ถูกเก็บจากรายงาน (ถือเป็นยอดสุดท้าย) */
  final: boolean;
}

/**
 * ค่าธรรมเนียมที่ใช้คำนวณต่อบรรทัด (กติกานับครั้งเดียว):
 * - ค่าธรรมเนียมแพลตฟอร์ม (คอมมิชชัน/ธุรกรรม/บริการ/อื่น ๆ) ไม่ผสมแหล่ง: ถ้ารายงานมีค่าใดค่าหนึ่ง
 *   จะใช้รายงานแทนค่าธรรมเนียมแพลตฟอร์ม "ทั้งหมด" จากไฟล์คำสั่งซื้อ (ไฟล์คำสั่งซื้อมักมีเป็นยอดรวมที่แยกประเภทไม่ได้)
 * - ค่าขนส่ง: ใช้รายงานแทนเมื่อรายงานมีค่าขนส่ง มิฉะนั้นใช้ไฟล์คำสั่งซื้อ
 * - ค่าธรรมเนียมที่ได้คืนจากรายงาน → ลดค่าธรรมเนียมอื่น และไม่ใช้ค่าที่ได้คืนจากไฟล์คำสั่งซื้อ
 * คืนค่า null ถ้ารายงานไม่มีค่าธรรมเนียมของคำสั่งซื้อนี้
 */
export function settlementFeesFor(order: Order, entries: SettlementEntry[]): SettlementFees | null {
  const t = settlementTotals(order.key, entries);
  if (!t || (!Object.keys(t.charges).length && t.refunds === 0)) return null;
  const active = order.lines.map((l, i) => ({ l, i })).filter((x) => !x.l.cancelled);
  const weights = active.map((x) => x.l.grossSatang);
  const keys = active.map((x) => x.l.lineKey);
  const perLine = order.lines.map((l) => ({ ...l.fees }));
  const PLATFORM: FeeType[] = ["commission", "transaction", "service", "other"];
  const replacePlatform = PLATFORM.some((t2) => t.charges[t2] !== undefined);
  for (const type of FEE_TYPES) {
    const fromReport = t.charges[type] !== undefined;
    if (!fromReport && !(replacePlatform && PLATFORM.includes(type))) continue;
    const shares = allocate(t.charges[type] ?? 0, weights, keys);
    perLine.forEach((f) => (f[type] = 0));
    active.forEach((x, n) => (perLine[x.i][type] = shares[n]));
  }
  if (t.refunds !== 0) {
    const shares = allocate(t.refunds, weights, keys);
    active.forEach((x, n) => (perLine[x.i].other += shares[n]));
  }
  return { perLine, replacesLineFeeRefund: t.refunds !== 0, final: Object.keys(t.charges).length > 0 };
}

export interface Reconciliation {
  orderKey: string;
  orderId: string;
  expected: number;
  actual: number;
  diff: number;
}

/** ยอดโอนที่คาดไว้ (รายได้ร้าน − เงินคืนที่ร้านรับภาระ − ค่าธรรมเนียมที่ใช้คำนวณ) เทียบกับยอดโอนจริงในรายงาน */
export function reconcile(orders: Order[], entries: SettlementEntry[]): Reconciliation[] {
  const out: Reconciliation[] = [];
  for (const o of orders) {
    const t = settlementTotals(o.key, entries);
    if (!t || t.payout === null) continue;
    const sf = settlementFeesFor(o, entries);
    const fees = sf?.perLine ?? o.lines.map((l) => l.fees);
    let expected = 0;
    o.lines.forEach((l, i) => {
      if (l.cancelled) return;
      const f = fees[i];
      const feeRefund = sf?.replacesLineFeeRefund ? 0 : l.feeRefunded;
      expected +=
        l.grossSatang - l.sellerDiscount - l.unknownDiscount - l.refundSeller - l.refundUnknown -
        (f.commission + f.transaction + f.service + f.other - feeRefund) -
        (f.shipping - l.shippingRefunded + l.returnShippingCost);
    });
    if (expected !== t.payout) out.push({ orderKey: o.key, orderId: o.orderId, expected, actual: t.payout, diff: t.payout - expected });
  }
  return out;
}

/** รายการที่ไม่มีเลขคำสั่งซื้อ → ค่าใช้จ่ายระดับร้าน (อ่านอย่างเดียว) — เฉพาะยอดที่ร้านจ่าย (> 0) */
export function expenseFromEntry(e: SettlementEntry, channel: string, now: string): Expense | null {
  if (e.orderKey || e.type === "payout" || e.amount <= 0) return null;
  const category: ExpenseCategory = e.type === "shipping" ? "shipping" : "platform_fee";
  return {
    id: `stl:${e.entryKey}`,
    date: e.occurredAt,
    category,
    amount: toBaht(e.amount),
    channel,
    note: `[รายงานการเงิน] ${e.description || e.type}`.slice(0, 300),
    createdAt: now,
    source: { kind: "settlement", entryKey: e.entryKey },
  };
}

/** ค่าใช้จ่ายที่กรอกเองซึ่งอาจซ้ำกับรายการในรายงาน (ประเภท ช่องทาง และช่วงเวลาตรงกัน) — ให้ผู้ใช้เลือกว่าจะใช้รายงานแทน */
export function supersedeCandidates(manual: Expense[], unassigned: SettlementEntry[], channel: string): Expense[] {
  if (!unassigned.length) return [];
  const dates = unassigned.map((e) => e.occurredAt).sort();
  const cats = new Set<ExpenseCategory>(unassigned.map((e) => (e.type === "shipping" ? "shipping" : "platform_fee")));
  return manual.filter(
    (x) => !x.source && !x.supersededBy && cats.has(x.category) && (x.channel === channel || x.channel === "") && x.date >= dates[0] && x.date <= dates[dates.length - 1],
  );
}

export { emptyFees };
