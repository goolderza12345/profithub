import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";
import type { SaleDraft } from "./csv";
import { newId } from "./id";
import type { DatasetId, Expense, ImportBatch, Product, Sale, SkuAlias } from "./types";
import type { Order, OrderRevision, SettlementEntry, SettlementReport } from "./orders/types";

export interface Snapshot {
  products: Product[];
  sales: Sale[];
  expenses: Expense[];
  batches: ImportBatch[];
  /** การจับคู่ SKU (v1.2+) — undefined ในจุดกู้คืน/ไฟล์ Backup รุ่นก่อน ถือเป็นรายการว่าง */
  skuAliases?: SkuAlias[];
  /** v1.3+ — undefined ในข้อมูลรุ่นก่อน ถือเป็นรายการว่าง */
  orders?: Order[];
  orderRevisions?: OrderRevision[];
  settlementReports?: SettlementReport[];
  settlementEntries?: SettlementEntry[];
}

export interface SnapshotCounts {
  products: number;
  sales: number;
  expenses: number;
  batches: number;
  skuAliases?: number;
  orders?: number;
  orderRevisions?: number;
  settlementReports?: number;
  settlementEntries?: number;
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
  skuAliases: { key: string; value: SkuAlias; indexes: { productId: string } };
  orders: { key: string; value: Order; indexes: { status: string; orderDate: string } };
  orderRevisions: { key: number; value: OrderRevision; indexes: { orderKey: string; batchId: string } };
  settlementReports: { key: string; value: SettlementReport; indexes: { fileHash: string } };
  settlementEntries: { key: string; value: SettlementEntry; indexes: { orderKey: string } };
}

export type DB = IDBPDatabase<ProfitHubDB>;

const DATA_STORES = [
  "products",
  "sales",
  "expenses",
  "batches",
  "skuAliases",
  "orders",
  "orderRevisions",
  "settlementReports",
  "settlementEntries",
] as const;
const ALL_STORES = [...DATA_STORES, "restorePoints"] as const;
type RWTx = IDBPTransaction<ProfitHubDB, typeof ALL_STORES extends readonly (infer T)[] ? T[] : never, "readwrite">;

/**
 * v1: MVP 1.0
 * v2: เพิ่ม restorePoints และบันทึกต้นทุนต่อชิ้น (snapshot) ให้รายการขายเดิม
 * v3: เพิ่ม skuAliases (จำการจับคู่ SKU จากไฟล์กับสินค้า) — ไม่แก้ข้อมูลเดิม
 * v4: เพิ่ม orders, orderRevisions, settlementReports, settlementEntries — สร้าง store ว่าง ไม่แก้ข้อมูลเดิม
 */
export const DB_VERSION = 4;
export const MAX_RESTORE_POINTS = 5;

/** ข้อมูลจริงและข้อมูล Demo อยู่คนละฐานข้อมูลใน IndexedDB */
export const DB_NAMES: Record<DatasetId, string> = {
  real: "profithub-real",
  demo: "profithub-demo",
};

const cache = new Map<DatasetId, Promise<DB>>();

export type DbEvent = { dataset: DatasetId; kind: "blocked" | "blocking" };
const dbListeners = new Set<(e: DbEvent) => void>();
/** ฟังเหตุการณ์การอัปเกรดฐานข้อมูลที่ถูกขวางโดยแท็บอื่น */
export function onDbEvent(fn: (e: DbEvent) => void): () => void {
  dbListeners.add(fn);
  return () => dbListeners.delete(fn);
}
function notifyDbEvent(e: DbEvent) {
  for (const fn of dbListeners) fn(e);
}

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
        if (oldVersion < 3) {
          db.createObjectStore("skuAliases", { keyPath: "alias" }).createIndex("productId", "productId");
        }
        if (oldVersion < 4) {
          const orders = db.createObjectStore("orders", { keyPath: "key" });
          orders.createIndex("status", "status");
          orders.createIndex("orderDate", "orderDate");
          const rev = db.createObjectStore("orderRevisions", { keyPath: "seq", autoIncrement: true });
          rev.createIndex("orderKey", "orderKey");
          rev.createIndex("batchId", "batchId");
          db.createObjectStore("settlementReports", { keyPath: "id" }).createIndex("fileHash", "fileHash");
          db.createObjectStore("settlementEntries", { keyPath: "entryKey" }).createIndex("orderKey", "orderKey");
        }
      },
      // แท็บอื่นเปิดฐานข้อมูลรุ่นเก่าค้างไว้ → แจ้งผู้ใช้แทนการค้างเงียบ
      blocked() {
        notifyDbEvent({ dataset, kind: "blocked" });
      },
      // แท็บนี้ขวางการอัปเกรดของแท็บอื่น → ปิดการเชื่อมต่อ ให้โหลดใหม่
      blocking() {
        void p?.then((db) => db.close());
        cache.delete(dataset);
        notifyDbEvent({ dataset, kind: "blocking" });
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
  return {
    products: s.products.length,
    sales: s.sales.length,
    expenses: s.expenses.length,
    batches: s.batches.length,
    skuAliases: s.skuAliases?.length ?? 0,
    orders: s.orders?.length ?? 0,
    orderRevisions: s.orderRevisions?.length ?? 0,
    settlementReports: s.settlementReports?.length ?? 0,
    settlementEntries: s.settlementEntries?.length ?? 0,
  };
}

