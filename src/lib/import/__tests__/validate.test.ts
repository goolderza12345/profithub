import { describe, expect, it } from "vitest";
import { makeDedupeKey } from "../../csv";
import { buildCostLookup, summarize } from "../../profit";
import type { Product, Sale } from "../../types";
import { getAdapter } from "../adapters";
import { defaultOptions, suggestMapping, type ColumnMapping, type MappingOptions } from "../mapping";
import { buildTable, csvToSheet, detectHeaderRow } from "../table";
import { validateImport, type ImportContext } from "../validate";
import { readFixture } from "./fixtures";

const NOW = "2026-11-01T00:00:00.000Z";
const P = (id: string, sku: string, unitCost: number): Product => ({ id, sku, name: `สินค้า ${sku}`, unitCost, createdAt: NOW, updatedAt: NOW });
const products = [P("p1", "TS-001", 85), P("p2", "MUG-002", 95)];
const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({ products, aliases: [], existingKeys: new Set(), skuDecisions: {}, ...over });
const generic = getAdapter("generic");
const opts = (over: Partial<MappingOptions> = {}): MappingOptions => ({ ...defaultOptions(generic), ...over });

function run(csv: string, o: Partial<MappingOptions> = {}, c: Partial<ImportContext> = {}, mapping?: ColumnMapping) {
  const table = buildTable(csvToSheet(csv), 0, true);
  const m = mapping ?? suggestMapping(table.headers, generic).mapping;
  return validateImport(table, m, opts(o), ctx(c));
}

const H = "order_id,order_date,channel,sku,quantity,unit_price,discount,refund,returned_qty,platform_fee,shipping_fee";

describe("สถานะของแต่ละแถว", () => {
  const csv = [
    H,
    "O1,2026-11-01,Shopee,TS-001,2,199,20,0,0,23.88,0", // ok
    "O2,2026-11-01,Shopee,NEW-9,1,100,0,0,0,0,0", // รอจับคู่
    "O3,2026-11-01,Shopee,TS-001,0,199,0,0,0,0,0", // ผิดพลาด
    "O1,2026-11-01,shopee,ts-001,2,199,20,0,0,23.88,0", // ซ้ำในไฟล์
    "O9,2026-11-01,Shopee,MUG-002,1,250,0,0,0,0,0", // ซ้ำกับฐานข้อมูล
  ].join("\n");
  const r = run(csv, {}, { existingKeys: new Set([makeDedupeKey("Shopee", "O9", "MUG-002")]) });

  it("นับจำนวนแต่ละสถานะ และระบุเลขแถว", () => {
    expect(r.counts).toEqual({ total: 5, ok: 1, error: 1, duplicate: 2, unmapped: 1 });
    expect(r.rows.map((x) => [x.rowNumber, x.status])).toEqual([
      [2, "ok"],
      [3, "unmapped"],
      [4, "error"],
      [5, "duplicate"],
      [6, "duplicate"],
    ]);
    expect(r.rows[2].errors).toContain("จำนวนชิ้นต้องมากกว่า 0");
    expect(r.rows[3].errors[0]).toContain("ซ้ำกับแถว 2");
    expect(r.rows[4].errors[0]).toContain("ถูกนำเข้าแล้ว");
  });

  it("แถวรอจับคู่ไม่ถูกนำเข้า และแสดงในรายการ SKU ที่ต้องจับคู่", () => {
    expect(r.rows[1].draft).toBeUndefined();
    expect(r.unmappedSkus).toEqual([{ sku: "NEW-9", rows: 1, sampleName: "" }]);
  });

  it("รายการที่นำเข้าได้มีต้นทุน ณ ปัจจุบัน และ SKU ตามไฟล์", () => {
    expect(r.rows[0].draft).toMatchObject({ sku: "TS-001", sourceSku: "TS-001", unitCost: 85, missingFields: [] });
    // 398 - 20 - 170 - 23.88
    expect(r.totals).toEqual({ lines: 1, grossSales: 398, netRevenue: 378, cogs: 170, orderFees: 23.88, estProfit: 184.12 });
  });
});

