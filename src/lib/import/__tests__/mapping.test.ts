import { describe, expect, it } from "vitest";
import { ADAPTERS, getAdapter } from "../adapters";
import {
  defaultOptions,
  headerFingerprint,
  mappingFromSaved,
  mappingProblems,
  mappingToSaved,
  needsConfirmation,
  suggestMapping,
} from "../mapping";
import { SAMPLE_CSV } from "../../csv";

const generic = getAdapter("generic");
const shopee = getAdapter("shopee");
const templateHeaders = SAMPLE_CSV.split("\n")[0].split(",");

describe("adapters", () => {
  it("มีแหล่งข้อมูลครบ และแพลตฟอร์มยังไม่อ้างว่ารองรับไฟล์จริง", () => {
    expect(ADAPTERS.map((a) => a.id)).toEqual(["generic", "shopee", "tiktok", "lazada"]);
    for (const id of ["shopee", "tiktok", "lazada"] as const) {
      const a = getAdapter(id);
      expect(a.verified).toBe(false);
      expect(a.verifiedHeaders).toEqual({});
      expect(a.supportNote).toContain("ยังไม่มีรูปแบบไฟล์");
    }
    expect(generic.verified).toBe(true);
  });
});

describe("suggestMapping", () => {
  it("แม่แบบ ProfitHub จับคู่ครบทุกช่องแบบยืนยันแล้ว ไม่ต้องให้ผู้ใช้ยืนยัน", () => {
    const s = suggestMapping(templateHeaders, generic);
    expect(s.mapping).toMatchObject({ orderId: [0], orderDate: [1], channel: [2], sku: [3], quantity: [4], unitPrice: [5], shippingFee: [10] });
    expect(Object.values(s.confidence).every((c) => c === "verified")).toBe(true);
    expect(needsConfirmation(generic, s)).toBe(false);
    expect(mappingProblems(s.mapping, defaultOptions(generic), templateHeaders)).toEqual([]);
  });

  it("หัวตารางภาษาไทยที่ไม่ใช่แม่แบบ: จับคู่จากชื่อทั่วไป", () => {
    const headers = ["หมายเลขคำสั่งซื้อ", "วันที่สร้างคำสั่งซื้อ", "รหัสสินค้า", "ชื่อสินค้า", "จำนวน", "ราคาต่อชิ้น", "ค่าส่งของคำสั่งซื้อ"];
    const s = suggestMapping(headers, generic);
    expect(s.mapping).toEqual({ orderId: [0], orderDate: [1], sku: [2], productName: [3], quantity: [4], unitPrice: [5] });
    expect(s.confidence.orderId).toBe("alias");
  });

  it("ชื่อคล้าย (เดา) ต้องให้ผู้ใช้ยืนยัน", () => {
    const s = suggestMapping(["Order ID", "Order Date (local)", "Seller SKU", "Qty", "Unit Price"], generic);
    expect(s.confidence.orderDate).toBe("fuzzy");
    expect(needsConfirmation(generic, s)).toBe(true);
  });

  it("แพลตฟอร์มที่ยังไม่ยืนยัน: ต้องยืนยันเสมอ และใช้ช่องทางคงที่แทนคอลัมน์", () => {
    const s = suggestMapping(templateHeaders, shopee);
    expect(s.mapping.channel).toBeUndefined();
    expect(needsConfirmation(shopee, s)).toBe(true);
    expect(defaultOptions(shopee).fixedChannel).toBe("Shopee");
    expect(Object.values(s.confidence)).not.toContain("verified");
  });

  it("มีทั้งราคาต่อชิ้นและยอดรวม: ใช้ราคาต่อชิ้น", () => {
    const s = suggestMapping(["order_id", "order_date", "channel", "sku", "quantity", "unit_price", "line_total"], generic);
    expect(s.mapping.unitPrice).toEqual([5]);
    expect(s.mapping.lineTotal).toBeUndefined();
  });

  it("คอลัมน์หนึ่งถูกใช้กับช่องเดียว", () => {
    const s = suggestMapping(["ส่วนลด", "ส่วนลด (2)"], generic);
    expect(Object.values(s.mapping).flat()).toEqual([0]);
  });
});

describe("mappingProblems", () => {
  const headers = ["a", "b", "c", "d", "e", "f"];
  it("แจ้งช่องบังคับที่ยังไม่เลือก ราคา และช่องทาง", () => {
    const p = mappingProblems({ orderId: [0] }, defaultOptions(generic), headers).map((x) => x.message);
    expect(p.join("\n")).toContain("วันที่สั่งซื้อ");
    expect(p.join("\n")).toContain("SKU");
    expect(p.join("\n")).toContain("ราคาขายต่อชิ้น");
    expect(p.join("\n")).toContain("ช่องทาง");
  });

  it("ช่องทางคงที่ใช้แทนคอลัมน์ได้", () => {
    const m = { orderId: [0], orderDate: [1], sku: [2], quantity: [3], lineTotal: [4] };
    expect(mappingProblems(m, { ...defaultOptions(generic), fixedChannel: "LINE" }, headers)).toEqual([]);
  });

  it("คอลัมน์เดียวกันถูกใช้หลายช่อง / เลือกทั้งราคาต่อชิ้นและยอดรวม", () => {
    const m = { orderId: [0], orderDate: [1], sku: [2], quantity: [3], unitPrice: [4], lineTotal: [5], discount: [5] };
    const p = mappingProblems(m, { ...defaultOptions(generic), fixedChannel: "LINE" }, headers).map((x) => x.message);
    expect(p.some((x) => x.includes("ถูกใช้ทั้ง"))).toBe(true);
    expect(p.some((x) => x.includes("เลือกได้เพียงอย่างเดียว"))).toBe(true);
  });
});

describe("จำการจับคู่ที่ยืนยันแล้ว", () => {
  it("บันทึกตามชื่อหัวตาราง แล้วนำกลับมาใช้ได้ ไม่ต้องยืนยันซ้ำ", () => {
    const headers = ["เลข", "วัน", "รหัส", "ชิ้น", "ราคา"];
    const saved = mappingToSaved({ orderId: [0], orderDate: [1], sku: [2], quantity: [3], unitPrice: [4] }, headers);
    expect(saved.orderId).toEqual(["เลข"]);
    const back = mappingFromSaved(saved, headers)!;
    expect(back.mapping.unitPrice).toEqual([4]);
    expect(needsConfirmation(shopee, back)).toBe(false);
    // หัวตารางเปลี่ยน → ไม่ใช้การจับคู่เดิม
    expect(mappingFromSaved(saved, ["เลข", "วัน"])).toBeNull();
  });

  it("fingerprint ขึ้นกับรูปแบบไฟล์และชื่อคอลัมน์", () => {
    expect(headerFingerprint("shopee", ["A", "B"])).toBe(headerFingerprint("shopee", [" a ", "b"]));
    expect(headerFingerprint("shopee", ["A", "B"])).not.toBe(headerFingerprint("lazada", ["A", "B"]));
  });
});
