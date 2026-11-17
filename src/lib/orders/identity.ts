/**
 * ระบุตัวตนของบรรทัดสินค้าในคำสั่งซื้อ โดยไม่ใช้ลำดับแถวของไฟล์
 *
 * 1) มีรหัสบรรทัดจากแพลตฟอร์ม → "pl:<id>" (แน่นอน)
 * 2) มี SKU → ลายนิ้วมือ "sku:<SKU>|p:<ราคาต่อชิ้นเป็นสตางค์>" (ไม่รวมจำนวน จึงจับคู่ได้แม้จำนวนเปลี่ยน)
 * 3) ไม่มี SKU → "name:<ชื่อ>|p:<ราคา>" (ตัวตนอ่อน ต้องให้ผู้ใช้ยืนยันเมื่อมีความต่าง)
 * บรรทัดที่ลายนิ้วมือซ้ำในออเดอร์เดียว จะได้ลำดับ #1..#n ตามเนื้อหา (ไม่ใช่ลำดับแถว)
 */
import { checksum } from "../checksum";

export type IdentityStrength = "platform_line_id" | "fingerprint" | "weak";

export interface LineIdentityInput {
  lineId?: string;
  sourceSku: string;
  productName: string;
  unitPriceSatang: number;
}

export interface LineFingerprint {
  fp: string;
  strength: IdentityStrength;
}

const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

export function lineFingerprint(x: LineIdentityInput): LineFingerprint {
  if (x.lineId?.trim()) return { fp: `pl:${x.lineId.trim()}`, strength: "platform_line_id" };
  if (x.sourceSku) return { fp: `sku:${x.sourceSku.toUpperCase()}|p:${x.unitPriceSatang}`, strength: "fingerprint" };
  return { fp: `name:${norm(x.productName)}|p:${x.unitPriceSatang}`, strength: "weak" };
}

/** SKU สังเคราะห์สำหรับสินค้าที่ไม่มี SKU ในไฟล์ (คงที่ทุกไฟล์สำหรับชื่อเดียวกัน) */
export function syntheticSku(productName: string): string {
  return `NOSKU-${checksum(norm(productName)).toUpperCase()}`;
}

/**
 * กำหนด lineKey ให้บรรทัดในออเดอร์เดียวกัน
 * @param contentKey ข้อความที่ใช้เรียงบรรทัดที่ลายนิ้วมือซ้ำ (เช่น จำนวน|ยอดเงิน) — ห้ามใช้เลขแถว
 */
export function assignLineKeys(lines: { fp: string; contentKey: string }[]): string[] {
  const groups = new Map<string, number[]>();
  lines.forEach((l, i) => groups.set(l.fp, [...(groups.get(l.fp) ?? []), i]));
  const out = new Array<string>(lines.length);
  for (const [fp, idx] of groups) {
    if (idx.length === 1) {
      out[idx[0]] = fp;
      continue;
    }
    const sorted = [...idx].sort((a, b) => (lines[a].contentKey < lines[b].contentKey ? -1 : lines[a].contentKey > lines[b].contentKey ? 1 : a - b));
    sorted.forEach((i, n) => (out[i] = `${fp}#${n + 1}`));
  }
  return out;
}

export interface MatchLine {
  lineKey: string;
  fp: string;
  strength: IdentityStrength;
}

export interface LineMatch {
  /** คู่ที่จับได้แน่นอน: [index เดิม, index ใหม่] */
  pairs: [number, number][];
  added: number[];
  removed: number[];
  /** บรรทัดที่จับคู่ไม่ได้อย่างแน่นอน (ลายนิ้วมือซ้ำแต่จำนวนต่างกัน หรือเป็นตัวตนอ่อน) → ผู้ใช้ต้องตัดสิน */
  ambiguous: { fp: string; existing: number[]; incoming: number[] }[];
}

/**
 * จับคู่บรรทัดเดิมกับบรรทัดใหม่ของออเดอร์เดียวกันด้วยลายนิ้วมือ ไม่จับคู่เดาเงียบ ๆ
 * กลุ่มลายนิ้วมือที่มีหลายบรรทัด จับคู่ได้เฉพาะเมื่อจำนวนบรรทัดเท่ากันและเนื้อหาเรียงได้ตรงกัน (sameContent)
 */
export function matchLines(
  existing: MatchLine[],
  incoming: MatchLine[],
  sameContent: (existingIdx: number, incomingIdx: number) => boolean,
): LineMatch {
  const byFp = (ls: MatchLine[]) => {
    const m = new Map<string, number[]>();
    ls.forEach((l, i) => m.set(l.fp, [...(m.get(l.fp) ?? []), i]));
    return m;
  };
  const ex = byFp(existing);
  const inc = byFp(incoming);
  const res: LineMatch = { pairs: [], added: [], removed: [], ambiguous: [] };
  for (const [fp, ei] of ex) {
    const ii = inc.get(fp);
    if (!ii) {
      res.removed.push(...ei);
      continue;
    }
    if (ei.length === 1 && ii.length === 1) {
      res.pairs.push([ei[0], ii[0]]);
      continue;
    }
    // หลายบรรทัดที่ลายนิ้วมือเดียวกัน: จับคู่ได้เฉพาะเมื่อชุดเนื้อหาเหมือนกันทุกบรรทัด
    const eKeys = ei.map((i) => existing[i].lineKey).sort();
    const iKeys = ii.map((i) => incoming[i].lineKey).sort();
    const sameSet = eKeys.length === iKeys.length && eKeys.every((k, n) => k === iKeys[n]);
    if (sameSet) {
      const pairs = eKeys.map((k) => [ei.find((i) => existing[i].lineKey === k)!, ii.find((i) => incoming[i].lineKey === k)!] as [number, number]);
      if (pairs.every(([a, b]) => sameContent(a, b))) {
        res.pairs.push(...pairs);
        continue;
      }
    }
    res.ambiguous.push({ fp, existing: ei, incoming: ii });
  }
  for (const [fp, ii] of inc) if (!ex.has(fp)) res.added.push(...ii);
  return res;
}
