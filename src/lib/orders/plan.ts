/**
 * Order Update Engine — สร้าง "แผนการเปลี่ยนแปลง" จากไฟล์ที่ตรวจแล้ว โดยไม่เขียนฐานข้อมูล
 *
 * ประเภทของแต่ละคำสั่งซื้อในไฟล์:
 *  new        ยังไม่มีในระบบ
 *  adopt      มีเป็นรายการขายรุ่นเก่า (ก่อน v1.3) → ผูกเข้าคำสั่งซื้อ โดยคงต้นทุน ณ วันนำเข้าเดิม
 *  update     มีอยู่แล้ว ข้อมูลใหม่กว่า และจับคู่บรรทัดได้ครบ
 *  unchanged  ข้อมูลเหมือนเดิมทุกอย่าง (นำเข้าไฟล์เดิมซ้ำ)
 *  stale      ข้อมูลในไฟล์เก่ากว่าข้อมูลในระบบ → ไม่บันทึกทับ
 *  conflict   บรรทัดหาย/กำกวม/SKU เปลี่ยน/สถานะขัดแย้ง → ผู้ใช้ต้องเลือก (ค่าเริ่มต้น: ข้าม)
 *
 * กติกาที่ต้องรักษา: unitCost ของบรรทัดเดิมไม่เปลี่ยน, ไม่ลบรายการขายเดิม (บรรทัดที่หายถูกทำเครื่องหมายยกเลิก)
 */
import { checksum } from "../checksum";
import { makeDedupeKey } from "../import/parse";
import { fromBaht } from "../money/satang";
import type { OptionalSaleField, Sale } from "../types";
import { assignLineKeys, matchLines, type IdentityStrength, type MatchLine } from "./identity";
import { factsForHash, projectLine } from "./project";
import { checkTransition, STATUS_LABELS } from "./status";
import { emptyFees, type FeeBreakdown, type Order, type OrderLine, type OrderStatusValue, type RevisionKind } from "./types";

/** บรรทัดที่ผ่านการตรวจแล้วจากไฟล์ (ไม่ขึ้นกับรูปแบบไฟล์) */
export interface IncomingLine {
  channel: string;
  orderId: string;
  orderDate: string;
  status: OrderStatusValue;
  rawStatus: string;
  sourceUpdatedAt?: string;
  facts: Omit<OrderLine, "saleId">;
  /** SKU ของสินค้าในระบบที่จับคู่แล้ว และต้นทุนปัจจุบัน (ใช้เฉพาะบรรทัดใหม่) */
  productSku: string;
  productCost: number;
  /** ราคาก่อนลดต่อชิ้น (บาท) สำหรับ Sale.unitPrice */
  unitPrice: number;
  missingFields: OptionalSaleField[];
}

export type PlanKind = "new" | "adopt" | "update" | "unchanged" | "stale" | "conflict";

export interface PlanChange {
  lineKey?: string;
  field: string;
  from: unknown;
  to: unknown;
}

export interface PlannedOrder {
  key: string;
  channel: string;
  orderId: string;
  kind: PlanKind;
  reasons: string[];
  changes: PlanChange[];
  /** บันทึกได้หรือไม่ (stale/unchanged = ไม่ได้, conflict = ได้เมื่อผู้ใช้เลือก) */
  applicable: boolean;
  /** ค่าเริ่มต้นของการตัดสินใจ */
  apply: boolean;
  revisionKind: RevisionKind;
  order: Order;
  /** รายการขายที่จะเพิ่มหรือแก้ (id ขึ้นต้น "new:" = เพิ่มใหม่) */
  sales: Sale[];
}

export interface OrderPlan {
  orders: PlannedOrder[];
  counts: Record<PlanKind, number>;
}

export interface PlanContext {
  orders: Map<string, Order>;
  sales: Sale[];
  batchId: string;
  now: string;
  /** ค่าธรรมเนียมจากรายงานการเงิน (ปันส่วนต่อบรรทัดแล้ว) ถ้ามี */
  settlementFees?: (order: Order) => FeeBreakdown[] | null;
}

