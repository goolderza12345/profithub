import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as db from "../db";
import { validateSalesCsv, SAMPLE_CSV } from "../csv";
import { buildCostLookup, summarize } from "../profit";
import type { Sale } from "../types";

beforeEach(() => {
  // ฐานข้อมูลใหม่ทุกการทดสอบ
  globalThis.indexedDB = new IDBFactory();
});
afterEach(async () => {
  await db.closeAllForTests();
});

async function seedProducts() {
  await db.saveProduct("real", { sku: "TS-001", name: "เสื้อ", unitCost: 85 });
  await db.saveProduct("real", { sku: "MUG-002", name: "แก้ว", unitCost: 95 });
}

async function importSample(dataset: "real" | "demo" = "real") {
  const snap = await db.loadAll(dataset);
  const check = validateSalesCsv(SAMPLE_CSV, {
    productCosts: new Map(snap.products.map((p) => [p.sku, p.unitCost])),
    existingKeys: new Set(snap.sales.map((s) => s.dedupeKey)),
  });
  return db.importSales(dataset, check.rows.filter((r) => r.sale).map((r) => r.sale!), "sample.csv");
}

describe("importSales + Historical Cost Snapshot", () => {
  it("บันทึกต้นทุนสินค้า ณ เวลานำเข้า", async () => {
    await seedProducts();
    const out = await importSample();
    expect(out.added).toBe(4);
    const { sales } = await db.loadAll("real");
    expect(sales.find((s) => s.sku === "TS-001")!.unitCost).toBe(85);
    expect(sales.find((s) => s.sku === "MUG-002")!.unitCost).toBe(95);
  });

  it("แก้ต้นทุนสินค้า: รายการเดิมไม่เปลี่ยน กำไรย้อนหลังเท่าเดิม รายการใหม่ใช้ต้นทุนใหม่", async () => {
    await seedProducts();
    await importSample();
    const before = await db.loadAll("real");
    const profitBefore = summarize(before.sales, [], buildCostLookup(before.products)).netProfit;

    const ts = before.products.find((p) => p.sku === "TS-001")!;
    await db.saveProduct("real", { sku: "TS-001", name: "เสื้อ", unitCost: 150 }, ts.id);

    const after = await db.loadAll("real");
    expect(after.products.find((p) => p.sku === "TS-001")!.unitCost).toBe(150);
    expect(after.sales.filter((s) => s.sku === "TS-001").every((s) => s.unitCost === 85)).toBe(true);
    expect(summarize(after.sales, [], buildCostLookup(after.products)).netProfit).toBe(profitBefore);

    const newSale = validateSalesCsv(
      "order_id,order_date,channel,sku,quantity,unit_price\nNEW-1,2026-11-10,Shopee,TS-001,1,199",
      { productCosts: new Map([["TS-001", 150]]), existingKeys: new Set() },
    ).rows[0].sale!;
    await db.importSales("real", [newSale], "new.csv");
    const latest = (await db.loadAll("real")).sales.find((s) => s.orderId === "NEW-1")!;
    expect(latest.unitCost).toBe(150);
  });

  it("ใช้ต้นทุนล่าสุดในฐานข้อมูล ณ วินาทีที่นำเข้า (แม้ตรวจไฟล์ไว้ก่อนแก้ต้นทุน)", async () => {
    await seedProducts();
    const check = validateSalesCsv(SAMPLE_CSV, { productCosts: new Map([["TS-001", 85], ["MUG-002", 95]]), existingKeys: new Set() });
    const mug = (await db.loadAll("real")).products.find((p) => p.sku === "MUG-002")!;
    await db.saveProduct("real", { sku: "MUG-002", name: "แก้ว", unitCost: 100 }, mug.id);
    await db.importSales("real", check.rows.map((r) => r.sale!), "sample.csv");
    const { sales } = await db.loadAll("real");
    expect(sales.filter((s) => s.sku === "MUG-002").every((s) => s.unitCost === 100)).toBe(true);
  });

  it("ป้องกันนำเข้าซ้ำในระดับฐานข้อมูล", async () => {
    await seedProducts();
    await importSample();
    const check = validateSalesCsv(SAMPLE_CSV, { productCosts: new Map([["TS-001", 85], ["MUG-002", 95]]), existingKeys: new Set() });
    const out = await db.importSales("real", check.rows.map((r) => r.sale!), "sample.csv");
    expect(out).toMatchObject({ added: 0, skippedDuplicate: 4, batchId: null });
    expect((await db.loadAll("real")).sales).toHaveLength(4);
  });
});

describe("แยกข้อมูลจริงและ Demo", () => {
  it("เขียนชุดหนึ่งไม่กระทบอีกชุด", async () => {
    await seedProducts();
    await importSample();
    expect((await db.loadAll("demo")).sales).toHaveLength(0);
    await db.clearAll("demo");
    expect((await db.loadAll("real")).sales).toHaveLength(4);
  });
});

