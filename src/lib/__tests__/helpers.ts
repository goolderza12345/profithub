import type { Expense, Product, Sale } from "../types";

export function sale(p: Partial<Sale> = {}): Sale {
  return {
    id: "s1",
    orderId: "O1",
    date: "2026-11-01",
    channel: "Shopee",
    sku: "A",
    quantity: 1,
    unitPrice: 100,
    discount: 0,
    refund: 0,
    returnedQty: 0,
    platformFee: 0,
    shippingFee: 0,
    dedupeKey: "k",
    batchId: "b",
    ...p,
  };
}

export function product(p: Partial<Product> = {}): Product {
  return { id: "p1", sku: "A", name: "สินค้า A", unitCost: 40, createdAt: "", updatedAt: "", ...p };
}

export function expense(p: Partial<Expense> = {}): Expense {
  return { id: "e1", date: "2026-11-01", category: "ads", amount: 0, channel: "", note: "", createdAt: "", ...p };
}
