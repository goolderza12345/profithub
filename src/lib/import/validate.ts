/**
 * ตรวจข้อมูลทุกแถวก่อนนำเข้า (ไม่เขียนฐานข้อมูล)
 *
 * ลำดับการตรวจของแต่ละแถว:
 *  1. แปลงค่าและตรวจรูปแบบ (ข้อผิดพลาด → "error")
 *  2. ตรวจรายการซ้ำกับฐานข้อมูลและภายในไฟล์ (→ "duplicate")
 *  3. จับคู่ SKU กับสินค้า (ไม่พบ → "unmapped" รอผู้ใช้เลือก)
 *  4. ค่าระดับคำสั่งซื้อ: ตรวจว่าเท่ากันทุกบรรทัด แล้วปันส่วนตามยอดขาย เพื่อไม่ให้หักซ้ำ
 */
import type { SaleDraft } from "../csv";
import { round2 } from "../money";
import { calcLine } from "../profit";
import { OPTIONAL_SALE_FIELDS, type OptionalSaleField, type Product, type SkuAlias } from "../types";
import { LIMITS, validateSku } from "../validation";
import { FIELD_BY_KEY, SCOPEABLE_FIELDS, type ImportFieldKey, type ScopeableField } from "./fields";
import type { ColumnMapping, MappingOptions } from "./mapping";
import { makeDedupeKey, normalizeChannel, parseAmount, parseDate } from "./parse";
import type { Table } from "./table";
import { allocate, fromBaht, toBaht } from "../money/satang";
import { assignLineKeys, lineFingerprint, type IdentityStrength } from "../orders/identity";

export type SkuDecision =
  | { kind: "product"; productId: string }
  | { kind: "new"; sku: string; name: string; unitCost: number };

export interface ImportContext {
  products: Product[];
  aliases: SkuAlias[];
  /** dedupeKey ของรายการขายที่มีอยู่แล้วในฐานข้อมูล */
  existingKeys: Set<string>;
  /** การจับคู่ SKU ที่ผู้ใช้เลือกในขั้นตอนนี้ (key = SKU ในไฟล์ ตัวพิมพ์ใหญ่) */
  skuDecisions: Record<string, SkuDecision>;
}

export type ImportRowStatus = "ok" | "error" | "duplicate" | "unmapped";

export interface ResolvedProduct {
  id: string | null;
  sku: string;
  name: string;
  unitCost: number;
  isNew: boolean;
  via: "sku" | "alias" | "picked" | "new";
}

export interface RowValues {
  quantity: number;
  unitPrice: number;
  grossSales: number;
  discount: number;
  refund: number;
  returnedQty: number;
  platformFee: number;
  shippingFee: number;
}

export interface PreviewRow {
  rowNumber: number;
  status: ImportRowStatus;
  errors: string[];
  orderId: string;
  date: string | null;
  channel: string;
  sourceSku: string;
  productName: string;
  product: ResolvedProduct | null;
  values: RowValues;
  netRevenue: number;
  /** กำไรโดยประมาณของบรรทัด (ก่อนหักค่าใช้จ่ายที่บันทึกเอง) ใช้ต้นทุนปัจจุบัน */
  estProfit: number | null;
  dedupeKey: string;
  /** ตัวตนของบรรทัดในออเดอร์ (ไม่ขึ้นกับลำดับแถว) — ใช้ปันส่วนและจับคู่การอัปเดต */
  lineKey: string;
  fingerprint: string;
  identity: IdentityStrength;
  draft?: SaleDraft;
  cells: string[];
}

export interface UnmappedSku {
  sku: string;
  rows: number;
  sampleName: string;
}

export interface OrderLevelHint {
  field: ScopeableField;
  /** จำนวนคำสั่งซื้อหลายบรรทัดที่ค่าช่องนี้เท่ากันทุกบรรทัด (และไม่เป็นศูนย์) */
  repeatedOrders: number;
  multiLineOrders: number;
}

