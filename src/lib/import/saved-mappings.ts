"use client";
/**
 * จำการจับคู่คอลัมน์ที่ผู้ใช้ยืนยันแล้ว (เก็บใน localStorage ของเบราว์เซอร์นี้ ตามชุดหัวตาราง)
 * ไม่ใช่ข้อมูลธุรกิจ จึงไม่อยู่ใน IndexedDB/Backup
 */
import type { ImportFieldKey } from "./fields";
import type { MappingOptions } from "./mapping";

export interface SavedMapping {
  columns: Partial<Record<ImportFieldKey, string[]>>;
  options: MappingOptions;
  savedAt: string;
}

const key = (fingerprint: string) => `profithub:mapping:${fingerprint}`;

export function loadSavedMapping(fingerprint: string): SavedMapping | null {
  try {
    const v = localStorage.getItem(key(fingerprint));
    return v ? (JSON.parse(v) as SavedMapping) : null;
  } catch {
    return null;
  }
}

export function saveMapping(fingerprint: string, m: SavedMapping) {
  try {
    localStorage.setItem(key(fingerprint), JSON.stringify(m));
  } catch {
    /* เก็บไม่ได้ก็ใช้งานต่อได้ */
  }
}
