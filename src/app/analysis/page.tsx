import type { Metadata } from "next";
import { AnalysisView } from "@/components/views/analysis";

export const metadata: Metadata = { title: "วิเคราะห์กำไร" };

export default function Page() {
  return <AnalysisView />;
}