export interface ImportPreview {
  fileErrors: string[];
  rows: PreviewRow[];
  counts: Record<ImportRowStatus, number> & { total: number };
  unmappedSkus: UnmappedSku[];
  /** ช่องที่ไฟล์ไม่มีข้อมูล (บันทึกเป็น 0 แต่ระบุว่า "ไม่มีข้อมูล") */
  missingFields: OptionalSaleField[];
  orderLevelHints: OrderLevelHint[];
  totals: { lines: number; grossSales: number; netRevenue: number; cogs: number; orderFees: number; estProfit: number };
  /** สินค้าใหม่ที่ผู้ใช้เลือกให้สร้าง และใช้ในรายการที่นำเข้าได้ */
  newProducts: { sku: string; name: string; unitCost: number }[];
  /** SKU ในไฟล์ที่ผู้ใช้จับคู่กับสินค้าเดิม (จะจำไว้ใช้ครั้งต่อไป) */
  aliasesToSave: { alias: string; productId: string }[];
}

const isScientific = (s: string) => /^[+-]?\d+(\.\d+)?e[+-]?\d+$/i.test(s.trim());

export function decisionErrors(sourceSku: string, d: SkuDecision, ctx: Pick<ImportContext, "products">): string[] {
  if (d.kind === "product") {
    return ctx.products.some((p) => p.id === d.productId) ? [] : ["ไม่พบสินค้าที่เลือก"];
  }
  const e: string[] = [];
  const skuErr = validateSku(d.sku);
  if (skuErr) e.push(skuErr);
  if (ctx.products.some((p) => p.sku.toUpperCase() === d.sku.toUpperCase())) e.push(`SKU "${d.sku}" มีอยู่แล้วในระบบ — เลือกสินค้านั้นแทน`);
  if (!d.name.trim()) e.push("กรุณาระบุชื่อสินค้า");
  else if (d.name.trim().length > LIMITS.nameLength) e.push(`ชื่อสินค้ายาวเกิน ${LIMITS.nameLength} ตัวอักษร`);
  if (!Number.isFinite(d.unitCost) || d.unitCost < 0 || d.unitCost > LIMITS.maxAmount) e.push("ต้นทุนต่อชิ้นไม่ถูกต้อง");
  if (sourceSku !== d.sku.toUpperCase()) e.push("SKU ของสินค้าใหม่ต้องตรงกับ SKU ในไฟล์");
  return e;
}

function resolveProduct(sourceSku: string, ctx: ImportContext): ResolvedProduct | null {
  const bySku = ctx.products.find((p) => p.sku.toUpperCase() === sourceSku);
  if (bySku) return { id: bySku.id, sku: bySku.sku, name: bySku.name, unitCost: bySku.unitCost, isNew: false, via: "sku" };
  const alias = ctx.aliases.find((a) => a.alias === sourceSku);
  const aliased = alias && ctx.products.find((p) => p.id === alias.productId);
  if (aliased) return { id: aliased.id, sku: aliased.sku, name: aliased.name, unitCost: aliased.unitCost, isNew: false, via: "alias" };
  const d = ctx.skuDecisions[sourceSku];
  if (!d || decisionErrors(sourceSku, d, ctx).length) return null;
  if (d.kind === "product") {
    const p = ctx.products.find((x) => x.id === d.productId)!;
    return { id: p.id, sku: p.sku, name: p.name, unitCost: p.unitCost, isNew: false, via: "picked" };
  }
  return { id: null, sku: d.sku.toUpperCase(), name: d.name.trim(), unitCost: round2(d.unitCost), isNew: true, via: "new" };
}