export async function loadAll(dataset: DatasetId): Promise<Snapshot> {
  const db = await getDB(dataset);
  const tx = db.transaction(DATA_STORES, "readonly");
  return readAll(tx);
}

async function readAll(tx: { objectStore: RWTx["objectStore"] } | IDBPTransaction<ProfitHubDB, (typeof DATA_STORES)[number][], "readonly">): Promise<Snapshot> {
  const t = tx as unknown as RWTx;
  const [products, sales, expenses, batches, skuAliases, orders, orderRevisions, settlementReports, settlementEntries] = await Promise.all([
    t.objectStore("products").getAll(),
    t.objectStore("sales").getAll(),
    t.objectStore("expenses").getAll(),
    t.objectStore("batches").getAll(),
    t.objectStore("skuAliases").getAll(),
    t.objectStore("orders").getAll(),
    t.objectStore("orderRevisions").getAll(),
    t.objectStore("settlementReports").getAll(),
    t.objectStore("settlementEntries").getAll(),
  ]);
  return { products, sales, expenses, batches, skuAliases, orders, orderRevisions, settlementReports, settlementEntries };
}

/** บันทึกจุดกู้คืนภายใน transaction เดียวกับการเปลี่ยนแปลง (ถ้าการเปลี่ยนแปลงล้มเหลว จุดกู้คืนก็ไม่ถูกสร้าง) */
async function addRestorePoint(tx: RWTx, reason: string): Promise<boolean> {
  const data = await readAll(tx);
  if (Object.values(countsOf(data)).every((n) => !n)) return false;
  const store = tx.objectStore("restorePoints");
  await store.put({ id: newId(), createdAt: new Date().toISOString(), reason, counts: countsOf(data), data });
  const all = await store.getAll();
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const old of all.slice(MAX_RESTORE_POINTS)) await store.delete(old.id);
  return true;
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
    for (const a of data.skuAliases ?? []) await tx.objectStore("skuAliases").add(a);
    for (const o of data.orders ?? []) await tx.objectStore("orders").add(o);
    for (const r of data.orderRevisions ?? []) await tx.objectStore("orderRevisions").add(r);
    for (const r of data.settlementReports ?? []) await tx.objectStore("settlementReports").add(r);
    for (const e of data.settlementEntries ?? []) await tx.objectStore("settlementEntries").add(e);
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
  await replaceAll(dataset, { products: [], sales: [], expenses: [], batches: [], skuAliases: [], orders: [], orderRevisions: [], settlementReports: [], settlementEntries: [] }, { reason: "ก่อนลบข้อมูลทั้งหมด", restorePoint });
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
  // ลบสินค้าพร้อมการจับคู่ SKU ที่ชี้มาที่สินค้านี้ใน transaction เดียว
  const tx = db.transaction(["products", "skuAliases"], "readwrite");
  const aliasKeys = await tx.objectStore("skuAliases").index("productId").getAllKeys(id);
  for (const k of aliasKeys) await tx.objectStore("skuAliases").delete(k);
  await tx.objectStore("products").delete(id);
  await tx.done;
}

export interface ImportOutcome {
  added: number;
  skippedDuplicate: number;
  skippedMissingProduct: number;
  batchId: string | null;
  /** สินค้าใหม่ที่สร้างตามที่ผู้ใช้ยืนยัน */
  createdProducts: number;
  /** การจับคู่ SKU ที่บันทึกไว้ใช้ครั้งต่อไป */
  savedAliases: number;
  /** สร้างจุดกู้คืนก่อนนำเข้าหรือไม่ (ไม่สร้างเมื่อยังไม่มีข้อมูลเดิม) */
  restorePointCreated: boolean;
}

