import { TEMPLATE_HEADERS, type ImportFieldKey } from "../fields";
import type { ImportAdapter } from "./types";

/**
 * ไฟล์ทั่วไป: แม่แบบ ProfitHub (ทดสอบแล้ว) หรือไฟล์ใด ๆ ที่ผู้ใช้จับคู่คอลัมน์เอง
 */
export const genericAdapter: ImportAdapter = {
  id: "generic",
  label: "ไฟล์ทั่วไป / แม่แบบ ProfitHub",
  description: "CSV หรือ Excel รูปแบบใดก็ได้ — จับคู่คอลัมน์เองได้ทุกช่อง",
  channel: null,
  verified: true,
  supportNote: "แม่แบบ ProfitHub ทดสอบแล้ว ไฟล์รูปแบบอื่นต้องตรวจสอบการจับคู่คอลัมน์ก่อนนำเข้า",
  verifiedHeaders: Object.fromEntries(Object.entries(TEMPLATE_HEADERS).map(([k, v]) => [k, [v]])) as Partial<
    Record<ImportFieldKey, string[]>
  >,
  defaultScopes: {},
  tips: [
    "แต่ละแถว = สินค้า 1 รายการในคำสั่งซื้อ (1 SKU)",
    "ใช้ไฟล์ตัวอย่างเป็นแม่แบบ จะจับคู่คอลัมน์ได้อัตโนมัติทั้งหมด",
  ],
};
