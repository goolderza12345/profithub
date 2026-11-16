import { toCsv } from "./csv";
import { buildCostLookup, calcLine, profitByChannel, profitByProduct, summarize } from "./profit";
import { EXPENSE_LABELS, type DatasetId, type Expense, type Product, type Sale } from "./types";

export type ReportKind = "sales" | "costs" | "profit" | "product" | "channel";

export const REPORTS: { kind: ReportKind; title: string; description: string }[] = [
  { kind: "sales", title: "รายงานยอดขาย", description: "ทุกรายการขาย พร้อมยอดก่อนหัก ส่วนลด เงินคืน และรายได้สุทธิ" },
  { kind: "costs", title: "รายงานต้นทุนและค่าใช้จ่าย", description: "ต้นทุนสินค้า ค่าธรรมเนียมในคำสั่งซื้อ และค่าใช้จ่ายที่บันทึกเอง ทีละรายการ" },
  { kind: "profit", title: "รายงานกำไร (งบกำไรขาดทุน)", description: "สรุปรายได้ หักต้นทุน หักค่าใช้จ่าย จนถึงกำไรสุทธิ" },
  { kind: "product", title: "กำไรแยกตามสินค้า", description: "ยอดขาย ต้นทุน ค่าธรรมเนียม และกำไรของแต่ละ SKU" },
  { kind: "channel", title: "กำไรแยกตามช่องทาง", description: "กำไรของแต่ละช่องทาง หลังหักค่าใช้จ่ายที่ระบุช่องทาง" },
];

type Rows = (string | number)[][];

const pct = (m: number | null) => (m === null ? "" : (m * 100).toFixed(2));

export function buildReportRows(
  kind: ReportKind,
  sales: Sale[],
  expenses: Expense[],
  products: Product[],
): Rows {
  const costs = buildCostLookup(products);
  const names = new Map(products.map((p) => [p.sku.toUpperCase(), p.name]));
  const sorted = [...sales].sort((a, b) => a.date.localeCompare(b.date) || a.orderId.localeCompare(b.orderId));

  switch (kind) {
    case "sales":
      return [
        ["วันที่", "ช่องทาง", "เลขคำสั่งซื้อ", "SKU", "ชื่อสินค้า", "จำนวน", "ราคาต่อชิ้น", "ยอดก่อนหัก", "ส่วนลด", "เงินคืน", "รายได้สุทธิ"],
        ...sorted.map((s) => {
          const l = calcLine(s, costs.get(s.sku.toUpperCase()));
          return [s.date, s.channel, s.orderId, s.sku, names.get(s.sku.toUpperCase()) ?? "", s.quantity, s.unitPrice, l.grossSales, l.discount, l.refund, l.netRevenue];
        }),
      ];
    case "costs": {
      const rows: Rows = [["วันที่", "ประเภท", "อ้างอิง", "รายละเอียด", "ช่องทาง", "จำนวนเงิน"]];
      for (const s of sorted) {
        const l = calcLine(s, costs.get(s.sku.toUpperCase()));
        const ref = `${s.orderId} / ${s.sku}`;
        if (l.cogs) rows.push([s.date, "ต้นทุนสินค้า", ref, `${l.costUnits} ชิ้น × ${l.unitCost}`, s.channel, l.cogs]);
        if (l.platformFee) rows.push([s.date, "ค่าธรรมเนียมแพลตฟอร์ม (ในคำสั่งซื้อ)", ref, "", s.channel, l.platformFee]);
        if (l.shippingFee) rows.push([s.date, "ค่าขนส่งที่ร้านออก (ในคำสั่งซื้อ)", ref, "", s.channel, l.shippingFee]);
      }
      for (const e of [...expenses].sort((a, b) => a.date.localeCompare(b.date))) {
        rows.push([e.date, `${EXPENSE_LABELS[e.category]} (บันทึกเอง)`, "", e.note, e.channel || "ไม่ระบุช่องทาง", e.amount]);
      }
      return rows;
    }
    case "profit": {
      const s = summarize(sales, expenses, costs);
      return [
        ["รายการ", "จำนวนเงิน"],
        ["ยอดขายก่อนหัก", s.grossSales],
        ["หัก ส่วนลด", -s.discount],
        ["หัก เงินคืนลูกค้า", -s.refund],
        ["= รายได้สุทธิ", s.netRevenue],
        ["หัก ต้นทุนสินค้า", -s.cogs],
        ["= กำไรขั้นต้น", s.grossProfit],
        ["หัก ค่าธรรมเนียมแพลตฟอร์ม (ในคำสั่งซื้อ)", -s.orderPlatformFees],
        ["หัก ค่าขนส่งที่ร้านออก (ในคำสั่งซื้อ)", -s.orderShippingFees],
        ...Object.entries(s.expensesByCategory).map(([c, v]) => [`หัก ${EXPENSE_LABELS[c as keyof typeof EXPENSE_LABELS]} (บันทึกเอง)`, -v]),
        ["= กำไรสุทธิ", s.netProfit],
        ["อัตรากำไรสุทธิ (%)", pct(s.netMargin)],
      ];
    }
    case "product":
      return [
        ["SKU", "ชื่อสินค้า", "จำนวนที่ขาย (สุทธิ)", "รายได้สุทธิ", "ต้นทุนสินค้า", "ค่าธรรมเนียมในคำสั่งซื้อ", "กำไร", "อัตรากำไร (%)"],
        ...profitByProduct(sales, products).map((r) => [r.key, r.label, r.unitsSold, r.netRevenue, r.cogs, r.orderFees, r.profit, pct(r.margin)]),
      ];
    case "channel": {
      const res = profitByChannel(sales, expenses, products);
      return [
        ["ช่องทาง", "รายได้สุทธิ", "ต้นทุนสินค้า", "ค่าธรรมเนียมในคำสั่งซื้อ", "ค่าใช้จ่ายที่ระบุช่องทาง", "กำไรสุทธิของช่องทาง"],
        ...res.rows.map((r) => [r.label, r.netRevenue, r.cogs, r.orderFees, r.channelExpenses, r.netProfit]),
        ["ค่าใช้จ่ายที่ไม่ระบุช่องทาง", "", "", "", res.unassignedExpenses, -res.unassignedExpenses],
      ];
    }
  }
}

export function buildReportCsv(
  kind: ReportKind,
  dataset: DatasetId,
  sales: Sale[],
  expenses: Expense[],
  products: Product[],
): string {
  const rows = buildReportRows(kind, sales, expenses, products);
  if (dataset === "demo") {
    rows[0] = [...rows[0], "ชุดข้อมูล"];
    for (let i = 1; i < rows.length; i++) rows[i] = [...rows[i], "DEMO (ข้อมูลตัวอย่าง)"];
  }
  return toCsv(rows);
}

export function reportFileName(kind: ReportKind, dataset: DatasetId, from: string | null, to: string | null): string {
  const range = from || to ? `${from ?? "start"}_${to ?? "end"}` : "all";
  return `${dataset === "demo" ? "DEMO_" : ""}profithub_${kind}_${range}.csv`;
}