describe("จับคู่สินค้า (Product Mapping)", () => {
  const csv = [H, "O1,2026-11-01,Shopee,SHP-TS-WHITE,1,199,,,,,", "O2,2026-11-01,Shopee,GIFT-9,1,59,,,,,"].join("\n");

  it("ไม่สร้างสินค้าเอง: SKU ที่ไม่พบรอจับคู่", () => {
    const r = run(csv);
    expect(r.counts.unmapped).toBe(2);
    expect(r.newProducts).toEqual([]);
  });

  it("เลือกสินค้าเดิม → นำเข้าเป็น SKU ของสินค้านั้น และจำการจับคู่", () => {
    const r = run(csv, {}, { skuDecisions: { "SHP-TS-WHITE": { kind: "product", productId: "p1" } } });
    expect(r.rows[0].status).toBe("ok");
    expect(r.rows[0].draft).toMatchObject({ sku: "TS-001", sourceSku: "SHP-TS-WHITE", unitCost: 85 });
    expect(r.aliasesToSave).toEqual([{ alias: "SHP-TS-WHITE", productId: "p1" }]);
    expect(r.rows[1].status).toBe("unmapped");
  });

  it("การจับคู่ที่จำไว้ (alias) ใช้อัตโนมัติ และไม่บันทึกซ้ำ", () => {
    const r = run(csv, {}, { aliases: [{ alias: "SHP-TS-WHITE", productId: "p1", createdAt: NOW }] });
    expect(r.rows[0].product?.via).toBe("alias");
    expect(r.aliasesToSave).toEqual([]);
  });

  it("สร้างสินค้าใหม่เมื่อผู้ใช้เลือกเท่านั้น และตรวจข้อมูลสินค้าใหม่", () => {
    const ok = run(csv, {}, { skuDecisions: { "GIFT-9": { kind: "new", sku: "GIFT-9", name: "พวงกุญแจ", unitCost: 12 } } });
    expect(ok.rows[1].status).toBe("ok");
    expect(ok.newProducts).toEqual([{ sku: "GIFT-9", name: "พวงกุญแจ", unitCost: 12 }]);
    expect(ok.rows[1].draft).toMatchObject({ sku: "GIFT-9", unitCost: 12 });

    const bad = run(csv, {}, { skuDecisions: { "GIFT-9": { kind: "new", sku: "GIFT-9", name: "", unitCost: Number.NaN } } });
    expect(bad.rows[1].status).toBe("unmapped");
    expect(bad.newProducts).toEqual([]);

    const clash = run(csv, {}, { skuDecisions: { "GIFT-9": { kind: "product", productId: "missing" } } });
    expect(clash.rows[1].status).toBe("unmapped");
  });
});

describe("ข้อมูลที่ไม่มีในไฟล์ ≠ ค่าศูนย์", () => {
  it("คอลัมน์ที่ไม่ได้จับคู่ถูกระบุใน missingFields", () => {
    const r = run("order_id,order_date,channel,sku,quantity,unit_price,platform_fee\nO1,2026-11-01,Shopee,TS-001,1,199,10");
    expect(r.missingFields).toEqual(["discount", "refund", "returnedQty", "shippingFee"]);
    expect(r.rows[0].draft!.missingFields).toEqual(["discount", "refund", "returnedQty", "shippingFee"]);
    expect(r.rows[0].draft!.discount).toBe(0);
  });

  it("คอลัมน์ที่จับคู่แล้วแต่ช่องว่าง = 0 (มีข้อมูล)", () => {
    const r = run(`${H}\nO1,2026-11-01,Shopee,TS-001,1,199,,,,,`);
    expect(r.missingFields).toEqual([]);
    expect(r.rows[0].draft!.missingFields).toEqual([]);
  });

  it("summarize ระบุว่าเป็นกำไรโดยประมาณ เมื่อข้อมูลไม่ครบ", () => {
    const r = run("order_id,order_date,channel,sku,quantity,unit_price\nO1,2026-11-01,Shopee,TS-001,1,199");
    const sale: Sale = { ...r.rows[0].draft!, id: "s1", batchId: "b1" };
    const s = summarize([sale], [], buildCostLookup(products));
    expect(s.isEstimate).toBe(true);
    expect(s.incompleteLines).toBe(1);
    expect(s.missingFields).toContain("platformFee");
    const full = summarize([{ ...sale, missingFields: [] }], [], buildCostLookup(products));
    expect(full.isEstimate).toBe(false);
  });
});

