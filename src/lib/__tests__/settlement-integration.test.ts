import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as db from "../db";
import { getAdapter } from "../import/adapters";
import { defaultOptions, suggestMapping } from "../import/mapping";
import { buildTable, csvToSheet } from "../import/table";
import { validateImport } from "../import/validate";
import { buildOrderPlan } from "../orders/plan";
import { selectRecognizedSales } from "../orders/recognition";
import { buildSettlementPlan, parseSettlement, reconcile, settlementFeesFor, suggestSettlementMapping } from "../orders/settlement";
import { buildCostLookup, summarize } from "../profit";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(async () => {
  await db.closeAllForTests();
});

const OH = "order_id,order_date,channel,sku,quantity,unit_price,platform_fee,shipping_fee,order_status";
const SH = "order_id,date,entry_id,commission_fee,transaction_fee,service_fee,shipping_fee,other_fee,fee_refund,payout,description";

async function importOrders(csv: string) {
  const snap = await db.loadAll("real");
  const t = buildTable(csvToSheet(csv), 0, true);
  const g = getAdapter("generic");
  const pv = validateImport(t, suggestMapping(t.headers, g).mapping, defaultOptions(g), {
    products: snap.products, aliases: [], existingKeys: new Set(), skuDecisions: {}, orderMode: true,
  });
  const plan = buildOrderPlan(pv.incoming, {
    orders: new Map((snap.orders ?? []).map((o) => [o.key, o])),
    sales: snap.sales,
    batchId: "x",
    now: new Date().toISOString(),
    settlementFees: (o) => settlementFeesFor(o, snap.settlementEntries ?? []),
  });
  return db.applyOrderPlan("real", plan.orders, "orders.csv");
}

let reportN = 0;
async function importSettlement(csv: string, hash = `h${++reportN}`, supersedeExpenseIds: string[] = []) {
  const snap = await db.loadAll("real");
  const t = buildTable(csvToSheet(csv), 0, true);
  const id = `r${reportN}`;
  const parsed = parseSettlement(t, suggestSettlementMapping(t.headers), { channel: "Shopee", reportId: id, negativeAsDeduction: false });
  expect(parsed.errors).toEqual([]);
  const plan = buildSettlementPlan(parsed.entries, new Map((snap.settlementEntries ?? []).map((e) => [e.entryKey, e])));
  const out = await db.applySettlement("real", { report: { id, adapterId: "generic", fileName: `fin-${id}.csv`, fileHash: hash }, plan, channel: "Shopee", supersedeExpenseIds });
  return { plan, out, id };
}

async function totals() {
  const s = await db.loadAll("real");
  const r = selectRecognizedSales(s.sales, s.orders ?? []);
  return summarize(r.recognized, s.expenses.filter((e) => !e.supersededBy), buildCostLookup(s.products));
}

beforeEach(async () => {
  await db.saveProduct("real", { sku: "TS-001", name: "เสื้อ", unitCost: 85 });
});

