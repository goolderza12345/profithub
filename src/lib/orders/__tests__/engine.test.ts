import { describe, expect, it } from "vitest";
import { calcLine } from "../../profit";
import type { Sale } from "../../types";
import { buildOrderPlan, type IncomingLine, type PlanContext } from "../plan";
import { lineFactErrors, projectLine } from "../project";
import { selectRecognizedSales } from "../recognition";
import { checkTransition, recognitionOf, statusFromToken } from "../status";
import { emptyFees, type Order, type OrderLine } from "../types";
import { line, order, T0 } from "./helpers";

/** ฉาย OrderLine ลง Sale แล้วคำนวณกำไรด้วย calcLine เดิม (บาท) */
function profitOf(l: OrderLine, unitCostBaht: number, status: Order["status"] = "completed") {
  const p = projectLine(l, { status });
  const sale: Sale = {
    id: "x", orderId: "O", date: "2026-11-01", channel: "Shopee", sku: "A", quantity: l.quantity,
    unitPrice: l.grossSatang / 100 / l.quantity, discount: p.discount, refund: p.refund, returnedQty: p.returnedQty,
    platformFee: p.platformFee, shippingFee: p.shippingFee, unitCost: unitCostBaht, dedupeKey: "k", batchId: "b",
  };
  return { ...calcLine(sale, undefined), p };
}
const fees = (f: Partial<ReturnType<typeof emptyFees>>) => ({ ...emptyFees(), ...f });

describe("ตัวอย่างรายได้/ส่วนลด (รายงานสถาปัตยกรรม ข้อ 1)", () => {
  const base = { quantity: 2, grossSatang: 40000 };
  it.each([
    ["1 ไม่มีส่วนลด", line({ ...base, fees: fees({ other: 4000 }) }), 400, 120],
    ["2 ร้านลด 50", line({ ...base, sellerDiscount: 5000, fees: fees({ other: 3500 }) }), 350, 75],
    ["3 แพลตฟอร์มลด 60 (ไม่กระทบรายได้ร้าน)", line({ ...base, platformSubsidy: 6000, fees: fees({ other: 4000 }) }), 400, 120],
    ["4 ส่วนลดร่วม 100 (ร้าน 30 / แพลตฟอร์ม 70)", line({ ...base, sellerDiscount: 3000, platformSubsidy: 7000, fees: fees({ other: 3700 }) }), 370, 93],
    ["6 ไม่รู้ผู้ออก 50 (คิดแบบระมัดระวัง)", line({ ...base, unknownDiscount: 5000, fees: fees({ other: 4000 }) }), 350, 70],
  ])("%s", (_n, l, revenue, profit) => {
    const r = profitOf(l, 120);
    expect(r.netRevenue).toBe(revenue);
    expect(r.lineProfit).toBe(profit);
  });

  it("ไม่รู้ผู้ออก: ระบุเหตุผลและกำไรที่อาจสูงขึ้น", () => {
    const r = profitOf(line({ quantity: 2, grossSatang: 40000, unknownDiscount: 5000 }), 120);
    expect(r.p.estimateReasons).toEqual(["unknown_discount_funding"]);
    expect(r.p.estimateUpside).toBe(50);
  });
});

describe("ตัวอย่างเงินคืน (รายงานสถาปัตยกรรม ข้อ 2): คืนเงิน ≠ คืนสินค้า", () => {
  const b = { quantity: 1, grossSatang: 50000, fees: fees({ other: 5000, shipping: 3000 }) };
  it.each([
    ["R0 ปกติ", {}, 120, 300],
    ["R1 คืนเงินเต็ม ได้สินค้าคืนเข้าสต็อก ได้ค่าธรรมเนียมคืน ค่าส่งคืน 40", { refundSeller: 50000, returnedResellable: 1, feeRefunded: 5000, returnShippingCost: 4000 }, -70, 0],
    ["R2 คืนเงินอย่างเดียว ไม่ต้องส่งคืน", { refundSeller: 50000, notReturned: 1, feeRefunded: 5000 }, -330, 300],
    ["R3 คืนเงินบางส่วน 100", { refundSeller: 10000, feeRefunded: 1000 }, 30, 300],
    ["R4 ได้สินค้าคืนแต่ชำรุด", { refundSeller: 50000, returnedDamaged: 1, feeRefunded: 5000, returnShippingCost: 4000 }, -370, 300],
    ["R5 แพลตฟอร์มรับภาระเงินคืน", { refundPlatform: 50000, notReturned: 1 }, 120, 300],
    ["R6 คืนเงินร่วม ร้าน 200 / แพลตฟอร์ม 300", { refundSeller: 20000, refundPlatform: 30000, notReturned: 1 }, -80, 300],
  ])("%s", (_n, f, profit, cogs) => {
    const r = profitOf(line({ ...b, ...f }), 300);
    expect(r.lineProfit).toBe(profit);
    expect(r.cogs).toBe(cogs);
  });

  it("ตรวจความสอดคล้อง: เงินคืน/ชิ้นคืน/ค่าธรรมเนียมคืนเกิน", () => {
    expect(lineFactErrors(line({ quantity: 1, grossSatang: 100, refundSeller: 200 }))).toContain("เงินคืนที่ร้านรับภาระมากกว่ารายได้ของร้านในบรรทัดนี้");
    expect(lineFactErrors(line({ quantity: 1, returnedResellable: 1, notReturned: 1 })).join()).toContain("มากกว่าจำนวนที่ขาย");
    expect(lineFactErrors(line({ feeRefunded: 1 })).join()).toContain("ค่าธรรมเนียมที่ได้คืนมากกว่า");
    expect(lineFactErrors(line({ fees: fees({ shipping: 10 }), shippingRefunded: 20 })).join()).toContain("ค่าส่งที่ได้คืนมากกว่า");
    expect(lineFactErrors(line({ quantity: 1, grossSatang: 100, sellerDiscount: 60, platformSubsidy: 60 })).join()).toContain("ส่วนลดรวมทุกประเภท");
  });
});

