import type { Metadata } from "next";
import { OrdersView } from "@/components/views/orders";

export const metadata: Metadata = { title: "คำสั่งซื้อ" };

export default function Page() {
  return <OrdersView />;
}
