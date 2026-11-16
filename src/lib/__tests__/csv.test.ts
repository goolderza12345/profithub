import { describe, expect, it } from "vitest";
import { sanitizeCell, toCsv, makeDedupeKey, mapHeader, normalizeChannel, parseAmount, parseDate, SAMPLE_CSV, validateSalesCsv } from "../csv";

const opts = (keys: string[] = []) => ({
  productCosts: new Map([["TS-001", 85], ["MUG-002", 95]]),
  existingKeys: new Set(keys),
});

const HEADER = "order_id,order_date,channel,sku,quantity,unit_price,discount,refund,returned_qty,platform_fee,shipping_fee";

describe("parsers", () => {
  it("parseDate รองรับหลายรูปแบบและ พ.ศ.", () => {
    expect(parseDate("2026-11-05")).toBe("2026-11-05");
    expect(parseDate("2026/1/5")).toBe("2026-01-05");
    expect(parseDate("05/11/2026")).toBe("2026-11-05");
    expect(parseDate("5/11/2569")).toBe("2026-11-05");
    expect(parseDate("2026-11-05 13:22:10")).toBe("2026-11-05");
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseDate("abc")).toBeNull();
    expect(parseDate("")).toBeNull();
  });

  it("parseAmount ตัดคอมมาและ ฿", () => {
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount("฿99")).toBe(99);
    expect(parseAmount("")).toBe("empty");
    expect(parseAmount("12a")).toBeNull();
  });

  it("normalizeChannel และ dedupe key ไม่สนตัวพิมพ์", () => {
    expect(normalizeChannel(" shopee ")).toBe("Shopee");
    expect(normalizeChannel("TikTok  Shop")).toBe("TikTok Shop");
    expect(normalizeChannel("ร้านหน้าบ้าน")).toBe("ร้านหน้าบ้าน");
    expect(makeDedupeKey("Shopee", "O1", "ts-001")).toBe(makeDedupeKey("shopee", " O1 ", "TS-001"));
  });

  it("mapHeader รองรับหัวคอลัมน์ภาษาไทยและ BOM", () => {
    expect(mapHeader("﻿Order_ID")).toBe("order_id");
    expect(mapHeader("เลขคำสั่งซื้อ")).toBe("order_id");
    expect(mapHeader("Unit Price")).toBe("unit_price");
  });
});

