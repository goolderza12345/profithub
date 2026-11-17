/**
 * แปลงข้อเท็จจริงของบรรทัดคำสั่งซื้อ (สตางค์) ลงช่องเดิมของ Sale (บาท)
 * เพื่อให้สูตรกำไรเดิม calcLine ใช้ต่อได้โดยไม่แก้
 *
 *   Sale.discount     = ส่วนลดที่ร้านรับภาระ + ส่วนลดที่ไม่รู้ผู้รับภาระ (คิดแบบระมัดระวัง)
 *   Sale.refund       = เงินคืนที่ร้านรับภาระ + เงินคืนที่ไม่รู้ผู้รับภาระ
 *   Sale.returnedQty  = ชิ้นที่คืนเข้าสต็อกและขายต่อได้เท่านั้น (คืนเงิน ≠ คืนสินค้า)
 *   Sale.platformFee  = ค่าคอมมิชชัน + ธุรกรรม + บริการ + อื่น ๆ − ค่าธรรมเนียมที่ได้คืน
 *   Sale.shippingFee  = ค่าส่งที่ร้านจ่าย − ค่าส่งที่ได้คืน + ค่าส่งสินค้าคืน
 * ส่วนลดที่แพลตฟอร์มสนับสนุน และเงินคืนที่แพลตฟอร์มรับภาระ ไม่กระทบรายได้ร้าน
 */
import type { EstimateReason } from "../types";
import { toBaht } from "../money/satang";
import { recognitionOf } from "./status";
import type { FeeBreakdown, Order, OrderLine } from "./types";

export interface ProjectedSale {
  discount: number;
  refund: number;
  returnedQty: number;
  platformFee: number;
  shippingFee: number;
  estimateReasons: EstimateReason[];
  estimateUpside: number;
}

export interface LineFactProblem {
  message: string;
}

/** ตรวจความสอดคล้องของบรรทัด (ก่อนบันทึก) */
export function lineFactErrors(l: OrderLine): string[] {
  const e: string[] = [];
  const sellerRevenue = l.grossSatang - l.sellerDiscount - l.unknownDiscount;
  if (sellerRevenue < 0) e.push("ส่วนลดที่ร้านรับภาระมากกว่ายอดขายของบรรทัด");
  if (l.sellerDiscount + l.unknownDiscount + l.platformSubsidy > l.grossSatang) e.push("ส่วนลดรวมทุกประเภทมากกว่ายอดขายของบรรทัด");
  if (l.refundSeller + l.refundUnknown > Math.max(0, sellerRevenue)) e.push("เงินคืนที่ร้านรับภาระมากกว่ารายได้ของร้านในบรรทัดนี้");
  if (l.returnedResellable + l.returnedDamaged + l.notReturned > l.quantity) e.push("จำนวนชิ้นที่คืน (ขายต่อได้ + ชำรุด + ไม่ต้องส่งคืน) มากกว่าจำนวนที่ขาย");
  const platformFees = l.fees.commission + l.fees.transaction + l.fees.service + l.fees.other;
  if (l.feeRefunded > platformFees) e.push("ค่าธรรมเนียมที่ได้คืนมากกว่าค่าธรรมเนียมที่ถูกเก็บ");
  if (l.shippingRefunded > l.fees.shipping) e.push("ค่าส่งที่ได้คืนมากกว่าค่าส่งที่ร้านจ่าย");
  return e;
}

/**
 * @param fees ค่าธรรมเนียมที่ใช้คำนวณ (จากรายงานการเงินถ้ามี มิฉะนั้นจากไฟล์คำสั่งซื้อ)
 * @param feesFinal ค่าธรรมเนียมมาจากรายงานการเงิน (ถือเป็นยอดสุดท้าย)
 */
export function projectLine(
  l: OrderLine,
  order: Pick<Order, "status">,
  fees: FeeBreakdown = l.fees,
  feesFinal = false,
  /** รายงานการเงินมีค่าธรรมเนียมที่ได้คืนแล้ว → ไม่หักค่าที่ได้คืนจากไฟล์คำสั่งซื้อซ้ำ */
  ignoreLineFeeRefund = false,
): ProjectedSale {
  const reasons: EstimateReason[] = [];
  if (l.unknownDiscount > 0) reasons.push("unknown_discount_funding");
  if (l.refundUnknown > 0) reasons.push("unknown_refund_funding");
  if (recognitionOf(order.status) === "provisional" && !feesFinal) reasons.push("provisional_status");
  const platformFee = fees.commission + fees.transaction + fees.service + fees.other - (ignoreLineFeeRefund ? 0 : l.feeRefunded);
  const shippingFee = fees.shipping - l.shippingRefunded + l.returnShippingCost;
  return {
    discount: toBaht(l.sellerDiscount + l.unknownDiscount),
    refund: toBaht(l.refundSeller + l.refundUnknown),
    returnedQty: l.returnedResellable,
    platformFee: toBaht(Math.max(0, platformFee)),
    shippingFee: toBaht(Math.max(0, shippingFee)),
    estimateReasons: reasons,
    estimateUpside: toBaht(l.unknownDiscount + l.refundUnknown),
  };
}

/** ข้อมูลที่ไม่ต้องเทียบเมื่อหาว่ามีการเปลี่ยนแปลงหรือไม่ */
export function factsForHash(o: Pick<Order, "status" | "rawStatus" | "sourceUpdatedAt" | "orderDate" | "lines">) {
  return {
    status: o.status,
    rawStatus: o.rawStatus,
    sourceUpdatedAt: o.sourceUpdatedAt ?? null,
    orderDate: o.orderDate,
    lines: [...o.lines]
      .sort((a, b) => (a.lineKey < b.lineKey ? -1 : 1))
      .map((l) => {
        const rest: Partial<OrderLine> = { ...l };
        delete rest.saleId;
        return rest;
      }),
  };
}
