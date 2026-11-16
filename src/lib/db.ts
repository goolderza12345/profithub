"use client";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { DatasetId, Expense, ImportBatch, Product, Sale } from "./types";

interface ProfitHubDB extends DBSchema {
  products: { key: string; value: Product; indexes: { sku: string } };
  sales: { key: string; value: Sale; indexes: { dedupeKey: string; batchId: string } };
  expenses: { key: string; value: Expense };
  batches: { key: string; value: ImportBatch };
}

export type DB = IDBPDatabase<ProfitHubDB>;

/** ข้อมูลจริงและข้อมูล Demo อยู่คนละฐานข้อมูลใน IndexedDB */
export const DB_NAMES: Record<DatasetId, string> = {
  real: "profithub-real",
  demo: "profithub-demo",
};

const cache = new Map<DatasetId, Promise<DB>>();

export function getDB(dataset: DatasetId): Promise<DB> {
  let p = cache.get(dataset);
  if (!p) {
    p = openDB<ProfitHubDB>(DB_NAMES[dataset], 1, {
      upgrade(db) {
        const products = db.createObjectStore("products", { keyPath: "id" });
        products.createIndex("sku", "sku", { unique: true });
        const sales = db.createObjectStore("sales", { keyPath: "id" });
        sales.createIndex("dedupeKey", "dedupeKey", { unique: true });
        sales.createIndex("batchId", "batchId");
        db.createObjectStore("expenses", { keyPath: "id" });
        db.createObjectStore("batches", { keyPath: "id" });
      },
    });
    cache.set(dataset, p);
  }
  return p;
}

export interface Snapshot {
  products: Product[];
  sales: Sale[];
  expenses: Expense[];
  batches: ImportBatch[];
}

export async function loadAll(dataset: DatasetId): Promise<Snapshot> {
  const db = await getDB(dataset);
  const [products, sales, expenses, batches] = await Promise.all([
    db.getAll("products"),
    db.getAll("sales"),
    db.getAll("expenses"),
    db.getAll("batches"),
  ]);
  return { products, sales, expenses, batches };
}

export async function clearAll(dataset: DatasetId): Promise<void> {
  const db = await getDB(dataset);
  const tx = db.transaction(["products", "sales", "expenses", "batches"], "readwrite");
  await Promise.all([
    tx.objectStore("products").clear(),
    tx.objectStore("sales").clear(),
    tx.objectStore("expenses").clear(),
    tx.objectStore("batches").clear(),
    tx.done,
  ]);
}

export async function writeSnapshot(dataset: DatasetId, data: Snapshot): Promise<void> {
  const db = await getDB(dataset);
  const tx = db.transaction(["products", "sales", "expenses", "batches"], "readwrite");
  for (const p of data.products) tx.objectStore("products").put(p);
  for (const s of data.sales) tx.objectStore("sales").put(s);
  for (const e of data.expenses) tx.objectStore("expenses").put(e);
  for (const b of data.batches) tx.objectStore("batches").put(b);
  await tx.done;
}
