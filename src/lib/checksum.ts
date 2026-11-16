/**
 * checksum แบบ cyrb53 (53-bit) สำหรับตรวจว่าไฟล์ Backup เสียหายหรือถูกแก้ไขโดยไม่ตั้งใจ
 * ไม่ใช่การเข้ารหัสหรือกันการปลอมแปลงโดยเจตนา (ใช้ได้ทั้งบน http และ https เพราะไม่พึ่ง crypto.subtle)
 */
export function checksum(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
