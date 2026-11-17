import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackup, parseBackup, referenceErrors, restoreImpact, serializeBackup } from "../backup";
import { checksum } from "../checksum";
import * as db from "../db";
import type { Snapshot } from "../db";
import { line, order, T0 } from "../orders/__tests__/helpers";
import { expense, product, sale } from "./helpers";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(async () => {
  await db.closeAllForTests();
});

const full = (): Required<Snapshot> => ({
  products: [product({ id: "p1", sku: "A", createdAt: T0, updatedAt: T0 })],
  sales: [sale({ id: "s1", sku: "A", unitCost: 40, orderKey: "shopee|O1", lineKey: "sku:A|p:10000", dedupeKey: "shopee|O1|A", batchId: "b1" })],
  expenses: [
    expense({ id: "e1", amount: 50, createdAt: T0 }),
    expense({ id: "e2", amount: 10, createdAt: T0, source: { kind: "settlement", entryKey: "id:9:other" } }),
  ],
  batches: [{ id: "b1", fileName: "a.csv", importedAt: T0, rowCount: 1 }],
  skuAliases: [],
  orders: [order({ lines: [line({ saleId: "s1" })] })],
  orderRevisions: [{ seq: 1, orderKey: "shopee|O1", batchId: "b1", appliedAt: T0, kind: "create", changes: [] }],
  settlementReports: [{ id: "r1", adapterId: "generic", fileName: "fin.csv", fileHash: "abc", importedAt: T0, entryCount: 1 }],
  settlementEntries: [{ entryKey: "id:9:other", reportIds: ["r1"], type: "other", amount: 1000, occurredAt: "2026-11-02", description: "" }],
});

describe("DB v3 → v4", () => {
  it("เพิ่ม store ใหม่ว่าง ข้อมูลเดิม การจับคู่ SKU และจุดกู้คืนยังอยู่ครบ", async () => {
    const v3 = await openDB(db.DB_NAMES.real, 3, {
      upgrade(d) {
        d.createObjectStore("products", { keyPath: "id" }).createIndex("sku", "sku", { unique: true });
        const s = d.createObjectStore("sales", { keyPath: "id" });
        s.createIndex("dedupeKey", "dedupeKey", { unique: true });
        s.createIndex("batchId", "batchId");
        d.createObjectStore("expenses", { keyPath: "id" });
        d.createObjectStore("batches", { keyPath: "id" });
        d.createObjectStore("restorePoints", { keyPath: "id" });
        d.createObjectStore("skuAliases", { keyPath: "alias" }).createIndex("productId", "productId");
      },
    });
    await v3.put("products", product({ id: "p1", sku: "A", createdAt: T0, updatedAt: T0 }));
    await v3.put("sales", sale({ id: "s1", sku: "A", unitCost: 40, dedupeKey: "k1" }));
    await v3.put("skuAliases", { alias: "X-A", productId: "p1", createdAt: T0 });
    await v3.put("restorePoints", { id: "r1", createdAt: T0, reason: "เดิม", counts: { products: 1, sales: 0, expenses: 0, batches: 0 }, data: { products: [], sales: [], expenses: [], batches: [] } });
    v3.close();

    const snap = await db.loadAll("real");
    expect(snap.sales).toEqual([sale({ id: "s1", sku: "A", unitCost: 40, dedupeKey: "k1" })]);
    expect(snap.skuAliases).toHaveLength(1);
    expect(snap.orders).toEqual([]);
    expect(snap.orderRevisions).toEqual([]);
    expect(snap.settlementReports).toEqual([]);
    expect(snap.settlementEntries).toEqual([]);
    expect((await db.listRestorePoints("real")).map((p) => p.id)).toEqual(["r1"]);
  });

  it("แท็บอื่นเปิดฐานข้อมูลรุ่นเก่าค้างไว้ → แจ้งเหตุการณ์ blocked และอัปเกรดต่อได้เมื่อแท็บนั้นปิด", async () => {
    const old = await openDB(db.DB_NAMES.real, 3, { upgrade: (d) => void d.createObjectStore("products", { keyPath: "id" }) });
    const events: string[] = [];
    const off = db.onDbEvent((e) => events.push(e.kind));
    const opening = db.getDB("real").catch((e) => e);
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toContain("blocked");
    old.close();
    await opening;
    off();
  });

  it("replaceAll และจุดกู้คืนรวมข้อมูลคำสั่งซื้อและรายงานการเงิน", async () => {
    await db.replaceAll("real", full(), { reason: "x", restorePoint: false });
    expect(db.countsOf(await db.loadAll("real"))).toEqual({ products: 1, sales: 1, expenses: 2, batches: 1, skuAliases: 0, orders: 1, orderRevisions: 1, settlementReports: 1, settlementEntries: 1 });
    await db.clearAll("real");
    const [point] = await db.listRestorePoints("real");
    expect(point.counts.orders).toBe(1);
    await db.restoreFromPoint("real", point.id);
    expect((await db.loadAll("real")).orderRevisions).toEqual(full().orderRevisions);
  });
});

