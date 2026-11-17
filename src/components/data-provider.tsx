"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as store from "@/lib/db";
import type { ExpenseInput, ImportExtras, ImportOutcome, OrderImportOutcome, ProductInput, RestorePointInfo, Snapshot } from "@/lib/db";
import type { PlannedOrder } from "@/lib/orders/plan";
import { selectRecognizedSales, type RecognitionResult } from "@/lib/orders/recognition";
import type { Order, OrderRevision, SettlementEntry, SettlementReport } from "@/lib/orders/types";
import { backupFileName, createBackup, serializeBackup, type BackupFile } from "@/lib/backup";
import { generateDemoData } from "@/lib/demo";
import { presetRange, type RangePreset } from "@/lib/dates";
import type { SaleDraft } from "@/lib/csv";
import type { DatasetId, DateRange, Expense, SkuAlias } from "@/lib/types";

export type { ExpenseInput, ProductInput };

const DATASET_KEY = "profithub:dataset";
const RANGE_KEY = "profithub:range";
const lastBackupKey = (d: DatasetId) => `profithub:lastBackup:${d}`;

interface RangeState {
  preset: RangePreset;
  custom: DateRange;
}

export type PersistState = "unsupported" | "persisted" | "not-persisted" | "unknown";

interface DataContextValue extends Omit<Snapshot, "skuAliases" | "orders" | "orderRevisions" | "settlementReports" | "settlementEntries"> {
  skuAliases: SkuAlias[];
  orders: Order[];
  orderRevisions: OrderRevision[];
  settlementReports: SettlementReport[];
  settlementEntries: SettlementEntry[];
  /** รายการขายที่นับในกำไร (ตัดคำสั่งซื้อรอชำระ/ยกเลิก และบรรทัดที่ยกเลิกออก) — ใช้กับหน้ารายงานทุกหน้า */
  activeSales: Snapshot["sales"];
  recognition: Omit<RecognitionResult, "recognized">;
  /** ค่าใช้จ่ายที่นับ (ไม่รวมรายการที่ถูกแทนด้วยรายงานการเงิน) */
  activeExpenses: Expense[];
  applyOrderPlan: (planned: PlannedOrder[], fileName: string, extras?: Omit<ImportExtras, "restorePoint">) => Promise<OrderImportOutcome>;
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
  importSales: (drafts: SaleDraft[], fileName: string, extras?: ImportExtras) => Promise<ImportOutcome>;
  deleteBatch: (batchId: string) => Promise<void>;
  saveExpense: (input: ExpenseInput, id?: string) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  /** สร้างไฟล์ Backup ของชุดข้อมูลปัจจุบัน (อ่านจากฐานข้อมูลโดยตรง) */
  exportBackup: () => Promise<{ fileName: string; text: string }>;
  /** บันทึกเวลาสำรองล่าสุด หลังดาวน์โหลดสำเร็จ */
  markBackedUp: () => void;
  lastBackupAt: string | null;
  /** ไม่เคยสำรอง หรือสำรองล่าสุดเกิน 7 วัน */
  backupDue: boolean;
  restoreBackup: (b: BackupFile) => Promise<void>;
  restorePoints: RestorePointInfo[];
  restoreFromPoint: (id: string) => Promise<void>;
  persist: PersistState;
  requestPersist: () => Promise<void>;
  range: DateRange;
  rangeState: RangeState;
  setRangeState: (r: RangeState) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

const EMPTY: Snapshot = {
  products: [],
  sales: [],
  expenses: [],
  batches: [],
  skuAliases: [],
  orders: [],
  orderRevisions: [],
  settlementReports: [],
  settlementEntries: [],
};

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

async function readPersist(): Promise<PersistState> {
  try {
    if (!navigator.storage?.persisted) return "unsupported";
    return (await navigator.storage.persisted()) ? "persisted" : "not-persisted";
  } catch {
    return "unknown";
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [dataset, setDataset] = useState<DatasetId>("real");
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [restorePoints, setRestorePoints] = useState<RestorePointInfo[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [persist, setPersist] = useState<PersistState>("unknown");
  // วันที่ปัจจุบันอ่านในเบราว์เซอร์เท่านั้น (ไม่อ่านตอน prerender)
  const [today, setToday] = useState<Date | null>(null);
  const [rangeState, setRangeStateRaw] = useState<RangeState>({ preset: "30d", custom: { from: null, to: null } });

  const reload = useCallback(async (d: DatasetId) => {
    try {
      const [snap, points] = await Promise.all([store.loadAll(d), store.listRestorePoints(d)]);
      setData(snap);
      setRestorePoints(points);
      setLastBackupAt(readStorage<string | null>(lastBackupKey(d), null));
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

  // แท็บอื่นขวางการอัปเกรดฐานข้อมูล → แจ้งผู้ใช้แทนการค้างเงียบ
  useEffect(
    () =>
      store.onDbEvent((e) =>
        setError(
          e.kind === "blocked"
            ? "กำลังอัปเดตฐานข้อมูล แต่มี ProfitHub เปิดค้างอยู่ในแท็บอื่น — กรุณาปิดแท็บอื่นแล้วโหลดหน้านี้ใหม่"
            : "ProfitHub ในแท็บอื่นกำลังอัปเดตฐานข้อมูล — กรุณาโหลดหน้านี้ใหม่",
        ),
      ),
    [],
  );

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
      setPersist(await readPersist());
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
    await store.replaceAll("demo", generateDemoData(new Date()), { reason: "ก่อนรีเซ็ตข้อมูล Demo", restorePoint: false });
    if (dataset === "demo") await reload("demo");
  }, [dataset, reload]);

  const startDemo = useCallback(async () => {
    const snap = await store.loadAll("demo");
    if (snap.products.length === 0 && snap.sales.length === 0 && snap.expenses.length === 0) {
      await store.replaceAll("demo", generateDemoData(new Date()), { reason: "สร้างข้อมูล Demo", restorePoint: false });
    }
    await switchDataset("demo");
  }, [switchDataset]);

  /** ทุกการเปลี่ยนแปลงเขียนลงฐานข้อมูลก่อน แล้วโหลดใหม่ เพื่อให้หน้าจอตรงกับข้อมูลที่บันทึกจริง */
  const mutate = useCallback(
    <A extends unknown[], R>(fn: (d: DatasetId, ...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        try {
          return await fn(dataset, ...args);
        } finally {
          await reload(dataset);
        }
      },
    [dataset, reload],
  );

  const exportBackup = useCallback(async () => {
    const snap = await store.loadAll(dataset);
    const now = new Date();
    return { fileName: backupFileName(dataset, now), text: serializeBackup(createBackup(dataset, snap, now)) };
  }, [dataset]);

  const markBackedUp = useCallback(() => {
    const now = new Date().toISOString();
    writeStorage(lastBackupKey(dataset), now);
    setLastBackupAt(now);
  }, [dataset]);

  const requestPersist = useCallback(async () => {
    try {
      if (navigator.storage?.persist) await navigator.storage.persist();
    } finally {
      setPersist(await readPersist());
    }
  }, []);

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

  const recognition = useMemo(() => selectRecognizedSales(data.sales, data.orders ?? []), [data.sales, data.orders]);
  const activeExpenses = useMemo(() => data.expenses.filter((e) => !e.supersededBy), [data.expenses]);

  const value: DataContextValue = {
    ...data,
    skuAliases: data.skuAliases ?? [],
    orders: data.orders ?? [],
    orderRevisions: data.orderRevisions ?? [],
    settlementReports: data.settlementReports ?? [],
    settlementEntries: data.settlementEntries ?? [],
    activeSales: recognition.recognized,
    recognition: {
      excludedPending: recognition.excludedPending,
      excludedCancelled: recognition.excludedCancelled,
      excludedCancelledLines: recognition.excludedCancelledLines,
      provisionalOrders: recognition.provisionalOrders,
    },
    activeExpenses,
    applyOrderPlan: mutate(store.applyOrderPlan),
    ready,
    error,
    dataset,
    switchDataset,
    startDemo,
    resetDemo,
    clearCurrent: mutate((d) => store.clearAll(d)),
    saveProduct: mutate(store.saveProduct),
    deleteProduct: mutate(store.deleteProduct),
    importSales: mutate(store.importSales),
    deleteBatch: mutate(async (d, id: string) => void (await store.deleteBatch(d, id))),
    saveExpense: mutate(store.saveExpense),
    deleteExpense: mutate(store.deleteExpense),
    exportBackup,
    markBackedUp,
    lastBackupAt,
    backupDue: !lastBackupAt || (today !== null && today.getTime() - Date.parse(lastBackupAt) > 7 * 86_400_000),
    restoreBackup: mutate(async (d, b: BackupFile) => {
      // ป้องกันซ้ำอีกชั้น: ห้ามกู้คืนข้ามชุดข้อมูล (จริง ↔ Demo)
      if (b.dataset !== d) throw new Error("ชุดข้อมูลในไฟล์ไม่ตรงกับชุดข้อมูลที่เปิดอยู่");
      await store.replaceAll(d, b.data, { reason: "ก่อนกู้คืนจากไฟล์ Backup", restorePoint: true });
    }),
    restorePoints,
    restoreFromPoint: mutate(store.restoreFromPoint),
    persist,
    requestPersist,
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
