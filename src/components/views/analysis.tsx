"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { formatBaht, formatNumber, formatPercent } from "@/lib/format";
import { buildCostLookup, filterByRange, lossProducts, profitByChannel, profitByProduct, summarize, type GroupRow } from "@/lib/profit";
import { EXPENSE_LABELS, type ExpenseCategory } from "@/lib/types";
import { useData } from "../data-provider";
import { RangeFilter } from "../range-filter";
import { buttonClass, Card, cn, EmptyState, Loading, PageHeader, Segmented } from "../ui";

type Tab = "product" | "channel" | "loss";

export function AnalysisView() {
  const { ready, sales, expenses, products, range } = useData();
  const [tab, setTab] = useState<Tab>("product");

  const v = useMemo(() => {
    const s = filterByRange(sales, range);
    const e = filterByRange(expenses, range);
    return {
      summary: summarize(s, e, buildCostLookup(products)),
      byProduct: profitByProduct(s, products),
      byChannel: profitByChannel(s, e, products),
      losses: lossProducts(s, products),
    };
  }, [sales, expenses, products, range]);

  if (!ready) return <Loading />;
  if (sales.length === 0 && expenses.length === 0)
    return (
      <>
        <PageHeader title="วิเคราะห์กำไร" />
        <EmptyState icon={<BarChart3 />} title="ยังไม่มีข้อมูลให้วิเคราะห์" description="นำเข้ายอดขายก่อน แล้วระบบจะแยกกำไรตามสินค้าและช่องทางให้อัตโนมัติ">
          <Link href="/import" className={buttonClass()}>
            นำเข้ายอดขาย
          </Link>
        </EmptyState>
      </>
    );

  const s = v.summary;
  const pl: { label: string; value: number; kind?: "total" | "net"; note?: string }[] = [
    { label: "ยอดขายก่อนหัก", value: s.grossSales, note: "ราคาต่อชิ้น × จำนวน" },
    { label: "หัก ส่วนลดที่ร้านออก", value: -s.discount },
    { label: "หัก เงินคืนลูกค้า", value: -s.refund },
    { label: "ยอดขายสุทธิ", value: s.netRevenue, kind: "total" },
    { label: "หัก ต้นทุนสินค้า", value: -s.cogs, note: "ไม่นับชิ้นที่ได้รับคืนเข้าสต็อก" },
    { label: "กำไรขั้นต้น", value: s.grossProfit, kind: "total" },
    { label: "หัก ค่าธรรมเนียมแพลตฟอร์ม (จากไฟล์ยอดขาย)", value: -s.orderPlatformFees },
    { label: "หัก ค่าขนส่งที่ร้านออก (จากไฟล์ยอดขาย)", value: -s.orderShippingFees },
    ...(Object.entries(s.expensesByCategory) as [ExpenseCategory, number][])
      .filter(([, val]) => val !== 0)
      .map(([c, val]) => ({
      label: `หัก ${EXPENSE_LABELS[c]} (บันทึกเอง)`,
      value: -val,
    })),
    { label: s.isEstimate ? "กำไรสุทธิ (โดยประมาณ)" : "กำไรสุทธิ", value: s.netProfit, kind: "net" },
  ];

  return (
    <>
      <PageHeader title="วิเคราะห์กำไร" description="ดูว่ากำไรมาจากไหน และสินค้าหรือช่องทางใดที่ทำให้ขาดทุน" />
      <RangeFilter />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold text-slate-900">งบกำไรขาดทุน</h2>
          <dl className="num divide-y divide-slate-100 text-sm">
            {pl.map((r) => (
              <div
                key={r.label}
                className={cn(
                  "flex items-start justify-between gap-3 py-2",
                  r.kind === "total" && "font-semibold",
                  r.kind === "net" && "mt-1 rounded-xl bg-slate-50 px-3 text-base font-bold",
                )}
              >
                <dt className={r.kind ? "text-slate-900" : "text-slate-600"}>
                  {r.label}
                  {r.note && <span className="block text-xs font-normal text-slate-400">{r.note}</span>}
                </dt>
                <dd className={cn("whitespace-nowrap", r.kind === "net" ? (r.value < 0 ? "text-rose-600" : "text-emerald-600") : "text-slate-900")}>{formatBaht(r.value)}</dd>
              </div>
            ))}
            <div className="flex justify-between py-2 text-slate-600">
              <dt>อัตรากำไรสุทธิ</dt>
              <dd className="font-semibold text-slate-900">{formatPercent(s.netMargin)}</dd>
            </div>
          </dl>
          <Link href="/how-it-works" className="mt-2 inline-block text-xs font-medium text-brand-600">
            อ่านวิธีคำนวณแบบละเอียด →
          </Link>
        </Card>

        <div className="lg:col-span-3">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "product", label: "แยกตามสินค้า" },
              { value: "channel", label: "แยกตามช่องทาง" },
              { value: "loss", label: `สินค้าขาดทุน (${v.losses.length})` },
            ]}
          />
          <div className="mt-3">
            {tab === "product" && (
              <>
                <GroupList rows={v.byProduct} showSku empty="ไม่มียอดขายในช่วงนี้" />
                <p className="mt-2 text-xs text-slate-500">
                  กำไรแยกตามสินค้า = ยอดขายสุทธิ − ต้นทุนสินค้า − ค่าธรรมเนียม/ขนส่งในคำสั่งซื้อ (ค่าใช้จ่ายที่บันทึกเองไม่ถูกปันส่วนเข้าสินค้า)
                </p>
              </>
            )}
            {tab === "loss" && (
              <>
                <GroupList rows={v.losses} showSku empty="ไม่มีสินค้าที่ขาดทุนในช่วงนี้ 🎉" />
                {v.losses.length > 0 && (
                  <p className="mt-2 text-xs text-slate-500">ลองตรวจสอบราคาขาย ส่วนลด ค่าธรรมเนียม หรือต้นทุนของสินค้าเหล่านี้</p>
                )}
              </>
            )}
            {tab === "channel" && (
              <Card className="!p-0">
                <ul className="divide-y divide-slate-100">
                  {v.byChannel.rows.map((r) => (
                    <li key={r.key} className="px-4 py-3 sm:px-5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-slate-900">{r.label}</p>
                        <p className={cn("num font-semibold", r.netProfit < 0 ? "text-rose-600" : "text-emerald-600")}>{formatBaht(r.netProfit)}</p>
                      </div>
                      <div className="num mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-500 sm:grid-cols-4">
                        <span>ยอดขายสุทธิ {formatBaht(r.netRevenue)}</span>
                        <span>ต้นทุน {formatBaht(r.cogs)}</span>
                        <span>ค่าธรรมเนียม {formatBaht(r.orderFees)}</span>
                        <span>ค่าใช้จ่ายช่องทาง {formatBaht(r.channelExpenses)}</span>
                      </div>
                    </li>
                  ))}
                  <li className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-sm sm:px-5">
                    <span className="text-slate-600">ค่าใช้จ่ายที่ไม่ระบุช่องทาง</span>
                    <span className="num font-semibold text-slate-900">{formatBaht(-v.byChannel.unassignedExpenses)}</span>
                  </li>
                  <li className="flex items-center justify-between gap-3 px-4 py-3 text-sm sm:px-5">
                    <span className="font-semibold text-slate-900">รวมกำไรสุทธิ</span>
                    <span className={cn("num font-bold", s.netProfit < 0 ? "text-rose-600" : "text-emerald-600")}>{formatBaht(s.netProfit)}</span>
                  </li>
                </ul>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function GroupList({ rows, showSku, empty }: { rows: GroupRow[]; showSku?: boolean; empty: string }) {
  if (rows.length === 0) return <Card><p className="text-sm text-slate-500">{empty}</p></Card>;
  return (
    <Card className="!p-0">
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.key} className="px-4 py-3 sm:px-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{r.label}</p>
                {showSku && (
                  <p className="text-xs text-slate-500">
                    {r.key} · {formatNumber(r.unitsSold)} ชิ้น
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className={cn("num font-semibold", r.profit < 0 ? "text-rose-600" : "text-emerald-600")}>{formatBaht(r.profit)}</p>
                <p className="text-xs text-slate-500">{formatPercent(r.margin)}</p>
              </div>
            </div>
            <div className="num mt-1 grid grid-cols-3 gap-x-3 text-xs text-slate-500">
              <span>ขาย {formatBaht(r.netRevenue)}</span>
              <span>ต้นทุน {formatBaht(r.cogs)}</span>
              <span>ค่าธรรมเนียม {formatBaht(r.orderFees)}</span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
