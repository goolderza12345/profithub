"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, GitCompare, Info, ListChecks, PackagePlus, ShieldCheck, XCircle } from "lucide-react";
import { toCsv } from "@/lib/csv";
import type { OrderImportOutcome } from "@/lib/db";
import { downloadText } from "@/lib/download";
import { formatThaiDate } from "@/lib/dates";
import { formatBaht, formatNumber } from "@/lib/format";
import type { AdapterId } from "@/lib/import/adapters";
import { FIELD_BY_KEY } from "@/lib/import/fields";
import type { ColumnMapping, MappingOptions } from "@/lib/import/mapping";
import type { SourceFile, Table } from "@/lib/import/table";
import { decisionErrors, validateImport, type ImportPreview, type ImportRowStatus, type SkuDecision } from "@/lib/import/validate";
import { buildOrderPlan, changeLabel, PLAN_LABELS, type OrderPlan, type PlanKind } from "@/lib/orders/plan";
import { settlementFeesFor } from "@/lib/orders/settlement";
import { STATUS_LABELS } from "@/lib/orders/status";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/orders/types";
import { OPTIONAL_FIELD_LABELS } from "@/lib/types";
import { useData } from "../data-provider";
import { Badge, Button, Card, cn, ConfirmDialog, inputClass, Segmented } from "../ui";

type Filter = "all" | ImportRowStatus;

const STATUS: Record<ImportRowStatus, { label: string; tone: "green" | "red" | "amber" | "brand" }> = {
  ok: { label: "นำเข้าได้", tone: "green" },
  error: { label: "ผิดพลาด", tone: "red" },
  duplicate: { label: "ซ้ำ", tone: "amber" },
  unmapped: { label: "รอจับคู่", tone: "brand" },
};

const PLAN_TONE: Record<PlanKind, "green" | "brand" | "slate" | "amber" | "red"> = {
  new: "green",
  adopt: "brand",
  update: "brand",
  unchanged: "slate",
  stale: "amber",
  conflict: "red",
};

interface Props {
  source: SourceFile;
  table: Table;
  adapterId: AdapterId;
  mapping: ColumnMapping;
  options: MappingOptions;
  onOptionsChange: (o: MappingOptions) => void;
  onBack: () => void;
  onRestart: () => void;
  onFinished: (done: boolean) => void;
}

interface Result {
  outcome: OrderImportOutcome;
  preview: ImportPreview;
  plan: OrderPlan;
  applied: number;
  fileName: string;
}

const fmtValue = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "number" ? formatNumber(v) : STATUS_LABELS[v as OrderStatus] ?? String(v));

function problemRowsCsv(preview: ImportPreview, table: Table): string {
  return toCsv([
    ["แถวในไฟล์", "สถานะ", "เลขคำสั่งซื้อ", "SKU", "เหตุผล", ...table.headers],
    ...preview.rows
      .filter((r) => r.status !== "ok")
      .map((r) => [r.rowNumber, STATUS[r.status].label, r.orderId, r.sourceSku, r.errors.join(" | "), ...r.cells]),
  ]);
}