export function validateImport(table: Table, mapping: ColumnMapping, options: MappingOptions, ctx: ImportContext): ImportPreview {
  const fileErrors: string[] = [];
  if (table.rows.length === 0) fileErrors.push("ไฟล์ไม่มีข้อมูล");
  if (table.rows.length > LIMITS.maxCsvRows) {
    fileErrors.push(`ไฟล์มี ${table.rows.length} แถว เกินขีดจำกัด ${LIMITS.maxCsvRows} แถวต่อไฟล์ กรุณาแบ่งไฟล์`);
  }
  const has = (k: ImportFieldKey) => (mapping[k]?.length ?? 0) > 0;
  const missingFields = OPTIONAL_SALE_FIELDS.filter((f) => {
    const key = (Object.keys(FIELD_BY_KEY) as ImportFieldKey[]).find((k) => FIELD_BY_KEY[k].optionalField === f)!;
    return !has(key);
  });
  const empty: ImportPreview = {
    fileErrors,
    rows: [],
    counts: { total: 0, ok: 0, error: 0, duplicate: 0, unmapped: 0 },
    unmappedSkus: [],
    missingFields,
    orderLevelHints: [],
    totals: { lines: 0, grossSales: 0, netRevenue: 0, cogs: 0, orderFees: 0, estProfit: 0 },
    newProducts: [],
    aliasesToSave: [],
  };
  if (fileErrors.length) return empty;

  const header = (k: ImportFieldKey) => (mapping[k] ?? []).map((c) => table.headers[c]).join(" + ");
  const seenInFile = new Map<string, number>();

  const rows: PreviewRow[] = table.rows.map((dr) => {
    const errors: string[] = [];
    if (dr.issue) errors.push(dr.issue);
    const cell = (k: ImportFieldKey) => (mapping[k] ?? []).map((c) => (dr.cells[c] ?? "").trim());
    const text = (k: ImportFieldKey) => cell(k)[0] ?? "";

    // เลขคำสั่งซื้อ
    const orderId = text("orderId");
    if (!orderId) errors.push(`ไม่มีเลขคำสั่งซื้อ (คอลัมน์ “${header("orderId")}”)`);
    else if (isScientific(orderId)) errors.push(`เลขคำสั่งซื้อ "${orderId}" ถูกบันทึกเป็นตัวเลขแบบย่อ (ข้อมูลอาจไม่ครบ) — ตั้งรูปแบบคอลัมน์ใน Excel เป็นข้อความแล้วส่งออกใหม่`);
    else if (orderId.length > LIMITS.orderIdLength) errors.push(`เลขคำสั่งซื้อยาวเกิน ${LIMITS.orderIdLength} ตัวอักษร`);

    // วันที่
    const rawDate = text("orderDate");
    const date = parseDate(rawDate);
    if (!date) errors.push(`วันที่ไม่ถูกต้อง "${rawDate}" (ใช้ YYYY-MM-DD หรือ DD/MM/YYYY)`);

    // ช่องทาง
    const channel = has("channel") ? normalizeChannel(text("channel")) : (options.fixedChannel ?? "").trim();
    if (!channel) errors.push("ไม่มีช่องทางขาย (channel)");
    else if (channel.length > LIMITS.channelLength) errors.push(`ช่องทางขายยาวเกิน ${LIMITS.channelLength} ตัวอักษร`);

    // SKU
    const sourceSku = text("sku").toUpperCase();
    if (!sourceSku) errors.push("ไม่มี SKU");
    else {
      const e = validateSku(sourceSku);
      if (e) errors.push(e);
    }

    // ตัวเลข
    const num = (k: ImportFieldKey, required: boolean): number => {
      const f = FIELD_BY_KEY[k];
      const cells = cell(k);
      if (!cells.length) return 0;
      let total = 0;
      let anyValue = false;
      for (const c of cells) {
        const v = parseAmount(c);
        if (v === "empty") continue;
        anyValue = true;
        if (v === null) {
          errors.push(`${f.label}ไม่ใช่ตัวเลข "${c}"`);
          continue;
        }
        let val = v;
        if (val < 0) {
          if (f.deduction && options.negativeAsDeduction) val = -val;
          else {
            errors.push(`${f.label}ต้องไม่ติดลบ`);
            continue;
          }
        }
        if (val > (f.kind === "int" ? LIMITS.maxQuantity : LIMITS.maxAmount)) errors.push(`${f.label}สูงผิดปกติ (${c})`);
        if (f.kind === "int" && !Number.isInteger(val)) errors.push(`${f.label}ต้องเป็นจำนวนเต็ม`);
        total += val;
      }
      if (!anyValue && required) errors.push(`ไม่มี${f.label} (คอลัมน์ “${header(k)}”)`);
      return round2(total);
    };

    const quantity = num("quantity", true);
    if (cell("quantity").length && parseAmount(cell("quantity")[0]) === 0) errors.push("จำนวนชิ้นต้องมากกว่า 0");
    let unitPrice: number;
    if (has("unitPrice")) unitPrice = num("unitPrice", true);
    else {
      const lineTotal = num("lineTotal", true);
      unitPrice = quantity > 0 ? lineTotal / quantity : 0;
    }
    const v: RowValues = {
      quantity,
      unitPrice,
      grossSales: round2(unitPrice * quantity),
      discount: num("discount", false),
      refund: num("refund", false),
      returnedQty: num("returnedQty", false),
      platformFee: num("platformFee", false),
      shippingFee: num("shippingFee", false),
    };
    const lineScoped = (f: ScopeableField) => options.scopes[f] === "line";
    if (lineScoped("discount") && v.discount > v.grossSales + 0.001) errors.push("ส่วนลดมากกว่ายอดขายของบรรทัด");
    if (lineScoped("discount") && lineScoped("refund") && v.discount + v.refund > v.grossSales + 0.001) {
      errors.push("ส่วนลดรวมเงินคืนมากกว่ายอดขายของบรรทัด");
    }
    if (v.returnedQty > v.quantity) errors.push("ชิ้นที่ได้รับคืนมากกว่าจำนวนชิ้นที่ขาย");

    const dedupeKey = makeDedupeKey(channel, orderId, sourceSku);
    let status: ImportRowStatus = errors.length ? "error" : "ok";
    if (status === "ok") {
      if (ctx.existingKeys.has(dedupeKey)) {
        status = "duplicate";
        errors.push("รายการนี้ถูกนำเข้าแล้ว (ช่องทาง + เลขคำสั่งซื้อ + SKU ซ้ำ)");
      } else if (seenInFile.has(dedupeKey)) {
        status = "duplicate";
        errors.push(`ซ้ำกับแถว ${seenInFile.get(dedupeKey)} ในไฟล์นี้ (หากเป็นสินค้าเดียวกัน ให้รวมจำนวนเป็นแถวเดียว)`);
      } else {
        seenInFile.set(dedupeKey, dr.rowNumber);
      }
    }

    const product = sourceSku ? resolveProduct(sourceSku, ctx) : null;
    if (status === "ok" && !product) {
      status = "unmapped";
      errors.push(`รอจับคู่ SKU "${sourceSku}" กับสินค้าในระบบ`);
    }

    return {
      rowNumber: dr.rowNumber,
      status,
      errors,
      orderId,
      date,
      channel,
      sourceSku,
      productName: text("productName"),
      product,
      values: v,
      netRevenue: 0,
      estProfit: null,
      dedupeKey,
      lineKey: "",
      ...(() => {
        const f = lineFingerprint({ sourceSku, productName: text("productName"), unitPriceSatang: fromBaht(v.unitPrice) });
        return { fingerprint: f.fp, identity: f.strength };
      })(),
      cells: dr.cells,
    };
  });

  assignKeys(rows);
  applyOrderLevel(rows, options);

  // สร้างรายการที่พร้อมบันทึก
  for (const r of rows) {
    const v = r.values;
    r.netRevenue = round2(v.grossSales - v.discount - v.refund);
    if (r.status !== "ok" || !r.product) continue;
    const draft: SaleDraft = {
      orderId: r.orderId,
      date: r.date!,
      channel: r.channel,
      sku: r.product.sku.toUpperCase(),
      sourceSku: r.sourceSku,
      quantity: v.quantity,
      unitPrice: v.unitPrice,
      discount: v.discount,
      refund: v.refund,
      returnedQty: v.returnedQty,
      platformFee: v.platformFee,
      shippingFee: v.shippingFee,
      unitCost: r.product.unitCost,
      missingFields: [...missingFields],
      dedupeKey: r.dedupeKey,
    };
    r.draft = draft;
    r.estProfit = calcLine({ ...draft, id: "", batchId: "" }, undefined).lineProfit;
  }

  const counts = { total: rows.length, ok: 0, error: 0, duplicate: 0, unmapped: 0 };
  for (const r of rows) counts[r.status]++;

  const unmapped = new Map<string, UnmappedSku>();
  for (const r of rows) {
    if (!r.sourceSku || validateSku(r.sourceSku) || r.product) continue;
    if (r.status === "duplicate") continue;
    const u = unmapped.get(r.sourceSku) ?? { sku: r.sourceSku, rows: 0, sampleName: r.productName };
    u.rows++;
    if (!u.sampleName && r.productName) u.sampleName = r.productName;
    unmapped.set(r.sourceSku, u);
  }

  const okRows = rows.filter((r) => r.status === "ok" && r.draft);
  const lines = okRows.map((r) => calcLine({ ...r.draft!, id: "", batchId: "" }, undefined));
  const sumOf = (f: (l: (typeof lines)[number]) => number) => round2(lines.reduce((a, l) => a + f(l), 0));

  const newProducts = new Map<string, { sku: string; name: string; unitCost: number }>();
  const aliases = new Map<string, string>();
  for (const r of okRows) {
    const p = r.product!;
    if (p.isNew) newProducts.set(p.sku, { sku: p.sku, name: p.name, unitCost: p.unitCost });
    if (p.via === "picked" && p.id) aliases.set(r.sourceSku, p.id);
  }

  return {
    fileErrors: [],
    rows,
    counts,
    unmappedSkus: [...unmapped.values()].sort((a, b) => b.rows - a.rows),
    missingFields,
    orderLevelHints: detectOrderLevel(rows, mapping, options),
    totals: {
      lines: okRows.length,
      grossSales: sumOf((l) => l.grossSales),
      netRevenue: sumOf((l) => l.netRevenue),
      cogs: sumOf((l) => l.cogs),
      orderFees: sumOf((l) => l.orderFees),
      estProfit: sumOf((l) => l.lineProfit),
    },
    newProducts: [...newProducts.values()],
    aliasesToSave: [...aliases].map(([alias, productId]) => ({ alias, productId })),
  };
}

