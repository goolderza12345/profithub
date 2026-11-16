"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clearAll, getDB, loadAll, writeSnapshot, type Snapshot } from "@/lib/db";
import { generateDemoData } from "@/lib/demo";
import { newId } from "@/lib/id";
import { presetRange, type RangePreset } from "@/lib/dates";
import type { SaleDraft } from "@/lib/csv";
import type { DatasetId, DateRange, Expense, ImportBatch, Product, Sale } from "@/lib/types";

const DATASET_KEY = "profithub:dataset";
const RANGE_KEY = "profithub:range";

export type ProductInput = Pick<Product, "sku" | "name" | "unitCost">;
export type ExpenseInput = Omit<Expense, "id" | "createdAt">;

interface RangeState {
  preset: RangePreset;
  custom: DateRange;
}

interface DataContextValue extends Snapshot {
  ready: boolean;
  error: string | null;
  dataset: DatasetId;
  switchDataset: (d: DatasetId) => Promise<void>;
  /** เปิดโหมด Demo (ถ้ายังไม่มีข้อมูล Demo จะสร้างให้) */
  startDemo: () => Promise<void>;
  resetDemo: () => Promise<void>;
  clearCurrent: () => Promise<void>;
  saveProduct: (input: ProductInput, id?: string) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  importSales: (drafts: SaleDraft[], fileName: string) => Promise<number>;
  deleteBatch: (batchId: string) => Promise<void>;
  saveExpense: (input: ExpenseInput, id?: string) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  range: DateRange;
  rangeState: RangeState;
  setRangeState: (r: RangeState) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

const EMPTY: Snapshot = { products: [], sales: [], expenses: [], batches: [] };

function readStorage<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ไม่เป็นไรถ้าเก็บไม่ได้ */
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [dataset, setDataset] = useState<DatasetId>("real");
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // วันที่ปัจจุบันอ่านในเบราว์เซอร์เท่านั้น (ไม่อ่านตอน prerender)
  const [today, setToday] = useState<Date | null>(null);
  const [rangeState, setRangeStateRaw] = useState<RangeState>({ preset: "30d", custom: { from: null, to: null } });