export interface ImportExtras {
  adapterId?: string;
  fileHash?: string;
  /** สินค้าใหม่ที่ผู้ใช้ยืนยันให้สร้างระหว่างนำเข้า */
  newProducts?: ProductInput[];
  /** SKU ในไฟล์ → สินค้าเดิม ที่ผู้ใช้เลือกไว้ */
  aliases?: { alias: string; productId: string }[];
  /** เก็บจุดกู้คืนก่อนนำเข้า (ค่าเริ่มต้น: เก็บ) */
  restorePoint?: boolean;
}

/**
 * นำเข้ารายการขายใน transaction เดียว (all-or-nothing):
 * จุดกู้คืน → สินค้าใหม่ที่ผู้ใช้ยืนยัน → การจับคู่ SKU → รายการขาย → ประวัติการนำเข้า
 * - ตรวจซ้ำกับฐานข้อมูลอีกครั้ง (dedupeKey) และข้ามรายการที่มีอยู่แล้ว
 * - บันทึกต้นทุนต่อชิ้นของสินค้า ณ เวลานำเข้า (snapshot) โดยอ่านจากฐานข้อมูลในจังหวะนั้น
 * หากขั้นตอนใดผิดพลาด จะยกเลิกทั้งหมด ไม่มีข้อมูลครึ่งชุด
 */
export async function importSales(
  dataset: DatasetId,
  drafts: SaleDraft[],
  fileName: string,
  extras: ImportExtras = {},
): Promise<ImportOutcome> {
  const db = await getDB(dataset);
  const now = new Date().toISOString();
  const batch: ImportBatch = { id: newId(), fileName: fileName.slice(0, 255), importedAt: now, rowCount: 0 };
  if (extras.adapterId) batch.adapterId = extras.adapterId.slice(0, 40);
  if (extras.fileHash) batch.fileHash = extras.fileHash.slice(0, 64);
  const out: ImportOutcome = {
    added: 0,
    skippedDuplicate: 0,
    skippedMissingProduct: 0,
    batchId: null,
    createdProducts: 0,
    savedAliases: 0,
    restorePointCreated: false,
  };
  const tx = db.transaction(ALL_STORES, "readwrite") as RWTx;
  try {
    if (extras.restorePoint !== false && drafts.length > 0) {
      out.restorePointCreated = await addRestorePoint(tx, `ก่อนนำเข้า "${batch.fileName}"`);
    }
    const products = tx.objectStore("products");
    for (const np of extras.newProducts ?? []) {
      const sku = np.sku.trim().toUpperCase();
      if (await products.index("sku").getKey(sku)) throw new Error(`SKU "${sku}" มีอยู่แล้วในระบบ — ยกเลิกการนำเข้าทั้งหมด`);
      await products.add({ id: newId(), sku, name: np.name.trim(), unitCost: np.unitCost, createdAt: now, updatedAt: now });
      out.createdProducts++;
    }
    for (const a of extras.aliases ?? []) {
      if (!(await products.get(a.productId))) throw new Error("ไม่พบสินค้าที่จับคู่ไว้ — ยกเลิกการนำเข้าทั้งหมด");
      await tx.objectStore("skuAliases").put({ alias: a.alias.trim().toUpperCase(), productId: a.productId, createdAt: now });
      out.savedAliases++;
    }
    const sales = tx.objectStore("sales");
    for (const d of drafts) {
      if (await sales.index("dedupeKey").getKey(d.dedupeKey)) {
        out.skippedDuplicate++;
        continue;
      }
      const product = await products.index("sku").get(d.sku.toUpperCase());
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
  } catch (e) {
    try {
      tx.abort();
    } catch {
      /* ถูกยกเลิกแล้ว */
    }
    await tx.done.catch(() => undefined);
    throw e;
  }
}

/** การจับคู่ SKU ทั้งหมดของชุดข้อมูล */
export async function listSkuAliases(dataset: DatasetId): Promise<SkuAlias[]> {
  const db = await getDB(dataset);
  return db.getAll("skuAliases");
}

export async function deleteSkuAlias(dataset: DatasetId, alias: string): Promise<void> {
  const db = await getDB(dataset);
  await db.delete("skuAliases", alias);
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
