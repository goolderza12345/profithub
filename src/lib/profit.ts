/**
 * สูตรคำนวณกำไรของ ProfitHub
 *
 * แต่ละจำนวนเงินมีแหล่งที่มาเดียว จึงถูกหักเพียงครั้งเดียว:
 *
 *   ยอดขายก่อนหัก (grossSales)  = ราคาต่อชิ้น × จำนวนชิ้น
 *   รายได้สุทธิ (netRevenue)     = grossSales − ส่วนลด − เงินคืน
 *   ต้นทุนสินค้า (cogs)          = ต้นทุนต่อชิ้น × (จำนวนชิ้น − ชิ้นที่ได้คืน)
 *                                  ต้นทุนต่อชิ้นใช้ค่าที่บันทึกไว้กับรายการขาย ณ วันนำเข้า (sale.unitCost)
 *                                  ถ้าไม่มี (ข้อมูลเก่า) จึงใช้ต้นทุนปัจจุบันในหน้าสินค้า
 *   ค่าธรรมเนียมในคำสั่งซื้อ     = ค่าธรรมเนียมแพลตฟอร์ม + ค่าขนส่งที่ร้านออก   (มาจากไฟล์ CSV)
 *   กำไรหลังหักต้นทุนขาย        = netRevenue − cogs − ค่าธรรมเนียมในคำสั่งซื้อ
 *   ค่าใช้จ่ายที่บันทึกเอง        = ผลรวมรายการในหน้า "ค่าใช้จ่าย"            (ไม่ได้มาจาก CSV)
 *   กำไรสุทธิ (netProfit)        = กำไรหลังหักต้นทุนขาย − ค่าใช้จ่ายที่บันทึกเอง
 *   อัตรากำไรสุทธิ               = netProfit ÷ netRevenue
 *
 * ผลลัพธ์นี้ไม่ใช่กำไรสุทธิทางบัญชี (ไม่รวมภาษีและค่าใช้จ่ายที่ไม่ได้บันทึก)
 * ถ้าไฟล์ต้นทางไม่มีบางช่อง (Sale.missingFields) หรือไม่มีต้นทุน ระบบจะระบุว่าเป็น "กำไรโดยประมาณ" (isEstimate)
 */
import { eachDay, inRange } from "./dates";
import { round2, sum } from "./money";
import {
  EXPENSE_CATEGORIES,
  OPTIONAL_SALE_FIELDS,
  type OptionalSaleField,
  ESTIMATE_REASONS,
  type EstimateReason,
  type DateRange,
  type Expense,
  type ExpenseCategory,
  type Product,
  type Sale,
} from "./types";

export interface LineBreakdown {
  grossSales: number;
  discount: number;
  refund: number;
  netRevenue: number;
  costUnits: number;
  unitCost: number;
  cogs: number;
  platformFee: number;
  shippingFee: number;
  orderFees: number;
  /** กำไรของบรรทัดนี้ (ยังไม่รวมค่าใช้จ่ายที่บันทึกเอง) */
  lineProfit: number;
  /** ไม่มีทั้ง snapshot และต้นทุนในหน้าสินค้า (ใช้ต้นทุน 0) */
  costMissing: boolean;
}

/**
 * @param fallbackCost ต้นทุนปัจจุบันจากหน้าสินค้า ใช้เฉพาะเมื่อรายการขายไม่มี snapshot
 */
export function calcLine(sale: Sale, fallbackCost: number | undefined): LineBreakdown {
  const unitCost = sale.unitCost ?? fallbackCost;
  const grossSales = round2(sale.unitPrice * sale.quantity);
  const netRevenue = round2(grossSales - sale.discount - sale.refund);
  const costUnits = Math.max(0, sale.quantity - sale.returnedQty);
  const cost = unitCost ?? 0;
  const cogs = round2(cost * costUnits);
  const orderFees = round2(sale.platformFee + sale.shippingFee);
  return {
    grossSales,
    discount: round2(sale.discount),
    refund: round2(sale.refund),
    netRevenue,
    costUnits,
    unitCost: cost,
    cogs,
    platformFee: round2(sale.platformFee),
    shippingFee: round2(sale.shippingFee),
    orderFees,
    lineProfit: round2(netRevenue - cogs - orderFees),
    costMissing: unitCost === undefined,
  };
}

export type CostLookup = Map<string, number>;

export function buildCostLookup(products: Product[]): CostLookup {
  return new Map(products.map((p) => [p.sku.toUpperCase(), p.unitCost]));
}