export const orderKeyOf = (channel: string, orderId: string) => `${channel.trim().toLowerCase()}|${orderId.trim()}`;

const skuFingerprint = (sku: string, unitPriceSatang: number) => `sku:${sku.toUpperCase()}|p:${unitPriceSatang}`;

/** สร้างข้อเท็จจริงของบรรทัดจากรายการขายรุ่นเก่า (สำหรับเทียบตอนผูกเข้าคำสั่งซื้อ) */
export function factsFromLegacySale(s: Sale, lineKey: string): Omit<OrderLine, "saleId"> {
  const fees = emptyFees();
  fees.other = fromBaht(s.platformFee);
  fees.shipping = fromBaht(s.shippingFee);
  const sourceSku = (s.sourceSku ?? s.sku).toUpperCase();
  const fp = skuFingerprint(sourceSku, fromBaht(s.unitPrice));
  return {
    lineKey,
    fingerprint: fp,
    identity: "fingerprint",
    sourceSku,
    productName: "",
    quantity: s.quantity,
    grossSatang: fromBaht(Math.round(s.unitPrice * s.quantity * 100) / 100),
    sellerDiscount: fromBaht(s.discount),
    platformSubsidy: 0,
    unknownDiscount: 0,
    refundSeller: fromBaht(s.refund),
    refundPlatform: 0,
    refundUnknown: 0,
    returnedResellable: s.returnedQty,
    returnedDamaged: 0,
    notReturned: 0,
    fees,
    feeRefunded: 0,
    shippingRefunded: 0,
    returnShippingCost: 0,
  };
}

export function contentHashOf(o: Parameters<typeof factsForHash>[0]): string {
  return checksum(JSON.stringify(factsForHash(o)));
}

const SALE_FIELDS = ["quantity", "unitPrice", "discount", "refund", "returnedQty", "platformFee", "shippingFee"] as const;
const FIELD_LABEL: Record<string, string> = {
  quantity: "จำนวน",
  unitPrice: "ราคาต่อชิ้น",
  discount: "ส่วนลดที่ร้านรับภาระ",
  refund: "เงินคืนที่ร้านรับภาระ",
  returnedQty: "ชิ้นที่คืนเข้าสต็อก",
  platformFee: "ค่าธรรมเนียม",
  shippingFee: "ค่าขนส่ง",
  status: "สถานะ",
};
export const changeLabel = (field: string) => FIELD_LABEL[field] ?? field;