const orderKey = (r: PreviewRow) => `${r.channel.toLowerCase()}|${r.orderId}`;

/** กำหนด lineKey ต่อออเดอร์ บรรทัดที่ลายนิ้วมือซ้ำเรียงตามเนื้อหา ไม่ใช่ลำดับแถว */
function assignKeys(rows: PreviewRow[]) {
  const groups = new Map<string, PreviewRow[]>();
  for (const r of rows) groups.set(orderKey(r), [...(groups.get(orderKey(r)) ?? []), r]);
  for (const g of groups.values()) {
    const keys = assignLineKeys(
      g.map((r) => ({ fp: r.fingerprint, contentKey: `${r.values.quantity}|${fromBaht(r.values.grossSales)}|${r.cells.join("\u0001")}` })),
    );
    g.forEach((r, i) => (r.lineKey = keys[i]));
  }
}

/**
 * ช่องที่ผู้ใช้ระบุว่าเป็น "ค่าของทั้งคำสั่งซื้อ" (ไฟล์แสดงซ้ำทุกบรรทัด)
 * - ทุกบรรทัดของคำสั่งซื้อต้องมีค่าเท่ากัน
 * - ถ้าบางบรรทัดนำเข้าไม่ได้ จะไม่นำเข้าทั้งคำสั่งซื้อ (กันหักซ้ำ/หักไม่ครบเมื่อนำเข้าภายหลัง)
 * - ปันส่วนตามสัดส่วนยอดขายของแต่ละบรรทัด ผลรวมเท่าค่าเดิมพอดี
 */
