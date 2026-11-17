/** ตัวแปลงค่าจากไฟล์ที่ใช้ร่วมกันทุกรูปแบบไฟล์ */
import { toISODate } from "../dates";

const KNOWN_CHANNELS: Record<string, string> = {
  shopee: "Shopee",
  lazada: "Lazada",
  tiktok: "TikTok Shop",
  "tiktok shop": "TikTok Shop",
  tiktokshop: "TikTok Shop",
  line: "LINE",
  "line shopping": "LINE",
  "line oa": "LINE",
  facebook: "Facebook",
  fb: "Facebook",
  website: "Website",
  web: "Website",
};

export const CHANNEL_OPTIONS = ["Shopee", "Lazada", "TikTok Shop", "LINE", "Facebook", "Website"];

export function normalizeChannel(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  return KNOWN_CHANNELS[t.toLowerCase()] ?? t;
}

export function makeDedupeKey(channel: string, orderId: string, sku: string): string {
  return `${channel.trim().toLowerCase()}|${orderId.trim()}|${sku.trim().toUpperCase()}`;
}

/** แปลงตัวเลข: ตัดคอมมา ช่องว่าง และสัญลักษณ์ ฿ ; คืน null ถ้าไม่ใช่ตัวเลข */
export function parseAmount(raw: string | undefined): number | null | "empty" {
  const t = (raw ?? "").replace(/[,\s฿]/g, "").replace(/บาท$/, "");
  if (t === "") return "empty";
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** รับ YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, DD-MM-YYYY (ปี พ.ศ. แปลงอัตโนมัติ) และตัดเวลาทิ้ง */
export function parseDate(raw: string | undefined): string | null {
  const t = (raw ?? "").trim().split(/[ T]/)[0];
  let y: number, m: number, d: number;
  let match = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  if (y > 2400) y -= 543;
  if (y < 2000 || y > 2100) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return toISODate(dt);
}
