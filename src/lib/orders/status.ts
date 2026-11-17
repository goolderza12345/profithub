/**
 * สถานะคำสั่งซื้อกลาง และกติกาการนับเป็นยอดขาย (อนุมัติแล้ว Phase 3)
 *
 * | สถานะ                         | นับในกำไร | หมายเหตุ                           |
 * | pending_payment               | ไม่นับ     | รอชำระ                             |
 * | cancelled                     | ไม่นับ     | ยกเลิก                             |
 * | paid / processing / shipped   | นับ        | กำไรโดยประมาณ (ค่าธรรมเนียมอาจยังไม่สิ้นสุด) |
 * | completed                     | นับ        | สุดท้าย                            |
 * | unspecified (ไฟล์ไม่มีสถานะ)  | นับ        | เหมือนข้อมูลเดิม                   |
 */
import { ORDER_STATUSES, type OrderStatus, type OrderStatusValue } from "./types";

export const STATUS_LABELS: Record<OrderStatusValue, string> = {
  pending_payment: "รอชำระเงิน",
  paid: "ชำระแล้ว",
  processing: "กำลังเตรียมสินค้า",
  shipped: "จัดส่งแล้ว",
  completed: "สำเร็จ",
  cancelled: "ยกเลิก",
  unspecified: "ไม่ระบุสถานะ",
};

export type Recognition = "excluded" | "provisional" | "final" | "unspecified";

export function recognitionOf(status: OrderStatusValue): Recognition {
  switch (status) {
    case "pending_payment":
    case "cancelled":
      return "excluded";
    case "paid":
    case "processing":
    case "shipped":
      return "provisional";
    case "completed":
      return "final";
    case "unspecified":
      return "unspecified";
  }
}

const RANK: Record<Exclude<OrderStatus, "cancelled">, number> = {
  pending_payment: 0,
  paid: 1,
  processing: 2,
  shipped: 3,
  completed: 4,
};

/**
 * อ่านสถานะจากไฟล์เฉพาะคำที่เป็นรูปแบบของ ProfitHub เอง (คีย์ภาษาอังกฤษหรือชื่อภาษาไทยข้างบน)
 * สถานะของแพลตฟอร์มอื่น ๆ ต้องให้ผู้ใช้จับคู่ หรือยืนยันใน adapter ก่อน — ไม่เดา
 */
export function statusFromToken(raw: string): OrderStatus | null {
  const t = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((ORDER_STATUSES as readonly string[]).includes(t)) return t as OrderStatus;
  const th = (Object.entries(STATUS_LABELS) as [OrderStatusValue, string][]).find(([, label]) => label === raw.trim());
  return th && th[0] !== "unspecified" ? (th[0] as OrderStatus) : null;
}

export type TransitionCheck = "newer" | "same" | "stale" | "conflict";

/**
 * ข้อมูลใหม่ทับข้อมูลเดิมได้หรือไม่
 * - มีเวลาอัปเดตทั้งสองฝั่ง: ใช้เวลา (ใหม่กว่า = newer, เก่ากว่า = stale) แต่ถ้าสถานะถอยหลัง = conflict
 * - ไม่มีเวลา: ใช้ลำดับสถานะ ถอยหลัง = stale, ออกจาก/เข้าสู่ "ยกเลิก" แบบไม่ชัดเจน = conflict
 */
export function checkTransition(
  from: { status: OrderStatusValue; sourceUpdatedAt?: string },
  to: { status: OrderStatusValue; sourceUpdatedAt?: string },
): TransitionCheck {
  const regress = statusRegresses(from.status, to.status);
  if (from.sourceUpdatedAt && to.sourceUpdatedAt) {
    if (to.sourceUpdatedAt < from.sourceUpdatedAt) return "stale";
    if (to.sourceUpdatedAt === from.sourceUpdatedAt) return from.status === to.status ? "same" : "conflict";
    return regress ? "conflict" : "newer";
  }
  if (from.status === to.status) return "same";
  if (regress === "stale") return "stale";
  return regress ? "conflict" : "newer";
}

/** null = ไปข้างหน้าหรือเท่าเดิม, "stale" = ถอยหลังตามลำดับปกติ, "conflict" = เกี่ยวกับการยกเลิก/ไม่ระบุ */
function statusRegresses(from: OrderStatusValue, to: OrderStatusValue): null | "stale" | "conflict" {
  if (from === to) return null;
  if (from === "unspecified" || to === "unspecified") return from === "unspecified" ? null : "conflict";
  if (from === "cancelled") return "conflict";
  if (to === "cancelled") return from === "completed" ? "conflict" : null;
  return RANK[to] < RANK[from] ? "stale" : null;
}
