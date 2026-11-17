/**
 * Integration: ไฟล์ → ตรวจ → แผน → บันทึก (fake IndexedDB) → คำนวณกำไรจากรายการที่นับ
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as db from "../db";
import { getAdapter } from "../import/adapters";
import { defaultOptions, suggestMapping, type MappingOptions } from "../import/mapping";
import { buildTable, csvToSheet } from "../import/table";
import { validateImport } from "../import/validate";
import { buildOrderPlan } from "../orders/plan";
import { selectRecognizedSales } from "../orders/recognition";
import { buildCostLookup, summarize } from "../profit";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(async () => {
  await db.closeAllForTests();
});

const H = "order_id,order_date,channel,sku,quantity,unit_price,discount,refund,returned_qty,platform_fee,shipping_fee,order_status,not_returned_qty,fee_refunded";

async function seed() {
  await db.saveProduct("real", { sku: "TS-001", name: "เสื้อ", unitCost: 85 });
  await db.saveProduct("real", { sku: "MUG-002", name: "แก้ว", unitCost: 95 });
}

async function plan(csv: string, opts: Partial<MappingOptions> = {}) {
  const snap = await db.loadAll("real");
  const table = buildTable(csvToSheet(csv), 0, true);
  const generic = getAdapter("generic");
  const preview = validateImport(table, suggestMapping(table.headers, generic).mapping, { ...defaultOptions(generic), ...opts }, {
    products: snap.products,
    aliases: snap.skuAliases ?? [],
    existingKeys: new Set(),
    skuDecisions: {},
    orderMode: true,
  });
  const p = buildOrderPlan(preview.incoming, { orders: new Map((snap.orders ?? []).map((o) => [o.key, o])), sales: snap.sales, batchId: "pending", now: new Date().toISOString() });
  return { preview, plan: p };
}

async function importCsv(csv: string, name = "f.csv") {
  const { preview, plan: p } = await plan(csv);
  const out = await db.applyOrderPlan("real", p.orders, name, {});
  return { preview, plan: p, out };
}

async function profit() {
  const s = await db.loadAll("real");
  const r = selectRecognizedSales(s.sales, s.orders ?? []);
  return { ...summarize(r.recognized, s.expenses, buildCostLookup(s.products)), r };
}

describe("นำเข้าคำสั่งซื้อ → อัปเดต → ประวัติ", () => {
  const first = [H, "A1,2026-11-01,Shopee,TS-001,2,199,20,0,0,23.88,0,shipped,0,0", "A1,2026-11-01,Shopee,MUG-002,1,250,0,0,0,15,0,shipped,0,0"].join("\n");

  it("นำเข้าไฟล์เดิมซ้ำ (และสลับลำดับแถว) ยอดไม่เพิ่ม ไม่มีประวัติใหม่", async () => {
    await seed();
    const a = await importCsv(first);
    expect(a.out).toMatchObject({ ordersCreated: 1, salesAdded: 2 });
    const before = await profit();
    const reordered = [H, ...first.split("\n").slice(1).reverse()].join("\n");
    const b = await importCsv(reordered);
    expect(b.plan.counts).toMatchObject({ unchanged: 1 });
    expect(b.out).toMatchObject({ batchId: null, salesAdded: 0, salesUpdated: 0 });
    const after = await profit();
    expect(after.netProfit).toBe(before.netProfit);
    expect((await db.loadAll("real")).orderRevisions).toHaveLength(1);
  });

  it("คืนเงินหลังนำเข้า + แก้ต้นทุนสินค้า: ต้นทุนเดิมไม่เปลี่ยน คืนเงินไม่ทำให้ชิ้นคืนผิด และประวัติเดิมยังอยู่", async () => {
    await seed();
    await importCsv(first);
    const ts = (await db.loadAll("real")).products.find((p) => p.sku === "TS-001")!;
    await db.saveProduct("real", { sku: "TS-001", name: "เสื้อ", unitCost: 150 }, ts.id);
    // ลูกค้าได้เงินคืน 100 บาท ไม่ต้องส่งสินค้าคืน 1 ชิ้น ร้านได้ค่าธรรมเนียมคืน 5 บาท
    const second = [H, "A1,2026-11-01,Shopee,TS-001,2,199,20,100,0,23.88,0,completed,1,5", "A1,2026-11-01,Shopee,MUG-002,1,250,0,0,0,15,0,completed,0,0"].join("\n");
    const r = await importCsv(second, "update.csv");
    expect(r.plan.counts).toMatchObject({ update: 1 });
    expect(r.out).toMatchObject({ ordersUpdated: 1, salesUpdated: 2, salesAdded: 0 });
    const s = await db.loadAll("real");
    const line = s.sales.find((x) => x.sku === "TS-001")!;
    expect(line).toMatchObject({ unitCost: 85, refund: 100, returnedQty: 0, platformFee: 18.88 });
    expect(s.orders![0].lines.find((l) => l.sourceSku === "TS-001")).toMatchObject({ notReturned: 1, refundSeller: 10000 });
    expect(s.orderRevisions!.map((x) => x.kind)).toEqual(["create", "update"]);
    expect(s.orderRevisions![1].changes).toContainEqual({ path: "sku:TS-001|p:19900.refund", from: 0, to: 100 });
    // กำไร: TS-001 = (378 − 100) − 170 − 18.88 = 89.12 · MUG-002 = 250 − 95 − 15 = 140 → รวม 229.12
    expect((await profit()).netProfit).toBe(229.12);
  });

  it("ไฟล์เก่ากว่าไม่บันทึกทับ", async () => {
    await seed();
    await importCsv(first.replaceAll("shipped", "completed"));
    const r = await importCsv(first);
    expect(r.plan.counts.stale).toBe(1);
    expect(r.out.batchId).toBeNull();
    expect((await db.loadAll("real")).orders![0].status).toBe("completed");
  });

  it("รอชำระและยกเลิกไม่นับในกำไร", async () => {
    await seed();
    await importCsv([H, "P1,2026-11-01,Shopee,TS-001,1,199,0,0,0,0,0,pending_payment,0,0", "C1,2026-11-01,Shopee,TS-001,1,199,0,0,0,0,0,cancelled,0,0", "K1,2026-11-01,Shopee,TS-001,1,199,0,0,0,0,0,completed,0,0"].join("\n"));
    const p = await profit();
    expect(p.netRevenue).toBe(199);
    expect(p.r).toMatchObject({ excludedPending: 1, excludedCancelled: 1 });
  });

  it("ข้อมูลในระบบเปลี่ยนระหว่างตรวจ → ไม่บันทึกอะไรเลย", async () => {
    await seed();
    await importCsv(first);
    const second = first.replaceAll("shipped", "completed");
    const a = await plan(second);
    const b = await plan(second);
    await db.applyOrderPlan("real", a.plan.orders, "a.csv");
    const before = await db.loadAll("real");
    await expect(db.applyOrderPlan("real", b.plan.orders, "b.csv")).rejects.toThrow(db.STALE_PLAN_MESSAGE);
    const after = await db.loadAll("real");
    expect(after.orderRevisions).toHaveLength(before.orderRevisions!.length);
    expect(after.batches).toHaveLength(before.batches.length);
  });

  it("ลบชุดนำเข้า: ชุดที่สร้างอย่างเดียวลบได้ / ชุดที่ถูกอัปเดตต่อ ลบไม่ได้", async () => {
    await seed();
    const a = await importCsv(first);
    const b = await importCsv([H, "B9,2026-11-02,Lazada,MUG-002,1,250,0,0,0,0,0,shipped,0,0"].join("\n"), "b.csv");
    await importCsv(first.replaceAll("shipped", "completed"), "c.csv");
    await expect(db.deleteBatch("real", a.out.batchId!)).rejects.toThrow("ลบทีละชุดไม่ได้");
    expect(await db.deleteBatch("real", b.out.batchId!)).toBe(1);
    const s = await db.loadAll("real");
    expect(s.orders!.map((o) => o.orderId)).toEqual(["A1"]);
    expect(s.orderRevisions!.every((r) => r.orderKey === "shopee|A1")).toBe(true);
  });
});

describe("ผูกข้อมูลรุ่นเก่า (นำเข้าด้วย v1.2)", () => {
  it("คงรายการขายเดิมและต้นทุนเดิม ไม่เกิดรายการซ้ำ", async () => {
    await seed();
    // v1.2 path
    const { validateSalesCsv } = await import("../csv");
    const snap = await db.loadAll("real");
    const v = validateSalesCsv("order_id,order_date,channel,sku,quantity,unit_price\nL1,2026-11-01,Shopee,TS-001,1,199", {
      productCosts: new Map(snap.products.map((p) => [p.sku, p.unitCost])),
      existingKeys: new Set(),
    });
    await db.importSales("real", v.rows.map((r) => r.sale!), "old.csv");
    const ts = (await db.loadAll("real")).products.find((p) => p.sku === "TS-001")!;
    await db.saveProduct("real", { sku: "TS-001", name: "เสื้อ", unitCost: 300 }, ts.id);
    const r = await importCsv([H, "L1,2026-11-01,Shopee,TS-001,1,199,0,50,0,0,0,completed,1,0"].join("\n"));
    expect(r.plan.counts.adopt).toBe(1);
    const s = await db.loadAll("real");
    expect(s.sales).toHaveLength(1);
    expect(s.sales[0]).toMatchObject({ unitCost: 85, refund: 50, orderKey: "shopee|L1", dedupeKey: "shopee|L1|TS-001" });
  });
});

describe("Backup หลังอัปเดตออเดอร์", () => {
  it("กู้คืน Backup ก่อนอัปเดต ได้ข้อมูลและประวัติกลับไปตรงกันทั้งชุด", async () => {
    const { createBackup, parseBackup, serializeBackup, restoreImpact } = await import("../backup");
    await seed();
    await importCsv([H, "A1,2026-11-01,Shopee,TS-001,1,199,0,0,0,0,0,shipped,0,0"].join("\n"));
    const backup = createBackup("real", await db.loadAll("real"), new Date());
    await new Promise((r) => setTimeout(r, 5));
    await importCsv([H, "A1,2026-11-01,Shopee,TS-001,1,199,0,199,0,0,0,completed,1,0"].join("\n"), "refund.csv");
    const parsed = parseBackup(serializeBackup(backup), "real");
    expect(parsed.ok).toBe(true);
    const im = restoreImpact(await db.loadAll("real"), parsed.backup!);
    expect(im).toMatchObject({ ordersUpdatedAfter: 1, revisionsAfter: 1, refundsAffected: 1, batchesAfter: 1 });
    await db.replaceAll("real", parsed.backup!.data, { reason: "x", restorePoint: true });
    const s = await db.loadAll("real");
    expect(s.orders![0].status).toBe("shipped");
    expect(s.orderRevisions).toHaveLength(1);
    expect(s.sales[0].refund).toBe(0);
  });
});