describe("validateSalesCsv", () => {
  it("ไฟล์ตัวอย่างผ่านการตรวจทั้งหมด", () => {
    const r = validateSalesCsv(SAMPLE_CSV, opts());
    expect(r.fileErrors).toEqual([]);
    expect(r.okCount).toBe(4);
    expect(r.errorCount).toBe(0);
    const lzd = r.rows[2].sale!;
    expect(lzd.date).toBe("2026-11-02");
    expect(lzd.shippingFee).toBe(15);
  });

  it("แจ้งคอลัมน์ที่จำเป็นที่ขาดหายไป", () => {
    const r = validateSalesCsv("order_id,sku\nO1,TS-001", opts());
    expect(r.fileErrors[0]).toContain("order_date");
    expect(r.fileErrors[0]).toContain("unit_price");
    expect(r.rows).toEqual([]);
  });

  it("ไฟล์ว่าง", () => {
    const r = validateSalesCsv(HEADER + "\n", opts());
    expect(r.fileErrors).toEqual(["ไฟล์ไม่มีข้อมูล"]);
  });

  it("แจ้งข้อผิดพลาดของแต่ละแถวพร้อมเลขแถว", () => {
    const csv = [
      HEADER,
      "O1,2026-11-01,Shopee,TS-001,1,199,,,,,", // ok (แถว 2)
      "O2,2026-13-01,Shopee,TS-001,1,199,,,,,", // วันที่ผิด (แถว 3)
      "O3,2026-11-01,Shopee,NOPE,1,199,,,,,", // SKU ไม่พบ (แถว 4)
      "O4,2026-11-01,Shopee,TS-001,0,abc,,,,,", // จำนวน 0 + ราคาไม่ใช่ตัวเลข (แถว 5)
      "O5,2026-11-01,Shopee,TS-001,1.5,100,,,,,", // จำนวนไม่เต็ม (แถว 6)
      "O6,2026-11-01,Shopee,TS-001,1,100,150,,,,", // ส่วนลดเกิน (แถว 7)
      "O7,2026-11-01,Shopee,TS-001,1,100,,,2,,", // คืนเกิน (แถว 8)
      "O8,2026-11-01,,TS-001,1,-5,,,,,", // ไม่มีช่องทาง + ติดลบ (แถว 9)
      ",2026-11-01,Shopee,TS-001,1,100,,,,,", // ไม่มีเลขคำสั่งซื้อ (แถว 10)
    ].join("\n");
    const r = validateSalesCsv(csv, opts());
    expect(r.okCount).toBe(1);
    expect(r.errorCount).toBe(8);
    const byRow = Object.fromEntries(r.rows.map((x) => [x.row, x.errors.join(" | ")]));
    expect(byRow[2]).toBe("");
    expect(byRow[3]).toContain("วันที่ไม่ถูกต้อง");
    expect(byRow[4]).toContain('ไม่พบ SKU "NOPE"');
    expect(byRow[5]).toContain("จำนวนชิ้นต้องมากกว่า 0");
    expect(byRow[5]).toContain("ราคาขายต่อชิ้นไม่ใช่ตัวเลข");
    expect(byRow[6]).toContain("จำนวนเต็ม");
    expect(byRow[7]).toContain("ส่วนลดมากกว่ายอดขาย");
    expect(byRow[8]).toContain("ชิ้นที่ได้รับคืนมากกว่า");
    expect(byRow[9]).toContain("ไม่มีช่องทางขาย");
    expect(byRow[9]).toContain("ต้องไม่ติดลบ");
    expect(byRow[10]).toContain("ไม่มีเลขคำสั่งซื้อ");
  });

  it("ป้องกันรายการซ้ำทั้งในไฟล์และที่เคยนำเข้าแล้ว", () => {
    const csv = [
      HEADER,
      "O1,2026-11-01,Shopee,TS-001,1,199,,,,,",
      "O1,2026-11-01,shopee,ts-001,1,199,,,,,", // ซ้ำในไฟล์
      "O1,2026-11-01,Lazada,TS-001,1,199,,,,,", // คนละช่องทาง = ไม่ซ้ำ
      "O9,2026-11-01,Shopee,MUG-002,1,250,,,,,", // เคยนำเข้าแล้ว
    ].join("\n");
    const r = validateSalesCsv(csv, opts([makeDedupeKey("Shopee", "O9", "MUG-002")]));
    expect(r.rows.map((x) => x.status)).toEqual(["ok", "duplicate", "ok", "duplicate"]);
    expect(r.rows[1].errors[0]).toContain("ซ้ำกับแถว 2");
    expect(r.rows[3].errors[0]).toContain("ถูกนำเข้าแล้ว");
    expect(r.duplicateCount).toBe(2);
  });

  it("รองรับหัวคอลัมน์ภาษาไทย ตัวเลขมีคอมมาในเครื่องหมายคำพูด และ CRLF", () => {
    const csv =
      "เลขคำสั่งซื้อ,วันที่สั่งซื้อ,ช่องทางขาย,SKU,จำนวนชิ้น,ราคาขายต่อชิ้น\r\n" +
      'A1,01/11/2569,lazada,mug-002,2,"1,250.00"\r\n';
    const r = validateSalesCsv(csv, opts());
    expect(r.okCount).toBe(1);
    const s = r.rows[0].sale!;
    expect(s).toMatchObject({ channel: "Lazada", sku: "MUG-002", unitPrice: 1250, quantity: 2, discount: 0 });
  });

  it("แจ้งแถวที่จำนวนคอลัมน์ไม่ตรง", () => {
    const r = validateSalesCsv(HEADER + "\nO1,2026-11-01,Shopee,TS-001,1,199,0,0,0,0,0,EXTRA", opts());
    expect(r.rows[0].status).toBe("error");
    expect(r.rows[0].errors[0]).toContain("จำนวนคอลัมน์");
  });

  it("บันทึกต้นทุนต่อชิ้น ณ เวลาตรวจไว้ในรายการ (snapshot)", () => {
    const r = validateSalesCsv(SAMPLE_CSV, opts());
    expect(r.rows[0].sale!.unitCost).toBe(85);
    expect(r.rows[1].sale!.unitCost).toBe(95);
  });

  it("ปฏิเสธข้อมูลที่ยาวหรือใหญ่ผิดปกติ", () => {
    const csv = [
      HEADER,
      `${"X".repeat(65)},2026-11-01,Shopee,TS-001,1,199,,,,,`,
      "O2,2026-11-01,Shopee,TS-001,1,999999999999,,,,,",
      "O3,2026-11-01,Shopee,TS-001,99999999,10,,,,,",
      `O4,2026-11-01,${"ช".repeat(41)},TS-001,1,10,,,,,`,
    ].join("\n");
    const r = validateSalesCsv(csv, opts());
    expect(r.errorCount).toBe(4);
    expect(r.rows[0].errors.join()).toContain("เลขคำสั่งซื้อยาวเกิน");
    expect(r.rows[1].errors.join()).toContain("สูงผิดปกติ");
    expect(r.rows[2].errors.join()).toContain("สูงผิดปกติ");
    expect(r.rows[3].errors.join()).toContain("ช่องทางขายยาวเกิน");
  });

  it("ปฏิเสธไฟล์ที่มีแถวเกินขีดจำกัด", () => {
    const rows = Array.from({ length: 20001 }, (_, i) => `O${i},2026-11-01,Shopee,TS-001,1,10,,,,,`);
    const r = validateSalesCsv([HEADER, ...rows].join("\n"), opts());
    expect(r.fileErrors[0]).toContain("เกินขีดจำกัด");
    expect(r.rows).toEqual([]);
  });
});

describe("CSV export: ป้องกัน formula injection", () => {
  it("เติม ' หน้าข้อความที่ขึ้นต้นด้วยสัญลักษณ์สูตร แต่ไม่แก้ตัวเลข", () => {
    expect(sanitizeCell("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    expect(sanitizeCell("+1")).toBe("'+1");
    expect(sanitizeCell("-cmd")).toBe("'-cmd");
    expect(sanitizeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(sanitizeCell("สินค้า A")).toBe("สินค้า A");
    expect(sanitizeCell(-50)).toBe(-50);
    const csv = toCsv([["name", "amount"], ["=1+1", -5]]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("-5");
  });
});
