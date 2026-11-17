/**
 * จำนวนเงินภายใน = จำนวนเต็มหน่วยสตางค์ (1 บาท = 100 สตางค์)
 * - อ่านค่าจากข้อความโดยตรง ไม่ผ่าน float
 * - ปันส่วนด้วยวิธีเศษเหลือมากสุด (largest remainder) เรียงตาม key ไม่ขึ้นกับลำดับแถว
 */
export type Satang = number & { readonly __satang: true };

export const ZERO = 0 as Satang;
const B0 = BigInt(0);
const B1 = BigInt(1);

export function isSatang(v: unknown): v is Satang {
  return typeof v === "number" && Number.isSafeInteger(v);
}

export function satang(n: number): Satang {
  if (!Number.isSafeInteger(n)) throw new RangeError(`ไม่ใช่จำนวนเต็มสตางค์: ${n}`);
  return n as Satang;
}

/** บาท (ทศนิยมไม่เกิน 2 ตำแหน่ง ที่เก็บในข้อมูลเดิม) → สตางค์ */
export function fromBaht(baht: number): Satang {
  return Math.round(baht * 100) as Satang;
}

export function toBaht(s: Satang | number): number {
  return s / 100;
}

export type ParsedSatang = { ok: true; value: Satang } | { ok: false; reason: "empty" | "invalid" | "precision" };

/**
 * แปลงข้อความเป็นสตางค์: "1,199.50" → 119950, "฿99" → 9900, "(10.00)" → -1000
 * ทศนิยมเกิน 2 ตำแหน่ง → precision (ไม่ปัดเงียบ) ยกเว้นศูนย์ต่อท้าย เช่น "1.500"
 */
export function parseSatang(raw: string | undefined): ParsedSatang {
  let t = (raw ?? "").trim().replace(/[\s,฿]/g, "").replace(/บาท$/, "").replace(/^THB/i, "");
  if (t === "" || t === "-") return { ok: false, reason: "empty" };
  let neg = false;
  const paren = t.match(/^\((.*)\)$/);
  if (paren) {
    neg = true;
    t = paren[1];
  }
  const m = t.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!m) return { ok: false, reason: "invalid" };
  if (m[1] === "-") neg = !neg;
  let frac = m[3] ?? "";
  frac = frac.replace(/0+$/, "");
  if (frac.length > 2) return { ok: false, reason: "precision" };
  const whole = m[2].replace(/^0+(?=\d)/, "");
  const value = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(value)) return { ok: false, reason: "invalid" };
  return { ok: true, value: (neg && value !== 0 ? -value : value) as Satang };
}

export function sumSatang(values: readonly number[]): Satang {
  let t = 0;
  for (const v of values) t += v;
  return satang(t);
}

/**
 * ปันส่วน total ตามน้ำหนัก ผลรวมเท่า total เสมอ
 * 1) ส่วนพื้นฐาน = floor(total × w / W) (คำนวณด้วย BigInt)
 * 2) เศษที่เหลือแจกทีละ 1 สตางค์ ให้รายการที่เศษส่วนมากที่สุด ถ้าเท่ากันเรียงตาม key
 * ยอดติดลบ: ปันส่วนค่าสัมบูรณ์แล้วใส่เครื่องหมายคืน · น้ำหนักรวม 0: แบ่งเท่ากัน
 */
export function allocate(total: number, weights: readonly number[], keys: readonly string[]): Satang[] {
  if (weights.length !== keys.length) throw new Error("weights/keys length mismatch");
  if (weights.length === 0) {
    if (total !== 0) throw new Error("ไม่มีรายการให้ปันส่วน");
    return [];
  }
  if (!Number.isSafeInteger(total)) throw new RangeError("total ต้องเป็นจำนวนเต็มสตางค์");
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) throw new RangeError("weights ต้องเป็นจำนวนเต็มไม่ติดลบ");
  const sign = total < 0 ? -1 : 1;
  const T = BigInt(Math.abs(total));
  let ws = weights.map((w) => BigInt(w));
  let W = ws.reduce((a, b) => a + b, B0);
  if (W === B0) {
    ws = ws.map(() => B1);
    W = BigInt(ws.length);
  }
  const base = ws.map((w) => (T * w) / W);
  const rem = ws.map((w) => (T * w) % W);
  let left = T - base.reduce((a, b) => a + b, B0);
  const order = ws
    .map((_, i) => i)
    .sort((a, b) => (rem[a] === rem[b] ? (keys[a] < keys[b] ? -1 : keys[a] > keys[b] ? 1 : a - b) : rem[a] > rem[b] ? -1 : 1));
  for (const i of order) {
    if (left === B0) break;
    base[i] += B1;
    left -= B1;
  }
  return base.map((b) => (sign * Number(b)) as Satang);
}
