import type { DateRange } from "./types";

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return toISODate(dt);
}

export function inRange(date: string, range: DateRange): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

/** วันที่ทุกวันระหว่าง from ถึง to (รวมปลายทั้งสอง) */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard < 3700) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

export type RangePreset =
  | "7d"
  | "30d"
  | "90d"
  | "this_month"
  | "last_month"
  | "all"
  | "custom";

export const PRESET_LABELS: Record<RangePreset, string> = {
  "7d": "7 วันล่าสุด",
  "30d": "30 วันล่าสุด",
  "90d": "90 วันล่าสุด",
  this_month: "เดือนนี้",
  last_month: "เดือนที่แล้ว",
  all: "ทั้งหมด",
  custom: "กำหนดเอง",
};

export function presetRange(preset: Exclude<RangePreset, "custom">, today: Date): DateRange {
  const t = toISODate(today);
  switch (preset) {
    case "7d":
      return { from: addDays(t, -6), to: t };
    case "30d":
      return { from: addDays(t, -29), to: t };
    case "90d":
      return { from: addDays(t, -89), to: t };
    case "this_month":
      return { from: t.slice(0, 8) + "01", to: t };
    case "last_month": {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: toISODate(first), to: toISODate(last) };
    }
    case "all":
      return { from: null, to: null };
  }
}

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** 2026-11-05 → 5 พ.ย. 69 */
export function formatThaiDate(iso: string, withYear = true): string {
  const [y, m, d] = iso.split("-").map(Number);
  const be = (y + 543) % 100;
  return withYear ? `${d} ${TH_MONTHS[m - 1]} ${String(be).padStart(2, "0")}` : `${d} ${TH_MONTHS[m - 1]}`;
}
