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
import { batchErrors, expenseErrors, productErrors, saleErrors } from "./validation";

export const BACKUP_KIND = "profithub-backup";
export const BACKUP_SCHEMA_VERSION = 1;
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
  if (typeof f.checksum !== "string" || checksumOf(f.dataset, data) !== f.checksum) {
    return fail("checksum ไม่ตรงกัน — ไฟล์อาจเสียหายหรือถูกแก้ไข จึงไม่กู้คืนเพื่อความปลอดภัยของข้อมูล");
  }

  const snap = data as unknown as Snapshot;
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
  }

  if (errors.length === 0) {
    const counts = countsOf(snap);
    const declared = f.counts as Partial<SnapshotCounts> | undefined;
    if (declared && (Object.keys(counts) as (keyof SnapshotCounts)[]).some((k) => declared[k] !== counts[k])) {
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
  return { ok: true, errors: [], warnings, backup: f as unknown as BackupFile };
}
