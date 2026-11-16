import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";
import type { SaleDraft } from "./csv";
import { newId } from "./id";
import type { DatasetId, Expense, ImportBatch, Product, Sale } from "./types";

export interface Snapshot {
  products: Product[];
  sales: Sale[];
  expenses: Expense[];
  batches: ImportBatch[];
}

export interface SnapshotCounts {
  products: number;
  sales: number;
  expenses: number;
  batches: number;
}

/** สำเนาข้อมูลอัตโนมัติก่อนการกระทำที่ลบ/เขียนทับข้อมูลจำนวนมาก (เก็บในฐานข้อมูลเดียวกัน) */
export interface RestorePoint {
  id: string;
  createdAt: string;
  reason: string;
  counts: SnapshotCounts;
  data: Snapshot;
}

export type RestorePointInfo = Omit<RestorePoint, "data">;

interface ProfitHubDB extends DBSchema {
  products: { key: string; value: Product; indexes: { sku: string } };
  sales: { key: string; value: Sale; indexes: { dedupeKey: string; batchId: string } };
  expenses: { key: string; value: Expense };
  batches: { key: string; value: ImportBatch };
  restorePoints: { key: string; value: RestorePoint };
}

export type DB = IDBPDatabase<ProfitHubDB>;

const DATA_STORES = ["products", "sales", "expenses", "batches"] as const;
const ALL_STORES = [...DATA_STORES, "restorePoints"] as const;
type RWTx = IDBPTransaction<ProfitHubDB, typeof ALL_STORES extends readonly (infer T)[] ? T[] : never, "readwrite">;

/**
 * v1: MVP 1.0
 * v2: เพิ่ม restorePoints และบันทึกต้นทุนต่อชิ้น (snapshot) ให้รายการขายเดิม
 */
export const DB_VERSION = 2;
export const MAX_RESTORE_POINTS = 5;

/** ข้อมูลจริงและข้อมูล Demo อยู่คนละฐานข้อมูลใน IndexedDB */
export const DB_NAMES: Record<DatasetId, string> = {
  real: "profithub-real",
  demo: "profithub-demo",
};

const cache = new Map<DatasetId, Promise<DB>>();

export function getDB(dataset: DatasetId): Promise<DB> {
  let p = cache.get(dataset);
  if (!p) {
    p = openDB<ProfitHubDB>(DB_NAMES[dataset], DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const products = db.createObjectStore("products", { keyPath: "id" });
          products.createIndex("sku", "sku", { unique: true });
          const sales = db.createObjectStore("sales", { keyPath: "id" });
          sales.createIndex("dedupeKey", "dedupeKey", { unique: true });
          sales.createIndex("batchId", "batchId");
          db.createObjectStore("expenses", { keyPath: "id" });
          db.createObjectStore("batches", { keyPath: "id" });
        }
        if (oldVersion < 2) {
          db.createObjectStore("restorePoints", { keyPath: "id" });
          if (oldVersion >= 1) {
            // ถ้าย้ายข้อมูลไม่สำเร็จ ยกเลิกการอัปเกรดทั้งหมด ข้อมูลเดิม (v1) ยังอยู่ครบ
            backfillCostSnapshots(tx as unknown as RWTx).catch(() => {
              try {
                tx.abort();
              } catch {
                /* ถูกยกเลิกแล้ว */
              }
            });
          }
        }
      },
    });
    p.catch(() => cache.delete(dataset));
    cache.set(dataset, p);
  }
  return p;
}

/**
 * ย้ายข้อมูลจาก v1: รายการขายเดิมยังไม่มี unitCost จึงบันทึกต้นทุนปัจจุบันให้ (เป็นข้อมูลที่ดีที่สุดที่มี)
 * เพื่อให้การแก้ต้นทุนหลังจากนี้ไม่กระทบกำไรย้อนหลัง ไม่ลบหรือแก้ฟิลด์อื่น
 */
async function backfillCostSnapshots(tx: RWTx) {
  const products = await tx.objectStore("products").getAll();
  const costs = new Map(products.map((p) => [p.sku.toUpperCase(), p.unitCost]));
  let cursor = await tx.objectStore("sales").openCursor();
  while (cursor) {
    const s = cursor.value;
    if (s.unitCost === undefined) {
      const c = costs.get(s.sku.toUpperCase());
      if (c !== undefined) await cursor.update({ ...s, unitCost: c });
    }
    cursor = await cursor.continue();
  }
}

