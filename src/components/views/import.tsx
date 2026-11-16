"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Download, FileSpreadsheet, History, Trash2, Upload, XCircle } from "lucide-react";
import type { ImportOutcome } from "@/lib/db";
import { SALES_COLUMNS, SAMPLE_CSV, validateSalesCsv, type RowStatus, type ValidationResult } from "@/lib/csv";
import { downloadText } from "@/lib/download";
import { formatNumber } from "@/lib/format";
import { useData } from "../data-provider";
import { Badge, Button, buttonClass, Card, cn, ConfirmDialog, Loading, PageHeader, Segmented } from "../ui";

/** อ่านไฟล์เป็น UTF-8 ถ้าอ่านไม่ได้ ลองเป็น Windows-874 (ไฟล์ภาษาไทยจาก Excel รุ่นเก่า) */
async function readFileText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("windows-874").decode(buf);
  } catch {
    return utf8;
  }
}

type Filter = "all" | RowStatus;

export function ImportView() {
  const { ready, products, sales, batches, importSales, deleteBatch, dataset } = useData();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<(ImportOutcome & { fileName: string }) | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [batchToDelete, setBatchToDelete] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const productCosts = useMemo(() => new Map(products.map((p) => [p.sku.toUpperCase(), p.unitCost])), [products]);
  const existingKeys = useMemo(() => new Set(sales.map((s) => s.dedupeKey)), [sales]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setDone(null);
    setReadError(null);
    setImportError(null);
    setFilter("all");
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
      setResult(null);
      setFileName(null);
      setReadError("รองรับเฉพาะไฟล์ .csv — หากเป็น Excel ให้บันทึกเป็น CSV UTF-8 ก่อน");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setReadError("ไฟล์ใหญ่เกิน 10 MB กรุณาแบ่งไฟล์");
      return;
    }
    const text = await readFileText(file);
    setFileName(file.name);
    setResult(validateSalesCsv(text, { productCosts, existingKeys }));
  }

  function reset() {
    setResult(null);
    setFileName(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function doImport() {
    if (!result || !fileName) return;
    setBusy(true);
    try {
      const drafts = result.rows.filter((r) => r.status === "ok" && r.sale).map((r) => r.sale!);
      const outcome = await importSales(drafts, fileName);
      setDone({ ...outcome, fileName });
      reset();
    } catch (e) {
      setImportError("นำเข้าไม่สำเร็จ ไม่มีรายการใดถูกบันทึก: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => (result ? result.rows.filter((r) => filter === "all" || r.status === filter) : []), [result, filter]);
  const missingSkus = useMemo(() => {
    if (!result) return [];
    const set = new Set<string>();
    for (const r of result.rows) {
      const sku = (r.raw.sku ?? "").trim().toUpperCase();
      if (sku && !productCosts.has(sku)) set.add(sku);
    }
    return [...set];
  }, [result, productCosts]);

  if (!ready) return <Loading />;

  return (
    <>
      <PageHeader title="นำเข้ายอดขาย" description="อัปโหลดไฟล์ CSV ระบบจะตรวจสอบทุกแถวก่อนบันทึก และข้ามรายการที่เคยนำเข้าแล้ว" />

      {dataset === "demo" && (
        <div className="mb-4 flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>
            ขณะนี้อยู่ใน <b>โหมด Demo</b> — ไฟล์ที่นำเข้าจะถูกเก็บในชุดข้อมูล Demo ไม่ใช่ข้อมูลจริง หากต้องการนำเข้าข้อมูลจริง ให้สลับเป็น “ข้อมูลจริง” ก่อน
          </p>
        </div>
      )}

      {done && (
        <div className="mb-4 flex gap-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-200">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <p>
            นำเข้า <b>{formatNumber(done.added)}</b> รายการจาก {done.fileName} เรียบร้อย (บันทึกต้นทุนต่อชิ้น ณ วันนี้ไว้กับทุกรายการ)
            {done.skippedDuplicate > 0 && ` · ข้ามรายการซ้ำ ${formatNumber(done.skippedDuplicate)}`}
            {done.skippedMissingProduct > 0 && ` · ข้าม ${formatNumber(done.skippedMissingProduct)} รายการเพราะสินค้าถูกลบระหว่างนำเข้า`} —{" "}
            <Link href="/" className="font-medium underline">
              ดูภาพรวม
            </Link>
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <div
              className={cn(
                "flex flex-col items-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition",
                "border-slate-300 bg-slate-50/50",
              )}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFile(e.dataTransfer.files[0]);
              }}
            >
              <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600">
                <FileSpreadsheet />
              </div>
              <p className="font-medium text-slate-900">เลือกไฟล์ยอดขาย (.csv)</p>
              <p className="mt-1 text-xs text-slate-500">รองรับ UTF-8 และ Windows-874 · ขนาดไม่เกิน 10 MB</p>
              <input
                ref={inputRef}
                id="csv-input"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              <label htmlFor="csv-input" className={buttonClass("primary", "md", "mt-4 cursor-pointer")}>
                <Upload size={18} /> เลือกไฟล์
              </label>
            </div>
            {readError && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{readError}</p>}
          </Card>

          {result && (
            <Card>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-slate-900">ผลการตรวจสอบ</h2>
                  <p className="text-xs text-slate-500">{fileName}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={reset}>
                  ยกเลิกไฟล์นี้
                </Button>
              </div>

              {fileName && batches.some((b) => b.fileName === fileName) && (
                <p className="mb-3 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                  <AlertTriangle size={18} className="shrink-0" />
                  เคยนำเข้าไฟล์ชื่อนี้แล้ว — แถวที่นำเข้าไปแล้วจะถูกข้ามอัตโนมัติ ตรวจสอบว่าไม่ได้เลือกไฟล์ผิด
                </p>
              )}
              {importError && <p className="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{importError}</p>}
              {result.fileErrors.length > 0 ? (
                <div className="space-y-2">
                  {result.fileErrors.map((e) => (
                    <p key={e} className="flex gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
                      <XCircle size={18} className="shrink-0" /> {e}
                    </p>
                  ))}
                  <p className="text-sm text-slate-500">ดาวน์โหลดไฟล์ตัวอย่างเพื่อดูรูปแบบที่ถูกต้อง</p>
                </div>
              ) : (
                <>
                  <div className="mb-4 grid grid-cols-3 gap-2 text-center">
                    <Stat label="ผ่าน" value={result.okCount} tone="text-emerald-600" />
                    <Stat label="ผิดพลาด" value={result.errorCount} tone="text-rose-600" />
                    <Stat label="ซ้ำ (ข้าม)" value={result.duplicateCount} tone="text-amber-600" />
                  </div>

                  {missingSkus.length > 0 && (
                    <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                      ไม่พบ SKU ในหน้าสินค้า: <b>{missingSkus.slice(0, 10).join(", ")}</b>
                      {missingSkus.length > 10 && ` และอีก ${missingSkus.length - 10} รายการ`} —{" "}
                      <Link href="/products" className="font-medium underline">
                        เพิ่มสินค้า
                      </Link>{" "}
                      แล้วเลือกไฟล์ใหม่อีกครั้ง
                    </p>
                  )}

                  <Segmented
                    value={filter}
                    onChange={setFilter}
                    options={[
                      { value: "all", label: `ทั้งหมด ${result.rows.length}` },
                      { value: "ok", label: `ผ่าน ${result.okCount}` },
                      { value: "error", label: `ผิดพลาด ${result.errorCount}` },
                      { value: "duplicate", label: `ซ้ำ ${result.duplicateCount}` },
                    ]}
                  />

                  <ul className="mt-3 max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
                    {rows.slice(0, 500).map((r) => (
                      <li key={r.row} className="py-2.5 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate">
                            <span className="mr-2 text-xs text-slate-400">แถว {r.row}</span>
                            <span className="font-medium text-slate-800">{r.raw.order_id || "—"}</span>
                            <span className="text-slate-500"> · {r.raw.sku || "—"}</span>
                          </span>
                          {r.status === "ok" && <Badge tone="green">ผ่าน</Badge>}
                          {r.status === "error" && <Badge tone="red">ผิดพลาด</Badge>}
                          {r.status === "duplicate" && <Badge tone="amber">ซ้ำ</Badge>}
                        </div>
                        {r.errors.length > 0 && (
                          <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
                            {r.errors.map((e) => (
                              <li key={e}>{e}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                    {rows.length > 500 && <li className="py-2 text-xs text-slate-500">แสดง 500 แถวแรกจาก {formatNumber(rows.length)} แถว</li>}
                    {rows.length === 0 && <li className="py-6 text-center text-sm text-slate-500">ไม่มีแถวในกลุ่มนี้</li>}
                  </ul>

                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <Button className="w-full" disabled={result.okCount === 0 || busy} onClick={doImport}>
                      {busy ? "กำลังนำเข้า…" : `นำเข้า ${formatNumber(result.okCount)} รายการที่ผ่านการตรวจ`}
                    </Button>
                    {(result.errorCount > 0 || result.duplicateCount > 0) && (
                      <p className="mt-2 text-center text-xs text-slate-500">
                        แถวที่ผิดพลาดและแถวซ้ำจะไม่ถูกนำเข้า แก้ไขไฟล์แล้วนำเข้าใหม่ได้ (แถวที่นำเข้าแล้วจะถูกข้ามอัตโนมัติ)
                      </p>
                    )}
                  </div>
                </>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="font-semibold text-slate-900">ไฟล์ตัวอย่าง</h2>
            <p className="mt-1 text-sm text-slate-500">ใช้เป็นแม่แบบ แล้วกรอกข้อมูลจากรายงานของแต่ละแพลตฟอร์ม</p>
            <Button variant="secondary" className="mt-3 w-full" onClick={() => downloadText("profithub_sales_template.csv", "﻿" + SAMPLE_CSV)}>
              <Download size={18} /> ดาวน์โหลดไฟล์ตัวอย่าง
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-full"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(SALES_COLUMNS.map((c) => c.key).join(","));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setCopied(false);
                }
              }}
            >
              <Copy size={15} /> {copied ? "คัดลอกแล้ว" : "คัดลอกหัวคอลัมน์"}
            </Button>
            <ul className="mt-4 space-y-2 text-sm">
              {SALES_COLUMNS.map((c) => (
                <li key={c.key}>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{c.key}</code>{" "}
                  <span className="text-slate-800">{c.label}</span>
                  {c.required ? <span className="text-rose-500"> *</span> : <span className="text-xs text-slate-400"> (ไม่บังคับ)</span>}
                  <p className="text-xs text-slate-500">{c.hint}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
              <b>กันรายการซ้ำ:</b> ช่องทาง + เลขคำสั่งซื้อ + SKU ต้องไม่ซ้ำ หากนำเข้าไฟล์เดิมอีกครั้ง ระบบจะข้ามแถวที่มีอยู่แล้ว
              <br />
              <b>ค่าธรรมเนียม:</b> ถ้าใส่ค่าธรรมเนียมในไฟล์นี้แล้ว ไม่ต้องบันทึกซ้ำในหน้าค่าใช้จ่าย
            </p>
          </Card>

          <Card>
            <h2 className="flex items-center gap-2 font-semibold text-slate-900">
              <History size={18} /> ประวัติการนำเข้า
            </h2>
            {batches.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">ยังไม่มีการนำเข้า</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {[...batches]
                  .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
                  .map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-800">{b.fileName}</p>
                        <p className="text-xs text-slate-500">
                          {new Date(b.importedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })} · {formatNumber(b.rowCount)} รายการ
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" className="shrink-0 text-rose-600" onClick={() => setBatchToDelete(b.id)} aria-label={`ลบชุดนำเข้า ${b.fileName}`}>
                        <Trash2 size={15} />
                      </Button>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={!!batchToDelete}
        title="ลบชุดนำเข้า"
        message={
          <>
            <p>
              รายการขาย <b>{formatNumber(batches.find((b) => b.id === batchToDelete)?.rowCount ?? 0)} รายการ</b> จากไฟล์{" "}
              <b>{batches.find((b) => b.id === batchToDelete)?.fileName}</b> จะถูกลบ (สินค้าและค่าใช้จ่ายไม่ได้รับผลกระทบ)
            </p>
            <p className="mt-2 text-xs text-slate-500">ระบบเก็บจุดกู้คืนอัตโนมัติไว้ก่อนลบ ย้อนกลับได้ที่หน้า “ตั้งค่าข้อมูล”</p>
          </>
        }
        confirmLabel="ลบรายการขาย"
        onClose={() => setBatchToDelete(null)}
        onConfirm={async () => {
          if (batchToDelete) await deleteBatch(batchToDelete);
          setBatchToDelete(null);
          setResult(null);
        }}
      />
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className={cn("num text-xl font-bold", tone)}>{formatNumber(value)}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
