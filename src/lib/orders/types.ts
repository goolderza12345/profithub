/**
 * โครงสร้างคำสั่งซื้อ (Phase 3) — จำนวนเงินทุกช่องเป็นจำนวนเต็มหน่วยสตางค์
 *
 * Order เก็บ "ข้อเท็จจริงจากไฟล์" แยกตามประเภท/ผู้รับภาระ
 * Sale (เดิม) เป็นผลการแปลงลง (projection) เพื่อให้สูตรกำไรเดิม (calcLine) ใช้ต่อได้โดยไม่แก้
 */
import type { IdentityStrength } from "./identity";

export const ORDER_STATUSES = ["pending_payment", "paid", "processing", "shipped", "completed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
/** unspecified = ไฟล์ไม่มีคอลัมน์สถานะ (นับเหมือนข้อมูลเดิม) */
export type OrderStatusValue = OrderStatus | "unspecified";

export const FEE_TYPES = ["commission", "transaction", "service", "shipping", "other"] as const;
export type FeeType = (typeof FEE_TYPES)[number];
export type FeeBreakdown = Record<FeeType, number>;

export const emptyFees = (): FeeBreakdown => ({ commission: 0, transaction: 0, service: 0, shipping: 0, other: 0 });

export interface OrderLine {
  lineKey: string;
  fingerprint: string;
  identity: IdentityStrength;
  /** Sale ที่เป็นผลการแปลงของบรรทัดนี้ */
  saleId: string;
  sourceSku: string;
  productName: string;
  quantity: number;
  /** ราคาก่อนส่วนลด × จำนวน */
  grossSatang: number;
  /** ส่วนลดที่ร้านรับภาระ (รวมส่วนของร้านในส่วนลดร่วม) */
  sellerDiscount: number;
  /** ส่วนลดที่แพลตฟอร์มสนับสนุน — ไม่หักจากรายได้ร้าน */
  platformSubsidy: number;
  /** ส่วนลดที่ไม่รู้ผู้รับภาระ — คิดแบบระมัดระวัง (ถือว่าร้านรับ) และแสดงช่วงค่า */
  unknownDiscount: number;
  /** เงินคืนลูกค้า แยกตามผู้รับภาระ */
  refundSeller: number;
  refundPlatform: number;
  refundUnknown: number;
  /** จำนวนชิ้น: คืนเข้าสต็อกขายต่อได้ / คืนแต่ชำรุด / ไม่ต้องส่งคืน */
  returnedResellable: number;
  returnedDamaged: number;
  notReturned: number;
  /** ค่าธรรมเนียมจากไฟล์คำสั่งซื้อ (ปันส่วนแล้ว) */
  fees: FeeBreakdown;
  feeRefunded: number;
  shippingRefunded: number;
  returnShippingCost: number;
  /** ผู้ใช้ยืนยันว่าบรรทัดนี้ถูกยกเลิก (บรรทัดหายจากไฟล์ใหม่) */
  cancelled?: boolean;
}

export interface Order {
  /** channel (ตัวพิมพ์เล็ก) | orderId */
  key: string;
  channel: string;
  orderId: string;
  orderDate: string;
  status: OrderStatusValue;
  /** สถานะตามไฟล์ (เก็บเสมอ) */
  rawStatus: string;
  /** เวลาอัปเดตตามไฟล์ ใช้กันข้อมูลเก่าทับข้อมูลใหม่ */
  sourceUpdatedAt?: string;
  lines: OrderLine[];
  /** checksum ของข้อเท็จจริง ใช้ตรวจการนำเข้าซ้ำที่ไม่มีอะไรเปลี่ยน */
  contentHash: string;
  revisionCount: number;
  firstBatchId: string;
  lastBatchId: string;
  createdAt: string;
  updatedAt: string;
}

export type RevisionKind = "create" | "update" | "adopt" | "settlement" | "user";

/** ประวัติการเปลี่ยนแปลง (เก็บเฉพาะช่องที่เปลี่ยน) */
export interface OrderRevision {
  /** autoIncrement */
  seq?: number;
  orderKey: string;
  batchId: string;
  appliedAt: string;
  kind: RevisionKind;
  changes: { path: string; from: unknown; to: unknown }[];
}

export interface SettlementReport {
  id: string;
  adapterId: string;
  fileName: string;
  fileHash: string;
  periodFrom?: string;
  periodTo?: string;
  importedAt: string;
  entryCount: number;
}

export type SettlementEntryType = FeeType | "fee_refund" | "payout" | "adjustment";

export interface SettlementEntry {
  /** id:<รหัสรายการ>:<ประเภท> หรือ fp:<ลายนิ้วมือ>#<ลำดับ> */
  entryKey: string;
  reportIds: string[];
  orderKey?: string;
  type: SettlementEntryType;
  /** สตางค์ มีเครื่องหมาย (+ = ร้านจ่าย สำหรับค่าธรรมเนียม, + = เงินเข้า สำหรับ payout) */
  amount: number;
  occurredAt: string;
  description: string;
  /** ค่าก่อนหน้า เมื่อรายงานใหม่กว่าปรับจำนวนเงินของรายการเดิม */
  history?: { amount: number; reportId: string }[];
}
