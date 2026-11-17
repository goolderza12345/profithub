/**
 * Golden regression: ข้อมูลเดิมต้องคำนวณกำไรได้เท่าเดิมทุกสตางค์
 *
 * golden/legacy-v1.2.json ถูกสร้างจากโค้ดที่ commit bc44b1b (ก่อน Phase 3) และเก็บทั้ง
 * "ข้อมูลนำเข้า" (รายการขายที่บันทึกไว้แล้ว) และ "ผลลัพธ์" ของทุกฟังก์ชันกำไร/รายงาน
 * ห้ามสร้างไฟล์นี้ใหม่จากโค้ดรุ่นหลัง เว้นแต่ได้รับอนุมัติให้เปลี่ยนผลการคำนวณ
 * (สร้างใหม่: GOLDEN_WRITE=1 npx vitest run src/lib/__tests__/golden.test.ts)
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_CSV, validateSalesCsv } from "../csv";
import { generateDemoData } from "../demo";
import { buildCostLookup, dailySeries, lossProducts, profitByChannel, profitByProduct, summarize } from "../profit";
import { buildReportRows, REPORTS } from "../reports";
import type { Expense, Product, Sale } from "../types";

const FILE = path.join(__dirname, "golden", "legacy-v1.2.json");

interface Dataset {
  products: Product[];
  sales: Sale[];
  expenses: Expense[];
}

function buildDatasets(): Record<string, Dataset> {
  const demo = generateDemoData(new Date(2026, 10, 16));
  const t = "2026-11-01T00:00:00.000Z";
  const products: Product[] = [
    { id: "p1", sku: "TS-001", name: "เสื้อ", unitCost: 85, createdAt: t, updatedAt: t },
    { id: "p2", sku: "MUG-002", name: "แก้ว", unitCost: 95.5, createdAt: t, updatedAt: t },
  ];
  // v1.0: ไม่มี unitCost snapshot (ใช้ต้นทุนปัจจุบัน) และมี SKU ที่ไม่มีสินค้า
  const base = { channel: "Shopee", discount: 0, refund: 0, returnedQty: 0, platformFee: 0, shippingFee: 0, batchId: "b0" };
  const v1: Sale[] = [
    { ...base, id: "v1-1", orderId: "A1", date: "2026-10-01", sku: "TS-001", quantity: 3, unitPrice: 199, discount: 10.5, platformFee: 23.88, dedupeKey: "k1" },
    { ...base, id: "v1-2", orderId: "A1", date: "2026-10-01", sku: "MUG-002", quantity: 1, unitPrice: 250, shippingFee: 15, dedupeKey: "k2" },
    { ...base, id: "v1-3", orderId: "A2", date: "2026-10-03", sku: "GONE-9", quantity: 2, unitPrice: 59.75, dedupeKey: "k3", channel: "Lazada" },
    { ...base, id: "v1-4", orderId: "A3", date: "2026-10-03", sku: "TS-001", quantity: 2, unitPrice: 199, refund: 199, returnedQty: 1, dedupeKey: "k4", channel: "TikTok Shop" },
  ];
  // v1.1/v1.2: ผ่านการนำเข้าจริง (มี unitCost snapshot, missingFields, ราคาจากยอดรวม/จำนวน)
  const imported = validateSalesCsv(SAMPLE_CSV, {
    productCosts: new Map([["TS-001", 85], ["MUG-002", 95.5]]),
    existingKeys: new Set(),
  }).rows.map((r, i) => ({ ...r.sale!, id: `imp-${i}`, batchId: "b1" }));
  const thirds: Sale = {
    ...base, id: "lt-1", orderId: "L1", date: "2026-10-05", sku: "TS-001", quantity: 3, unitPrice: 100 / 3,
    unitCost: 33.33, dedupeKey: "k5", missingFields: ["refund", "returnedQty"], platformFee: 3.33, shippingFee: 6.67,
  };
  const expenses: Expense[] = [
    { id: "e1", date: "2026-10-02", category: "ads", amount: 120.25, channel: "Shopee", note: "", createdAt: t },
    { id: "e2", date: "2026-10-04", category: "packaging", amount: 33.3, channel: "", note: "", createdAt: t },
  ];
  return {
    demo: { products: demo.products, sales: demo.sales, expenses: demo.expenses },
    legacyMixed: { products, sales: [...v1, ...imported, thirds], expenses },
  };
}

function outputs(d: Dataset) {
  const costs = buildCostLookup(d.products);
  const dates = d.sales.map((s) => s.date).sort();
  return {
    summary: summarize(d.sales, d.expenses, costs),
    byProduct: profitByProduct(d.sales, d.products),
    byChannel: profitByChannel(d.sales, d.expenses, d.products),
    losses: lossProducts(d.sales, d.products),
    daily: dailySeries(d.sales, d.expenses, costs, { from: dates[0], to: dates[dates.length - 1] }),
    reports: Object.fromEntries(REPORTS.map((r) => [r.kind, buildReportRows(r.kind, d.sales, d.expenses, d.products)])),
  };
}

if (process.env.GOLDEN_WRITE === "1") {
  const datasets = buildDatasets();
  const data = { generatedFrom: "bc44b1b", datasets, outputs: Object.fromEntries(Object.entries(datasets).map(([k, v]) => [k, outputs(v)])) };
  fs.writeFileSync(FILE, JSON.stringify(data, null, 1) + "\n");
}

describe("golden: ข้อมูลเดิมคำนวณได้เท่าเดิมทุกสตางค์", () => {
  const golden = JSON.parse(fs.readFileSync(FILE, "utf8")) as {
    generatedFrom: string;
    datasets: Record<string, Dataset>;
    outputs: Record<string, ReturnType<typeof outputs>>;
  };

  it("สร้างจาก commit ก่อน Phase 3", () => {
    expect(golden.generatedFrom).toBe("bc44b1b");
  });

  for (const name of Object.keys(golden.datasets)) {
    it(`${name}: ผลกำไร รายสินค้า รายช่องทาง รายวัน และรายงานทุกแบบตรงกับ golden`, () => {
      // ผ่าน JSON เหมือนไฟล์ golden (-0 กับ 0 คือจำนวนเงินเดียวกัน)
      const now = JSON.parse(JSON.stringify(outputs(golden.datasets[name]))) as ReturnType<typeof outputs>;
      const exp = golden.outputs[name];
      // toMatchObject: ยอมให้มีช่องใหม่เพิ่ม แต่ค่าเดิมทุกค่าต้องเท่าเดิม
      expect(now.summary).toMatchObject(exp.summary);
      expect(now.byProduct).toEqual(exp.byProduct);
      expect(now.byChannel).toEqual(exp.byChannel);
      expect(now.losses).toEqual(exp.losses);
      expect(now.daily).toEqual(exp.daily);
      for (const k of Object.keys(exp.reports)) expect(now.reports[k as keyof typeof now.reports]).toEqual(exp.reports[k as keyof typeof exp.reports]);
    });
  }
});