describe("รูปแบบตัวเลข", () => {
  const base = "order_id,order_date,channel,sku,quantity";

  it("รวมหลายคอลัมน์ค่าธรรมเนียม", () => {
    const csv = `${base},unit_price,ค่าคอม,ค่าบริการ\nO1,2026-11-01,Shopee,TS-001,1,199,20,5.5`;
    const r = run(csv, {}, {}, { orderId: [0], orderDate: [1], channel: [2], sku: [3], quantity: [4], unitPrice: [5], platformFee: [6, 7] });
    expect(r.rows[0].values.platformFee).toBe(25.5);
  });

  it("ค่าติดลบในรายการหัก: ผิดพลาด เว้นแต่ผู้ใช้เลือกให้ตีความเป็นรายการหัก", () => {
    const csv = `${H}\nO1,2026-11-01,Shopee,TS-001,1,199,-10,0,0,-23.88,0`;
    expect(run(csv).rows[0].errors.join()).toContain("ต้องไม่ติดลบ");
    const r = run(csv, { negativeAsDeduction: true });
    expect(r.rows[0].status).toBe("ok");
    expect(r.rows[0].values).toMatchObject({ discount: 10, platformFee: 23.88 });
    // ราคาไม่ใช่รายการหัก: ติดลบยังผิดพลาด
    expect(run(`${H}\nO1,2026-11-01,Shopee,TS-001,1,-199,,,,,`, { negativeAsDeduction: true }).rows[0].status).toBe("error");
  });

  it("ใช้ยอดรวมของบรรทัดแทนราคาต่อชิ้น", () => {
    const r = run(`${base},line_total\nO1,2026-11-01,Shopee,TS-001,3,100`);
    expect(r.rows[0].values.unitPrice).toBeCloseTo(33.3333, 3);
    expect(r.rows[0].values.grossSales).toBe(100);
  });

  it("เลขคำสั่งซื้อที่ Excel แปลงเป็นตัวเลขแบบย่อ ถูกแจ้งข้อผิดพลาด", () => {
    const r = run(`${base},unit_price\n2.61105123456789e+17,2026-11-01,Shopee,TS-001,1,199`);
    expect(r.rows[0].errors[0]).toContain("ตัวเลขแบบย่อ");
  });

  it("ช่องทางคงที่ของทั้งไฟล์", () => {
    const r = run(`order_id,order_date,sku,quantity,unit_price\nO1,2026-11-01,TS-001,1,199`, { fixedChannel: "TikTok Shop" });
    expect(r.rows[0].channel).toBe("TikTok Shop");
    expect(r.rows[0].dedupeKey).toBe(makeDedupeKey("TikTok Shop", "O1", "TS-001"));
  });

  it("ไฟล์ไม่มีข้อมูล และเกินจำนวนแถวสูงสุด", () => {
    expect(run(`${H}\n`).fileErrors).toEqual(["ไฟล์ไม่มีข้อมูล"]);
    const rows = Array.from({ length: 20001 }, (_, i) => `O${i},2026-11-01,Shopee,TS-001,1,1,,,,,`);
    expect(run([H, ...rows].join("\n")).fileErrors[0]).toContain("เกินขีดจำกัด");
  });
});

