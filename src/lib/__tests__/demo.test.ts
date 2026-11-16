import { describe, expect, it } from "vitest";
import { generateDemoData } from "../demo";

describe("demo data", () => {
  const d = generateDemoData(new Date(2026, 10, 16));
  it("ทุกสินค้า Demo ระบุว่าเป็น Demo", () => {
    expect(d.products.every((p) => p.name.startsWith("[Demo]") && p.sku.startsWith("DEMO-"))).toBe(true);
    expect(d.expenses.every((e) => e.note.startsWith("[Demo]"))).toBe(true);
    expect(d.sales.every((s) => s.orderId.startsWith("DEMO-"))).toBe(true);
  });
  it("ไม่มี dedupe key ซ้ำ และ SKU ทุกตัวมีต้นทุน", () => {
    expect(new Set(d.sales.map((s) => s.dedupeKey)).size).toBe(d.sales.length);
    const skus = new Set(d.products.map((p) => p.sku));
    expect(d.sales.every((s) => skus.has(s.sku))).toBe(true);
  });
  it("ข้อมูลอยู่ใน 90 วันล่าสุด", () => {
    const dates = d.sales.map((s) => s.date).sort();
    expect(dates[0]).toBe("2026-08-19");
    expect(dates[dates.length - 1]).toBe("2026-11-16");
  });
});
