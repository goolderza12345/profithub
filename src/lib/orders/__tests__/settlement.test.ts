import { describe, expect, it } from "vitest";
import { buildTable, csvToSheet } from "../../import/table";
import { buildSettlementPlan, expenseFromEntry, parseSettlement, reconcile, settlementFeesFor, suggestSettlementMapping, supersedeCandidates } from "../settlement";
import type { SettlementEntry } from "../types";
import { emptyFees } from "../types";
import { line, order } from "./helpers";

const parse = (csv: string, reportId = "r1", negativeAsDeduction = false) => {
  const t = buildTable(csvToSheet(csv), 0, true);
  return parseSettlement(t, suggestSettlementMapping(t.headers), { channel: "Shopee", reportId, negativeAsDeduction });
};
const H = "order_id,date,entry_id,commission_fee,transaction_fee,service_fee,shipping_fee,other_fee,fee_refund,payout,description";
const asMap = (es: SettlementEntry[]) => new Map(es.map((e) => [e.entryKey, e]));

describe("parseSettlement", () => {
  it("แต่ละคอลัมน์จำนวนเงินเป็นหนึ่งรายการ มีรหัสใช้รหัส ไม่มีรหัสใช้ลายนิ้วมือ+ลำดับ", () => {
    const p = parse([H, "O1,2026-11-05,T1,12.50,3,,,,,184.50,", "O1,2026-11-05,,,,,,,-5,,ค่าคอมคืน", ",2026-11-30,,,,,,99,,,ค่าบริการรายเดือน"].join("\n"));
    expect(p.errors).toEqual([]);
    const e = p.entries.map((x) => x.entry);
    expect(e.map((x) => [x.entryKey.replace(/fp:[0-9a-f]+/, "fp"), x.type, x.amount, x.orderKey ?? null])).toEqual([
      ["id:T1:commission", "commission", 1250, "shopee|O1"],
      ["id:T1:transaction", "transaction", 300, "shopee|O1"],
      ["id:T1:payout", "payout", 18450, "shopee|O1"],
      ["fp#1", "fee_refund", -500, "shopee|O1"],
      ["fp#1", "other", 9900, null],
    ]);
    expect(p.periodFrom).toBe("2026-11-05");
    expect(p.periodTo).toBe("2026-11-30");
  });

  it("ค่าธรรมเนียมติดลบ: ผิดพลาด เว้นแต่ผู้ใช้เลือกว่าไฟล์แสดงรายการหักเป็นค่าติดลบ", () => {
    expect(parse([H, "O1,2026-11-05,,-12.5,,,,,,,"].join("\n")).errors[0].message).toContain("ติดลบ");
    expect(parse([H, "O1,2026-11-05,,-12.5,,,,,,,"].join("\n"), "r1", true).entries[0].entry.amount).toBe(1250);
  });
});

describe("กันนำเข้ารายงานซ้ำ", () => {
  const r1 = [H, "O1,2026-11-05,,12,,,,,,,", "O2,2026-11-06,,10,,,,,,,", "O2,2026-11-06,,10,,,,,,,"].join("\n");

  it("รายงานช่วงเวลาซ้อนกัน: รายการเดิมนับครั้งเดียว (จำนวนสูงสุดต่อรายงาน ไม่ใช่ผลรวม)", () => {
    const a = parse(r1, "r1");
    const planA = buildSettlementPlan(a.entries, new Map());
    expect(planA.newEntries).toHaveLength(3); // O2 มีสองรายการเหมือนกันจริงในรายงานเดียว → #1, #2
    const overlap = [H, "O2,2026-11-06,,10,,,,,,,", "O2,2026-11-06,,10,,,,,,,", "O3,2026-11-07,,8,,,,,,,"].join("\n");
    const b = parse(overlap, "r2");
    const planB = buildSettlementPlan(b.entries, asMap(planA.newEntries));
    expect(planB.alreadyCounted).toHaveLength(2);
    expect(planB.newEntries.map((e) => e.orderKey)).toEqual(["shopee|O3"]);
  });

  it("รหัสรายการเดิมแต่จำนวนเงินเปลี่ยน = ปรับย้อนหลัง", () => {
    const a = buildSettlementPlan(parse([H, "O1,2026-11-05,T1,12,,,,,,,"].join("\n")).entries, new Map());
    const b = buildSettlementPlan(parse([H, "O1,2026-11-05,T1,15,,,,,,,"].join("\n"), "r2").entries, asMap(a.newEntries));
    expect(b.revised).toHaveLength(1);
    expect(b.revised[0].after.amount).toBe(1500);
    expect(b.affectedOrders).toEqual(["shopee|O1"]);
  });

  it("รหัสรายการซ้ำภายในไฟล์เดียว", () => {
    const p = buildSettlementPlan(parse([H, "O1,2026-11-05,T1,12,,,,,,,", "O1,2026-11-05,T1,12,,,,,,,"].join("\n")).entries, new Map());
    expect(p.duplicateInFile).toHaveLength(1);
    expect(p.newEntries).toHaveLength(1);
  });
});

