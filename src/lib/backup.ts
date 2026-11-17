/**
 * สำรองและกู้คืนข้อมูลเป็นไฟล์ JSON
 *
 * ขั้นตอนกู้คืนอย่างปลอดภัย:
 *  1. parseBackup() ตรวจไฟล์ทั้งหมดก่อน (รูปแบบ, เวอร์ชัน, checksum, ชุดข้อมูล, ทุกรายการ, ความซ้ำ)
 *  2. ผู้ใช้ยืนยันหลังเห็นจำนวนข้อมูลเดิมและข้อมูลใหม่
 *  3. db.replaceAll() เขียนใน transaction เดียว + สร้างจุดกู้คืนของข้อมูลเดิมไว้ก่อนเสมอ
 */
import { checksum } from "./checksum";
import { countsOf, type Snapshot, type SnapshotCounts } from "./db";
import type { DatasetId } from "./types";
import {
  batchErrors,
  expenseErrors,
  orderErrors,
  orderRevisionErrors,
  productErrors,
  saleErrors,
  settlementEntryErrors,
  settlementReportErrors,
  skuAliasErrors,
} from "./validation";

export const BACKUP_KIND = "profithub-backup";
/**
 * 1: v1.1 (สินค้า รายการขาย ค่าใช้จ่าย ชุดนำเข้า)
 * 2: v1.2 เพิ่ม skuAliases — ยังกู้คืนไฟล์เวอร์ชัน 1 ได้ (ถือว่าไม่มีการจับคู่ SKU)
 * 3: v1.3 เพิ่ม orders, orderRevisions, settlementReports, settlementEntries
 *    — ยังกู้คืนไฟล์เวอร์ชัน 1/2 ได้ (ถือว่าไม่มีข้อมูลเหล่านี้ และแจ้งผู้ใช้ว่าข้อมูลใดจะหายไป)
 */
export const BACKUP_SCHEMA_VERSION = 3;
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const MAX_REPORTED_ERRORS = 30;

export interface BackupFile {
  kind: typeof BACKUP_KIND;
  schemaVersion: number;
  app: "ProfitHub";
  dataset: DatasetId;
  exportedAt: string;
  counts: SnapshotCounts;
  /** checksum ของ dataset + JSON ในฟิลด์ data */
  checksum: string;
  data: Snapshot;
}

export function createBackup(dataset: DatasetId, data: Snapshot, now: Date = new Date()): BackupFile {
  const snapshot: Snapshot = {
    products: data.products,
    sales: data.sales,
    expenses: data.expenses,
    batches: data.batches,
    skuAliases: data.skuAliases ?? [],
    orders: data.orders ?? [],
    orderRevisions: data.orderRevisions ?? [],
    settlementReports: data.settlementReports ?? [],
    settlementEntries: data.settlementEntries ?? [],
  };
  return {
    kind: BACKUP_KIND,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    app: "ProfitHub",
    dataset,
    exportedAt: now.toISOString(),
    counts: countsOf(snapshot),
    checksum: checksumOf(dataset, snapshot),
    data: snapshot,
  };
}

function checksumOf(dataset: unknown, data: unknown): string {
  return checksum(JSON.stringify({ dataset, data }));
}

export function serializeBackup(b: BackupFile): string {
  return JSON.stringify(b, null, 1);
}

