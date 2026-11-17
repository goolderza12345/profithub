import type { AmountScope, ImportFieldKey, ScopeableField } from "../fields";

export type AdapterId = "generic" | "shopee" | "tiktok" | "lazada";

/**
 * รูปแบบไฟล์ของแต่ละแหล่งข้อมูล
 *
 * กติกา: ห้ามใส่ชื่อคอลัมน์ใน verifiedHeaders จนกว่าจะทดสอบกับไฟล์ส่งออกจริงของแพลตฟอร์มนั้น
 * และต้องมีไฟล์ตัวอย่าง (ลบข้อมูลส่วนตัวแล้ว) พร้อม unit test ใน src/lib/import/__tests__
 */
export interface ImportAdapter {
  id: AdapterId;
  label: string;
  description: string;
  /** ช่องทางขายของทั้งไฟล์ (null = อ่านจากคอลัมน์ หรือให้ผู้ใช้เลือก) */
  channel: string | null;
  /** ทดสอบกับไฟล์จริงแล้วหรือยัง */
  verified: boolean;
  /** ข้อความสถานะการรองรับที่แสดงให้ผู้ใช้เห็น */
  supportNote: string;
  /** ชื่อหัวคอลัมน์ที่ยืนยันแล้วจากไฟล์จริง (ว่าง = ยังไม่ยืนยัน ต้องให้ผู้ใช้ตรวจการจับคู่เอง) */
  verifiedHeaders: Partial<Record<ImportFieldKey, string[]>>;
  /** ค่าเริ่มต้นว่าช่องเงินเป็นค่าต่อบรรทัดหรือต่อคำสั่งซื้อ (ไม่ระบุ = ต่อบรรทัด และให้ผู้ใช้ตรวจ) */
  defaultScopes: Partial<Record<ScopeableField, AmountScope>>;
  /** คำแนะนำทั่วไปในการเตรียมไฟล์ */
  tips: string[];
}