describe("replaceAll / restore (กู้คืน)", () => {
  it("สร้างจุดกู้คืนของข้อมูลเดิมก่อนแทนที่ และย้อนกลับได้", async () => {
    await seedProducts();
    await importSample();
    const original = await db.loadAll("real");

    await db.replaceAll("real", { products: [], sales: [], expenses: [], batches: [] }, { reason: "ทดสอบ", restorePoint: true });
    expect((await db.loadAll("real")).sales).toHaveLength(0);

    const points = await db.listRestorePoints("real");
    expect(points).toHaveLength(1);
    expect(points[0].counts).toEqual({ products: 2, sales: 4, expenses: 0, batches: 1 });

    await db.restoreFromPoint("real", points[0].id);
    const back = await db.loadAll("real");
    const sortById = <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => x.id.localeCompare(y.id));
    expect(sortById(back.sales)).toEqual(sortById(original.sales));
    expect(sortById(back.products)).toEqual(sortById(original.products));
  });

  it("ถ้าเขียนไม่สำเร็จกลางทาง ข้อมูลเดิมยังอยู่ครบ และไม่มีจุดกู้คืนค้าง (atomic)", async () => {
    await seedProducts();
    await importSample();
    const original = await db.loadAll("real");
    const bad: Sale[] = [
      { ...original.sales[0], id: "x1" },
      { ...original.sales[0], id: "x2" }, // dedupeKey ซ้ำ → ละเมิด unique index
    ];
    await expect(
      db.replaceAll("real", { ...original, sales: bad }, { reason: "ทดสอบ", restorePoint: true }),
    ).rejects.toThrow();
    const after = await db.loadAll("real");
    expect(after.sales).toHaveLength(4);
    expect(after.products).toHaveLength(2);
    expect(await db.listRestorePoints("real")).toHaveLength(0);
  });

  it("เก็บจุดกู้คืนไม่เกินจำนวนสูงสุด", async () => {
    await seedProducts();
    const snap = await db.loadAll("real");
    for (let i = 0; i < db.MAX_RESTORE_POINTS + 3; i++) {
      await db.replaceAll("real", snap, { reason: `รอบ ${i}`, restorePoint: true });
    }
    expect(await db.listRestorePoints("real")).toHaveLength(db.MAX_RESTORE_POINTS);
  });

  it("ไม่สร้างจุดกู้คืนเมื่อไม่มีข้อมูลเดิม", async () => {
    await db.replaceAll("real", { products: [], sales: [], expenses: [], batches: [] }, { reason: "x", restorePoint: true });
    expect(await db.listRestorePoints("real")).toHaveLength(0);
  });

  it("ลบชุดนำเข้าสร้างจุดกู้คืนก่อนลบ", async () => {
    await seedProducts();
    const out = await importSample();
    expect(await db.deleteBatch("real", out.batchId!)).toBe(4);
    expect((await db.loadAll("real")).sales).toHaveLength(0);
    const points = await db.listRestorePoints("real");
    expect(points[0].reason).toContain("sample.csv");
    expect(points[0].counts.sales).toBe(4);
  });
});

describe("product integrity", () => {
  it("SKU ซ้ำ, ลบสินค้าที่มีรายการขาย และเปลี่ยน SKU ที่ใช้แล้ว ถูกปฏิเสธ", async () => {
    await seedProducts();
    await expect(db.saveProduct("real", { sku: "ts-001", name: "x", unitCost: 1 })).rejects.toThrow("มีอยู่แล้ว");
    await importSample();
    const ts = (await db.loadAll("real")).products.find((p) => p.sku === "TS-001")!;
    await expect(db.deleteProduct("real", ts.id)).rejects.toThrow("ลบไม่ได้");
    await expect(db.saveProduct("real", { sku: "TS-999", name: "x", unitCost: 1 }, ts.id)).rejects.toThrow("เปลี่ยน SKU ไม่ได้");
  });
});

describe("ย้ายข้อมูลจาก v1 → v2", () => {
  it("เติมต้นทุน snapshot ให้รายการขายเดิมจากต้นทุนปัจจุบัน โดยไม่ลบข้อมูลใด", async () => {
    // สร้างฐานข้อมูลรูปแบบ MVP 1.0 (v1)
    const v1 = await openDB(db.DB_NAMES.real, 1, {
      upgrade(d) {
        d.createObjectStore("products", { keyPath: "id" }).createIndex("sku", "sku", { unique: true });
        const s = d.createObjectStore("sales", { keyPath: "id" });
        s.createIndex("dedupeKey", "dedupeKey", { unique: true });
        s.createIndex("batchId", "batchId");
        d.createObjectStore("expenses", { keyPath: "id" });
        d.createObjectStore("batches", { keyPath: "id" });
      },
    });
    const base = { orderId: "O", date: "2026-11-01", channel: "Shopee", quantity: 1, unitPrice: 100, discount: 0, refund: 0, returnedQty: 0, platformFee: 0, shippingFee: 0, batchId: "b1" };
    await v1.put("products", { id: "p1", sku: "A", name: "A", unitCost: 40, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
    await v1.put("sales", { ...base, id: "s1", sku: "A", dedupeKey: "k1" });
    await v1.put("sales", { ...base, id: "s2", sku: "GONE", dedupeKey: "k2" });
    await v1.put("expenses", { id: "e1", date: "2026-11-01", category: "ads", amount: 10, channel: "", note: "", createdAt: "2026-11-01T00:00:00Z" });
    await v1.put("batches", { id: "b1", fileName: "f.csv", importedAt: "2026-11-01T00:00:00Z", rowCount: 2 });
    v1.close();

    const snap = await db.loadAll("real");
    expect(snap.sales).toHaveLength(2);
    expect(snap.expenses).toHaveLength(1);
    expect(snap.batches).toHaveLength(1);
    expect(snap.sales.find((s) => s.id === "s1")!.unitCost).toBe(40);
    // SKU ที่ไม่มีสินค้า: ไม่เดาต้นทุน ปล่อยว่างไว้
    expect(snap.sales.find((s) => s.id === "s2")!.unitCost).toBeUndefined();
    expect(await db.listRestorePoints("real")).toEqual([]);
  });
});