describe("รายงานการเงิน → ค่าธรรมเนียมจริง", () => {
  it("แทนค่าธรรมเนียมจากไฟล์คำสั่งซื้อ (นับครั้งเดียว) ต้นทุนเดิมไม่เปลี่ยน และเก็บประวัติ", async () => {
    await importOrders([OH, "A1,2026-11-01,Shopee,TS-001,2,199,30,0,shipped"].join("\n"));
    expect((await totals()).orderFees).toBe(30);
    const { out } = await importSettlement([SH, "A1,2026-11-05,T1,20,3.5,,,,,,"].join("\n"));
    expect(out).toMatchObject({ entriesAdded: 2, ordersRecomputed: 1 });
    const s = await db.loadAll("real");
    expect(s.sales[0]).toMatchObject({ platformFee: 23.5, unitCost: 85 });
    expect(s.sales[0].estimateReasons).toEqual([]); // ค่าธรรมเนียมจากรายงานเป็นยอดสุดท้าย
    expect(s.orderRevisions!.map((r) => r.kind)).toEqual(["create", "settlement"]);
    expect((await totals()).orderFees).toBe(23.5);
  });

  it("นำเข้าไฟล์รายงานเดิมซ้ำ → ปฏิเสธทั้งไฟล์ ค่าธรรมเนียมไม่เพิ่ม", async () => {
    await importOrders([OH, "A1,2026-11-01,Shopee,TS-001,1,199,0,0,completed"].join("\n"));
    await importSettlement([SH, "A1,2026-11-05,,20,,,,,,,"].join("\n"), "same");
    const before = await totals();
    await expect(importSettlement([SH, "A1,2026-11-05,,20,,,,,,,"].join("\n"), "same")).rejects.toThrow(db.SETTLEMENT_DUPLICATE_FILE);
    expect((await totals()).orderFees).toBe(before.orderFees);
  });

  it("รายงานช่วงเวลาซ้อนกัน (คนละไฟล์) → รายการเดิมไม่ถูกนับซ้ำ", async () => {
    await importOrders([OH, "A1,2026-11-01,Shopee,TS-001,1,199,0,0,completed", "A2,2026-11-02,Shopee,TS-001,1,199,0,0,completed"].join("\n"));
    await importSettlement([SH, "A1,2026-11-05,,20,,,,,,,", "A2,2026-11-06,,15,,,,,,,"].join("\n"));
    const { plan } = await importSettlement([SH, "A2,2026-11-06,,15,,,,,,,", "A2,2026-11-08,,2,,,,,,,ปรับเพิ่ม"].join("\n"));
    expect(plan.alreadyCounted).toHaveLength(1);
    expect(plan.newEntries).toHaveLength(1);
    expect((await totals()).orderFees).toBe(37);
  });

  it("ปรับย้อนหลัง (รหัสเดิม จำนวนเงินใหม่) → ใช้ค่าใหม่ เก็บค่าเดิมในประวัติ", async () => {
    await importOrders([OH, "A1,2026-11-01,Shopee,TS-001,1,199,0,0,completed"].join("\n"));
    const first = await importSettlement([SH, "A1,2026-11-05,T9,20,,,,,,,"].join("\n"));
    await importSettlement([SH, "A1,2026-11-05,T9,25,,,,,,,"].join("\n"));
    const e = (await db.loadAll("real")).settlementEntries![0];
    expect(e.amount).toBe(2500);
    expect(e.history).toEqual([{ amount: 2000, reportId: first.id }]);
    expect((await totals()).orderFees).toBe(25);
  });

  it("รายงานมาก่อนคำสั่งซื้อ → เมื่อนำเข้าคำสั่งซื้อภายหลังใช้ค่าธรรมเนียมจากรายงาน", async () => {
    const { out } = await importSettlement([SH, "B1,2026-11-05,,12,,,,,,,"].join("\n"));
    expect(out.ordersPending).toBe(1);
    await importOrders([OH, "B1,2026-11-01,Shopee,TS-001,1,199,40,0,completed"].join("\n"));
    expect((await db.loadAll("real")).sales[0].platformFee).toBe(12);
  });

  it("อัปเดตคำสั่งซื้อหลังรายงาน ไม่เขียนทับค่าธรรมเนียมจากรายงาน", async () => {
    await importOrders([OH, "A1,2026-11-01,Shopee,TS-001,1,199,30,0,shipped"].join("\n"));
    await importSettlement([SH, "A1,2026-11-05,,20,,,,,,,"].join("\n"));
    await importOrders([OH, "A1,2026-11-01,Shopee,TS-001,1,199,30,0,completed"].join("\n"));
    expect((await db.loadAll("real")).sales[0].platformFee).toBe(20);
  });

  it("ค่าธรรมเนียมที่ไม่มีเลขคำสั่งซื้อ → ค่าใช้จ่ายระดับร้าน และแทนค่าใช้จ่ายที่กรอกเองได้ (ไม่หักซ้ำ)", async () => {
    await db.saveExpense("real", { date: "2026-11-30", category: "platform_fee", amount: 99, channel: "Shopee", note: "กรอกเอง" });
    const manual = (await db.loadAll("real")).expenses[0];
    await importSettlement([SH, ",2026-11-30,,,,99,,,,,ค่าบริการรายเดือน"].join("\n"), "m1", [manual.id]);
    const s = await db.loadAll("real");
    expect(s.expenses.find((e) => e.source)).toMatchObject({ amount: 99, category: "platform_fee" });
    expect(s.expenses.find((e) => e.id === manual.id)!.supersededBy).toBeDefined();
    expect((await totals()).manualExpenses).toBe(99); // นับครั้งเดียว ไม่ใช่ 198
  });

  it("กระทบยอดโอน", async () => {
    await importOrders([OH, "A1,2026-11-01,Shopee,TS-001,1,199,0,0,completed"].join("\n"));
    await importSettlement([SH, "A1,2026-11-05,,20,,,,,,179,"].join("\n"));
    const s = await db.loadAll("real");
    expect(reconcile(s.orders!, s.settlementEntries!)).toEqual([]);
    await importSettlement([SH, "A1,2026-11-06,,,,,,,,-1,ปรับยอดโอน"].join("\n"));
    const s2 = await db.loadAll("real");
    expect(reconcile(s2.orders!, s2.settlementEntries!)).toMatchObject([{ orderId: "A1", diff: -100 }]);
  });

  it("ผิดพลาดกลางทาง → ไม่มีข้อมูลครึ่งชุด", async () => {
    await importOrders([OH, "A1,2026-11-01,Shopee,TS-001,1,199,0,0,completed"].join("\n"));
    const before = await db.loadAll("real");
    await expect(importSettlement([SH, ",2026-11-30,,,,99,,,,,x"].join("\n"), "z", ["no-such-expense"])).rejects.toThrow();
    const after = await db.loadAll("real");
    expect(after.settlementReports).toEqual([]);
    expect(after.settlementEntries).toEqual([]);
    expect(after.expenses).toHaveLength(before.expenses.length);
  });
});
