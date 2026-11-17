"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { History, ReceiptText, Search } from "lucide-react";
import { formatThaiDate } from "@/lib/dates";
import { formatBaht, formatNumber } from "@/lib/format";
import { toBaht } from "@/lib/money/satang";
import { changeLabel } from "@/lib/orders/plan";
import { reconcile } from "@/lib/orders/settlement";
import { recognitionOf, STATUS_LABELS } from "@/lib/orders/status";
import type { Order } from "@/lib/orders/types";
import { useData } from "../data-provider";
import { Badge, buttonClass, Card, cn, EmptyState, inputClass, Loading, Modal, PageHeader, Segmented } from "../ui";

type Filter = "all" | "counted" | "excluded" | "provisional" | "cancelledLines" | "mismatch";

const REC_TONE = { excluded: "red", provisional: "amber", final: "green", unspecified: "slate" } as const;

export function OrdersView() {
  const { ready, orders, orderRevisions, settlementEntries } = useData();
  const mismatches = useMemo(() => new Map(reconcile(orders, settlementEntries).map((r) => [r.orderKey, r])), [orders, settlementEntries]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Order | null>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...orders]
      .filter((o) => {
        const rec = recognitionOf(o.status);
        if (filter === "counted" && rec === "excluded") return false;
        if (filter === "excluded" && rec !== "excluded") return false;
        if (filter === "provisional" && rec !== "provisional") return false;
        if (filter === "cancelledLines" && !o.lines.some((l) => l.cancelled)) return false;
        if (filter === "mismatch" && !mismatches.has(o.key)) return false;
        return !q || o.orderId.toLowerCase().includes(q) || o.lines.some((l) => l.sourceSku.toLowerCase().includes(q));
      })
      .sort((a, b) => b.orderDate.localeCompare(a.orderDate) || a.orderId.localeCompare(b.orderId));
  }, [orders, filter, query, mismatches]);

  if (!ready) return <Loading />;
  if (orders.length === 0) {
    return (
      <>
        <PageHeader title="คำสั่งซื้อ" description="สถานะ การอัปเดต และประวัติของแต่ละคำสั่งซื้อ" />
        <EmptyState
          icon={<ReceiptText />}
          title="ยังไม่มีคำสั่งซื้อจากการนำเข้ารุ่นใหม่"
          description="รายการขายที่นำเข้าก่อนหน้านี้ยังนับในกำไรตามปกติ เมื่อนำเข้าไฟล์ครั้งถัดไป ระบบจะสร้างคำสั่งซื้อและเก็บประวัติให้"
        >
          <Link href="/import" className={buttonClass()}>
            นำเข้ายอดขาย
          </Link>
        </EmptyState>
      </>
    );
  }

  const history = open ? orderRevisions.filter((r) => r.orderKey === open.key).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)) : [];

  return (
    <>
      <PageHeader title="คำสั่งซื้อ" description="รอชำระและยกเลิกไม่นับในกำไร · คำสั่งซื้อที่ยังไม่สำเร็จแสดงเป็นกำไรโดยประมาณ" />
      <label className="relative mb-3 block sm:max-w-sm">
        <span className="sr-only">ค้นหาคำสั่งซื้อ</span>
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาเลขคำสั่งซื้อหรือ SKU" className={inputClass + " pl-10"} />
      </label>
      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: `ทั้งหมด ${orders.length}` },
          { value: "counted", label: "นับในกำไร" },
          { value: "provisional", label: "ยังไม่สำเร็จ" },
          { value: "excluded", label: "รอชำระ/ยกเลิก" },
          { value: "cancelledLines", label: "มีบรรทัดยกเลิก" },
          { value: "mismatch", label: `ยอดโอนไม่ตรง ${mismatches.size}` },
        ]}
      />
      <p className="mb-2 mt-3 text-sm text-slate-500">{formatNumber(list.length)} คำสั่งซื้อ</p>
      <Card className="!p-0">
        <ul className="divide-y divide-slate-100" data-testid="orders-list">
          {list.slice(0, 300).map((o) => {
            const rec = recognitionOf(o.status);
            return (
              <li key={o.key}>
                <button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 sm:px-5" onClick={() => setOpen(o)} data-order={o.orderId}>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{o.orderId}</p>
                    <p className="text-xs text-slate-500">
                      {formatThaiDate(o.orderDate)} · {o.channel} · {o.lines.filter((l) => !l.cancelled).length} บรรทัด
                      {o.revisionCount > 1 && ` · อัปเดต ${o.revisionCount - 1} ครั้ง`}
                    </p>
                  </div>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={REC_TONE[rec]}>{STATUS_LABELS[o.status]}</Badge>
                    {mismatches.has(o.key) && <Badge tone="red">ยอดโอนไม่ตรง</Badge>}
                  </span>
                </button>
              </li>
            );
          })}
          {list.length > 300 && <li className="px-4 py-2 text-xs text-slate-500">แสดง 300 รายการแรก — ใช้การค้นหาเพื่อหาคำสั่งซื้ออื่น</li>}
          {list.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">ไม่พบคำสั่งซื้อ</li>}
        </ul>
      </Card>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `คำสั่งซื้อ ${open.orderId}` : ""}>
        {open && (
          <div className="space-y-4 text-sm">
            <p className="text-slate-600">
              {formatThaiDate(open.orderDate)} · {open.channel} · สถานะ <b>{STATUS_LABELS[open.status]}</b>
              {open.rawStatus && open.status !== "unspecified" && <span className="text-xs text-slate-400"> (ในไฟล์: {open.rawStatus})</span>}
            </p>
            {mismatches.get(open.key) && (
              <p className="num rounded-xl bg-rose-50 p-3 text-xs text-rose-800" data-testid="payout-mismatch">
                ยอดโอนที่คาดไว้ {formatBaht(toBaht(mismatches.get(open.key)!.expected))} · ยอดโอนจริงในรายงาน {formatBaht(toBaht(mismatches.get(open.key)!.actual))} · ต่าง{" "}
                {formatBaht(toBaht(mismatches.get(open.key)!.diff))} — ตรวจสอบส่วนลด เงินคืน หรือค่าธรรมเนียมที่อาจขาดหาย
              </p>
            )}
            <ul className="space-y-2">
              {open.lines.map((l) => (
                <li key={l.lineKey} className={cn("rounded-xl p-3 ring-1 ring-slate-200", l.cancelled && "opacity-60")}>
                  <div className="flex justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">{l.sourceSku}</span>
                    {l.cancelled && <Badge tone="red">ยกเลิกบรรทัด</Badge>}
                  </div>
                  <dl className="num mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-slate-600">
                    <dt>ยอดขาย ({l.quantity} ชิ้น)</dt>
                    <dd className="text-right">{formatBaht(toBaht(l.grossSatang))}</dd>
                    <dt>ส่วนลดที่ร้านรับภาระ</dt>
                    <dd className="text-right">{formatBaht(toBaht(l.sellerDiscount + l.unknownDiscount))}</dd>
                    <dt>ส่วนลดที่แพลตฟอร์มสนับสนุน</dt>
                    <dd className="text-right">{formatBaht(toBaht(l.platformSubsidy))}</dd>
                    <dt>เงินคืน (ร้าน / แพลตฟอร์ม)</dt>
                    <dd className="text-right">
                      {formatBaht(toBaht(l.refundSeller + l.refundUnknown))} / {formatBaht(toBaht(l.refundPlatform))}
                    </dd>
                    <dt>ชิ้นคืนเข้าสต็อก / ชำรุด / ไม่ต้องส่งคืน</dt>
                    <dd className="text-right">
                      {l.returnedResellable} / {l.returnedDamaged} / {l.notReturned}
                    </dd>
                    <dt>ค่าธรรมเนียม / ค่าส่ง</dt>
                    <dd className="text-right">
                      {formatBaht(toBaht(l.fees.commission + l.fees.transaction + l.fees.service + l.fees.other - l.feeRefunded))} /{" "}
                      {formatBaht(toBaht(l.fees.shipping - l.shippingRefunded + l.returnShippingCost))}
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
            <div>
              <h3 className="flex items-center gap-1.5 font-semibold text-slate-900">
                <History size={16} /> ประวัติการเปลี่ยนแปลง ({history.length})
              </h3>
              <ol className="mt-2 space-y-2" data-testid="order-history">
                {history.map((r) => (
                  <li key={r.seq} className="rounded-xl bg-slate-50 p-3 text-xs">
                    <p className="font-medium text-slate-800">
                      {{ create: "สร้าง", update: "อัปเดต", adopt: "ผูกข้อมูลเดิม", settlement: "รายงานการเงิน", user: "แก้ไขโดยผู้ใช้" }[r.kind]} ·{" "}
                      {new Date(r.appliedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                    {r.changes.length > 0 && (
                      <ul className="num mt-1 space-y-0.5 text-slate-600">
                        {r.changes.slice(0, 20).map((c, i) => {
                          const [lineKey, field] = c.path.includes(".") ? [c.path.slice(0, c.path.lastIndexOf(".")), c.path.slice(c.path.lastIndexOf(".") + 1)] : ["", c.path];
                          return (
                            <li key={i}>
                              {lineKey && `${lineKey.replace(/^sku:/, "").split("|")[0]} · `}
                              {changeLabel(field)}: {String(c.from ?? "—")} → {String(c.to ?? "—")}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