function applyOrderLevel(rows: PreviewRow[], options: MappingOptions) {
  const orderFields = SCOPEABLE_FIELDS.filter((f) => options.scopes[f] === "order");
  if (!orderFields.length) return;
  const groups = new Map<string, PreviewRow[]>();
  for (const r of rows) {
    if (!r.orderId || !r.channel) continue;
    const k = orderKey(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const group of groups.values()) {
    const blocking = group.filter((r) => r.status !== "ok" && r.status !== "unmapped");
    const fail = (msg: string) => {
      for (const r of group) {
        if (r.status === "ok" || r.status === "unmapped") {
          r.status = "error";
          r.errors.push(msg);
        }
      }
    };
    if (blocking.length && blocking.length < group.length) {
      fail(
        `บางบรรทัดของคำสั่งซื้อนี้นำเข้าไม่ได้ (แถว ${blocking.map((r) => r.rowNumber).join(", ")}) — ไม่นำเข้าทั้งคำสั่งซื้อ เพื่อไม่ให้ค่าระดับคำสั่งซื้อถูกหักซ้ำหรือหักไม่ครบ`,
      );
      continue;
    }
    if (blocking.length) continue;
    for (const f of orderFields) {
      const values = [...new Set(group.map((r) => r.values[f]))];
      if (values.length > 1) {
        fail(`“${FIELD_BY_KEY[f].label}” ถูกตั้งเป็นค่าของทั้งคำสั่งซื้อ แต่แต่ละบรรทัดมีค่าไม่เท่ากัน (${values.join(", ")})`);
      }
    }
    if (group.some((r) => r.status === "error")) continue;
    // ปันส่วนเป็นสตางค์ด้วยวิธีเศษเหลือมากสุด เรียงตาม lineKey (ไม่ขึ้นกับลำดับแถว)
    const gross = group.map((r) => fromBaht(r.values.grossSales));
    const totalGross = group.reduce((a, r) => a + r.values.grossSales, 0);
    const keys = group.map((r) => r.lineKey);
    for (const f of orderFields) {
      const shares = allocate(fromBaht(group[0].values[f]), gross, keys);
      group.forEach((r, i) => (r.values[f] = toBaht(shares[i])));
    }
    const discount = group.reduce((a, r) => a + r.values.discount, 0);
    const refund = group.reduce((a, r) => a + r.values.refund, 0);
    if (discount + refund > totalGross + 0.001) fail("ส่วนลดรวมเงินคืนมากกว่ายอดขายของคำสั่งซื้อ");
  }
}

/** ค้นหาช่องเงินที่น่าจะเป็นค่าระดับคำสั่งซื้อ (ค่าเท่ากันทุกบรรทัดในคำสั่งซื้อหลายบรรทัด) */
function detectOrderLevel(rows: PreviewRow[], mapping: ColumnMapping, options: MappingOptions): OrderLevelHint[] {
  const groups = new Map<string, PreviewRow[]>();
  for (const r of rows) {
    if (!r.orderId || !r.channel || r.status === "error") continue;
    groups.set(orderKey(r), [...(groups.get(orderKey(r)) ?? []), r]);
  }
  const multi = [...groups.values()].filter((g) => g.length > 1);
  const hints: OrderLevelHint[] = [];
  for (const f of SCOPEABLE_FIELDS) {
    if (options.scopes[f] !== "line" || !(mapping[f]?.length)) continue;
    const withValue = multi.filter((g) => g.some((r) => r.values[f] !== 0));
    const repeated = withValue.filter((g) => g.every((r) => r.values[f] === g[0].values[f]));
    if (repeated.length > 0 && repeated.length === withValue.length) {
      hints.push({ field: f, repeatedOrders: repeated.length, multiLineOrders: multi.length });
    }
  }
  return hints;
}
