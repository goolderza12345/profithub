import { describe, expect, it } from "vitest";
import { buildTable, csvToSheet, decodeText, detectHeaderRow, excelDateToISO, readSourceFile } from "../table";
import { bytes, fixtureBuffer, readFixture } from "./fixtures";

describe("decodeText: การเข้ารหัสตัวอักษร", () => {
  it("UTF-8 มี BOM และไม่มี BOM", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("สวัสดี")]))).toEqual({ text: "สวัสดี", encoding: "UTF-8 (BOM)" });
    expect(decodeText(new TextEncoder().encode("สวัสดี")).encoding).toBe("UTF-8");
  });

  it("Windows-874 (ไฟล์ภาษาไทยจาก Excel รุ่นเก่า)", () => {
    const r = decodeText(new Uint8Array(fixtureBuffer("thai-cp874.csv")));
    expect(r.encoding).toContain("Windows-874");
    expect(r.text).toContain("เลขคำสั่งซื้อ");
  });

  it("UTF-16LE", () => {
    const r = decodeText(new Uint8Array(fixtureBuffer("thai-utf16.csv")));
    expect(r.encoding).toBe("UTF-16LE");
    expect(r.text).toContain("U16-1");
  });
});

describe("readSourceFile", () => {
  it("ไฟล์ 0 ไบต์", async () => {
    expect(await readSourceFile("zero-bytes.csv", fixtureBuffer("zero-bytes.csv"))).toEqual({ ok: false, error: "ไฟล์ว่างเปล่า (0 ไบต์)" });
  });

  it("ปฏิเสธ .xls รุ่นเก่า และ .xlsx ปลอม", async () => {
    const r = await readSourceFile("legacy.xls", fixtureBuffer("legacy.xls"));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(".xls");
    const fake = await readSourceFile("fake.xlsx", bytes("not a zip"));
    expect(!fake.ok && fake.error).toContain("เสียหาย");
  });

  it("ปฏิเสธไฟล์ใหญ่เกิน 10 MB", async () => {
    const r = await readSourceFile("big.csv", new ArrayBuffer(10 * 1024 * 1024 + 1));
    expect(!r.ok && r.error).toContain("10 MB");
  });

  it("อ่าน Excel ภาษาไทย: ชื่อชีต วันที่ และเลขยาวที่ Excel เก็บเป็นตัวเลข", async () => {
    const f = await readFixture("thai-orders.xlsx");
    expect(f.kind).toBe("xlsx");
    expect(f.sheets.map((s) => s.name)).toEqual(["ยอดขาย", "หมายเหตุ"]);
    const s = f.sheets[0];
    // แถวว่างถูกข้าม แต่เลขแถวยังตรงกับไฟล์
    expect(s.rowNumbers.slice(0, 3)).toEqual([1, 3, 4]);
    expect(s.rows[2]).toEqual(["TH-0001", "2026-11-05", "TS-001", "เสื้อยืดสีขาว", "2", "199", "40", "20", "5"]);
    expect(s.rows[s.rows.length - 1][0]).toMatch(/e\+17$/i);
  });

  it("ไฟล์เดิมได้ checksum เดิม ไฟล์ต่างกันได้ checksum ต่างกัน", async () => {
    const a = await readFixture("template-thai.csv");
    const b = await readFixture("template-thai.csv");
    const c = await readFixture("malformed.csv");
    expect(a.fileHash).toBe(b.fileHash);
    expect(a.fileHash).not.toBe(c.fileHash);
  });
});

describe("โครงสร้างตาราง", () => {
  it("csvToSheet ข้ามแถวว่างและเก็บเลขแถวเดิม", () => {
    const s = csvToSheet("a,b\n\n1,2\n , \n3,4");
    expect(s.rows).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
    expect(s.rowNumbers).toEqual([1, 3, 5]);
  });

  it("หาแถวหัวตารางที่อยู่ใต้แถวชื่อรายงาน", async () => {
    const f = await readFixture("thai-orders.xlsx");
    expect(detectHeaderRow(f.sheets[0].rows)).toBe(1);
    expect(detectHeaderRow([["x"], ["ไม่รู้จัก1", "ไม่รู้จัก2", "ไม่รู้จัก3"], ["1", "2", "3"]])).toBe(1);
  });

  it("ตั้งชื่อหัวคอลัมน์ว่าง/ซ้ำให้ไม่ซ้ำ และตรวจจำนวนคอลัมน์ของ CSV", () => {
    const t = buildTable(csvToSheet("a,,a\n1,2,3,4\n1,2"), 0, true);
    expect(t.headers).toEqual(["a", "คอลัมน์ 2", "a (2)"]);
    expect(t.rows[0].issue).toBe("จำนวนคอลัมน์มากกว่าหัวตาราง");
    expect(t.rows[1].issue).toBe("จำนวนคอลัมน์น้อยกว่าหัวตาราง");
    expect(t.rows[1].cells).toEqual(["1", "2", ""]);
    // Excel: ไม่ตรวจความกว้าง (ช่องว่างท้ายแถวถูกตัดเป็นปกติ)
    expect(buildTable(csvToSheet("a,b,c\n1"), 0, false).rows[0].issue).toBeUndefined();
  });

  it("วันที่จาก Excel ที่มีเศษมิลลิวินาทีถูกปัดก่อนตัดเป็นวันที่", () => {
    expect(excelDateToISO(new Date("2026-11-05T23:59:59.999Z"))).toBe("2026-11-06");
    expect(excelDateToISO(new Date("2026-11-05T14:29:59.999Z"))).toBe("2026-11-05");
  });
});
