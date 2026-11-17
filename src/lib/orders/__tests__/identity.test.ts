import { describe, expect, it } from "vitest";
import { assignLineKeys, lineFingerprint, matchLines, syntheticSku, type MatchLine } from "../identity";

describe("lineFingerprint", () => {
  it("ใช้รหัสบรรทัดก่อน → SKU+ราคา → ชื่อ+ราคา", () => {
    expect(lineFingerprint({ lineId: "991", sourceSku: "A", productName: "x", unitPriceSatang: 100 })).toEqual({ fp: "pl:991", strength: "platform_line_id" });
    expect(lineFingerprint({ sourceSku: "a-1", productName: "x", unitPriceSatang: 19900 })).toEqual({ fp: "sku:A-1|p:19900", strength: "fingerprint" });
    expect(lineFingerprint({ sourceSku: "", productName: "  เสื้อ  สีขาว ", unitPriceSatang: 100 })).toEqual({ fp: "name:เสื้อ สีขาว|p:100", strength: "weak" });
  });

  it("SKU สังเคราะห์คงที่สำหรับชื่อเดียวกัน และผ่านรูปแบบ SKU", () => {
    expect(syntheticSku("เสื้อ สีขาว")).toBe(syntheticSku(" เสื้อ  สีขาว"));
    expect(syntheticSku("เสื้อ สีขาว")).toMatch(/^NOSKU-[0-9A-F]+$/);
    expect(syntheticSku("ก")).not.toBe(syntheticSku("ข"));
  });
});

describe("assignLineKeys", () => {
  it("ลายนิ้วมือเดียวกันหลายบรรทัด ได้ลำดับตามเนื้อหา ไม่ใช่ลำดับแถว", () => {
    const a = assignLineKeys([
      { fp: "sku:A|p:1", contentKey: "2|" },
      { fp: "sku:B|p:1", contentKey: "1|" },
      { fp: "sku:A|p:1", contentKey: "1|" },
    ]);
    expect(a).toEqual(["sku:A|p:1#2", "sku:B|p:1", "sku:A|p:1#1"]);
    const b = assignLineKeys([
      { fp: "sku:A|p:1", contentKey: "1|" },
      { fp: "sku:A|p:1", contentKey: "2|" },
      { fp: "sku:B|p:1", contentKey: "1|" },
    ]);
    expect(b).toEqual(["sku:A|p:1#1", "sku:A|p:1#2", "sku:B|p:1"]);
  });
});

describe("matchLines: ไม่จับคู่เดาเงียบ ๆ", () => {
  const L = (lineKey: string, fp = lineKey.split("#")[0], strength: MatchLine["strength"] = "fingerprint"): MatchLine => ({ lineKey, fp, strength });
  const same = () => true;

  it("บรรทัดเดิม เพิ่ม และหาย", () => {
    const r = matchLines([L("sku:A|p:1"), L("sku:B|p:1")], [L("sku:B|p:1"), L("sku:C|p:1")], same);
    expect(r.pairs).toEqual([[1, 0]]);
    expect(r.removed).toEqual([0]);
    expect(r.added).toEqual([1]);
    expect(r.ambiguous).toEqual([]);
  });

  it("SKU เปลี่ยน (ไม่มีรหัสบรรทัด) → เห็นเป็นหาย+เพิ่ม ให้ผู้ใช้ตัดสิน", () => {
    const r = matchLines([L("sku:OLD|p:1")], [L("sku:NEW|p:1")], same);
    expect(r).toMatchObject({ pairs: [], removed: [0], added: [0] });
  });

  it("SKU เดียวกันหลายบรรทัด: ชุดเหมือนเดิม → จับคู่ได้ / เนื้อหาเปลี่ยน → กำกวม", () => {
    const ex = [L("sku:A|p:1#1"), L("sku:A|p:1#2")];
    expect(matchLines(ex, [L("sku:A|p:1#2"), L("sku:A|p:1#1")], same).pairs).toEqual([
      [0, 1],
      [1, 0],
    ]);
    const amb = matchLines(ex, [L("sku:A|p:1#1"), L("sku:A|p:1#2")], () => false);
    expect(amb.ambiguous).toEqual([{ fp: "sku:A|p:1", existing: [0, 1], incoming: [0, 1] }]);
    const fewer = matchLines(ex, [L("sku:A|p:1")], same);
    expect(fewer.ambiguous).toHaveLength(1);
  });

  it("มีรหัสบรรทัด: จับคู่ได้แม้ SKU หรือลำดับเปลี่ยน", () => {
    const r = matchLines([L("pl:1", "pl:1", "platform_line_id"), L("pl:2", "pl:2", "platform_line_id")], [L("pl:2", "pl:2", "platform_line_id"), L("pl:1", "pl:1", "platform_line_id")], same);
    expect(r.pairs).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });
});
