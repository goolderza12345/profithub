import { describe, expect, it } from "vitest";
import {
  buildCostLookup,
  calcLine,
  dailySeries,
  lossProducts,
  profitByChannel,
  profitByProduct,
  summarize,
} from "../profit";
import { expense, product, sale } from "./helpers";

describe("calcLine", () => {
  it("แยกรายได้ ส่วนลด เงินคืน ต้นทุน และค่าธรรมเนียม", () => {
    const l = calcLine(
      sale({ quantity: 3, unitPrice: 200, discount: 60, refund: 0, platformFee: 50, shippingFee: 20 }),
      70,
    );
    expect(l.grossSales).toBe(600);
    expect(l.netRevenue).toBe(540); // 600 - 60
    expect(l.cogs).toBe(210); // 70 × 3
    expect(l.orderFees).toBe(70); // 50 + 20
    expect(l.lineProfit).toBe(260); // 540 - 210 - 70
  });

  it("คืนเงินพร้อมรับสินค้าคืน: หักเงินคืนจากรายได้ และไม่คิดต้นทุนชิ้นที่กลับเข้าสต็อก", () => {
    const l = calcLine(sale({ quantity: 2, unitPrice: 100, refund: 100, returnedQty: 1 }), 40);
    expect(l.netRevenue).toBe(100);
    expect(l.costUnits).toBe(1);
    expect(l.cogs).toBe(40);
    expect(l.lineProfit).toBe(60);
  });

  it("คืนเงินแต่ไม่ได้สินค้าคืน: ยังคิดต้นทุนเต็ม", () => {
    const l = calcLine(sale({ quantity: 1, unitPrice: 100, refund: 100, returnedQty: 0 }), 40);
    expect(l.netRevenue).toBe(0);
    expect(l.cogs).toBe(40);
    expect(l.lineProfit).toBe(-40);
  });

  it("ไม่พบต้นทุน: ใช้ 0 และติดธง costMissing", () => {
    const l = calcLine(sale(), undefined);
    expect(l.cogs).toBe(0);
    expect(l.costMissing).toBe(true);
  });

  it("ปัดเศษเป็นสตางค์ ไม่มีปัญหาทศนิยม", () => {
    const l = calcLine(sale({ quantity: 3, unitPrice: 0.1, platformFee: 0.2 }), 0.1);
    expect(l.grossSales).toBe(0.3);
    expect(l.lineProfit).toBe(-0.2);
  });
});

