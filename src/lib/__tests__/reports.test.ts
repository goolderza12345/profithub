import { describe, expect, it } from "vitest";
import { buildReportCsv, buildReportRows, reportFileName } from "../reports";
import { expense, product, sale } from "./helpers";

const products = [product({ sku: "A", unitCost: 40 })];
const sales = [sale({ quantity: 2, unitPrice: 100, discount: 10, platformFee: 19 })];
const expenses = [expense({ amount: 50, category: "ads" })];

describe("reports", () => {
  it("งบกำไรขาดทุนจบที่กำไรสุทธิเดียวกับสูตร", () => {
    const rows = buildReportRows("profit", sales, expenses, products);
    const net = rows.find((r) => r[0] === "= กำไรสุทธิ")!;
    expect(net[1]).toBe(200 - 10 - 80 - 19 - 50);
  });

  it("รายงานต้นทุนรวมกันได้เท่ากับต้นทุน + ค่าใช้จ่ายรวม", () => {
    const rows = buildReportRows("costs", sales, expenses, products).slice(1);
    const total = rows.reduce((a, r) => a + Number(r[5]), 0);
    expect(total).toBe(80 + 19 + 50);
  });

  it("ไฟล์ Demo ถูกระบุชัดเจน และมี BOM", () => {
    const csv = buildReportCsv("sales", "demo", sales, expenses, products);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("DEMO (ข้อมูลตัวอย่าง)");
    expect(reportFileName("sales", "demo", null, null)).toBe("DEMO_profithub_sales_all.csv");
    expect(buildReportCsv("sales", "real", sales, expenses, products)).not.toContain("DEMO");
  });
});