export interface ProfitSummary {
  orderCount: number;
  lineCount: number;
  unitsSold: number;
  grossSales: number;
  discount: number;
  refund: number;
  netRevenue: number;
  cogs: number;
  orderPlatformFees: number;
  orderShippingFees: number;
  /** ค่าธรรมเนียมในคำสั่งซื้อทั้งหมด (จาก CSV) */
  orderFees: number;
  /** netRevenue − cogs */
  grossProfit: number;
  /** netRevenue − cogs − orderFees */
  profitAfterOrderCosts: number;
  expensesByCategory: Record<ExpenseCategory, number>;
  /** ค่าใช้จ่ายที่บันทึกเอง */
  manualExpenses: number;
  /** ค่าใช้จ่ายรวม = ค่าธรรมเนียมในคำสั่งซื้อ + ค่าใช้จ่ายที่บันทึกเอง (ไม่รวมต้นทุนสินค้า) */
  totalExpenses: number;
  netProfit: number;
  /** null เมื่อรายได้สุทธิเป็น 0 หรือติดลบ */
  netMargin: number | null;
  missingCostSkus: string[];
  /** จำนวนบรรทัดที่ไฟล์ต้นทางไม่มีข้อมูลบางช่อง */
  incompleteLines: number;
  /** ช่องที่ไม่มีข้อมูลในบางบรรทัด */
  missingFields: OptionalSaleField[];
  /** v1.3: เหตุผลอื่นที่ทำให้เป็นค่าประมาณ (ไม่รู้ผู้รับภาระส่วนลด/เงินคืน, คำสั่งซื้อยังไม่สำเร็จ) */
  estimateReasons: EstimateReason[];
  /** v1.3: กำไรอาจสูงขึ้นได้ถึง (บาท) ถ้าส่วนลด/เงินคืนที่ไม่รู้ผู้รับภาระเป็นของแพลตฟอร์ม */
  estimateUpside: number;
  /** ข้อมูลต้นทางไม่ครบ (ไม่มีบางช่อง ไม่มีต้นทุน หรือมีเหตุผลข้างบน) → ต้องแสดงเป็น "กำไรโดยประมาณ" */
  isEstimate: boolean;
}

function emptyCategories(): Record<ExpenseCategory, number> {
  return Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, 0])) as Record<ExpenseCategory, number>;
}

export function margin(profit: number, revenue: number): number | null {
  return revenue > 0 ? profit / revenue : null;
}

export function filterByRange<T extends { date: string }>(items: T[], range: DateRange): T[] {
  return items.filter((i) => inRange(i.date, range));
}

export function summarize(sales: Sale[], expenses: Expense[], costs: CostLookup): ProfitSummary {
  const lines = sales.map((s) => calcLine(s, costs.get(s.sku.toUpperCase())));
  const expensesByCategory = emptyCategories();
  for (const e of expenses) expensesByCategory[e.category] = round2(expensesByCategory[e.category] + e.amount);

  const grossSales = sum(lines.map((l) => l.grossSales));
  const discount = sum(lines.map((l) => l.discount));
  const refund = sum(lines.map((l) => l.refund));
  const netRevenue = round2(grossSales - discount - refund);
  const cogs = sum(lines.map((l) => l.cogs));
  const orderPlatformFees = sum(lines.map((l) => l.platformFee));
  const orderShippingFees = sum(lines.map((l) => l.shippingFee));
  const orderFees = round2(orderPlatformFees + orderShippingFees);
  const grossProfit = round2(netRevenue - cogs);
  const profitAfterOrderCosts = round2(grossProfit - orderFees);
  const manualExpenses = sum(expenses.map((e) => e.amount));
  const netProfit = round2(profitAfterOrderCosts - manualExpenses);

  const missing = new Set<string>();
  sales.forEach((s, i) => {
    if (lines[i].costMissing) missing.add(s.sku);
  });
  const incomplete = sales.filter((s) => (s.missingFields?.length ?? 0) > 0);
  const missingFields = OPTIONAL_SALE_FIELDS.filter((f) => incomplete.some((s) => s.missingFields!.includes(f)));
  const estimateReasons = ESTIMATE_REASONS.filter((r) => sales.some((s) => s.estimateReasons?.includes(r)));

  return {
    orderCount: new Set(sales.map((s) => `${s.channel}|${s.orderId}`)).size,
    lineCount: sales.length,
    unitsSold: sales.reduce((a, s) => a + s.quantity - s.returnedQty, 0),
    grossSales,
    discount,
    refund,
    netRevenue,
    cogs,
    orderPlatformFees,
    orderShippingFees,
    orderFees,
    grossProfit,
    profitAfterOrderCosts,
    expensesByCategory,
    manualExpenses,
    totalExpenses: round2(orderFees + manualExpenses),
    netProfit,
    netMargin: margin(netProfit, netRevenue),
    missingCostSkus: [...missing].sort(),
    incompleteLines: incomplete.length,
    missingFields,
    estimateReasons,
    estimateUpside: sum(sales.map((s) => s.estimateUpside ?? 0)),
    isEstimate: incomplete.length > 0 || missing.size > 0 || estimateReasons.length > 0,
  };
}

export interface GroupRow {
  key: string;
  label: string;
  unitsSold: number;
  netRevenue: number;
  cogs: number;
  orderFees: number;
  /** กำไรหลังหักต้นทุนขายและค่าธรรมเนียมในคำสั่งซื้อ */
  profit: number;
  margin: number | null;
}

