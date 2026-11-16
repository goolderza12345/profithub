"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Download, FileText } from "lucide-react";
import { downloadText } from "@/lib/download";
import { formatNumber } from "@/lib/format";
import { filterByRange } from "@/lib/profit";
import { buildReportCsv, buildReportRows, reportFileName, REPORTS, type ReportKind } from "@/lib/reports";
import { useData } from "../data-provider";
import { RangeFilter } from "../range-filter";
import { Badge, Button, Card, Loading, PageHeader } from "../ui";

export function ReportsView() {
  const { ready, sales, expenses, products, range, dataset } = useData();
  const [last, setLast] = useState<ReportKind | null>(null);

  const filtered = useMemo(
    () => ({ sales: filterByRange(sales, range), expenses: filterByRange(expenses, range) }),
    [sales, expenses, range],
  );
  const counts = useMemo(() => {
    const out = {} as Record<ReportKind, number>;
    for (const r of REPORTS) out[r.kind] = buildReportRows(r.kind, filtered.sales, filtered.expenses, products).length - 1;
    return out;
  }, [filtered, products]);

  if (!ready) return <Loading />;

  function download(kind: ReportKind) {
    const csv = buildReportCsv(kind, dataset, filtered.sales, filtered.expenses, products);
    downloadText(reportFileName(kind, dataset, range.from, range.to), csv);
    setLast(kind);
  }

  return (
    <>
      <PageHeader title="รายงาน" description="ส่งออกเป็นไฟล์ CSV เปิดได้ด้วย Excel หรือ Google Sheets (ภาษาไทยแสดงถูกต้อง)" />
      <RangeFilter />
      {dataset === "demo" && (
        <p className="mb-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          โหมด Demo: ไฟล์จะขึ้นต้นด้วย <b>DEMO_</b> และทุกแถวมีคอลัมน์ระบุว่าเป็นข้อมูลตัวอย่าง
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Card key={r.kind} className="flex flex-col">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                <FileText size={20} />
              </span>
              <div>
                <h2 className="font-semibold text-slate-900">{r.title}</h2>
                <p className="mt-0.5 text-sm text-slate-500">{r.description}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-1 items-end justify-between gap-2">
              <Badge>{formatNumber(counts[r.kind])} แถว</Badge>
              <Button size="sm" onClick={() => download(r.kind)} disabled={counts[r.kind] === 0}>
                {last === r.kind ? <CheckCircle2 size={16} /> : <Download size={16} />}
                {last === r.kind ? "ดาวน์โหลดแล้ว" : "ส่งออก CSV"}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