describe("Backup schema 3", () => {
  const text = (d: Snapshot) => serializeBackup(createBackup("real", d, new Date(T0)));

  it("ไป-กลับครบทุกข้อมูลรวมคำสั่งซื้อ ประวัติ และรายงานการเงิน", () => {
    const r = parseBackup(text(full()), "real");
    expect(r.errors).toEqual([]);
    expect(r.backup!.schemaVersion).toBe(3);
    expect(r.backup!.data).toEqual(full());
  });

  it("ยังรับไฟล์ schema 2 (ไม่มีข้อมูลคำสั่งซื้อ)", () => {
    const d = { products: full().products, sales: [sale({ id: "s1", sku: "A" })], expenses: [], batches: [], skuAliases: [] };
    const f = { kind: "profithub-backup", schemaVersion: 2, app: "ProfitHub", dataset: "real", exportedAt: T0, counts: { products: 1, sales: 1, expenses: 0, batches: 0, skuAliases: 0 }, checksum: checksum(JSON.stringify({ dataset: "real", data: d })), data: d };
    const r = parseBackup(JSON.stringify(f), "real");
    expect(r.errors).toEqual([]);
    expect(r.backup!.data.orders).toEqual([]);
  });

  it("ความสัมพันธ์เสีย → ปฏิเสธทั้งไฟล์", () => {
    const cases: [string, (s: Required<Snapshot>) => void][] = [
      ["ไม่พบรายการขายของบรรทัด", (s) => (s.orders[0].lines[0].saleId = "ghost")],
      ["ไม่พบคำสั่งซื้อ", (s) => (s.sales[0].orderKey = "shopee|NOPE")],
      ["ประวัติลำดับ 1: ไม่พบคำสั่งซื้อ", (s) => (s.orderRevisions[0].orderKey = "x|y")],
      ["ไม่พบรายงานการเงินที่อ้างถึง", (s) => (s.settlementEntries[0].reportIds = ["r9"])],
      ["ไม่พบรายการในรายงานการเงินที่เป็นที่มา", (s) => (s.expenses[1].source = { kind: "settlement", entryKey: "id:0" })],
    ];
    for (const [msg, mutate] of cases) {
      const d = full();
      mutate(d);
      expect(referenceErrors(d).join()).toContain(msg);
      const r = parseBackup(text(d), "real");
      expect(r.ok).toBe(false);
    }
  });

  it("ข้อมูลคำสั่งซื้อผิดรูปแบบ (สตางค์ไม่ใช่จำนวนเต็ม, คืนเกินจำนวน)", () => {
    const d = full();
    d.orders[0].lines[0].sellerDiscount = 10.5;
    d.orders[0].lines[0].returnedResellable = 2;
    const r = parseBackup(text(d), "real");
    expect(r.errors.join()).toContain("sellerDiscount ต้องเป็นจำนวนเต็มสตางค์");
    expect(r.errors.join()).toContain("จำนวนชิ้นที่คืนรวมกันเกินจำนวนที่ขาย");
  });
});

describe("restoreImpact: แจ้งข้อมูลที่จะหายก่อนกู้คืน", () => {
  it("นับคำสั่งซื้อที่อัปเดต ประวัติ เงินคืน และรายงานการเงินหลังเวลาสร้าง Backup", () => {
    const backup = createBackup("real", full(), new Date("2026-11-05T00:00:00.000Z"));
    const now = full();
    now.orders[0].updatedAt = "2026-11-06T00:00:00.000Z";
    now.orders[0].lines[0].refundSeller = 5000;
    now.orderRevisions.push({ seq: 2, orderKey: "shopee|O1", batchId: "b2", appliedAt: "2026-11-06T00:00:00.000Z", kind: "update", changes: [] });
    now.settlementReports.push({ id: "r2", adapterId: "generic", fileName: "f2.csv", fileHash: "def", importedAt: "2026-11-06T00:00:00.000Z", entryCount: 0 });
    expect(restoreImpact(now, backup)).toEqual({
      ordersUpdatedAfter: 1,
      revisionsAfter: 1,
      refundsAffected: 1,
      settlementReportsAfter: 1,
      batchesAfter: 0,
      droppedKinds: [],
    });
  });

  it("Backup รุ่นเก่า (schema 2) ทับฐานข้อมูลใหม่: ระบุข้อมูลที่จะถูกลบทั้งหมด", () => {
    const old = { ...createBackup("real", full(), new Date(T0)), schemaVersion: 2 };
    expect(restoreImpact(full(), old).droppedKinds).toEqual([
      { label: "คำสั่งซื้อและสถานะ", count: 1 },
      { label: "ประวัติการเปลี่ยนแปลงคำสั่งซื้อ", count: 1 },
      { label: "รายงานการเงิน", count: 1 },
    ]);
  });
});
