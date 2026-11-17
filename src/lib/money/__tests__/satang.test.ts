import { describe, expect, it } from "vitest";
import { rng } from "../../demo";
import { allocate, fromBaht, parseSatang, toBaht } from "../satang";

describe("parseSatang: อ่านจากข้อความโดยไม่ผ่าน float", () => {
  it.each([
    ["1,199.50", 119950],
    ["฿99", 9900],
    ["0.1", 10],
    ["0.10", 10],
    ["1.500", 150],
    ["-23.88", -2388],
    ["(10.00)", -1000],
    ["THB 5", 500],
    ["12 บาท", 1200],
    ["0012.3", 1230],
  ])("%s → %d", (raw, expected) => {
    expect(parseSatang(raw)).toEqual({ ok: true, value: expected });
  });

  it("ค่าว่าง ไม่ใช่ตัวเลข และทศนิยมเกิน 2 ตำแหน่ง", () => {
    expect(parseSatang("")).toEqual({ ok: false, reason: "empty" });
    expect(parseSatang("-")).toEqual({ ok: false, reason: "empty" });
    expect(parseSatang("12a")).toEqual({ ok: false, reason: "invalid" });
    expect(parseSatang("1e5")).toEqual({ ok: false, reason: "invalid" });
    expect(parseSatang("1.234")).toEqual({ ok: false, reason: "precision" });
  });

  it("แปลงไป-กลับกับบาทที่มีทศนิยม 2 ตำแหน่งได้ตรง", () => {
    for (const b of [0.1, 0.2, 0.3, 23.88, 199.99, 1234567.89]) expect(toBaht(fromBaht(b))).toBe(b);
    expect(fromBaht(0.1 + 0.2)).toBe(30);
  });
});

describe("allocate: วิธีเศษเหลือมากสุด", () => {
  it("ผลรวมตรง และเศษไปตาม key ไม่ใช่ลำดับแถว", () => {
    expect(allocate(1000, [100, 100, 100], ["b", "a", "c"])).toEqual([333, 334, 333]);
    expect(allocate(4000, [39800, 25000], ["TS", "MUG"])).toEqual([2457, 1543]);
    expect(allocate(4000, [25000, 39800], ["MUG", "TS"])).toEqual([1543, 2457]);
  });

  it("ยอดติดลบ น้ำหนักรวม 0 และยอด 0", () => {
    expect(allocate(-1000, [1, 1, 1], ["a", "b", "c"])).toEqual([-334, -333, -333]);
    expect(allocate(5, [0, 0], ["a", "b"])).toEqual([3, 2]);
    expect(allocate(0, [10, 20], ["a", "b"])).toEqual([0, 0]);
  });

  it("ตัวเลขขนาดใหญ่ไม่ล้น (ใช้ BigInt)", () => {
    const r = allocate(9_999_999_999, [9_000_000_000, 1_000_000_001, 3], ["a", "b", "c"]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(9_999_999_999);
  });

  it("สุ่ม 10,000 กรณี: ผลรวมตรงเสมอ ไม่ขึ้นกับลำดับ และแต่ละส่วนห่างจากสัดส่วนจริงไม่เกิน 1 สตางค์", () => {
    const rand = rng(42);
    for (let n = 0; n < 10_000; n++) {
      const k = 1 + Math.floor(rand() * 6);
      const total = Math.floor((rand() - 0.2) * 1_000_000);
      const weights = Array.from({ length: k }, () => Math.floor(rand() * 50_000));
      const keys = Array.from({ length: k }, (_, i) => `k${(i * 7) % k}-${i}`);
      const r = allocate(total, weights, keys);
      expect(r.reduce((a, b) => a + b, 0)).toBe(total);
      const W = weights.reduce((a, b) => a + b, 0) || k;
      r.forEach((v, i) => expect(Math.abs(v - (total * (W === k && weights.every((w) => w === 0) ? 1 : weights[i])) / W)).toBeLessThan(1));
      // สลับลำดับแล้วผลของแต่ละ key ต้องเท่าเดิม
      const perm = keys.map((_, i) => i).reverse();
      const r2 = allocate(total, perm.map((i) => weights[i]), perm.map((i) => keys[i]));
      perm.forEach((orig, j) => expect(r2[j]).toBe(r[orig]));
    }
  });
});