describe("สถานะ", () => {
  it("กติกาการนับ", () => {
    expect(["pending_payment", "paid", "processing", "shipped", "completed", "cancelled", "unspecified"].map((s) => recognitionOf(s as Order["status"]))).toEqual([
      "excluded", "provisional", "provisional", "provisional", "final", "excluded", "unspecified",
    ]);
  });

  it("อ่านเฉพาะคำของ ProfitHub เอง ไม่เดาคำของแพลตฟอร์ม", () => {
    expect(statusFromToken("Completed")).toBe("completed");
    expect(statusFromToken("pending payment")).toBe("pending_payment");
    expect(statusFromToken("ยกเลิก")).toBe("cancelled");
    expect(statusFromToken("To Ship")).toBeNull();
    expect(statusFromToken("ที่ต้องจัดส่ง")).toBeNull();
  });

  it("กันข้อมูลเก่าทับข้อมูลใหม่", () => {
    expect(checkTransition({ status: "shipped" }, { status: "completed" })).toBe("newer");
    expect(checkTransition({ status: "completed" }, { status: "shipped" })).toBe("stale");
    expect(checkTransition({ status: "cancelled" }, { status: "paid" })).toBe("conflict");
    expect(checkTransition({ status: "completed" }, { status: "cancelled" })).toBe("conflict");
    expect(checkTransition({ status: "paid" }, { status: "cancelled" })).toBe("newer");
    expect(checkTransition({ status: "paid", sourceUpdatedAt: "2026-11-02T10:00" }, { status: "shipped", sourceUpdatedAt: "2026-11-01T10:00" })).toBe("stale");
    expect(checkTransition({ status: "shipped", sourceUpdatedAt: "2026-11-01T10:00" }, { status: "paid", sourceUpdatedAt: "2026-11-03T10:00" })).toBe("conflict");
    expect(checkTransition({ status: "unspecified" }, { status: "completed" })).toBe("newer");
  });
});

describe("selectRecognizedSales", () => {
  const S = (id: string, orderKey?: string): Sale => ({ id, orderId: "O", date: "2026-11-01", channel: "Shopee", sku: "A", quantity: 1, unitPrice: 1, discount: 0, refund: 0, returnedQty: 0, platformFee: 0, shippingFee: 0, dedupeKey: id, batchId: "b", ...(orderKey ? { orderKey } : {}) });
  it("ไม่นับรอชำระ/ยกเลิก/บรรทัดที่ยกเลิก แต่นับข้อมูลรุ่นเก่าเหมือนเดิม", () => {
    const orders = [
      order({ key: "a", status: "pending_payment", lines: [line({ saleId: "s1" })] }),
      order({ key: "b", status: "cancelled", lines: [line({ saleId: "s2" })] }),
      order({ key: "c", status: "shipped", lines: [line({ saleId: "s3" }), line({ saleId: "s4", lineKey: "x", cancelled: true })] }),
    ];
    const r = selectRecognizedSales([S("s0"), S("s1", "a"), S("s2", "b"), S("s3", "c"), S("s4", "c")], orders);
    expect(r.recognized.map((s) => s.id)).toEqual(["s0", "s3"]);
    expect(r).toMatchObject({ excludedPending: 1, excludedCancelled: 1, excludedCancelledLines: 1, provisionalOrders: 1 });
  });
});