describe("ค่าธรรมเนียมที่ใช้คำนวณ (นับครั้งเดียว)", () => {
  const o = order({
    lines: [
      line({ lineKey: "a", grossSatang: 30000, fees: { ...emptyFees(), commission: 3000, other: 500, shipping: 2000 }, feeRefunded: 100 }),
      line({ lineKey: "b", saleId: "s2", grossSatang: 10000, fees: { ...emptyFees(), commission: 1000, other: 0 } }),
    ],
  });
  const E = (type: SettlementEntry["type"], amount: number, key = type): SettlementEntry => ({ entryKey: key, reportIds: ["r"], orderKey: o.key, type, amount, occurredAt: "2026-11-05", description: "" });

  it("ค่าธรรมเนียมแพลตฟอร์มจากรายงานแทน “ทั้งหมด” จากไฟล์คำสั่งซื้อ (ไม่ผสมแหล่ง) ค่าขนส่งที่รายงานไม่มีใช้ค่าเดิม", () => {
    const sf = settlementFeesFor(o, [E("commission", 4500)])!;
    expect(sf.perLine.map((f) => f.commission)).toEqual([3375, 1125]);
    expect(sf.perLine.map((f) => f.other)).toEqual([0, 0]); // ยอดรวมจากไฟล์คำสั่งซื้อไม่ถูกบวกซ้ำ
    expect(sf.perLine.map((f) => f.shipping)).toEqual([2000, 0]);
    expect(sf).toMatchObject({ final: true, replacesLineFeeRefund: false });
  });

  it("รายงานมีแต่ค่าธรรมเนียมที่ได้คืน: ไม่ทิ้งค่าธรรมเนียมจากไฟล์คำสั่งซื้อ และไม่หักค่าได้คืนซ้ำ", () => {
    const sf = settlementFeesFor(o, [E("fee_refund", -400)])!;
    expect(sf.perLine.map((f) => f.commission)).toEqual([3000, 1000]);
    expect(sf.perLine.map((f) => f.other)).toEqual([200, -100]);
    expect(sf).toMatchObject({ final: false, replacesLineFeeRefund: true });
  });

  it("ไม่มีรายการค่าธรรมเนียมของคำสั่งซื้อ → null", () => {
    expect(settlementFeesFor(o, [E("payout", 100)])).toBeNull();
    expect(settlementFeesFor(o, [])).toBeNull();
  });

  it("กระทบยอด: ยอดโอนที่คาดไว้เทียบกับยอดโอนจริง", () => {
    const ok = order({ lines: [line({ grossSatang: 10000, sellerDiscount: 1000, fees: { ...emptyFees(), commission: 900 } })] });
    const pay = (amount: number): SettlementEntry => ({ entryKey: "p", reportIds: ["r"], orderKey: ok.key, type: "payout", amount, occurredAt: "2026-11-05", description: "" });
    expect(reconcile([ok], [pay(8100)])).toEqual([]);
    expect(reconcile([ok], [pay(8000)])).toEqual([{ orderKey: ok.key, orderId: ok.orderId, expected: 8100, actual: 8000, diff: -100 }]);
  });
});

describe("รายการที่ไม่มีเลขคำสั่งซื้อ และค่าใช้จ่ายที่กรอกเอง", () => {
  const e: SettlementEntry = { entryKey: "fp:x#1", reportIds: ["r"], type: "service", amount: 9900, occurredAt: "2026-11-30", description: "รายเดือน" };
  it("กลายเป็นค่าใช้จ่ายอ่านอย่างเดียว (เฉพาะยอดที่ร้านจ่าย)", () => {
    expect(expenseFromEntry(e, "Shopee", "t")).toMatchObject({ id: "stl:fp:x#1", category: "platform_fee", amount: 99, channel: "Shopee", source: { kind: "settlement", entryKey: "fp:x#1" } });
    expect(expenseFromEntry({ ...e, amount: -100 }, "Shopee", "t")).toBeNull();
    expect(expenseFromEntry({ ...e, orderKey: "x" }, "Shopee", "t")).toBeNull();
  });

  it("เสนอค่าใช้จ่ายที่กรอกเองซึ่งอาจซ้ำ (ประเภท/ช่องทาง/ช่วงเวลาตรง)", () => {
    const base = { note: "", createdAt: "t" };
    const manual = [
      { ...base, id: "m1", date: "2026-11-30", category: "platform_fee" as const, amount: 99, channel: "Shopee" },
      { ...base, id: "m2", date: "2026-11-30", category: "ads" as const, amount: 99, channel: "Shopee" },
      { ...base, id: "m3", date: "2026-10-01", category: "platform_fee" as const, amount: 99, channel: "Shopee" },
      { ...base, id: "m4", date: "2026-11-30", category: "platform_fee" as const, amount: 99, channel: "Lazada" },
    ];
    expect(supersedeCandidates(manual, [e], "Shopee").map((x) => x.id)).toEqual(["m1"]);
  });
});