  const reload = useCallback(async (d: DatasetId) => {
    try {
      const snap = await loadAll(d);
      setData(snap);
      setError(null);
    } catch (e) {
      setError(
        "ไม่สามารถเปิดฐานข้อมูลในเบราว์เซอร์ได้ (IndexedDB) — โหมดไม่ระบุตัวตนบางเบราว์เซอร์ไม่รองรับ: " +
          (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = readStorage<DatasetId>(DATASET_KEY, "real") === "demo" ? "demo" : "real";
      const r = readStorage<RangeState | null>(RANGE_KEY, null);
      if (cancelled) return;
      setToday(new Date());
      if (r && r.preset) setRangeStateRaw(r);
      setDataset(d);
      await reload(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const switchDataset = useCallback(
    async (d: DatasetId) => {
      setDataset(d);
      writeStorage(DATASET_KEY, d);
      await reload(d);
    },
    [reload],
  );

  const resetDemo = useCallback(async () => {
    await clearAll("demo");
    await writeSnapshot("demo", generateDemoData(new Date()));
    if (dataset === "demo") await reload("demo");
  }, [dataset, reload]);

  const startDemo = useCallback(async () => {
    const snap = await loadAll("demo");
    if (snap.products.length === 0 && snap.sales.length === 0) {
      await writeSnapshot("demo", generateDemoData(new Date()));
    }
    await switchDataset("demo");
  }, [switchDataset]);

  const clearCurrent = useCallback(async () => {
    await clearAll(dataset);
    await reload(dataset);
  }, [dataset, reload]);

  const saveProduct = useCallback(
    async (input: ProductInput, id?: string) => {
      const db = await getDB(dataset);
      const sku = input.sku.trim().toUpperCase();
      const clash = await db.getFromIndex("products", "sku", sku);
      if (clash && clash.id !== id) throw new Error(`SKU "${sku}" มีอยู่แล้ว`);
      const now = new Date().toISOString();
      if (id) {
        const old = await db.get("products", id);
        if (!old) throw new Error("ไม่พบสินค้า");
        if (old.sku !== sku) {
          const used = data.sales.some((s) => s.sku.toUpperCase() === old.sku.toUpperCase());
          if (used) throw new Error("เปลี่ยน SKU ไม่ได้ เพราะมีรายการขายที่ใช้ SKU นี้แล้ว");
        }
        await db.put("products", { ...old, sku, name: input.name.trim(), unitCost: input.unitCost, updatedAt: now });
      } else {
        await db.add("products", { id: newId(), sku, name: input.name.trim(), unitCost: input.unitCost, createdAt: now, updatedAt: now });
      }
      await reload(dataset);
    },
    [dataset, data.sales, reload],
  );

  const deleteProduct = useCallback(
    async (id: string) => {
      const db = await getDB(dataset);
      const p = await db.get("products", id);
      if (!p) return;
      const used = data.sales.filter((s) => s.sku.toUpperCase() === p.sku.toUpperCase()).length;
      if (used) throw new Error(`ลบไม่ได้ เพราะมีรายการขาย ${used} รายการที่ใช้ SKU นี้ (ลบชุดนำเข้าที่เกี่ยวข้องก่อน)`);
      await db.delete("products", id);
      await reload(dataset);
    },
    [dataset, data.sales, reload],
  );

  const importSales = useCallback(
    async (drafts: SaleDraft[], fileName: string) => {
      const db = await getDB(dataset);
      const batch: ImportBatch = { id: newId(), fileName, importedAt: new Date().toISOString(), rowCount: 0 };
      const tx = db.transaction(["sales", "batches"], "readwrite");
      const store = tx.objectStore("sales");
      let added = 0;
      for (const d of drafts) {
        // ตรวจซ้ำอีกครั้งในฐานข้อมูล (กันกรณีกดนำเข้าซ้ำ)
        const exists = await store.index("dedupeKey").getKey(d.dedupeKey);
        if (exists) continue;
        const s: Sale = { ...d, id: newId(), batchId: batch.id };
        await store.add(s);
        added++;
      }
      batch.rowCount = added;
      if (added > 0) await tx.objectStore("batches").add(batch);
      await tx.done;
      await reload(dataset);
      return added;
    },
    [dataset, reload],
  );

  const deleteBatch = useCallback(
    async (batchId: string) => {
      const db = await getDB(dataset);
      const tx = db.transaction(["sales", "batches"], "readwrite");
      const keys = await tx.objectStore("sales").index("batchId").getAllKeys(batchId);
      for (const k of keys) await tx.objectStore("sales").delete(k);
      await tx.objectStore("batches").delete(batchId);
      await tx.done;
      await reload(dataset);
    },
    [dataset, reload],
  );

  const saveExpense = useCallback(
    async (input: ExpenseInput, id?: string) => {
      const db = await getDB(dataset);
      if (id) {
        const old = await db.get("expenses", id);
        if (!old) throw new Error("ไม่พบรายการ");
        await db.put("expenses", { ...old, ...input });
      } else {
        await db.add("expenses", { ...input, id: newId(), createdAt: new Date().toISOString() });
      }
      await reload(dataset);
    },
    [dataset, reload],
  );

  const deleteExpense = useCallback(
    async (id: string) => {
      const db = await getDB(dataset);
      await db.delete("expenses", id);
      await reload(dataset);
    },
    [dataset, reload],
  );

  const setRangeState = useCallback((r: RangeState) => {
    setRangeStateRaw(r);
    writeStorage(RANGE_KEY, r);
  }, []);

  const range = useMemo<DateRange>(
    () =>
      rangeState.preset === "custom"
        ? rangeState.custom
        : today
          ? presetRange(rangeState.preset, today)
          : { from: null, to: null },
    [rangeState, today],
  );

  const value: DataContextValue = {
    ...data,
    ready,
    error,
    dataset,
    switchDataset,
    startDemo,
    resetDemo,
    clearCurrent,
    saveProduct,
    deleteProduct,
    importSales,
    deleteBatch,
    saveExpense,
    deleteExpense,
    range,
    rangeState,
    setRangeState,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used inside DataProvider");
  return ctx;
}
