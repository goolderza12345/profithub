import type { Metadata } from "next";
import { ProductsView } from "@/components/views/products";

export const metadata: Metadata = { title: "สินค้า" };

export default function Page() {
  return <ProductsView />;
}
