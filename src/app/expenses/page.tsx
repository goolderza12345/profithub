import type { Metadata } from "next";
import { ExpensesView } from "@/components/views/expenses";

export const metadata: Metadata = { title: "ค่าใช้จ่าย" };

export default function Page() {
  return <ExpensesView />;
}