describe("Order Update Engine", () => {
  const inc = (p: Omit<Partial<IncomingLine>, "facts"> & { facts?: Partial<OrderLine> } = {}): IncomingLine => {
    const { facts, ...rest } = p;
    const f = line({ ...facts });
    const { saleId: _x, ...withoutSale } = f;
    void _x;
    return {
      channel: "Shopee", orderId: "O1", orderDate: "2026-11-01", status: "shipped", rawStatus: "shipped",
      facts: withoutSale, productSku: f.sourceSku, productCost: 40, unitPrice: f.grossSatang / 100 / f.quantity, missingFields: [],
      ...rest,
    };
  };
  const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({ orders: new Map(), sales: [], batchId: "b1", now: T0, ...over });
  /** จำลองการบันทึกแผน (เหมือน db.applyOrderPlan) */
  const applyAll = (plan: ReturnType<typeof buildOrderPlan>, c: PlanContext) => {
    let n = c.sales.length;
    const sales = new Map(c.sales.map((s) => [s.id, s]));
    const orders = new Map(c.orders);
    for (const p of plan.orders.filter((x) => x.apply)) {
      const ids = new Map<string, string>();
      for (const s of p.sales) {
        const id = s.id.startsWith("new:") ? `s${++n}` : s.id;
        ids.set(s.id, id);
        sales.set(id, { ...s, id });
      }
      orders.set(p.key, { ...p.order, lines: p.order.lines.map((l) => ({ ...l, saleId: ids.get(l.saleId) ?? l.saleId })) });
    }
    return { orders, sales: [...sales.values()] };
  };

  it("นำเข้าใหม่ → นำเข้าไฟล์เดิมซ้ำ (แม้สลับลำดับแถว) = ไม่เปลี่ยน ยอดไม่เพิ่ม", () => {
    const lines = [inc({ facts: { lineKey: "sku:A|p:10000", fingerprint: "sku:A|p:10000" } }), inc({ facts: { lineKey: "sku:B|p:5000", fingerprint: "sku:B|p:5000", sourceSku: "B", grossSatang: 5000 } })];
    const p1 = buildOrderPlan(lines, ctx());
    expect(p1.counts.new).toBe(1);
    const db1 = applyAll(p1, ctx());
    const p2 = buildOrderPlan([...lines].reverse(), ctx({ ...db1, batchId: "b2" }));
    expect(p2.counts).toMatchObject({ unchanged: 1, new: 0, update: 0 });
    expect(p2.orders[0].sales).toEqual([]);
  });

  it("คืนเงินหลังนำเข้า: อัปเดต เก็บต้นทุนเดิม และบันทึกความเปลี่ยนแปลง", () => {
    const first = buildOrderPlan([inc({ facts: { fees: fees({ other: 1000 }) } })], ctx());
    const db1 = applyAll(first, ctx());
    expect(db1.sales[0].unitCost).toBe(40);
    const second = buildOrderPlan(
      [inc({ status: "completed", rawStatus: "completed", productCost: 999, facts: { refundSeller: 3000, returnedResellable: 0, notReturned: 1, fees: fees({ other: 1000 }) } })],
      ctx({ ...db1, batchId: "b2" }),
    );
    const p = second.orders[0];
    expect(p.kind).toBe("update");
    expect(p.sales[0].unitCost).toBe(40); // ต้นทุน ณ วันนำเข้าเดิม
    expect(p.sales[0].refund).toBe(30);
    expect(p.sales[0].returnedQty).toBe(0); // คืนเงินแต่ไม่ได้สินค้าคืน
    expect(p.changes).toContainEqual({ lineKey: "sku:A|p:10000", field: "refund", from: 0, to: 30 });
    expect(p.changes).toContainEqual({ field: "status", from: "shipped", to: "completed" });
    expect(p.order.revisionCount).toBe(2);
    expect(p.order.firstBatchId).toBe("b1");
  });

  it("ไฟล์เก่ากว่า (สถานะถอยหลัง) ไม่บันทึกทับ", () => {
    const db1 = applyAll(buildOrderPlan([inc({ status: "completed" })], ctx()), ctx());
    const p = buildOrderPlan([inc({ status: "shipped" })], ctx({ ...db1, batchId: "b2" })).orders[0];
    expect(p).toMatchObject({ kind: "stale", applicable: false, apply: false });
    expect(p.reasons[0]).toContain("ย้อนหลัง");
  });

  it("บรรทัดหายจากไฟล์ใหม่ → ขัดแย้ง ถ้าผู้ใช้เลือกบันทึก บรรทัดถูกทำเครื่องหมายยกเลิก ไม่ลบ", () => {
    const two = [inc(), inc({ facts: { lineKey: "sku:B|p:5000", fingerprint: "sku:B|p:5000", sourceSku: "B", grossSatang: 5000 } })];
    const db1 = applyAll(buildOrderPlan(two, ctx()), ctx());
    const p = buildOrderPlan([inc({ status: "completed" })], ctx({ ...db1, batchId: "b2" })).orders[0];
    expect(p.kind).toBe("conflict");
    expect(p.apply).toBe(false);
    expect(p.applicable).toBe(true);
    const cancelled = p.order.lines.find((l) => l.sourceSku === "B")!;
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.saleId).toBe(db1.sales.find((s) => s.sourceSku === "B")!.id);
  });

  it("SKU เปลี่ยนในบรรทัดที่มีรหัสบรรทัด → ขัดแย้ง", () => {
    const pl = { lineKey: "pl:7", fingerprint: "pl:7", identity: "platform_line_id" as const };
    const db1 = applyAll(buildOrderPlan([inc({ facts: { ...pl, sourceSku: "A" } })], ctx()), ctx());
    const p = buildOrderPlan([inc({ status: "completed", facts: { ...pl, sourceSku: "A2" } })], ctx({ ...db1, batchId: "b2" })).orders[0];
    expect(p.kind).toBe("conflict");
    expect(p.reasons.join()).toContain("SKU ของบรรทัดเปลี่ยน");
  });

  it("SKU เดียวกันหลายบรรทัด: จำนวนเปลี่ยน → ขัดแย้ง (ไม่จับคู่เดา)", () => {
    const dup = (n: number, q: number) => inc({ facts: { lineKey: `sku:A|p:10000#${n}`, fingerprint: "sku:A|p:10000", quantity: q, grossSatang: 10000 * q } });
    const db1 = applyAll(buildOrderPlan([dup(1, 1), dup(2, 2)], ctx()), ctx());
    expect(db1.sales.map((s) => s.dedupeKey).sort()).toEqual(["shopee|O1|A", "shopee|O1|A#2"]);
    const same = buildOrderPlan([dup(2, 2), dup(1, 1)], ctx({ ...db1, batchId: "b2" })).orders[0];
    expect(same.kind).toBe("unchanged");
    const changed = buildOrderPlan([dup(1, 1), dup(2, 3)], ctx({ ...db1, batchId: "b2" })).orders[0];
    expect(changed.kind).toBe("conflict");
  });

  it("ผูกข้อมูลรุ่นเก่า (ก่อน v1.3): ใช้รายการขายเดิม คงต้นทุนเดิม (รวมกรณีไม่มี snapshot)", () => {
    const legacy: Sale[] = [
      { id: "L1", orderId: "O1", date: "2026-11-01", channel: "Shopee", sku: "A", quantity: 1, unitPrice: 100, discount: 0, refund: 0, returnedQty: 0, platformFee: 0, shippingFee: 0, unitCost: 33, dedupeKey: "shopee|O1|A", batchId: "old" },
      { id: "L2", orderId: "O1", date: "2026-11-01", channel: "Shopee", sku: "B", quantity: 1, unitPrice: 50, discount: 0, refund: 0, returnedQty: 0, platformFee: 0, shippingFee: 0, dedupeKey: "shopee|O1|B", batchId: "old" },
    ];
    const p = buildOrderPlan(
      [inc({ status: "completed", productCost: 999 }), inc({ status: "completed", productCost: 999, facts: { lineKey: "sku:B|p:5000", fingerprint: "sku:B|p:5000", sourceSku: "B", grossSatang: 5000 } })],
      ctx({ sales: legacy }),
    ).orders[0];
    expect(p.kind).toBe("adopt");
    const a = p.sales.find((s) => s.id === "L1")!;
    const b = p.sales.find((s) => s.id === "L2")!;
    expect(a).toMatchObject({ unitCost: 33, orderKey: "shopee|O1", dedupeKey: "shopee|O1|A", batchId: "old" });
    expect(b.unitCost).toBeUndefined();
    expect(p.order.lines.map((l) => l.saleId).sort()).toEqual(["L1", "L2"]);
  });

  it("สถานะในไฟล์ไม่ตรงกันในคำสั่งซื้อเดียวกัน → ขัดแย้ง", () => {
    const p = buildOrderPlan([inc(), inc({ status: "completed", facts: { lineKey: "sku:B|p:1", fingerprint: "sku:B|p:1", sourceSku: "B" } })], ctx()).orders[0];
    expect(p.kind).toBe("conflict");
  });
});