export function ImportReview({ source, table, adapterId, mapping, options, onOptionsChange, onBack, onRestart, onFinished }: Props) {
  const { products, skuAliases, sales, orders, batches, settlementEntries, applyOrderPlan } = useData();
  const [decisions, setDecisions] = useState<Record<string, SkuDecision>>({});
  const [statusDecisions, setStatusDecisions] = useState<Record<string, OrderStatus>>({});
  const [newForms, setNewForms] = useState<Record<string, { name: string; cost: string }>>({});
  const [conflictApply, setConflictApply] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const preview = useMemo(
    () =>
      validateImport(table, mapping, options, {
        products,
        aliases: skuAliases,
        existingKeys: new Set(),
        skuDecisions: decisions,
        statusDecisions,
        orderMode: true,
      }),
    [table, mapping, options, products, skuAliases, decisions, statusDecisions],
  );
  const plan = useMemo(
    () =>
      buildOrderPlan(preview.incoming, {
        orders: new Map(orders.map((o) => [o.key, o])),
        sales,
        batchId: "pending",
        now: new Date().toISOString(),
        // ค่าธรรมเนียมจากรายงานการเงินที่นำเข้าแล้ว มีลำดับเหนือไฟล์คำสั่งซื้อ (กันหักซ้ำ/ถูกเขียนทับ)
        settlementFees: (o) => settlementFeesFor(o, settlementEntries),
      }),
    [preview, orders, sales, settlementEntries],
  );
  const planned = plan.orders.map((p) => (p.kind === "conflict" ? { ...p, apply: !!conflictApply[p.key] } : p));
  const toApply = planned.filter((p) => p.apply && p.applicable);

  // SKU ที่ต้องให้ผู้ใช้จับคู่ (ยังไม่พบ หรือเลือกไว้แล้วในขั้นตอนนี้)
  const skuItems = useMemo(() => {
    const map = new Map<string, { sku: string; rows: number; sampleName: string }>();
    for (const r of preview.rows) {
      if (!r.sourceSku || r.status === "duplicate") continue;
      const needs = !r.product || r.product.via === "picked" || r.product.via === "new" || decisions[r.sourceSku];
      if (!needs) continue;
      const item = map.get(r.sourceSku) ?? { sku: r.sourceSku, rows: 0, sampleName: r.productName };
      item.rows++;
      if (!item.sampleName && r.productName) item.sampleName = r.productName;
      map.set(r.sourceSku, item);
    }
    return [...map.values()].filter((i) => preview.unmappedSkus.some((u) => u.sku === i.sku) || decisions[i.sku]);
  }, [preview, decisions]);
  const statusItems = [
    ...preview.unmappedStatuses,
    ...Object.keys(statusDecisions)
      .filter((raw) => !preview.unmappedStatuses.some((u) => u.raw === raw))
      .map((raw) => ({ raw, rows: preview.rows.filter((r) => r.rawStatus === raw).length })),
  ];

  const sameFile = batches.find((b) => b.fileHash && b.fileHash === source.fileHash);
  const rows = preview.rows.filter((r) => filter === "all" || r.status === filter);
  const parseCost = (cost: string) => (cost.trim() === "" ? Number.NaN : Number(cost.replace(/,/g, "")));

  function setDecision(sku: string, value: string) {
    const next = { ...decisions };
    if (!value) delete next[sku];
    else if (value === "new") {
      const form = newForms[sku] ?? { name: skuItems.find((i) => i.sku === sku)?.sampleName || sku, cost: "" };
      setNewForms({ ...newForms, [sku]: form });
      next[sku] = { kind: "new", sku, name: form.name, unitCost: parseCost(form.cost) };
    } else next[sku] = { kind: "product", productId: value.slice(2) };
    setDecisions(next);
  }

  function updateNewForm(sku: string, patch: Partial<{ name: string; cost: string }>) {
    const form = { ...(newForms[sku] ?? { name: sku, cost: "" }), ...patch };
    setNewForms({ ...newForms, [sku]: form });
    setDecisions({ ...decisions, [sku]: { kind: "new", sku, name: form.name, unitCost: parseCost(form.cost) } });
  }

  async function doImport() {
    setConfirmOpen(false);
    setBusy(true);
    setImportError(null);
    try {
      const outcome = await applyOrderPlan(planned, source.fileName, {
        adapterId,
        fileHash: source.fileHash,
        newProducts: preview.newProducts,
        aliases: preview.aliasesToSave,
      });
      setResult({ outcome, preview, plan, applied: toApply.length, fileName: source.fileName });
      onFinished(true);
    } catch (e) {
      setImportError("บันทึกไม่สำเร็จ ไม่มีข้อมูลใดถูกบันทึก (ยกเลิกทั้งชุด): " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const { outcome, preview: p, plan: pl } = result;
    const notImported = p.counts.error + p.counts.unmapped;
    const skipped = pl.counts.unchanged + pl.counts.stale + (pl.counts.conflict - pl.orders.filter((o) => o.kind === "conflict" && conflictApply[o.key]).length);
    return (
      <Card>
        <div className="flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 size={30} />
          </span>
          <h2 className="mt-3 text-lg font-bold text-slate-900">บันทึกเรียบร้อย</h2>
          <p className="text-sm text-slate-500">{result.fileName}</p>
        </div>
        <dl className="num mt-5 grid grid-cols-2 gap-2 text-center sm:grid-cols-4" data-testid="import-summary">
          <SummaryStat label="คำสั่งซื้อใหม่" value={outcome.ordersCreated} tone="text-emerald-600" />
          <SummaryStat label="อัปเดต / ผูกข้อมูลเดิม" value={outcome.ordersUpdated + outcome.ordersAdopted} tone="text-brand-600" />
          <SummaryStat label="ไม่บันทึก (ไม่เปลี่ยน/เก่ากว่า/ข้าม)" value={skipped} tone="text-slate-700" />
          <SummaryStat label="แถวที่ผิดพลาด/รอจับคู่" value={notImported} tone="text-rose-600" />
        </dl>
        <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
          <li>
            • รายการขาย: เพิ่ม {formatNumber(outcome.salesAdded)} · ปรับปรุง {formatNumber(outcome.salesUpdated)} (ต้นทุน ณ วันนำเข้าเดิมไม่เปลี่ยน)
          </li>
          {outcome.createdProducts > 0 && <li>• สร้างสินค้าใหม่ {formatNumber(outcome.createdProducts)} รายการ (ตามที่คุณยืนยัน)</li>}
          {outcome.savedAliases > 0 && <li>• จำการจับคู่ SKU {formatNumber(outcome.savedAliases)} รายการ ไว้ใช้ครั้งต่อไป</li>}
          {outcome.restorePointCreated && <li>• สร้างจุดกู้คืนก่อนบันทึกแล้ว — ย้อนกลับได้ที่หน้า “สำรองและตั้งค่า”</li>}
          <li>• ประวัติการเปลี่ยนแปลงดูได้ที่หน้า “คำสั่งซื้อ”</li>
        </ul>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Link href="/" className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-600 px-4 font-medium text-white">
            ดูภาพรวม
          </Link>
          <Button variant="secondary" onClick={onRestart}>
            นำเข้าไฟล์อื่น
          </Button>
          {notImported > 0 && (
            <Button variant="ghost" className="sm:col-span-2" onClick={() => downloadText(`ไม่ได้นำเข้า_${result.fileName.replace(/\.[^.]+$/, "")}.csv`, problemRowsCsv(p, table))}>
              <Download size={16} /> ดาวน์โหลดรายการที่ไม่ได้นำเข้า ({formatNumber(notImported)})
            </Button>
          )}
          <Link href="/settings" className="inline-flex h-9 items-center justify-center gap-1 text-sm font-medium text-brand-700 sm:col-span-2">
            <ShieldCheck size={16} /> สำรองข้อมูล (แนะนำหลังนำเข้า)
          </Link>
        </div>
      </Card>
    );
  }

  const c = preview.counts;
  const changedOrders = planned.filter((p) => p.kind !== "new" && p.kind !== "unchanged");
  return (
    <div className="space-y-4">
      {preview.fileErrors.length > 0 ? (
        <Card>
          {preview.fileErrors.map((e) => (
            <p key={e} className="flex gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
              <XCircle size={18} className="shrink-0" /> {e}
            </p>
          ))}
          <Button variant="secondary" className="mt-3 w-full" onClick={onBack}>
            <ArrowLeft size={18} /> กลับไปแก้การจับคู่
          </Button>
        </Card>
      ) : (
        <>
          <Card>
            <h2 className="font-semibold text-slate-900">ผลการตรวจสอบแถว</h2>
            <dl className="num mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-5" data-testid="import-counts">
              <SummaryStat label="ทั้งหมด" value={c.total} tone="text-slate-900" />
              <SummaryStat label="นำเข้าได้" value={c.ok} tone="text-emerald-600" />
              <SummaryStat label="ผิดพลาด" value={c.error} tone="text-rose-600" />
              <SummaryStat label="ซ้ำ" value={c.duplicate} tone="text-amber-600" />
              <SummaryStat label="รอจับคู่" value={c.unmapped} tone="text-brand-600" />
            </dl>

            {sameFile && (
              <Notice tone="amber">
                ไฟล์นี้เคยนำเข้าแล้วเมื่อ {new Date(sameFile.importedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })} — คำสั่งซื้อที่ไม่เปลี่ยนจะไม่ถูกบันทึกซ้ำ
              </Notice>
            )}
            {preview.missingFields.length > 0 && (
              <Notice tone="slate">
                ไฟล์ไม่มีข้อมูล: <b>{preview.missingFields.map((f) => OPTIONAL_FIELD_LABELS[f]).join(", ")}</b> — ระบบจะบันทึกว่า “ไม่มีข้อมูล” (ไม่ใช่ศูนย์) และแสดงผลเป็น
                <b> กำไรโดยประมาณ</b>
              </Notice>
            )}
            {preview.orderLevelHints.map((h) => (
              <Notice key={h.field} tone="amber">
                <p>
                  “{FIELD_BY_KEY[h.field].label}” มีค่าเท่ากันทุกบรรทัดใน {formatNumber(h.repeatedOrders)} คำสั่งซื้อที่มีหลายสินค้า — อาจเป็นค่าของทั้งคำสั่งซื้อที่ไฟล์แสดงซ้ำ
                  ถ้าใช่ ต้องเลือก “ทั้งคำสั่งซื้อ” มิฉะนั้นจะถูกหักซ้ำ
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  onClick={() => onOptionsChange({ ...options, scopes: { ...options.scopes, [h.field]: "order" } })}
                >
                  ใช้เป็นค่าของทั้งคำสั่งซื้อ
                </Button>
              </Notice>
            ))}
          </Card>

          {statusItems.length > 0 && (
            <Card>
              <h2 className="flex items-center gap-2 font-semibold text-slate-900">
                <ListChecks size={18} /> จับคู่สถานะคำสั่งซื้อ ({formatNumber(statusItems.length)})
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                ระบบไม่เดาความหมายของสถานะจากแพลตฟอร์ม เลือกสถานะที่ตรงกัน — “รอชำระ” และ “ยกเลิก” จะไม่นับในกำไร
              </p>
              <ul className="mt-3 space-y-2">
                {statusItems.map((s) => (
                  <li key={s.raw} className="flex flex-wrap items-center gap-2 rounded-2xl p-3 ring-1 ring-slate-200" data-status-raw={s.raw}>
                    <span className="min-w-0 flex-1 text-sm">
                      <b>“{s.raw}”</b> <span className="text-xs text-slate-500">· {formatNumber(s.rows)} แถว</span>
                    </span>
                    <select
                      aria-label={`จับคู่สถานะ ${s.raw}`}
                      className={cn(inputClass, "sm:w-56")}
                      value={statusDecisions[s.raw] ?? ""}
                      onChange={(e) => {
                        const next = { ...statusDecisions };
                        if (e.target.value) next[s.raw] = e.target.value as OrderStatus;
                        else delete next[s.raw];
                        setStatusDecisions(next);
                      }}
                    >
                      <option value="">— รอจับคู่ (ไม่นำเข้า) —</option>
                      {ORDER_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {STATUS_LABELS[st]}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {skuItems.length > 0 && (
            <Card>
              <h2 className="flex items-center gap-2 font-semibold text-slate-900">
                <PackagePlus size={18} /> จับคู่สินค้า ({formatNumber(skuItems.length)} SKU)
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                SKU ในไฟล์ที่ไม่พบในระบบ เลือกสินค้าที่ถูกต้อง หรือสร้างเป็นสินค้าใหม่ — ระบบจะไม่สร้างสินค้าให้เองโดยไม่ได้รับการยืนยัน รายการที่ยังรอจับคู่จะไม่ถูกนำเข้า
              </p>
              <ul className="mt-3 space-y-3">
                {skuItems.map((item) => {
                  const d = decisions[item.sku];
                  const value = !d ? "" : d.kind === "new" ? "new" : `p:${d.productId}`;
                  const errs = d ? decisionErrors(item.sku, d, { products }) : [];
                  const form = newForms[item.sku];
                  return (
                    <li key={item.sku} className="rounded-2xl p-3 ring-1 ring-slate-200" data-sku={item.sku}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-semibold text-slate-900">{item.sku}</p>
                          <p className="truncate text-xs text-slate-500">
                            {item.sampleName || "ไม่มีชื่อสินค้าในไฟล์"} · {formatNumber(item.rows)} แถว
                          </p>
                        </div>
                        {d && !errs.length ? <Badge tone="green">จับคู่แล้ว</Badge> : <Badge tone="brand">รอจับคู่</Badge>}
                      </div>
                      <select aria-label={`จับคู่ SKU ${item.sku}`} className={cn(inputClass, "mt-2")} value={value} onChange={(e) => setDecision(item.sku, e.target.value)}>
                        <option value="">— รอจับคู่ (ไม่นำเข้า) —</option>
                        {products
                          .slice()
                          .sort((a, b) => a.sku.localeCompare(b.sku))
                          .map((p) => (
                            <option key={p.id} value={`p:${p.id}`}>
                              {p.sku} · {p.name}
                            </option>
                          ))}
                        <option value="new">+ สร้างเป็นสินค้าใหม่ (SKU {item.sku})</option>
                      </select>
                      {d?.kind === "new" && form && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <label className="col-span-2 text-xs text-slate-600 sm:col-span-1">
                            ชื่อสินค้าใหม่
                            <input className={cn(inputClass, "mt-1")} value={form.name} onChange={(e) => updateNewForm(item.sku, { name: e.target.value })} />
                          </label>
                          <label className="col-span-2 text-xs text-slate-600 sm:col-span-1">
                            ต้นทุนต่อชิ้น (บาท)
                            <input
                              className={cn(inputClass, "num mt-1")}
                              inputMode="decimal"
                              placeholder="0.00"
                              value={form.cost}
                              onChange={(e) => updateNewForm(item.sku, { cost: e.target.value })}
                            />
                          </label>
                        </div>
                      )}
                      {errs.length > 0 && <p className="mt-1 text-xs text-rose-600">{errs.join(" · ")}</p>}
                      {d?.kind === "product" && !errs.length && <p className="mt-1 text-xs text-slate-500">ระบบจะจำการจับคู่นี้ไว้ใช้ครั้งต่อไป</p>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          <Card>
            <h2 className="flex items-center gap-2 font-semibold text-slate-900">
              <GitCompare size={18} /> เทียบกับข้อมูลในระบบ ({formatNumber(plan.orders.length)} คำสั่งซื้อ)
            </h2>
            <dl className="num mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-6" data-testid="plan-counts">
              {(Object.keys(PLAN_LABELS) as PlanKind[]).map((k) => (
                <SummaryStat key={k} label={PLAN_LABELS[k]} value={plan.counts[k]} tone={k === "conflict" ? "text-rose-600" : k === "stale" ? "text-amber-600" : "text-slate-900"} />
              ))}
            </dl>
            {changedOrders.length > 0 && (
              <ul className="mt-3 max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
                {changedOrders.slice(0, 100).map((p) => (
                  <li key={p.key} className="py-2.5 text-sm" data-order={p.orderId} data-plan={p.kind}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-slate-800">
                        {p.orderId} <span className="text-xs font-normal text-slate-500">· {p.channel}</span>
                      </span>
                      <Badge tone={PLAN_TONE[p.kind]}>{PLAN_LABELS[p.kind]}</Badge>
                    </div>
                    {p.reasons.length > 0 && (
                      <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
                        {p.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    )}
                    {p.changes.length > 0 && p.kind !== "stale" && (
                      <ul className="num mt-1 space-y-0.5 text-xs text-slate-500">
                        {p.changes.slice(0, 8).map((ch, i) => (
                          <li key={i}>
                            {ch.lineKey ? `${ch.lineKey.replace(/^sku:/, "").split("|")[0]} · ` : ""}
                            {changeLabel(ch.field)}: {fmtValue(ch.from)} → {fmtValue(ch.to)}
                          </li>
                        ))}
                        {p.changes.length > 8 && <li>…และอีก {p.changes.length - 8} รายการ</li>}
                      </ul>
                    )}
                    {p.kind === "conflict" && p.applicable && (
                      <label className="mt-2 flex items-start gap-2 rounded-xl bg-rose-50 p-2 text-xs text-rose-900">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4"
                          checked={!!conflictApply[p.key]}
                          onChange={(e) => setConflictApply({ ...conflictApply, [p.key]: e.target.checked })}
                        />
                        <span>บันทึกตามไฟล์นี้ (บรรทัดที่ไม่อยู่ในไฟล์จะถูกทำเครื่องหมายยกเลิก ไม่ถูกลบ) — ถ้าไม่เลือก จะข้ามคำสั่งซื้อนี้</span>
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="font-semibold text-slate-900">ตัวอย่างข้อมูล</h2>
            <div className="mt-3">
              <Segmented<Filter>
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: `ทั้งหมด ${c.total}` },
                  { value: "ok", label: `นำเข้าได้ ${c.ok}` },
                  { value: "error", label: `ผิดพลาด ${c.error}` },
                  { value: "duplicate", label: `ซ้ำ ${c.duplicate}` },
                  { value: "unmapped", label: `รอจับคู่ ${c.unmapped}` },
                ]}
              />
            </div>
            <ul className="mt-3 max-h-[32rem] divide-y divide-slate-100 overflow-y-auto" data-testid="preview-rows">
              {rows.slice(0, 200).map((r) => (
                <li key={r.rowNumber} className="py-2.5 text-sm" data-row={r.rowNumber} data-status={r.status}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      <span className="mr-2 text-xs text-slate-400">แถว {r.rowNumber}</span>
                      <span className="font-medium text-slate-800">{r.orderId || "—"}</span>
                      <span className="text-slate-500"> · {r.sourceSku || "—"}</span>
                    </span>
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  </div>
                  {(r.status === "ok" || r.status === "unmapped") && (
                    <p className="num mt-0.5 text-xs text-slate-500">
                      {r.date ? formatThaiDate(r.date) : "—"} · {r.channel}
                      {r.orderStatus && r.orderStatus !== "unspecified" && ` · ${STATUS_LABELS[r.orderStatus]}`} · {formatNumber(r.values.quantity)} ×{" "}
                      {formatBaht(r.values.unitPrice)}
                      {r.product && ` → ${r.product.name}${r.product.isNew ? " (ใหม่)" : ""}`} · สุทธิ {formatBaht(r.netRevenue)}
                      {r.estProfit !== null && ` · กำไร ${formatBaht(r.estProfit)}`}
                    </p>
                  )}
                  {r.notes.length > 0 && <p className="mt-0.5 text-xs text-amber-700">{r.notes.join(" · ")}</p>}
                  {r.errors.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
                      {r.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
              {rows.length > 200 && <li className="py-2 text-xs text-slate-500">แสดง 200 แถวแรกจาก {formatNumber(rows.length)} แถว</li>}
              {rows.length === 0 && <li className="py-6 text-center text-sm text-slate-500">ไม่มีแถวในกลุ่มนี้</li>}
            </ul>
            {c.total - c.ok > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => downloadText(`ตรวจสอบ_${source.fileName.replace(/\.[^.]+$/, "")}.csv`, problemRowsCsv(preview, table))}
              >
                <Download size={15} /> ดาวน์โหลดรายการที่มีปัญหา (CSV)
              </Button>
            )}
          </Card>

          <Card>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p className="text-slate-500">ยอดขายสุทธิในไฟล์ (แถวที่นำเข้าได้)</p>
              <p className="num text-right font-semibold">{formatBaht(preview.totals.netRevenue)}</p>
              <p className="text-slate-500">ต้นทุนสินค้า (ต้นทุน ณ วันนี้)</p>
              <p className="num text-right font-semibold">{formatBaht(preview.totals.cogs)}</p>
              <p className="text-slate-500">ค่าธรรมเนียม/ขนส่งในไฟล์</p>
              <p className="num text-right font-semibold">{formatBaht(preview.totals.orderFees)}</p>
              <p className="font-medium text-slate-800">กำไรโดยประมาณ</p>
              <p className={cn("num text-right font-bold", preview.totals.estProfit < 0 ? "text-rose-600" : "text-emerald-600")}>
                {formatBaht(preview.totals.estProfit)}
              </p>
            </div>
            <p className="mt-2 flex gap-1 text-xs text-slate-500">
              <Info size={14} className="mt-0.5 shrink-0" /> รวมทุกแถวที่ตรวจผ่าน (รวมคำสั่งซื้อที่ไม่เปลี่ยน) ยังไม่หักค่าใช้จ่ายที่บันทึกเอง และไม่ใช่กำไรทางบัญชี
            </p>
            {importError && (
              <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
                {importError}
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={onBack}>
                <ArrowLeft size={18} /> ย้อนกลับ
              </Button>
              <Button disabled={toApply.length === 0 || busy} onClick={() => setConfirmOpen(true)}>
                {busy ? "กำลังบันทึก…" : `บันทึก ${formatNumber(toApply.length)} คำสั่งซื้อ`}
              </Button>
            </div>
            {toApply.length === 0 && <p className="mt-2 text-center text-xs text-slate-500">ไม่มีคำสั่งซื้อใหม่หรือที่ต้องอัปเดต — แก้ข้อผิดพลาด จับคู่ หรือเลือกบันทึกคำสั่งซื้อที่ขัดแย้งก่อน</p>}
          </Card>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="ยืนยันการบันทึก"
        confirmLabel={`บันทึก ${formatNumber(toApply.length)} คำสั่งซื้อ`}
        tone="primary"
        onClose={() => setConfirmOpen(false)}
        onConfirm={doImport}
        message={
          <div className="space-y-2">
            <p>
              จะบันทึก <b>{formatNumber(toApply.length)}</b> คำสั่งซื้อจาก <b>{source.fileName}</b>
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              <li>
                ใหม่ {toApply.filter((p) => p.kind === "new").length} · อัปเดต {toApply.filter((p) => p.kind === "update").length} · ผูกข้อมูลเดิม{" "}
                {toApply.filter((p) => p.kind === "adopt").length} · ขัดแย้งที่เลือกบันทึก {toApply.filter((p) => p.kind === "conflict").length}
              </li>
              <li>
                ไม่บันทึก: ไม่เปลี่ยน {plan.counts.unchanged} · ข้อมูลเก่ากว่า {plan.counts.stale} · แถวผิดพลาด {c.error} · ซ้ำ {c.duplicate} · รอจับคู่ {c.unmapped}
              </li>
              {preview.newProducts.length > 0 && (
                <li>
                  สร้างสินค้าใหม่ {preview.newProducts.length} รายการ: {preview.newProducts.map((p) => `${p.sku} (${formatBaht(p.unitCost)})`).join(", ")}
                </li>
              )}
              {preview.aliasesToSave.length > 0 && <li>จำการจับคู่ SKU {preview.aliasesToSave.length} รายการ</li>}
              {preview.missingFields.length > 0 && <li>ไฟล์ไม่มีข้อมูล {preview.missingFields.map((f) => OPTIONAL_FIELD_LABELS[f]).join(", ")} → กำไรเป็นค่าประมาณ</li>}
              <li>ต้นทุน ณ วันนำเข้าของบรรทัดเดิมไม่เปลี่ยน · เก็บประวัติทุกการเปลี่ยนแปลง</li>
              <li>ระบบจะสร้างจุดกู้คืนก่อนบันทึก และบันทึกทั้งชุดในครั้งเดียว ถ้าผิดพลาดจะไม่มีข้อมูลใดถูกบันทึก</li>
            </ul>
          </div>
        }
      />
      {plan.counts.stale > 0 && !result && (
        <p className="flex gap-2 text-xs text-amber-800">
          <AlertTriangle size={14} className="shrink-0" /> คำสั่งซื้อที่ข้อมูลในไฟล์เก่ากว่าข้อมูลในระบบจะไม่ถูกบันทึกทับ
        </p>
      )}
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-2.5">
      <dd className={cn("text-xl font-bold", tone)}>{formatNumber(value)}</dd>
      <dt className="text-[11px] text-slate-500">{label}</dt>
    </div>
  );
}

function Notice({ tone, children }: { tone: "amber" | "slate"; children: React.ReactNode }) {
  return (
    <div className={cn("mt-3 flex gap-2 rounded-xl p-3 text-sm", tone === "amber" ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-700")}>
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
