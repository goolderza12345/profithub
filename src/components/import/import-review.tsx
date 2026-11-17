"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, Info, PackagePlus, ShieldCheck, XCircle } from "lucide-react";
import { toCsv } from "@/lib/csv";
import type { ImportOutcome } from "@/lib/db";
import { downloadText } from "@/lib/download";
import { formatThaiDate } from "@/lib/dates";
import { formatBaht, formatNumber } from "@/lib/format";
import type { AdapterId } from "@/lib/import/adapters";
import { FIELD_BY_KEY } from "@/lib/import/fields";
import type { ColumnMapping, MappingOptions } from "@/lib/import/mapping";
import type { SourceFile, Table } from "@/lib/import/table";
import { decisionErrors, validateImport, type ImportPreview, type ImportRowStatus, type SkuDecision } from "@/lib/import/validate";
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
  outcome: ImportOutcome;
  preview: ImportPreview;
  fileName: string;
}

function problemRowsCsv(preview: ImportPreview, table: Table): string {
  return toCsv([
    ["แถวในไฟล์", "สถานะ", "เลขคำสั่งซื้อ", "SKU", "เหตุผล", ...table.headers],
    ...preview.rows
      .filter((r) => r.status !== "ok")
      .map((r) => [r.rowNumber, STATUS[r.status].label, r.orderId, r.sourceSku, r.errors.join(" | "), ...r.cells]),
  ]);
}

