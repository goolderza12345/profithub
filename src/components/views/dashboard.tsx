"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AlertTriangle, ArrowRight, Coins, FlaskConical, Package, Percent, Receipt, ShieldCheck, TrendingUp, Upload, Wallet, Info } from "lucide-react";
import { buildCostLookup, dailySeries, filterByRange, lossProducts, summarize } from "@/lib/profit";
import { formatBaht, formatNumber, formatPercent } from "@/lib/format";
import { ESTIMATE_REASON_LABELS, OPTIONAL_FIELD_LABELS } from "@/lib/types";
import { useData } from "../data-provider";
import { DailyChart } from "../charts";
import { RangeFilter } from "../range-filter";
import { StatCard } from "../stat-card";
import { Button, buttonClass, Card, EmptyState, Loading, PageHeader } from "../ui";

export function DashboardView() {
  const { ready, products, sales: allSales, activeSales: sales, activeExpenses: expenses, range, dataset, startDemo, lastBackupAt, backupDue, recognition } = useData();

  const view = useMemo(() => {
    const s = filterByRange(sales, range);
    const e = filterByRange(expenses, range);
    const costs = buildCostLookup(products);
    return {
      summary: summarize(s, e, costs),
      series: dailySeries(s, e, costs, range),
      losses: lossProducts(s, products).slice(0, 3),
    };
  }, [sales, expenses, products, range]);

  if (!ready) return <Loading />;

  // ว่างจริงเมื่อไม่มีรายการขายเลย (แม้ทุกคำสั่งซื้อจะรอชำระ/ยกเลิก ก็ไม่ถือว่าว่าง)
  if (allSales.length === 0 && expenses.length === 0) {
    return (
      <>
        <PageHeader title="ภาพรวมร้านค้า" description="เริ่มต้นใช้งาน ProfitHub ใน 3 ขั้นตอน" />
        <EmptyState
          icon={<TrendingUp />}
          title={dataset === "demo" ? "ยังไม่มีข้อมูล Demo" : "ยังไม่มีข้อมูลยอดขาย"}
          description="1) เพิ่มสินค้าและต้นทุนต่อชิ้น  2) นำเข้ายอดขายจากไฟล์ CSV  3) บันทึกค่าใช้จ่าย แล้วดูกำไรจริงได้ทันที"
        >
          <Link href="/products" className={buttonClass("secondary")}>
            <Package size={18} /> เพิ่มสินค้า
          </Link>
          <Link href="/import" className={buttonClass()}>
            <Upload size={18} /> นำเข้า CSV
          </Link>
          {dataset === "real" && (
            <Button variant="ghost" onClick={() => startDemo()}>
              <FlaskConical size={18} /> ทดลองด้วยข้อมูล Demo
            </Button>
          )}
        </EmptyState>
      </>
    );
  }

  const s = view.summary;
  return (
    <>
      <PageHeader title="ภาพรวมร้านค้า" description={`${formatNumber(s.orderCount)} คำสั่งซื้อ · ${formatNumber(s.unitsSold)} ชิ้น`} />
      <RangeFilter />

      {dataset === "real" && backupDue && (
        <div className="mb-4 flex gap-3 rounded-2xl bg-brand-50 p-4 text-sm text-brand-900 ring-1 ring-brand-100">
          <ShieldCheck size={18} className="mt-0.5 shrink-0" />
          <p>
            {lastBackupAt ? "ไม่ได้สำรองข้อมูลมากกว่า 7 วัน" : "ยังไม่เคยสำรองข้อมูล"} — ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น{" "}
            <Link href="/settings" className="font-medium underline">
              สำรองข้อมูลตอนนี้
            </Link>
          </p>
        </div>
      )}

      {s.incompleteLines > 0 && (
        <div className="mb-4 flex gap-3 rounded-2xl bg-slate-100 p-4 text-sm text-slate-700" data-testid="estimate-notice">
          <Info size={18} className="mt-0.5 shrink-0" />
          <p>
            <b>กำไรโดยประมาณ</b> — {formatNumber(s.incompleteLines)} รายการขายมาจากไฟล์ที่ไม่มีข้อมูล{" "}
            {s.missingFields.map((f) => OPTIONAL_FIELD_LABELS[f]).join(", ")} (ระบบนับเป็น 0) ตัวเลขจริงอาจต่ำกว่านี้
          </p>
        </div>
      )}

      {(s.estimateReasons.length > 0 || recognition.excludedPending + recognition.excludedCancelled + recognition.excludedCancelledLines > 0) && (
        <div className="mb-4 space-y-1 rounded-2xl bg-slate-100 p-4 text-sm text-slate-700" data-testid="order-notice">
          {s.estimateReasons.map((r) => (
            <p key={r}>• {ESTIMATE_REASON_LABELS[r]}</p>
          ))}
          {s.estimateUpside > 0 && <p>• กำไรอาจสูงขึ้นได้ถึง {formatBaht(s.estimateUpside)} ถ้าส่วนลด/เงินคืนที่ไม่รู้ผู้รับภาระเป็นของแพลตฟอร์ม</p>}
          {recognition.excludedPending + recognition.excludedCancelled > 0 && (
            <p>
              • ไม่นับในกำไร: รอชำระ {formatNumber(recognition.excludedPending)} · ยกเลิก {formatNumber(recognition.excludedCancelled)} คำสั่งซื้อ (ทุกช่วงเวลา) —{" "}
              <Link href="/orders" className="font-medium underline">
                ดูคำสั่งซื้อ
              </Link>
            </p>
          )}
          {recognition.excludedCancelledLines > 0 && <p>• ไม่นับบรรทัดสินค้าที่ยกเลิก {formatNumber(recognition.excludedCancelledLines)} บรรทัด</p>}
        </div>
      )}

      {s.missingCostSkus.length > 0 && (
        <div className="mb-4 flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>
            ไม่พบต้นทุนของ SKU: <b>{s.missingCostSkus.join(", ")}</b> — กำไรอาจสูงเกินจริง{" "}
            <Link href="/products" className="font-medium underline">
              เพิ่มสินค้า
            </Link>
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="ยอดขายสุทธิ" value={formatBaht(s.netRevenue)} icon={<Wallet size={17} />} tone="brand" sub={`ก่อนหักส่วนลด/คืนเงิน ${formatBaht(s.grossSales)}`} />
        <StatCard label="ต้นทุนสินค้ารวม" value={formatBaht(s.cogs)} icon={<Package size={17} />} tone="slate" sub="ต้นทุนต่อชิ้น × ชิ้นที่ขาย" />
        <StatCard label="ค่าใช้จ่ายรวม" value={formatBaht(s.totalExpenses)} icon={<Receipt size={17} />} tone="amber" sub={`ในคำสั่งซื้อ ${formatBaht(s.orderFees)} · บันทึกเอง ${formatBaht(s.manualExpenses)}`} />
        <StatCard label={s.isEstimate ? "กำไรสุทธิ (โดยประมาณ)" : "กำไรสุทธิ"} value={formatBaht(s.netProfit)} icon={<Coins size={17} />} tone={s.netProfit < 0 ? "red" : "green"} sub={s.netProfit < 0 ? "ขาดทุนในช่วงนี้" : "หลังหักทุกอย่างแล้ว"} />
        <StatCard
          className="col-span-2 lg:col-span-1"
          label="อัตรากำไรสุทธิ"
          value={formatPercent(s.netMargin)}
          icon={<Percent size={17} />}
          tone={s.netMargin !== null && s.netMargin < 0 ? "red" : "green"}
          sub="กำไรสุทธิ ÷ ยอดขายสุทธิ"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">ยอดขายและกำไรรายวัน</h2>
          </div>
          {view.series.length > 0 ? <DailyChart data={view.series} /> : <p className="py-16 text-center text-sm text-slate-500">ไม่มีข้อมูลในช่วงเวลานี้</p>}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">ที่มาของกำไร</h2>
            <Link href="/how-it-works" className="text-xs font-medium text-brand-600">
              วิธีคำนวณ
            </Link>
          </div>
          <dl className="num space-y-2 text-sm">
            <Row label="ยอดขายก่อนหัก" value={s.grossSales} />
            <Row label="− ส่วนลด" value={-s.discount} />
            <Row label="− เงินคืนลูกค้า" value={-s.refund} />
            <Row label="= ยอดขายสุทธิ" value={s.netRevenue} strong />
            <Row label="− ต้นทุนสินค้า" value={-s.cogs} />
            <Row label="− ค่าธรรมเนียม/ขนส่งในคำสั่งซื้อ" value={-s.orderFees} />
            <Row label="− ค่าใช้จ่ายที่บันทึกเอง" value={-s.manualExpenses} />
            <div className="border-t border-slate-200 pt-2">
              <Row label={s.isEstimate ? "= กำไรสุทธิโดยประมาณ" : "= กำไรสุทธิ"} value={s.netProfit} strong colored />
            </div>
          </dl>
        </Card>
      </div>

      <Card className="mt-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">สินค้าที่ขาดทุน</h2>
          <Link href="/analysis" className="flex items-center gap-1 text-xs font-medium text-brand-600">
            ดูการวิเคราะห์ <ArrowRight size={14} />
          </Link>
        </div>
        {view.losses.length === 0 ? (
          <p className="text-sm text-slate-500">ไม่มีสินค้าที่ขาดทุนในช่วงนี้ 🎉</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {view.losses.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">{r.label}</p>
                  <p className="text-xs text-slate-500">
                    {r.key} · ขาย {formatNumber(r.unitsSold)} ชิ้น
                  </p>
                </div>
                <span className="num shrink-0 font-semibold text-rose-600">{formatBaht(r.profit)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Row({ label, value, strong, colored }: { label: string; value: number; strong?: boolean; colored?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={strong ? "font-semibold text-slate-900" : "text-slate-600"}>{label}</dt>
      <dd className={[strong ? "font-semibold" : "", colored ? (value < 0 ? "text-rose-600" : "text-emerald-600") : "text-slate-900"].join(" ")}>
        {formatBaht(value)}
      </dd>
    </div>
  );
}
