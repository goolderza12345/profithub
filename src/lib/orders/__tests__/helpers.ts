import { emptyFees, type Order, type OrderLine } from "../types";

export const T0 = "2026-11-01T00:00:00.000Z";

export function line(p: Partial<OrderLine> = {}): OrderLine {
  return {
    lineKey: "sku:A|p:10000",
    fingerprint: "sku:A|p:10000",
    identity: "fingerprint",
    saleId: "s1",
    sourceSku: "A",
    productName: "สินค้า A",
    quantity: 1,
    grossSatang: 10000,
    sellerDiscount: 0,
    platformSubsidy: 0,
    unknownDiscount: 0,
    refundSeller: 0,
    refundPlatform: 0,
    refundUnknown: 0,
    returnedResellable: 0,
    returnedDamaged: 0,
    notReturned: 0,
    fees: emptyFees(),
    feeRefunded: 0,
    shippingRefunded: 0,
    returnShippingCost: 0,
    ...p,
  };
}

export function order(p: Partial<Order> = {}): Order {
  return {
    key: "shopee|O1",
    channel: "Shopee",
    orderId: "O1",
    orderDate: "2026-11-01",
    status: "completed",
    rawStatus: "completed",
    lines: [line()],
    contentHash: "h1",
    revisionCount: 1,
    firstBatchId: "b1",
    lastBatchId: "b1",
    createdAt: T0,
    updatedAt: T0,
    ...p,
  };
}