/** สำหรับการทดสอบเท่านั้น */
export async function closeAllForTests() {
  for (const p of cache.values()) (await p.catch(() => null))?.close();
  cache.clear();
}

export function countsOf(s: Snapshot): SnapshotCounts {
  return { products: s.products.length, sales: s.sales.length, expenses: s.expenses.length, batches: s.batches.length };
}

export async function loadAll(dataset: DatasetId): Promise<Snapshot> {
  const db = await getDB(dataset);
  const tx = db.transaction(DATA_STORES, "readonly");
  const [products, sales, expenses, batches] = await Promise.all([
    tx.objectStore("products").getAll(),
    tx.objectStore("sales").getAll(),
    tx.objectStore("expenses").getAll(),
    tx.objectStore("batches").getAll(),
  ]);
  return { products, sales, expenses, batches };
}

/** บันทึกจุดกู้คืนภายใน transaction เดียวกับการเปลี่ยนแปลง (ถ้าการเปลี่ยนแปลงล้มเหลว จุดกู้คืนก็ไม่ถูกสร้าง) */
async function addRestorePoint(tx: RWTx, reason: string): Promise<void> {
  const [products, sales, expenses, batches] = await Promise.all([
    tx.objectStore("products").getAll(),
    tx.objectStore("sales").getAll(),
    tx.objectStore("expenses").getAll(),
    tx.objectStore("batches").getAll(),
  ]);
  const data = { products, sales, expenses, batches };
  if (products.length + sales.length + expenses.length + batches.length === 0) return;
  const store = tx.objectStore("restorePoints");
  await store.put({ id: newId(), createdAt: new Date().toISOString(), reason, counts: countsOf(data), data });
  const all = await store.getAll();
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const old of all.slice(MAX_RESTORE_POINTS)) await store.delete(old.id);
}