function groupLines(
  sales: Sale[],
  costs: CostLookup,
  keyOf: (s: Sale) => string,
  labelOf: (key: string) => string,
): GroupRow[] {
  const map = new Map<string, GroupRow>();
  for (const s of sales) {
    const l = calcLine(s, costs.get(s.sku.toUpperCase()));
    const key = keyOf(s);
    const row =
      map.get(key) ??
      { key, label: labelOf(key), unitsSold: 0, netRevenue: 0, cogs: 0, orderFees: 0, profit: 0, margin: null };
    row.unitsSold += l.costUnits;
    row.netRevenue = round2(row.netRevenue + l.netRevenue);
    row.cogs = round2(row.cogs + l.cogs);
    row.orderFees = round2(row.orderFees + l.orderFees);
    row.profit = round2(row.profit + l.lineProfit);
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, margin: margin(r.profit, r.netRevenue) }))
    .sort((a, b) => b.profit - a.profit);
}

/**
 * กำไรแยกตามสินค้า: หักต้นทุนสินค้าและค่าธรรมเนียมในคำสั่งซื้อของสินค้านั้น
 * ค่าใช้จ่ายที่บันทึกเอง (เช่น ค่าโฆษณารวม) ไม่ถูกปันส่วนเข้าสินค้า เพื่อไม่ให้เดาตัวเลข
 */
export function profitByProduct(sales: Sale[], products: Product[]): GroupRow[] {
  const costs = buildCostLookup(products);
  const names = new Map(products.map((p) => [p.sku.toUpperCase(), p.name]));
  return groupLines(
    sales,
    costs,
    (s) => s.sku.toUpperCase(),
    (k) => names.get(k) ?? `${k} (ไม่พบสินค้า)`,
  );
}

export interface ChannelRow extends GroupRow {
  /** ค่าใช้จ่ายที่บันทึกเองและระบุช่องทางนี้ */
  channelExpenses: number;
  /** profit − channelExpenses */
  netProfit: number;
}

export interface ChannelResult {
  rows: ChannelRow[];
  /** ค่าใช้จ่ายที่บันทึกเองโดยไม่ระบุช่องทาง */
  unassignedExpenses: number;
}

export function profitByChannel(sales: Sale[], expenses: Expense[], products: Product[]): ChannelResult {
  const costs = buildCostLookup(products);
  const base = groupLines(sales, costs, (s) => s.channel, (k) => k);
  const expByChannel = new Map<string, number>();
  let unassigned = 0;
  for (const e of expenses) {
    if (e.channel) expByChannel.set(e.channel, round2((expByChannel.get(e.channel) ?? 0) + e.amount));
    else unassigned = round2(unassigned + e.amount);
  }
  const rows: ChannelRow[] = base.map((r) => {
    const ce = expByChannel.get(r.key) ?? 0;
    expByChannel.delete(r.key);
    return { ...r, channelExpenses: ce, netProfit: round2(r.profit - ce) };
  });
  // ช่องทางที่มีแต่ค่าใช้จ่าย ไม่มียอดขายในช่วงนี้
  for (const [channel, ce] of expByChannel) {
    rows.push({
      key: channel,
      label: channel,
      unitsSold: 0,
      netRevenue: 0,
      cogs: 0,
      orderFees: 0,
      profit: 0,
      margin: null,
      channelExpenses: ce,
      netProfit: round2(-ce),
    });
  }
  rows.sort((a, b) => b.netProfit - a.netProfit);
  return { rows, unassignedExpenses: unassigned };
}

export function lossProducts(sales: Sale[], products: Product[]): GroupRow[] {
  return profitByProduct(sales, products)
    .filter((r) => r.profit < 0)
    .sort((a, b) => a.profit - b.profit);
}

export interface DailyPoint {
  date: string;
  netRevenue: number;
  netProfit: number;
}

/** ยอดขายและกำไรสุทธิรายวัน (ค่าใช้จ่ายที่บันทึกเองนับในวันที่ของรายการนั้น) */
export function dailySeries(
  sales: Sale[],
  expenses: Expense[],
  costs: CostLookup,
  range: DateRange,
): DailyPoint[] {
  const dates = [...sales.map((s) => s.date), ...expenses.map((e) => e.date)].sort();
  const from = range.from ?? dates[0];
  const to = range.to ?? dates[dates.length - 1];
  if (!from || !to) return [];
  const map = new Map<string, DailyPoint>(eachDay(from, to).map((d) => [d, { date: d, netRevenue: 0, netProfit: 0 }]));
  for (const s of sales) {
    const p = map.get(s.date);
    if (!p) continue;
    const l = calcLine(s, costs.get(s.sku.toUpperCase()));
    p.netRevenue = round2(p.netRevenue + l.netRevenue);
    p.netProfit = round2(p.netProfit + l.lineProfit);
  }
  for (const e of expenses) {
    const p = map.get(e.date);
    if (p) p.netProfit = round2(p.netProfit - e.amount);
  }
  return [...map.values()];
}
