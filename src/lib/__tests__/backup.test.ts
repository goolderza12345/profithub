import { describe, expect, it } from "vitest";
import { backupFileName, createBackup, parseBackup, serializeBackup, BACKUP_SCHEMA_VERSION } from "../backup";
import { generateDemoData } from "../demo";
import type { Snapshot } from "../db";
import { expense, product, sale } from "./helpers";

const NOW = "2026-11-16T10:00:00.000Z";
const realData = (): Snapshot => ({
  products: [product({ id: "p1", sku: "A", createdAt: NOW, updatedAt: NOW })],
  sales: [sale({ id: "s1", sku: "A", unitCost: 40, dedupeKey: "shopee|O1|A", batchId: "b1" })],
  expenses: [expense({ id: "e1", amount: 50, createdAt: NOW })],
  batches: [{ id: "b1", fileName: "sales.csv", importedAt: NOW, rowCount: 1 }],
});
const text = (d: Snapshot = realData(), ds: "real" | "demo" = "real") => serializeBackup(createBackup(ds, d, new Date(NOW)));

/** แก้ไฟล์แล้วคำนวณ checksum ใหม่ เพื่อทดสอบการตรวจรายการ */
function tamper(fn: (d: Snapshot) => void): string {
  const d = realData();
  fn(d);
  return text(d);
}

describe("backup: สร้างและกู้คืน", () => {
  it("สร้างแล้วอ่านกลับได้ครบทุกข้อมูล (round trip)", () => {
    const r = parseBackup(text(), "real");
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.backup!.data).toEqual(realData());
    expect(r.backup!.counts).toEqual({ products: 1, sales: 1, expenses: 1, batches: 1 });
    expect(r.backup!.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
  });

  it("ข้อมูล Demo 90 วันผ่านการตรวจทั้งหมด", () => {
    const r = parseBackup(text(generateDemoData(new Date(2026, 10, 16)), "demo"), "demo");
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("ชื่อไฟล์ระบุ Demo", () => {
    expect(backupFileName("demo", new Date(2026, 10, 16, 9, 5))).toBe("DEMO_profithub-backup-20261116-0905.json");
    expect(backupFileName("real", new Date(2026, 10, 16, 9, 5))).toBe("profithub-backup-20261116-0905.json");
  });
});

describe("backup: ตรวจไฟล์ก่อนกู้คืน", () => {
  it("ไม่ใช่ JSON", () => {
    expect(parseBackup("{not json", "real").errors[0]).toContain("ไม่ใช่ JSON");
  });

  it("ไม่ใช่ไฟล์ของ ProfitHub", () => {
    expect(parseBackup(JSON.stringify({ hello: 1 }), "real").errors[0]).toContain("ไม่ใช่ไฟล์สำรองข้อมูลของ ProfitHub");
  });

  it("ไฟล์จากรุ่นใหม่กว่า", () => {
    const f = JSON.parse(text());
    f.schemaVersion = BACKUP_SCHEMA_VERSION + 1;
    expect(parseBackup(JSON.stringify(f), "real").errors[0]).toContain("รุ่นใหม่กว่า");
  });

  it("ห้ามกู้คืนข้ามชุดข้อมูล (Demo → จริง และ จริง → Demo)", () => {
    expect(parseBackup(text(realData(), "demo"), "real").ok).toBe(false);
    const r = parseBackup(text(realData(), "real"), "demo");
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("ปะปน");
  });

  it("checksum ไม่ตรง (ไฟล์ถูกแก้หรือเสียหาย)", () => {
    const f = JSON.parse(text());
    f.data.sales[0].unitPrice = 1;
    const r = parseBackup(JSON.stringify(f), "real");
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("checksum");
  });

  it("ข้อมูลบางส่วนหายไป", () => {
    const f = JSON.parse(text());
    delete f.data.sales;
    expect(parseBackup(JSON.stringify(f), "real").errors[0]).toContain("sales");
  });

  it("รายการผิดรูปแบบ ถูกแจ้งพร้อมลำดับ", () => {
    const r = parseBackup(
      tamper((d) => {
        d.products[0].unitCost = -1;
        d.sales[0].date = "2026-02-30";
        d.sales[0].returnedQty = 5;
        (d.expenses[0] as { category: string }).category = "bribe";
      }),
      "real",
    );
    expect(r.ok).toBe(false);
    const all = r.errors.join("\n");
    expect(all).toContain("สินค้า ลำดับที่ 1: ต้นทุนต่อชิ้นไม่ถูกต้อง");
    expect(all).toContain("วันที่ไม่ถูกต้อง (2026-02-30)");
    expect(all).toContain("ชิ้นที่ได้รับคืนมากกว่า");
    expect(all).toContain("ประเภทค่าใช้จ่ายไม่ถูกต้อง (bribe)");
  });

  it("ข้อมูลซ้ำ: SKU และรายการขายซ้ำ", () => {
    const r = parseBackup(
      tamper((d) => {
        d.products.push({ ...d.products[0], id: "p2" });
        d.sales.push({ ...d.sales[0], id: "s2" });
      }),
      "real",
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("SKU ซ้ำ: A");
    expect(r.errors.join()).toContain("รายการขาย (ช่องทาง + เลขคำสั่งซื้อ + SKU) ซ้ำ");
  });

  it("จำนวนข้อมูลไม่ตรงกับที่ระบุในไฟล์", () => {
    const f = JSON.parse(text());
    f.counts.sales = 99;
    expect(parseBackup(JSON.stringify(f), "real").errors[0]).toContain("จำนวนข้อมูล");
  });

  it("เตือน (แต่ยอมให้กู้คืน) ข้อมูลรุ่นเก่าที่ไม่มีต้นทุน snapshot", () => {
    const r = parseBackup(tamper((d) => delete d.sales[0].unitCost), "real");
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toContain("ยังไม่มีต้นทุน ณ วันนำเข้า");
  });

  it("แจ้งข้อผิดพลาดไม่เกินจำนวนที่กำหนด", () => {
    const r = parseBackup(
      tamper((d) => {
        for (let i = 0; i < 100; i++) d.expenses.push(expense({ id: `x${i}`, amount: -1, createdAt: NOW }));
      }),
      "real",
    );
    expect(r.errors.length).toBe(31);
  });
});

describe("backup: checksum ครอบคลุมชุดข้อมูล", () => {
  it("แก้ dataset ในไฟล์จาก demo เป็น real เพื่อข้ามชุด ถูกตรวจพบ", () => {
    const f = JSON.parse(text(realData(), "demo"));
    f.dataset = "real";
    const r = parseBackup(JSON.stringify(f), "real");
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("checksum");
  });
});