export async function listRestorePoints(dataset: DatasetId): Promise<RestorePointInfo[]> {
  const db = await getDB(dataset);
  const all = await db.getAll("restorePoints");
  return all
    .map(({ id, createdAt, reason, counts }) => ({ id, createdAt, reason, counts }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * แทนที่ข้อมูลทั้งหมดของชุดข้อมูลนี้ใน transaction เดียว (all-or-nothing)
 * หากเขียนรายการใดไม่สำเร็จ IndexedDB จะยกเลิกทั้ง transaction และข้อมูลเดิมยังอยู่ครบ
 */
export async function replaceAll(
  dataset: DatasetId,
  data: Snapshot,
  opts: { reason: string; restorePoint: boolean },
): Promise<void> {
  const db = await getDB(dataset);
  const tx = db.transaction(ALL_STORES, "readwrite") as RWTx;
  try {
    if (opts.restorePoint) await addRestorePoint(tx, opts.reason);
    await Promise.all(DATA_STORES.map((s) => tx.objectStore(s).clear()));
    for (const p of data.products) await tx.objectStore("products").add(p);
    for (const s of data.sales) await tx.objectStore("sales").add(s);
    for (const e of data.expenses) await tx.objectStore("expenses").add(e);
    for (const b of data.batches) await tx.objectStore("batches").add(b);
    await tx.done;
  } catch (e) {
    try {
      tx.abort();
    } catch {
      /* transaction ถูกยกเลิกไปแล้ว */
    }
    await tx.done.catch(() => undefined);
    throw e;
  }
}

export async function restoreFromPoint(dataset: DatasetId, pointId: string): Promise<void> {
  const db = await getDB(dataset);
  const point = await db.get("restorePoints", pointId);
  if (!point) throw new Error("ไม่พบจุดกู้คืน");
  const when = new Date(point.createdAt).toLocaleString("th-TH");
  await replaceAll(dataset, point.data, { reason: `ก่อนย้อนกลับไปยังจุดกู้คืน ${when}`, restorePoint: true });
}

export async function clearAll(dataset: DatasetId, restorePoint = true): Promise<void> {
  await replaceAll(dataset, { products: [], sales: [], expenses: [], batches: [] }, { reason: "ก่อนลบข้อมูลทั้งหมด", restorePoint });
}

export interface ProductInput {
  sku: string;
  name: string;
  unitCost: number;
}

async function salesUsingSku(db: DB, sku: string): Promise<number> {
  const all = await db.getAll("sales");
  return all.filter((s) => s.sku.toUpperCase() === sku.toUpperCase()).length;
}

/** บันทึกสินค้า การแก้ต้นทุนมีผลกับรายการขายที่นำเข้าหลังจากนี้เท่านั้น */
export async function saveProduct(dataset: DatasetId, input: ProductInput, id?: string): Promise<void> {
  const db = await getDB(dataset);
  const sku = input.sku.trim().toUpperCase();
  const clash = await db.getFromIndex("products", "sku", sku);
  if (clash && clash.id !== id) throw new Error(`SKU "${sku}" มีอยู่แล้ว`);
  const now = new Date().toISOString();
  if (id) {
    const old = await db.get("products", id);
    if (!old) throw new Error("ไม่พบสินค้า");
    if (old.sku !== sku && (await salesUsingSku(db, old.sku)) > 0) {
      throw new Error("เปลี่ยน SKU ไม่ได้ เพราะมีรายการขายที่ใช้ SKU นี้แล้ว");
    }
    await db.put("products", { ...old, sku, name: input.name.trim(), unitCost: input.unitCost, updatedAt: now });
  } else {
    await db.add("products", { id: newId(), sku, name: input.name.trim(), unitCost: input.unitCost, createdAt: now, updatedAt: now });
  }
}

export async function deleteProduct(dataset: DatasetId, id: string): Promise<void> {
  const db = await getDB(dataset);
  const p = await db.get("products", id);
  if (!p) return;
  const used = await salesUsingSku(db, p.sku);
  if (used) throw new Error(`ลบไม่ได้ เพราะมีรายการขาย ${used} รายการที่ใช้ SKU นี้ (ลบชุดนำเข้าที่เกี่ยวข้องก่อน)`);
  await db.delete("products", id);
}

export interface ImportOutcome {
  added: number;
  skippedDuplicate: number;
  skippedMissingProduct: number;
  batchId: string | null;
}

/**
 * นำเข้ารายการขาย: ตรวจซ้ำกับฐานข้อมูลอีกครั้ง และบันทึกต้นทุนต่อชิ้นของสินค้า ณ เวลานำเข้า (snapshot)
 * อ่านต้นทุนจากฐานข้อมูลใน transaction เดียวกัน จึงได้ค่าล่าสุดเสมอ
 */
export async function importSales(dataset: DatasetId, drafts: SaleDraft[], fileName: string): Promise<ImportOutcome> {
  const db = await getDB(dataset);
  const batch: ImportBatch = { id: newId(), fileName: fileName.slice(0, 255), importedAt: new Date().toISOString(), rowCount: 0 };
  const tx = db.transaction(["sales", "batches", "products"], "readwrite");
  const sales = tx.objectStore("sales");
  const productBySku = tx.objectStore("products").index("sku");
  const out: ImportOutcome = { added: 0, skippedDuplicate: 0, skippedMissingProduct: 0, batchId: null };
  for (const d of drafts) {
    if (await sales.index("dedupeKey").getKey(d.dedupeKey)) {
      out.skippedDuplicate++;
      continue;
    }
    const product = await productBySku.get(d.sku.toUpperCase());
    if (!product) {
      out.skippedMissingProduct++;
      continue;
    }
    await sales.add({ ...d, unitCost: product.unitCost, id: newId(), batchId: batch.id });
    out.added++;
  }
  batch.rowCount = out.added;
  if (out.added > 0) {
    await tx.objectStore("batches").add(batch);
    out.batchId = batch.id;
  }
  await tx.done;
  return out;
}

export async function deleteBatch(dataset: DatasetId, batchId: string): Promise<number> {
  const db = await getDB(dataset);
  const tx = db.transaction(ALL_STORES, "readwrite") as RWTx;
  const keys = await tx.objectStore("sales").index("batchId").getAllKeys(batchId);
  const batch = await tx.objectStore("batches").get(batchId);
  await addRestorePoint(tx, `ก่อนลบชุดนำเข้า "${batch?.fileName ?? batchId}"`);
  for (const k of keys) await tx.objectStore("sales").delete(k);
  await tx.objectStore("batches").delete(batchId);
  await tx.done;
  return keys.length;
}

export type ExpenseInput = Omit<Expense, "id" | "createdAt">;

export async function saveExpense(dataset: DatasetId, input: ExpenseInput, id?: string): Promise<void> {
  const db = await getDB(dataset);
  if (id) {
    const old = await db.get("expenses", id);
    if (!old) throw new Error("ไม่พบรายการ");
    await db.put("expenses", { ...old, ...input });
  } else {
    await db.add("expenses", { ...input, id: newId(), createdAt: new Date().toISOString() });
  }
}

export async function deleteExpense(dataset: DatasetId, id: string): Promise<void> {
  const db = await getDB(dataset);
  await db.delete("expenses", id);
}
