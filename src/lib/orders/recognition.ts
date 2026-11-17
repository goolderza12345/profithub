/**
 * เลือกรายการขายที่นับในกำไรตามสถานะคำสั่งซื้อ (ใช้ก่อนส่งให้ summarize / รายงานทุกแบบ)
 * รายการขายรุ่นเก่า (ไม่มี orderKey) นับเหมือนเดิมทุกประการ
 */
import type { Sale } from "../types";
import { recognitionOf } from "./status";
import type { Order } from "./types";

export interface RecognitionResult {
  recognized: Sale[];
  excludedPending: number;
  excludedCancelled: number;
  excludedCancelledLines: number;
  provisionalOrders: number;
}

export function selectRecognizedSales(sales: Sale[], orders: Order[]): RecognitionResult {
  const byKey = new Map(orders.map((o) => [o.key, o]));
  const out: RecognitionResult = { recognized: [], excludedPending: 0, excludedCancelled: 0, excludedCancelledLines: 0, provisionalOrders: 0 };
  const pending = new Set<string>();
  const cancelled = new Set<string>();
  for (const s of sales) {
    if (!s.orderKey) {
      out.recognized.push(s);
      continue;
    }
    const o = byKey.get(s.orderKey);
    if (!o) {
      // ไม่ควรเกิด (มีการตรวจความสัมพันธ์) — นับไว้เพื่อไม่ให้ยอดหายเงียบ ๆ
      out.recognized.push(s);
      continue;
    }
    const rec = recognitionOf(o.status);
    if (rec === "excluded") {
      (o.status === "cancelled" ? cancelled : pending).add(o.key);
      continue;
    }
    const line = o.lines.find((l) => l.saleId === s.id);
    if (line?.cancelled) {
      out.excludedCancelledLines++;
      continue;
    }
    out.recognized.push(s);
  }
  out.excludedPending = pending.size;
  out.excludedCancelled = cancelled.size;
  out.provisionalOrders = orders.filter((o) => recognitionOf(o.status) === "provisional").length;
  return out;
}
