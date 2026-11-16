import type { Metadata } from "next";
import { SettingsView } from "@/components/views/settings";

export const metadata: Metadata = { title: "สำรองและตั้งค่าข้อมูล" };

export default function Page() {
  return <SettingsView />;
}
