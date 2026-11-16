import { makeDedupeKey } from "./csv";
import { addDays, toISODate } from "./dates";
import { round2 } from "./money";
import type { Snapshot } from "./db";
import type { Expense, ExpenseCategory, Product, Sale } from "./types";

/** สุ่มแบบกำหนด seed เพื่อให้ข้อมูล Demo เหมือนเดิมทุกครั้ง */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_PRODUCTS: { sku: string; name: string; unitCost: number; price: number; weight: number }[] = [
  { sku: "DEMO-TS-01", name: "[Demo] เสื้อยืดคอตตอน สีขาว", unitCost: 85, price: 199, weight: 5 },
  { sku: "DEMO-TS-02", name: "[Demo] เสื้อยืดคอตตอน สีดำ", unitCost: 85, price: 199, weight: 4 },
  { sku: "DEMO-MUG-01", name: "[Demo] แก้วเซรามิกสกรีนชื่อ", unitCost: 95, price: 259, weight: 3 },
  { sku: "DEMO-BAG-01", name: "[Demo] กระเป๋าผ้าแคนวาส", unitCost: 120, price: 290, weight: 3 },
  { sku: "DEMO-CASE-01", name: "[Demo] เคสโทรศัพท์ใส", unitCost: 35, price: 99, weight: 4 },
  { sku: "DEMO-SKN-01", name: "[Demo] เซรั่มบำรุงผิว 30 ml", unitCost: 180, price: 450, weight: 2 },
  // สินค้าตัวอย่างที่ขาดทุน: ต้นทุนสูง ขายลดราคา
  { sku: "DEMO-LAMP-01", name: "[Demo] โคมไฟตั้งโต๊ะ LED", unitCost: 310, price: 349, weight: 1 },
];

const CHANNELS = [
  { name: "Shopee", feeRate: 0.12, weight: 5, prefix: "SHP" },
  { name: "Lazada", feeRate: 0.11, weight: 3, prefix: "LZD" },
  { name: "TikTok Shop", feeRate: 0.1, weight: 3, prefix: "TTS" },
  { name: "LINE", feeRate: 0, weight: 1, prefix: "LINE" },
];

function pick<T extends { weight: number }>(items: T[], r: number): T {
  const total = items.reduce((a, i) => a + i.weight, 0);
  let x = r * total;
  for (const i of items) {
    x -= i.weight;
    if (x <= 0) return i;
  }
  return items[items.length - 1];
}

/** สร้างข้อมูลตัวอย่าง 90 วันย้อนหลังจากวันนี้ (ใช้กับฐานข้อมูล Demo เท่านั้น) */
export function generateDemoData(today: Date, days = 90): Snapshot {
  const rand = rng(20261116);
  const now = new Date().toISOString();
  const batchId = "demo-batch";
  const end = toISODate(today);
  const start = addDays(end, -(days - 1));

  const products: Product[] = DEMO_PRODUCTS.map((p, i) => ({
    id: `demo-product-${i + 1}`,
    sku: p.sku,
    name: p.name,
    unitCost: p.unitCost,
    createdAt: now,
    updatedAt: now,
  }));

  const sales: Sale[] = [];
  let orderNo = 1;
  for (let d = 0; d < days; d++) {
    const date = addDays(start, d);
    const weekday = new Date(date + "T00:00:00").getDay();
    const orders = 3 + Math.floor(rand() * 6) + (weekday === 0 || weekday === 6 ? 3 : 0);
    for (let o = 0; o < orders; o++) {
      const ch = pick(CHANNELS, rand());
      const orderId = `DEMO-${ch.prefix}-${String(orderNo++).padStart(5, "0")}`;
      const lineCount = rand() < 0.25 ? 2 : 1;
      const used = new Set<string>();
      for (let l = 0; l < lineCount; l++) {
        const p = pick(DEMO_PRODUCTS, rand());
        if (used.has(p.sku)) continue;
        used.add(p.sku);
        const quantity = 1 + (rand() < 0.3 ? Math.floor(rand() * 3) : 0);
        const unitPrice = p.price;
        const gross = unitPrice * quantity;
        const discount = rand() < 0.3 ? round2(gross * (p.sku === "DEMO-LAMP-01" ? 0.15 : 0.08)) : 0;
        const isReturn = rand() < 0.03;
        const refund = isReturn ? round2(gross - discount) : 0;
        const returnedQty = isReturn ? quantity : 0;
        const platformFee = round2((gross - discount) * ch.feeRate);
        const shippingFee = ch.name === "LINE" ? 40 : rand() < 0.2 ? 15 : 0;
        sales.push({
          id: `demo-sale-${sales.length + 1}`,
          orderId,
          date,
          channel: ch.name,
          sku: p.sku,
          quantity,
          unitPrice,
          discount,
          refund,
          returnedQty,
          platformFee,
          shippingFee,
          unitCost: p.unitCost,
          dedupeKey: makeDedupeKey(ch.name, orderId, p.sku),
          batchId,
        });
      }
    }
  }

  const expenses: Expense[] = [];
  const addExpense = (date: string, category: ExpenseCategory, amount: number, channel: string, note: string) =>
    expenses.push({
      id: `demo-expense-${expenses.length + 1}`,
      date,
      category,
      amount,
      channel,
      note: `[Demo] ${note}`,
      createdAt: now,
    });

  for (let d = 0; d < days; d += 7) {
    const date = addDays(start, d);
    addExpense(date, "ads", round2(600 + rand() * 500), "Shopee", "Shopee Ads รายสัปดาห์");
    addExpense(date, "ads", round2(400 + rand() * 400), "TikTok Shop", "TikTok Ads รายสัปดาห์");
  }
  for (let d = 0; d < days; d += 30) {
    const date = addDays(start, d);
    addExpense(date, "packaging", 850, "", "กล่องและเทปกาว");
    addExpense(date, "other", 299, "", "ค่าโปรแกรมพิมพ์ใบปะหน้า");
    addExpense(date, "platform_fee", 199, "LINE", "ค่าแพ็กเกจ LINE OA");
  }

  return {
    products,
    sales,
    expenses,
    batches: [{ id: batchId, fileName: "ข้อมูลตัวอย่าง (Demo)", importedAt: now, rowCount: sales.length }],
  };
}