export function buildOrderPlan(incoming: IncomingLine[], ctx: PlanContext): OrderPlan {
  const groups = new Map<string, IncomingLine[]>();
  for (const l of incoming) {
    const k = orderKeyOf(l.channel, l.orderId);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const takenKeys = new Set(ctx.sales.map((s) => s.dedupeKey));
  const legacyByOrder = new Map<string, Sale[]>();
  for (const s of ctx.sales) {
    if (s.orderKey) continue;
    const k = s.dedupeKey.split("|").slice(0, 2).join("|");
    legacyByOrder.set(k, [...(legacyByOrder.get(k) ?? []), s]);
  }
  const salesById = new Map(ctx.sales.map((s) => [s.id, s]));
  let newId = 0;

  const nextDedupe = (channel: string, orderId: string, sku: string) => {
    const base = makeDedupeKey(channel, orderId, sku);
    let key = base;
    for (let n = 2; takenKeys.has(key); n++) key = `${base}#${n}`;
    takenKeys.add(key);
    return key;
  };

  const plans: PlannedOrder[] = [];
  for (const [key, lines] of groups) {
    const head = lines[0];
    const reasons: string[] = [];
    // ข้อมูลระดับคำสั่งซื้อต้องตรงกันทุกบรรทัด
    if (new Set(lines.map((l) => l.status)).size > 1) reasons.push("แต่ละบรรทัดในไฟล์มีสถานะไม่เหมือนกัน");
    if (new Set(lines.map((l) => l.orderDate)).size > 1) reasons.push("แต่ละบรรทัดในไฟล์มีวันที่สั่งซื้อไม่เหมือนกัน");

    const incomingOrder: Order = {
      key,
      channel: head.channel,
      orderId: head.orderId,
      orderDate: head.orderDate,
      status: head.status,
      rawStatus: head.rawStatus,
      ...(head.sourceUpdatedAt ? { sourceUpdatedAt: head.sourceUpdatedAt } : {}),
      lines: lines.map((l) => ({ ...l.facts, saleId: "" })),
      contentHash: "",
      revisionCount: 1,
      firstBatchId: ctx.batchId,
      lastBatchId: ctx.batchId,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    incomingOrder.contentHash = contentHashOf(incomingOrder);
    const existing = ctx.orders.get(key);
    const legacy = existing ? [] : legacyByOrder.get(key) ?? [];

    const plan: PlannedOrder = {
      key,
      channel: head.channel,
      orderId: head.orderId,
      kind: "new",
      reasons,
      changes: [],
      applicable: true,
      apply: true,
      revisionKind: "create",
      order: incomingOrder,
      sales: [],
    };

    const saleFor = (l: IncomingLine, line: OrderLine, base: Sale | null, order: Order, feeOverride?: FeeBreakdown): Sale => {
      const p = projectLine(line, order, feeOverride ?? line.fees, !!feeOverride);
      const s: Sale = {
        id: base?.id ?? `new:${++newId}`,
        orderId: order.orderId,
        date: order.orderDate,
        channel: order.channel,
        sku: base?.sku ?? l.productSku,
        sourceSku: line.sourceSku,
        quantity: line.quantity,
        unitPrice: l.unitPrice,
        discount: p.discount,
        refund: p.refund,
        returnedQty: p.returnedQty,
        platformFee: p.platformFee,
        shippingFee: p.shippingFee,
        missingFields: [...l.missingFields],
        orderKey: order.key,
        lineKey: line.lineKey,
        estimateReasons: p.estimateReasons,
        estimateUpside: p.estimateUpside,
        dedupeKey: base?.dedupeKey ?? nextDedupe(order.channel, order.orderId, line.sourceSku),
        batchId: base?.batchId ?? ctx.batchId,
      };
      // ต้นทุน ณ วันนำเข้าเดิมไม่เปลี่ยน (บรรทัดใหม่ใช้ต้นทุนปัจจุบัน และจะอ่านซ้ำจากฐานข้อมูลตอนบันทึก)
      if (base) {
        if (base.unitCost !== undefined) s.unitCost = base.unitCost;
      } else s.unitCost = l.productCost;
      return s;
    };

    const diff = (before: Sale | null, after: Sale, lineKey: string) => {
      for (const f of SALE_FIELDS) {
        const a = before ? before[f] : undefined;
        if (a !== after[f]) plan.changes.push({ lineKey, field: f, from: a ?? null, to: after[f] });
      }
    };

    if (!existing && legacy.length === 0) {
      // คำสั่งซื้อใหม่
      plan.kind = "new";
      const fees = ctx.settlementFees?.(incomingOrder) ?? null;
      incomingOrder.lines.forEach((line, i) => {
        const s = saleFor(lines[i], line, null, incomingOrder, fees?.[i]);
        line.saleId = s.id;
        plan.sales.push(s);
      });
    } else {
      // เทียบกับข้อมูลเดิม (คำสั่งซื้อ หรือรายการขายรุ่นเก่า)
      const before: { lines: Omit<OrderLine, "saleId">[]; saleIds: string[]; status: OrderStatusValue; sourceUpdatedAt?: string } = existing
        ? { lines: existing.lines, saleIds: existing.lines.map((l) => l.saleId), status: existing.status, sourceUpdatedAt: existing.sourceUpdatedAt }
        : (() => {
            const keys = assignLineKeys(
              legacy.map((s) => ({ fp: skuFingerprint(s.sourceSku ?? s.sku, fromBaht(s.unitPrice)), contentKey: `${s.quantity}|${s.unitPrice}` })),
            );
            return { lines: legacy.map((s, i) => factsFromLegacySale(s, keys[i])), saleIds: legacy.map((s) => s.id), status: "unspecified" as const };
          })();

      if (existing && existing.contentHash === incomingOrder.contentHash) {
        plan.kind = "unchanged";
        plan.applicable = false;
        plan.apply = false;
        plans.push(plan);
        continue;
      }

      const t = existing ? checkTransition(existing, incomingOrder) : "newer";
      if (t === "stale") {
        plan.kind = "stale";
        plan.applicable = false;
        plan.apply = false;
        plan.reasons.push(
          existing?.sourceUpdatedAt && incomingOrder.sourceUpdatedAt
            ? `ข้อมูลในไฟล์ (${incomingOrder.sourceUpdatedAt}) เก่ากว่าข้อมูลในระบบ (${existing.sourceUpdatedAt})`
            : `สถานะในไฟล์ “${STATUS_LABELS[incomingOrder.status]}” ย้อนหลังจากสถานะในระบบ “${STATUS_LABELS[existing!.status]}”`,
        );
        plans.push(plan);
        continue;
      }
      if (t === "conflict") plan.reasons.push(`สถานะเปลี่ยนจาก “${STATUS_LABELS[before.status]}” เป็น “${STATUS_LABELS[incomingOrder.status]}” ซึ่งไม่ใช่ลำดับปกติ`);

      // จับคู่บรรทัด: คำสั่งซื้อเดิมใช้ลายนิ้วมือหลัก, ข้อมูลรุ่นเก่าใช้ SKU + ราคา
      const exLines: MatchLine[] = before.lines.map((l) => ({ lineKey: l.lineKey, fp: l.fingerprint, strength: l.identity as IdentityStrength }));
      const inLines: MatchLine[] = existing
        ? incomingOrder.lines.map((l) => ({ lineKey: l.lineKey, fp: l.fingerprint, strength: l.identity }))
        : (() => {
            // ข้อมูลรุ่นเก่ามีแค่ SKU + ราคา จึงเทียบด้วยลายนิ้วมือแบบเดียวกันทั้งสองฝั่ง
            const fps = lines.map((l) => skuFingerprint(l.facts.sourceSku, fromBaht(l.unitPrice)));
            const keys = assignLineKeys(lines.map((l, i) => ({ fp: fps[i], contentKey: `${l.facts.quantity}|${l.unitPrice}` })));
            return lines.map((_, i) => ({ lineKey: keys[i], fp: fps[i], strength: "fingerprint" as const }));
          })();
      // บรรทัด SKU ซ้ำในกลุ่มเดียวกัน จับคู่ได้เมื่อจำนวนชิ้นเท่าเดิม (ไม่เช่นนั้นถือว่ากำกวม)
      const m = matchLines(exLines, inLines, (a, b) => before.lines[a].quantity === incomingOrder.lines[b].quantity);
      if (m.removed.length) plan.reasons.push(`มี ${m.removed.length} บรรทัดในระบบที่ไม่อยู่ในไฟล์นี้ (จะถูกทำเครื่องหมายยกเลิก ไม่ลบ)`);
      if (m.ambiguous.length) plan.reasons.push("มี SKU เดียวกันหลายบรรทัดที่จับคู่กับข้อมูลเดิมไม่ได้อย่างแน่นอน");
      for (const [a, b] of m.pairs) {
        if (before.lines[a].sourceSku !== incomingOrder.lines[b].sourceSku) {
          plan.reasons.push(`SKU ของบรรทัดเปลี่ยนจาก ${before.lines[a].sourceSku} เป็น ${incomingOrder.lines[b].sourceSku}`);
        }
      }

      const resultLines: OrderLine[] = [];
      const fees = ctx.settlementFees?.(incomingOrder) ?? null;
      const handledIncoming = new Set<number>();
      const pairList: [number, number][] = [...m.pairs];
      // กลุ่มกำกวม: ถ้าผู้ใช้เลือกบันทึก จับคู่ตามลำดับ lineKey (SKU เดียวกัน จึงใช้ต้นทุนเดิมของกลุ่ม)
      for (const g of m.ambiguous) {
        const ex = [...g.existing].sort((x, y) => (before.lines[x].lineKey < before.lines[y].lineKey ? -1 : 1));
        const inc = [...g.incoming].sort((x, y) => (incomingOrder.lines[x].lineKey < incomingOrder.lines[y].lineKey ? -1 : 1));
        inc.forEach((b, n) => {
          if (n < ex.length) pairList.push([ex[n], b]);
        });
        ex.slice(inc.length).forEach((a) => m.removed.push(a));
        inc.slice(ex.length).forEach((b) => m.added.push(b));
      }
      for (const [a, b] of pairList) {
        handledIncoming.add(b);
        const base = salesById.get(before.saleIds[a]) ?? null;
        const line: OrderLine = { ...incomingOrder.lines[b], saleId: before.saleIds[a] };
        const s = saleFor(lines[b], line, base, incomingOrder, fees?.[b]);
        diff(base, s, line.lineKey);
        resultLines.push(line);
        plan.sales.push(s);
      }
      for (const b of m.added) {
        handledIncoming.add(b);
        const line: OrderLine = { ...incomingOrder.lines[b], saleId: "" };
        const s = saleFor(lines[b], line, null, incomingOrder, fees?.[b]);
        line.saleId = s.id;
        plan.changes.push({ lineKey: line.lineKey, field: "เพิ่มบรรทัด", from: null, to: `${line.sourceSku} × ${line.quantity}` });
        resultLines.push(line);
        plan.sales.push(s);
      }
      for (const a of m.removed) {
        const old = before.lines[a];
        resultLines.push({ ...old, saleId: before.saleIds[a], cancelled: true });
        plan.changes.push({ lineKey: old.lineKey, field: "ยกเลิกบรรทัด", from: `${old.sourceSku} × ${old.quantity}`, to: null });
      }
      if (before.status !== incomingOrder.status) plan.changes.push({ field: "status", from: before.status, to: incomingOrder.status });

      plan.order = {
        ...incomingOrder,
        lines: resultLines,
        revisionCount: (existing?.revisionCount ?? 0) + 1,
        firstBatchId: existing?.firstBatchId ?? ctx.batchId,
        createdAt: existing?.createdAt ?? ctx.now,
      };
      plan.order.contentHash = contentHashOf({ ...incomingOrder, lines: incomingOrder.lines });
      plan.kind = existing ? "update" : "adopt";
      plan.revisionKind = existing ? "update" : "adopt";
      if (plan.reasons.length) {
        plan.kind = "conflict";
        plan.apply = false;
      }
    }
    if (plan.kind === "new" && plan.reasons.length) {
      plan.kind = "conflict";
      plan.apply = false;
    }
    plans.push(plan);
  }

  const counts: Record<PlanKind, number> = { new: 0, adopt: 0, update: 0, unchanged: 0, stale: 0, conflict: 0 };
  for (const p of plans) counts[p.kind]++;
  return { orders: plans, counts };
}

export const PLAN_LABELS: Record<PlanKind, string> = {
  new: "ใหม่",
  adopt: "ผูกข้อมูลเดิม",
  update: "อัปเดต",
  unchanged: "ไม่เปลี่ยน",
  stale: "ข้อมูลเก่ากว่า",
  conflict: "ขัดแย้ง",
};