describe("ค่าระดับคำสั่งซื้อ: ไม่หักซ้ำ", () => {
  // ค่าส่ง 40 ของทั้งคำสั่งซื้อ แสดงซ้ำทั้งสองบรรทัด
  const csv = [H, "A1,2026-11-01,Shopee,TS-001,2,200,,,,,40", "A1,2026-11-01,Shopee,MUG-002,1,100,,,,,40", "A2,2026-11-01,Shopee,TS-001,1,199,,,,,30"].join("\n");

  it("ถ้าตั้งเป็นต่อบรรทัด จะถูกหักซ้ำ — ระบบแจ้งเตือนให้ตรวจ", () => {
    const r = run(csv);
    expect(r.totals.orderFees).toBe(110);
    expect(r.orderLevelHints).toEqual([{ field: "shippingFee", repeatedOrders: 1, multiLineOrders: 1 }]);
  });

  it("ตั้งเป็นทั้งคำสั่งซื้อ: หักครั้งเดียว ปันส่วนตามยอดขาย ผลรวมเท่าเดิม", () => {
    const r = run(csv, { scopes: { ...opts().scopes, shippingFee: "order" } });
    expect(r.counts.ok).toBe(3);
    expect(r.rows[0].values.shippingFee).toBe(32); // 40 × 400/500
    expect(r.rows[1].values.shippingFee).toBe(8);
    expect(r.rows[2].values.shippingFee).toBe(30);
    expect(r.totals.orderFees).toBe(70);
    expect(r.orderLevelHints).toEqual([]);
  });

  it("ปันส่วนเศษสตางค์แล้วผลรวมยังตรง", () => {
    const c = [H, "B1,2026-11-01,Shopee,TS-001,1,100,,,,,10", "B1,2026-11-01,Shopee,MUG-002,1,100,,,,,10", "B1,2026-11-01,Shopee,X-3,1,100,,,,,10"].join("\n");
    const r = run(c, { scopes: { ...opts().scopes, shippingFee: "order" } }, { skuDecisions: { "X-3": { kind: "product", productId: "p1" } } });
    const fees = r.rows.map((x) => x.values.shippingFee);
    // Phase 3 (อนุมัติแล้ว): เศษสตางค์ไปตาม lineKey (sku:MUG-002 เรียงก่อน) ไม่ใช่แถวสุดท้ายอีกต่อไป
    expect(fees).toEqual([3.33, 3.34, 3.33]);
    expect(fees.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 10);
  });

  it("สลับลำดับแถวในไฟล์ ผลปันส่วนของแต่ละสินค้าเท่าเดิม", () => {
    const rows = ["B1,2026-11-01,Shopee,TS-001,1,100,,,,,10", "B1,2026-11-01,Shopee,MUG-002,1,100,,,,,10", "B1,2026-11-01,Shopee,X-3,1,100,,,,,10"];
    const o = { scopes: { ...opts().scopes, shippingFee: "order" as const } };
    const c = { skuDecisions: { "X-3": { kind: "product" as const, productId: "p1" } } };
    const bySku = (csv: string) => Object.fromEntries(run(csv, o, c).rows.map((x) => [x.sourceSku, x.values.shippingFee]));
    expect(bySku([H, ...rows].join("\n"))).toEqual(bySku([H, ...rows.reverse()].join("\n")));
  });

  it("ค่าที่ควรเท่ากันแต่ไม่เท่ากัน → ผิดพลาดทั้งคำสั่งซื้อ", () => {
    const c = [H, "C1,2026-11-01,Shopee,TS-001,1,100,,,,,40", "C1,2026-11-01,Shopee,MUG-002,1,100,,,,,35"].join("\n");
    const r = run(c, { scopes: { ...opts().scopes, shippingFee: "order" } });
    expect(r.counts.error).toBe(2);
    expect(r.rows[0].errors.join()).toContain("ไม่เท่ากัน");
  });

  it("บางบรรทัดนำเข้าไม่ได้ → ไม่นำเข้าทั้งคำสั่งซื้อ (กันหักซ้ำเมื่อแก้แล้วนำเข้าภายหลัง)", () => {
    const c = [H, "D1,2026-11-01,Shopee,TS-001,1,100,,,,,40", "D1,2026-11-01,Shopee,MUG-002,0,100,,,,,40"].join("\n");
    const r = run(c, { scopes: { ...opts().scopes, shippingFee: "order" } });
    expect(r.rows[0].status).toBe("error");
    expect(r.rows[0].errors.join()).toContain("ไม่นำเข้าทั้งคำสั่งซื้อ");
  });
});

describe("ไฟล์ Excel ภาษาไทย (end-to-end ของ lib)", () => {
  it("หัวตารางใต้ชื่อรายงาน, ค่าธรรมเนียม 2 คอลัมน์, ค่าส่งระดับคำสั่งซื้อ, SKU ใหม่, แถวผิด", async () => {
    const f = await readFixture("thai-orders.xlsx");
    const sheet = f.sheets[0];
    const table = buildTable(sheet, detectHeaderRow(sheet.rows), false);
    const s = suggestMapping(table.headers, generic);
    const mapping: ColumnMapping = { ...s.mapping, shippingFee: [6], platformFee: [7, 8] };
    const o = opts({ fixedChannel: "Shopee", scopes: { ...opts().scopes, shippingFee: "order" } });
    const r = validateImport(table, mapping, o, ctx({ skuDecisions: { "GIFT-9": { kind: "new", sku: "GIFT-9", name: "พวงกุญแจ", unitCost: 15 } } }));
    expect(r.counts).toEqual({ total: 6, ok: 4, error: 2, duplicate: 0, unmapped: 0 });
    const byRow = Object.fromEntries(r.rows.map((x) => [x.rowNumber, x]));
    expect(byRow[4].date).toBe("2026-11-05");
    expect(byRow[4].values).toMatchObject({ quantity: 2, unitPrice: 199, platformFee: 25 });
    // ค่าส่ง 40 ปันส่วน 398:250
    expect(byRow[4].values.shippingFee + byRow[5].values.shippingFee).toBe(40);
    expect(byRow[8].errors).toContain("จำนวนชิ้นต้องมากกว่า 0");
    expect(byRow[9].errors[0]).toContain("ตัวเลขแบบย่อ");
    expect(r.newProducts).toEqual([{ sku: "GIFT-9", name: "พวงกุญแจ", unitCost: 15 }]);
    expect(r.missingFields).toEqual(["discount", "refund", "returnedQty"]);
  });
});