describe("summarize", () => {
  const products = [product({ sku: "A", unitCost: 40 }), product({ id: "p2", sku: "B", unitCost: 150 })];
  const costs = buildCostLookup(products);
  const sales = [
    sale({ id: "1", orderId: "O1", sku: "A", quantity: 2, unitPrice: 100, discount: 10, platformFee: 19, shippingFee: 0 }),
    sale({ id: "2", orderId: "O1", sku: "B", quantity: 1, unitPrice: 200, platformFee: 20 }),
    sale({ id: "3", orderId: "O2", sku: "A", quantity: 1, unitPrice: 100, refund: 100, returnedQty: 1, shippingFee: 15 }),
  ];
  const expenses = [
    expense({ id: "e1", category: "ads", amount: 50 }),
    expense({ id: "e2", category: "packaging", amount: 10.5 }),
  ];
  const s = summarize(sales, expenses, costs);

  it("คำนวณแต่ละส่วนแยกกัน", () => {
    expect(s.grossSales).toBe(500);
    expect(s.discount).toBe(10);
    expect(s.refund).toBe(100);
    expect(s.netRevenue).toBe(390);
    expect(s.cogs).toBe(230); // A: 40×2, B: 150×1, A คืน: 0
    expect(s.grossProfit).toBe(160);
    expect(s.orderPlatformFees).toBe(39);
    expect(s.orderShippingFees).toBe(15);
    expect(s.orderFees).toBe(54);
    expect(s.manualExpenses).toBe(60.5);
    expect(s.totalExpenses).toBe(114.5);
    expect(s.netProfit).toBe(45.5);
    expect(s.netMargin).toBeCloseTo(45.5 / 390, 10);
    expect(s.orderCount).toBe(2);
    expect(s.unitsSold).toBe(3);
  });

  it("ไม่หักค่าใช้จ่ายซ้ำ: รายได้สุทธิ − ต้นทุน − ค่าใช้จ่ายรวม = กำไรสุทธิ", () => {
    expect(s.netRevenue - s.cogs - s.totalExpenses).toBeCloseTo(s.netProfit, 10);
    const byCategory = Object.values(s.expensesByCategory).reduce((a, b) => a + b, 0);
    expect(byCategory).toBeCloseTo(s.manualExpenses, 10);
  });

  it("อัตรากำไรเป็น null เมื่อไม่มีรายได้", () => {
    const empty = summarize([], [expense({ amount: 100 })], costs);
    expect(empty.netProfit).toBe(-100);
    expect(empty.netMargin).toBeNull();
  });

  it("รายงาน SKU ที่ไม่มีต้นทุน", () => {
    const r = summarize([sale({ sku: "ZZZ" })], [], costs);
    expect(r.missingCostSkus).toEqual(["ZZZ"]);
  });

  it("กำไรตามสินค้ารวมกันได้เท่ากับกำไรก่อนหักค่าใช้จ่ายที่บันทึกเอง", () => {
    const rows = profitByProduct(sales, products);
    const total = rows.reduce((a, r) => a + r.profit, 0);
    expect(total).toBeCloseTo(s.profitAfterOrderCosts, 10);
    const a = rows.find((r) => r.key === "A")!;
    expect(a.netRevenue).toBe(190);
    expect(a.cogs).toBe(80);
    expect(a.orderFees).toBe(34);
    expect(a.profit).toBe(76);
  });

  it("กำไรตามช่องทาง − ค่าใช้จ่ายไม่ระบุช่องทาง = กำไรสุทธิ", () => {
    const mixed = [
      sale({ id: "1", orderId: "O1", channel: "Shopee", quantity: 1, unitPrice: 300, platformFee: 30 }),
      sale({ id: "2", orderId: "O2", channel: "Lazada", quantity: 1, unitPrice: 200, platformFee: 20 }),
    ];
    const exp = [
      expense({ id: "e1", channel: "Shopee", amount: 100 }),
      expense({ id: "e2", channel: "TikTok Shop", amount: 40 }),
      expense({ id: "e3", channel: "", amount: 25 }),
    ];
    const res = profitByChannel(mixed, exp, products);
    const shopee = res.rows.find((r) => r.key === "Shopee")!;
    expect(shopee.profit).toBe(230); // 300 - 40 - 30
    expect(shopee.netProfit).toBe(130);
    const tiktok = res.rows.find((r) => r.key === "TikTok Shop")!;
    expect(tiktok.netProfit).toBe(-40);
    expect(res.unassignedExpenses).toBe(25);
    const total = res.rows.reduce((a, r) => a + r.netProfit, 0) - res.unassignedExpenses;
    expect(total).toBeCloseTo(summarize(mixed, exp, costs).netProfit, 10);
  });

  it("แสดงสินค้าที่ขาดทุน เรียงจากขาดทุนมากสุด", () => {
    const loss = lossProducts(
      [
        sale({ id: "1", sku: "B", quantity: 1, unitPrice: 160, platformFee: 20 }), // -10
        sale({ id: "2", sku: "A", quantity: 1, unitPrice: 30 }), // -10 ... A: 30-40 = -10
        sale({ id: "3", sku: "A", orderId: "O9", quantity: 1, unitPrice: 20 }), // A total -30
      ],
      products,
    );
    expect(loss.map((r) => r.key)).toEqual(["A", "B"]);
    expect(loss[0].profit).toBe(-30);
  });
});

describe("dailySeries", () => {
  it("เติมวันที่ไม่มีข้อมูล และหักค่าใช้จ่ายในวันที่บันทึก", () => {
    const costs = buildCostLookup([product({ unitCost: 40 })]);
    const series = dailySeries(
      [sale({ date: "2026-11-01", unitPrice: 100 }), sale({ id: "2", date: "2026-11-03", unitPrice: 100 })],
      [expense({ date: "2026-11-02", amount: 30 })],
      costs,
      { from: "2026-11-01", to: "2026-11-03" },
    );
    expect(series).toEqual([
      { date: "2026-11-01", netRevenue: 100, netProfit: 60 },
      { date: "2026-11-02", netRevenue: 0, netProfit: -30 },
      { date: "2026-11-03", netRevenue: 100, netProfit: 60 },
    ]);
  });
});
