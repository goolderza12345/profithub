import type { Metadata } from "next";
import { ImportView } from "@/components/views/import";

export const metadata: Metadata = { title: "นำเข้ายอดขาย" };

export default function Page() {
  return <ImportView />;
}