export function backupFileName(dataset: DatasetId, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${dataset === "demo" ? "DEMO_" : ""}profithub-backup-${stamp}.json`;
}

export interface BackupCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  backup?: BackupFile;
}

const DATASET_LABEL: Record<DatasetId, string> = { real: "ข้อมูลจริง", demo: "ข้อมูล Demo" };

/** ตรวจไฟล์ Backup ทั้งหมดโดยไม่แตะฐานข้อมูล */
export function parseBackup(text: string, targetDataset: DatasetId): BackupCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (msg: string): BackupCheck => ({ ok: false, errors: [msg], warnings: [] });

  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return fail("ไฟล์ไม่ใช่ JSON ที่ถูกต้อง หรือไฟล์เสียหาย");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("รูปแบบไฟล์ไม่ถูกต้อง");
  const f = raw as Record<string, unknown>;
  if (f.kind !== BACKUP_KIND) return fail("ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลของ ProfitHub");
  if (typeof f.schemaVersion !== "number" || !Number.isInteger(f.schemaVersion) || f.schemaVersion < 1) {
    return fail("ไม่พบเวอร์ชันของไฟล์สำรองข้อมูล");
  }
  if (f.schemaVersion > BACKUP_SCHEMA_VERSION) {
    return fail(`ไฟล์สร้างจาก ProfitHub รุ่นใหม่กว่า (เวอร์ชัน ${f.schemaVersion}) กรุณาอัปเดตแอปก่อนกู้คืน`);
  }
  if (f.dataset !== "real" && f.dataset !== "demo") return fail("ไม่ระบุชุดข้อมูลในไฟล์");
  if (f.dataset !== targetDataset) {
    return fail(
      `ไฟล์นี้เป็น${DATASET_LABEL[f.dataset]} แต่ขณะนี้เปิด${DATASET_LABEL[targetDataset]}อยู่ — ` +
        `เพื่อไม่ให้ข้อมูลจริงและ Demo ปะปนกัน กรุณาสลับไปที่${DATASET_LABEL[f.dataset]}ก่อนกู้คืน`,
    );
  }

  const data = f.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") return fail("ไม่พบข้อมูลในไฟล์");
  for (const k of ["products", "sales", "expenses", "batches"] as const) {
    if (!Array.isArray(data[k])) return fail(`ข้อมูล ${k} ในไฟล์ไม่ถูกต้อง`);
  }
  if (f.schemaVersion >= 2 && !Array.isArray(data.skuAliases)) return fail("ข้อมูล skuAliases ในไฟล์ไม่ถูกต้อง");
  if (f.schemaVersion >= 3) {
    for (const k of ["orders", "orderRevisions", "settlementReports", "settlementEntries"] as const) {
      if (!Array.isArray(data[k])) return fail(`ข้อมูล ${k} ในไฟล์ไม่ถูกต้อง`);
    }
  }
  if (typeof f.checksum !== "string" || checksumOf(f.dataset, data) !== f.checksum) {
    return fail("checksum ไม่ตรงกัน — ไฟล์อาจเสียหายหรือถูกแก้ไข จึงไม่กู้คืนเพื่อความปลอดภัยของข้อมูล");
  }

  // ไฟล์เวอร์ชัน 1 ไม่มีการจับคู่ SKU
  const d = data as unknown as Snapshot;
  const snap: Required<Snapshot> = {
    ...d,
    skuAliases: d.skuAliases ?? [],
    orders: d.orders ?? [],
    orderRevisions: d.orderRevisions ?? [],
    settlementReports: d.settlementReports ?? [],
    settlementEntries: d.settlementEntries ?? [],
  };
  const aliases = snap.skuAliases;
  const push = (msg: string) => {
    if (errors.length < MAX_REPORTED_ERRORS) errors.push(msg);
    else if (errors.length === MAX_REPORTED_ERRORS) errors.push("…และข้อผิดพลาดอื่น ๆ");
  };
  const check = <T>(label: string, items: T[], fn: (v: unknown) => string[]) =>
    items.forEach((item, i) => {
      const e = fn(item);
      if (e.length) push(`${label} ลำดับที่ ${i + 1}: ${e.join(", ")}`);
    });
  check("สินค้า", snap.products, productErrors);
  check("รายการขาย", snap.sales, saleErrors);
  check("ค่าใช้จ่าย", snap.expenses, expenseErrors);
  check("ชุดนำเข้า", snap.batches, batchErrors);
  check("การจับคู่ SKU", aliases, skuAliasErrors);
  check("คำสั่งซื้อ", snap.orders, orderErrors);
  check("ประวัติคำสั่งซื้อ", snap.orderRevisions, orderRevisionErrors);
  check("รายงานการเงิน", snap.settlementReports, settlementReportErrors);
  check("รายการในรายงานการเงิน", snap.settlementEntries, settlementEntryErrors);

  const dupes = <T>(label: string, items: T[], key: (t: T) => unknown) => {
    const seen = new Set<unknown>();
    for (const it of items) {
      const k = key(it);
      if (seen.has(k)) push(`${label} ซ้ำ: ${String(k)}`);
      seen.add(k);
    }
  };
  if (errors.length === 0) {
    dupes("รหัสสินค้า (id)", snap.products, (p) => p.id);
    dupes("SKU", snap.products, (p) => p.sku);
    dupes("รหัสรายการขาย (id)", snap.sales, (s) => s.id);
    dupes("รายการขาย (ช่องทาง + เลขคำสั่งซื้อ + SKU)", snap.sales, (s) => s.dedupeKey);
    dupes("รหัสค่าใช้จ่าย (id)", snap.expenses, (e) => e.id);
    dupes("รหัสชุดนำเข้า (id)", snap.batches, (b) => b.id);
    dupes("การจับคู่ SKU", aliases, (a) => a.alias);
    const productIds = new Set(snap.products.map((p) => p.id));
    for (const a of aliases) {
      if (!productIds.has(a.productId)) push(`การจับคู่ SKU "${a.alias}" ชี้ไปยังสินค้าที่ไม่มีในไฟล์`);
    }
    for (const e of referenceErrors(snap)) push(e);
  }

  if (errors.length === 0) {
    const counts = countsOf(snap);
    const declared = f.counts as Partial<SnapshotCounts> | undefined;
    // ตรวจเฉพาะจำนวนที่ไฟล์ระบุไว้ (ไฟล์เวอร์ชัน 1 ไม่มีจำนวน skuAliases)
    if (declared && (Object.keys(declared) as (keyof SnapshotCounts)[]).some((k) => k in counts && declared[k] !== counts[k])) {
      push("จำนวนข้อมูลในไฟล์ไม่ตรงกับที่บันทึกไว้ในไฟล์");
    }
    const skus = new Set(snap.products.map((p) => p.sku));
    const orphan = new Set(snap.sales.filter((s) => !skus.has(s.sku)).map((s) => s.sku));
    if (orphan.size) warnings.push(`มีรายการขายที่ไม่พบสินค้าในไฟล์: ${[...orphan].slice(0, 10).join(", ")}`);
    const legacy = snap.sales.filter((s) => s.unitCost === undefined).length;
    if (legacy) warnings.push(`${legacy} รายการขายยังไม่มีต้นทุน ณ วันนำเข้า (ข้อมูลรุ่นเก่า) ระบบจะใช้ต้นทุนปัจจุบันของสินค้าแทน`);
    const batchIds = new Set(snap.batches.map((b) => b.id));
    const noBatch = snap.sales.filter((s) => !batchIds.has(s.batchId)).length;
    if (noBatch) warnings.push(`${noBatch} รายการขายไม่มีประวัติชุดนำเข้า (ยังใช้งานได้ แต่ลบทีละชุดไม่ได้)`);
  }

  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, errors: [], warnings, backup: { ...(f as unknown as BackupFile), data: snap } };
}

/**
 * ตรวจความสัมพันธ์ระหว่างข้อมูล v1.3 — ถ้าผิดข้อใด ปฏิเสธทั้งไฟล์ (ไม่กู้คืนบางส่วน)
 */
export function referenceErrors(s: Required<Snapshot>): string[] {
  const e: string[] = [];
  const dup = <T>(label: string, items: T[], key: (t: T) => unknown) => {
    const seen = new Set<unknown>();
    for (const it of items) {
      const k = key(it);
      if (seen.has(k)) e.push(`${label} ซ้ำ: ${String(k)}`);
      seen.add(k);
    }
  };
  dup("คำสั่งซื้อ", s.orders, (o) => o.key);
  dup("ลำดับประวัติ", s.orderRevisions.filter((r) => r.seq !== undefined), (r) => r.seq);
  dup("รายงานการเงิน", s.settlementReports, (r) => r.id);
  dup("รายการในรายงานการเงิน", s.settlementEntries, (x) => x.entryKey);

  const sales = new Map(s.sales.map((x) => [x.id, x]));
  const orders = new Map(s.orders.map((o) => [o.key, o]));
  for (const o of s.orders) {
    for (const l of o.lines) {
      const sale = sales.get(l.saleId);
      if (!sale) e.push(`คำสั่งซื้อ ${o.orderId}: ไม่พบรายการขายของบรรทัด ${l.lineKey}`);
      else if (sale.orderKey !== o.key) e.push(`คำสั่งซื้อ ${o.orderId}: รายการขายของบรรทัด ${l.lineKey} ไม่ได้ผูกกับคำสั่งซื้อนี้`);
    }
  }
  for (const x of s.sales) {
    if (x.orderKey !== undefined && !orders.has(x.orderKey)) e.push(`รายการขาย ${x.orderId}: ไม่พบคำสั่งซื้อ ${x.orderKey}`);
  }
  for (const r of s.orderRevisions) if (!orders.has(r.orderKey)) e.push(`ประวัติลำดับ ${r.seq}: ไม่พบคำสั่งซื้อ ${r.orderKey}`);
  const reports = new Set(s.settlementReports.map((r) => r.id));
  const entries = new Set(s.settlementEntries.map((x) => x.entryKey));
  for (const x of s.settlementEntries) if (!x.reportIds.every((id) => reports.has(id))) e.push(`รายการ ${x.entryKey}: ไม่พบรายงานการเงินที่อ้างถึง`);
  for (const x of s.expenses) {
    if (x.source && !entries.has(x.source.entryKey)) e.push(`ค่าใช้จ่าย ${x.id}: ไม่พบรายการในรายงานการเงินที่เป็นที่มา`);
    if (x.supersededBy && !entries.has(x.supersededBy)) e.push(`ค่าใช้จ่าย ${x.id}: ไม่พบรายการในรายงานการเงินที่ใช้แทน`);
  }
  return e;
}

export interface RestoreImpact {
  /** ข้อมูลในเครื่องที่ใหม่กว่าเวลาสร้างไฟล์ Backup และจะหายไปเมื่อกู้คืน */
  ordersUpdatedAfter: number;
  revisionsAfter: number;
  refundsAffected: number;
  settlementReportsAfter: number;
  batchesAfter: number;
  /** ไฟล์รุ่นเก่าไม่มีข้อมูลประเภทนี้ แต่ในเครื่องมี → จะถูกลบทั้งหมด */
  droppedKinds: { label: string; count: number }[];
}

/** สรุปผลกระทบก่อนกู้คืน เพื่อแจ้งผู้ใช้ (การกู้คืนเป็นแบบแทนที่ทั้งชุดเสมอ) */
export function restoreImpact(current: Snapshot, backup: BackupFile): RestoreImpact {
  const at = backup.exportedAt;
  const orders = current.orders ?? [];
  const backupOrders = new Map((backup.data.orders ?? []).map((o) => [o.key, o]));
  const refundTotal = (o: { lines: { refundSeller: number; refundPlatform: number; refundUnknown: number }[] }) =>
    o.lines.reduce((a, l) => a + l.refundSeller + l.refundPlatform + l.refundUnknown, 0);
  const dropped: { label: string; count: number }[] = [];
  if (backup.schemaVersion < 3) {
    const add = (label: string, n: number) => n > 0 && dropped.push({ label, count: n });
    add("คำสั่งซื้อและสถานะ", orders.length);
    add("ประวัติการเปลี่ยนแปลงคำสั่งซื้อ", current.orderRevisions?.length ?? 0);
    add("รายงานการเงิน", current.settlementReports?.length ?? 0);
  }
  if (backup.schemaVersion < 2) {
    const n = current.skuAliases?.length ?? 0;
    if (n) dropped.push({ label: "การจับคู่ SKU", count: n });
  }
  return {
    ordersUpdatedAfter: orders.filter((o) => o.updatedAt > at).length,
    revisionsAfter: (current.orderRevisions ?? []).filter((r) => r.appliedAt > at).length,
    refundsAffected: orders.filter((o) => {
      const before = backupOrders.get(o.key);
      return refundTotal(o) !== (before ? refundTotal(before) : 0) && refundTotal(o) > 0;
    }).length,
    settlementReportsAfter: (current.settlementReports ?? []).filter((r) => r.importedAt > at).length,
    batchesAfter: current.batches.filter((b) => b.importedAt > at).length,
    droppedKinds: dropped,
  };
}