export function ImportReview({ source, table, adapterId, mapping, options, onOptionsChange, onBack, onRestart, onFinished }: Props) {
  const { products, skuAliases, sales, batches, importSales } = useData();
  const [decisions, setDecisions] = useState<Record<string, SkuDecision>>({});
  const [newForms, setNewForms] = useState<Record<string, { name: string; cost: string }>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const existingKeys = useMemo(() => new Set(sales.map((s) => s.dedupeKey)), [sales]);
  const preview = useMemo(
    () => validateImport(table, mapping, options, { products, aliases: skuAliases, existingKeys, skuDecisions: decisions }),
    [table, mapping, options, products, skuAliases, existingKeys, decisions],
  );

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
      const drafts = preview.rows.filter((r) => r.status === "ok" && r.draft).map((r) => r.draft!);
      const outcome = await importSales(drafts, source.fileName, {
        adapterId,
        fileHash: source.fileHash,
        newProducts: preview.newProducts,
        aliases: preview.aliasesToSave,
      });
      setResult({ outcome, preview, fileName: source.fileName });
      onFinished(true);
    } catch (e) {
      setImportError("นำเข้าไม่สำเร็จ ไม่มีข้อมูลใดถูกบันทึก (ยกเลิกทั้งชุด): " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const { outcome, preview: p } = result;
    const notImported = p.counts.error + p.counts.unmapped;
    return (
      <Card>
        <div className="flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 size={30} />
          </span>
          <h2 className="mt-3 text-lg font-bold text-slate-900">นำเข้าเรียบร้อย</h2>
          <p className="text-sm text-slate-500">{result.fileName}</p>
        </div>
        <dl className="num mt-5 grid grid-cols-2 gap-2 text-center sm:grid-cols-4" data-testid="import-summary">
          <SummaryStat label="นำเข้าแล้ว" value={outcome.added} tone="text-emerald-600" />
          <SummaryStat label="ข้ามรายการซ้ำ" value={p.counts.duplicate + outcome.skippedDuplicate} tone="text-amber-600" />
          <SummaryStat label="ผิดพลาด (ไม่นำเข้า)" value={p.counts.error} tone="text-rose-600" />
          <SummaryStat label="รอจับคู่ (ไม่นำเข้า)" value={p.counts.unmapped} tone="text-brand-600" />
        </dl>
        <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
          {outcome.createdProducts > 0 && <li>• สร้างสินค้าใหม่ {formatNumber(outcome.createdProducts)} รายการ (ตามที่คุณยืนยัน)</li>}
          {outcome.savedAliases > 0 && <li>• จำการจับคู่ SKU {formatNumber(outcome.savedAliases)} รายการ ไว้ใช้ครั้งต่อไป</li>}
          <li>• บันทึกต้นทุนต่อชิ้น ณ วันนี้ไว้กับทุกรายการ (แก้ต้นทุนภายหลังไม่กระทบกำไรย้อนหลัง)</li>
          {outcome.restorePointCreated && <li>• สร้างจุดกู้คืนก่อนนำเข้าแล้ว — ย้อนกลับได้ที่หน้า “สำรองและตั้งค่า”</li>}
          {outcome.skippedMissingProduct > 0 && <li className="text-amber-700">• ข้าม {outcome.skippedMissingProduct} รายการเพราะสินค้าถูกลบระหว่างนำเข้า</li>}
        </ul>
        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-medium text-slate-800">
            {p.missingFields.length ? "กำไรโดยประมาณ" : "กำไร"}ของรายการที่นำเข้า (ก่อนหักค่าใช้จ่ายที่บันทึกเอง)
          </p>
          <p className={cn("num mt-1 text-xl font-bold", p.totals.estProfit < 0 ? "text-rose-600" : "text-emerald-600")}>{formatBaht(p.totals.estProfit)}</p>
          {p.missingFields.length > 0 && (
            <p className="mt-1 text-xs text-amber-800">ไฟล์ไม่มีข้อมูล: {p.missingFields.map((f) => OPTIONAL_FIELD_LABELS[f]).join(", ")} — ตัวเลขจึงเป็นค่าประมาณ</p>
          )}
        </div>
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
            <h2 className="font-semibold text-slate-900">ผลการตรวจสอบ</h2>
            <dl className="num mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-5" data-testid="import-counts">
              <SummaryStat label="ทั้งหมด" value={c.total} tone="text-slate-900" />
              <SummaryStat label="นำเข้าได้" value={c.ok} tone="text-emerald-600" />
              <SummaryStat label="ผิดพลาด" value={c.error} tone="text-rose-600" />
              <SummaryStat label="ซ้ำ" value={c.duplicate} tone="text-amber-600" />
              <SummaryStat label="รอจับคู่" value={c.unmapped} tone="text-brand-600" />
            </dl>

            {sameFile && (
              <Notice tone="amber">
                ไฟล์นี้เคยนำเข้าแล้วเมื่อ {new Date(sameFile.importedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })} — รายการที่นำเข้าไปแล้วจะถูกข้ามอัตโนมัติ
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
                      <select
                        aria-label={`จับคู่ SKU ${item.sku}`}
                        className={cn(inputClass, "mt-2")}
                        value={value}
                        onChange={(e) => setDecision(item.sku, e.target.value)}
                      >
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
                      {r.date ? formatThaiDate(r.date) : "—"} · {r.channel} · {formatNumber(r.values.quantity)} × {formatBaht(r.values.unitPrice)}
                      {r.product && ` → ${r.product.name}${r.product.isNew ? " (ใหม่)" : ""}`} · สุทธิ {formatBaht(r.netRevenue)}
                      {r.estProfit !== null && ` · กำไร ${formatBaht(r.estProfit)}`}
                    </p>
                  )}
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
              <p className="text-slate-500">ยอดขายสุทธิที่จะนำเข้า</p>
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
              <Info size={14} className="mt-0.5 shrink-0" /> ยังไม่หักค่าใช้จ่ายที่บันทึกเอง (เช่น ค่าโฆษณา) และไม่ใช่กำไรทางบัญชี
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
              <Button disabled={c.ok === 0 || busy} onClick={() => setConfirmOpen(true)}>
                {busy ? "กำลังนำเข้า…" : `นำเข้า ${formatNumber(c.ok)} รายการ`}
              </Button>
            </div>
            {c.ok === 0 && <p className="mt-2 text-center text-xs text-slate-500">ยังไม่มีรายการที่นำเข้าได้ — แก้ข้อผิดพลาดหรือจับคู่สินค้าก่อน</p>}
          </Card>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="ยืนยันการนำเข้า"
        confirmLabel={`นำเข้า ${formatNumber(c.ok)} รายการ`}
        tone="primary"
        onClose={() => setConfirmOpen(false)}
        onConfirm={doImport}
        message={
          <div className="space-y-2">
            <p>
              จะบันทึกรายการขาย <b>{formatNumber(c.ok)}</b> รายการจาก <b>{source.fileName}</b>
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              {c.error + c.duplicate + c.unmapped > 0 && (
                <li>
                  ไม่นำเข้า: ผิดพลาด {c.error} · ซ้ำ {c.duplicate} · รอจับคู่ {c.unmapped}
                </li>
              )}
              {preview.newProducts.length > 0 && (
                <li>
                  สร้างสินค้าใหม่ {preview.newProducts.length} รายการ: {preview.newProducts.map((p) => `${p.sku} (${formatBaht(p.unitCost)})`).join(", ")}
                </li>
              )}
              {preview.aliasesToSave.length > 0 && <li>จำการจับคู่ SKU {preview.aliasesToSave.length} รายการ</li>}
              {preview.missingFields.length > 0 && <li>ไฟล์ไม่มีข้อมูล {preview.missingFields.map((f) => OPTIONAL_FIELD_LABELS[f]).join(", ")} → กำไรเป็นค่าประมาณ</li>}
              <li>ระบบจะสร้างจุดกู้คืนก่อนนำเข้า และบันทึกทั้งชุดในครั้งเดียว ถ้าผิดพลาดจะไม่มีข้อมูลใดถูกบันทึก</li>
            </ul>
          </div>
        }
      />
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
    <div
      className={cn(
        "mt-3 flex gap-2 rounded-xl p-3 text-sm",
        tone === "amber" ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-700",
      )}
    >
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
