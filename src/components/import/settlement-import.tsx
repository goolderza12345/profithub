"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import type { SettlementOutcome } from "@/lib/db";
import { formatBaht, formatNumber } from "@/lib/format";
import { CHANNEL_OPTIONS } from "@/lib/import/parse";
import { buildTable, detectHeaderRow, readSourceFile, type SourceFile } from "@/lib/import/table";
import { toBaht } from "@/lib/money/satang";
import { newId } from "@/lib/id";
import {
  buildSettlementPlan,
  parseSettlement,
  SETTLEMENT_FIELDS,
  settlementMappingProblems,
  suggestSettlementMapping,
  supersedeCandidates,
  type SettlementMapping,
} from "@/lib/orders/settlement";
import { EXPENSE_LABELS } from "@/lib/types";
import { useData } from "../data-provider";
import { Badge, Button, buttonClass, Card, cn, ConfirmDialog, inputClass } from "../ui";

/**
 * นำเข้ารายงานการเงิน (ค่าธรรมเนียมจริง / ยอดโอน) — แยกจากไฟล์คำสั่งซื้อ
 * รองรับเฉพาะรูปแบบ ProfitHub หรือการจับคู่คอลัมน์เอง (ไม่อ้างว่ารองรับรายงานของแพลตฟอร์มใด)
 */
export function SettlementImport() {
  const { orders, expenses, settlementEntries, settlementReports, applySettlement } = useData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [channel, setChannel] = useState("");
  const [negative, setNegative] = useState(false);
  const [source, setSource] = useState<SourceFile | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [mapping, setMapping] = useState<SettlementMapping>({});
  const [step, setStep] = useState<"file" | "mapping" | "review" | "done">("file");
  const [supersede, setSupersede] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SettlementOutcome | null>(null);
  const [reportId] = useState(() => newId());

  const sheet = source?.sheets[0];
  const table = useMemo(() => (sheet ? buildTable(sheet, headerIndex, source!.kind === "csv") : null), [sheet, headerIndex, source]);
  const problems = settlementMappingProblems(mapping);

  const review = useMemo(() => {
    if (step !== "review" || !table) return null;
    const parsed = parseSettlement(table, mapping, { channel, reportId, negativeAsDeduction: negative });
    const plan = buildSettlementPlan(parsed.entries, new Map(settlementEntries.map((e) => [e.entryKey, e])));
    const known = new Set(orders.map((o) => o.key));
    return {
      parsed,
      plan,
      inDb: plan.affectedOrders.filter((k) => known.has(k)).length,
      pending: plan.affectedOrders.filter((k) => !known.has(k)).length,
      candidates: supersedeCandidates(expenses, plan.unassigned, channel),
    };
  }, [step, table, mapping, channel, reportId, negative, settlementEntries, orders, expenses]);
  const sameFile = source && settlementReports.find((r) => r.fileHash === source.fileHash);

  async function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setReadError(null);
    const res = await readSourceFile(file.name, await file.arrayBuffer());
    if (!res.ok) return setReadError(res.error);
    const sh = res.file.sheets.find((s) => s.rows.length) ?? res.file.sheets[0];
    if (!sh.rows.length) return setReadError("ไฟล์ไม่มีข้อมูล");
    setSource({ ...res.file, sheets: [sh] });
    const h = detectHeaderRow(sh.rows);
    setHeaderIndex(h);
    setMapping(suggestSettlementMapping(buildTable(sh, h, res.file.kind === "csv").headers));
    setStep("mapping");
  }

  async function apply() {
    if (!review || !source) return;
    setConfirmOpen(false);
    setBusy(true);
    setError(null);
    try {
      const out = await applySettlement({
        report: { id: reportId, adapterId: "generic", fileName: source.fileName, fileHash: source.fileHash, periodFrom: review.parsed.periodFrom, periodTo: review.parsed.periodTo },
        plan: review.plan,
        channel,
        supersedeExpenseIds: Object.entries(supersede).filter(([, v]) => v).map(([k]) => k),
      });
      setOutcome(out);
      setStep("done");
    } catch (e) {
      setError("บันทึกไม่สำเร็จ ไม่มีข้อมูลใดถูกบันทึก: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setSource(null);
    setStep("file");
    setOutcome(null);
    setSupersede({});
    setError(null);
  }

  if (step === "done" && outcome) {
    return (
      <Card>
        <div className="flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 size={30} />
          </span>
          <h2 className="mt-3 text-lg font-bold text-slate-900">นำเข้ารายงานการเงินแล้ว</h2>
        </div>
        <ul className="mt-4 space-y-1.5 text-sm text-slate-600" data-testid="settlement-summary">
          <li>• รายการใหม่ {formatNumber(outcome.entriesAdded)} · ปรับย้อนหลัง {formatNumber(outcome.entriesRevised)} · มีอยู่แล้ว (ไม่นับซ้ำ) {formatNumber(outcome.entriesAlreadyCounted)}</li>
          <li>• คำนวณค่าธรรมเนียมใหม่ {formatNumber(outcome.ordersRecomputed)} คำสั่งซื้อ (ต้นทุน ณ วันนำเข้าไม่เปลี่ยน)</li>
          {outcome.ordersPending > 0 && <li>• รอคำสั่งซื้อ {formatNumber(outcome.ordersPending)} รายการ — จะใช้ค่าธรรมเนียมนี้เมื่อนำเข้าคำสั่งซื้อ</li>}
          {outcome.expensesCreated > 0 && <li>• ค่าใช้จ่ายระดับร้านจากรายงาน {formatNumber(outcome.expensesCreated)} รายการ</li>}
          {outcome.expensesSuperseded > 0 && <li>• ค่าใช้จ่ายที่กรอกเองถูกแทนด้วยรายงาน {formatNumber(outcome.expensesSuperseded)} รายการ (ไม่นับซ้ำ)</li>}
          {outcome.restorePointCreated && <li>• สร้างจุดกู้คืนก่อนบันทึกแล้ว</li>}
        </ul>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Link href="/orders" className={buttonClass()}>
            ดูคำสั่งซื้อและการกระทบยอด
          </Link>
          <Button variant="secondary" onClick={restart}>
            นำเข้ารายงานอื่น
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-semibold text-slate-900">รายงานการเงิน (ค่าธรรมเนียมจริงและยอดโอน)</h2>
        <p className="mt-1 text-sm text-slate-500">
          ค่าธรรมเนียมจากรายงานจะใช้แทนค่าจากไฟล์คำสั่งซื้อ (นับครั้งเดียว) · ยอดโอนใช้กระทบยอดเท่านั้น ไม่ใช่ยอดขาย · ยังไม่มีรูปแบบรายงานของแพลตฟอร์มที่ผ่านการตรวจสอบ —
          ใช้รูปแบบ ProfitHub หรือจับคู่คอลัมน์เอง
        </p>
        {step === "file" && (
          <>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium text-slate-700">ช่องทางของรายงานนี้ *</span>
              <select aria-label="ช่องทางของรายงาน" className={inputClass} value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="">— เลือกช่องทาง —</option>
                {CHANNEL_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={negative} onChange={(e) => setNegative(e.target.checked)} />
              ไฟล์แสดงค่าธรรมเนียมเป็นตัวเลขติดลบ
            </label>
            <input ref={fileRef} id="settlement-file" type="file" accept=".csv,.xlsx" className="sr-only" disabled={!channel} onChange={(e) => onFile(e.target.files?.[0])} />
            <label htmlFor="settlement-file" className={buttonClass("primary", "md", cn("mt-4 w-full", channel ? "cursor-pointer" : "pointer-events-none opacity-50"))}>
              <Upload size={18} /> เลือกไฟล์รายงานการเงิน
            </label>
            {!channel && <p className="mt-2 text-center text-xs text-slate-500">เลือกช่องทางก่อน</p>}
            {readError && (
              <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
                {readError}
              </p>
            )}
          </>
        )}
      </Card>

      {step === "mapping" && table && sheet && (
        <Card>
          <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <FileSpreadsheet size={16} /> {source!.fileName} · {channel} · {formatNumber(table.rows.length)} แถว
          </p>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block font-medium text-slate-700">แถวหัวตาราง</span>
            <select className={inputClass} value={headerIndex} onChange={(e) => setHeaderIndex(Number(e.target.value))}>
              {sheet.rows.slice(0, 20).map((r, i) => (
                <option key={i} value={i}>
                  แถว {sheet.rowNumbers[i]}: {r.filter(Boolean).slice(0, 3).join(", ").slice(0, 40)}
                </option>
              ))}
            </select>
          </label>
          <ul className="mt-3 divide-y divide-slate-100">
            {SETTLEMENT_FIELDS.map((f) => (
              <li key={f.key} className="py-2.5">
                <p className="text-sm font-medium text-slate-800">{f.label}</p>
                {f.hint && <p className="text-xs text-slate-500">{f.hint}</p>}
                <select
                  aria-label={`คอลัมน์รายงานสำหรับ ${f.label}`}
                  className={cn(inputClass, "mt-1")}
                  value={mapping[f.key] ?? -1}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    const next = { ...mapping };
                    if (v < 0) delete next[f.key];
                    else next[f.key] = v;
                    setMapping(next);
                  }}
                >
                  <option value={-1}>— ไม่มีในไฟล์ —</option>
                  {table.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          {problems.map((p) => (
            <p key={p} className="mt-2 text-sm text-rose-600">
              {p}
            </p>
          ))}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={restart}>
              <ArrowLeft size={18} /> ย้อนกลับ
            </Button>
            <Button disabled={problems.length > 0} onClick={() => setStep("review")}>
              ตรวจสอบรายงาน
            </Button>
          </div>
        </Card>
      )}

      {step === "review" && review && (
        <Card>
          <h2 className="font-semibold text-slate-900">ผลการตรวจสอบรายงาน</h2>
          {sameFile && (
            <p className="mt-3 flex gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800" role="alert">
              <AlertTriangle size={18} className="shrink-0" /> ไฟล์นี้เคยนำเข้าแล้ว — บันทึกซ้ำไม่ได้
            </p>
          )}
          <dl className="num mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4" data-testid="settlement-counts">
            <Stat label="รายการใหม่" value={review.plan.newEntries.length} />
            <Stat label="มีอยู่แล้ว (ไม่นับซ้ำ)" value={review.plan.alreadyCounted.length + review.plan.duplicateInFile.length} />
            <Stat label="ปรับย้อนหลัง" value={review.plan.revised.length} />
            <Stat label="แถวผิดพลาด" value={review.parsed.errors.length} />
          </dl>
          <ul className="mt-3 space-y-1 text-sm text-slate-600">
            <li>• คำสั่งซื้อที่ค่าธรรมเนียมจะถูกคำนวณใหม่: {formatNumber(review.inDb)}</li>
            {review.pending > 0 && <li>• ยังไม่มีคำสั่งซื้อในระบบ {formatNumber(review.pending)} รายการ (จะใช้เมื่อนำเข้าคำสั่งซื้อ)</li>}
            {review.plan.unassigned.length > 0 && (
              <li>
                • ไม่มีเลขคำสั่งซื้อ {formatNumber(review.plan.unassigned.length)} รายการ → ค่าใช้จ่ายระดับร้าน รวม{" "}
                {formatBaht(toBaht(review.plan.unassigned.filter((e) => e.amount > 0).reduce((a, e) => a + e.amount, 0)))}
              </li>
            )}
          </ul>
          {review.plan.revised.length > 0 && (
            <ul className="num mt-2 space-y-0.5 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
              {review.plan.revised.slice(0, 10).map(({ before, after }) => (
                <li key={before.entryKey}>
                  ปรับย้อนหลัง {before.orderKey?.split("|")[1] ?? "ระดับร้าน"} · {before.type}: {formatBaht(toBaht(before.amount))} → {formatBaht(toBaht(after.amount))}
                </li>
              ))}
            </ul>
          )}
          {review.parsed.errors.length > 0 && (
            <ul className="mt-2 max-h-40 list-disc overflow-y-auto rounded-xl bg-rose-50 p-3 pl-7 text-xs text-rose-800">
              {review.parsed.errors.slice(0, 50).map((e, i) => (
                <li key={i}>
                  แถว {e.rowNumber}: {e.message}
                </li>
              ))}
            </ul>
          )}
          {review.candidates.length > 0 && (
            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-800">ค่าใช้จ่ายที่กรอกเองซึ่งอาจซ้ำกับรายงานนี้</p>
              <p className="text-xs text-slate-500">เลือกเพื่อใช้ค่าจากรายงานแทน (รายการที่เลือกจะไม่ถูกนับ แต่ไม่ถูกลบ)</p>
              <ul className="mt-2 space-y-1">
                {review.candidates.map((x) => (
                  <li key={x.id}>
                    <label className="flex items-start gap-2 text-xs">
                      <input type="checkbox" className="mt-0.5 h-4 w-4" checked={!!supersede[x.id]} onChange={(e) => setSupersede({ ...supersede, [x.id]: e.target.checked })} />
                      {x.date} · {EXPENSE_LABELS[x.category]} · {x.channel || "ทุกช่องทาง"} · {formatBaht(x.amount)} {x.note && `· ${x.note}`}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && (
            <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
              {error}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setStep("mapping")}>
              <ArrowLeft size={18} /> ย้อนกลับ
            </Button>
            <Button
              disabled={!!sameFile || busy || review.plan.newEntries.length + review.plan.revised.length + review.plan.alreadyCounted.length === 0}
              onClick={() => setConfirmOpen(true)}
            >
              {busy ? "กำลังบันทึก…" : "บันทึกรายงาน"}
            </Button>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="ยืนยันการนำเข้ารายงานการเงิน"
        confirmLabel="บันทึกรายงาน"
        tone="primary"
        onClose={() => setConfirmOpen(false)}
        onConfirm={apply}
        message={
          review && (
            <ul className="list-disc space-y-1 pl-5 text-xs">
              <li>
                รายการใหม่ {review.plan.newEntries.length} · ปรับย้อนหลัง {review.plan.revised.length} · ไม่นับซ้ำ {review.plan.alreadyCounted.length + review.plan.duplicateInFile.length}
              </li>
              <li>ค่าธรรมเนียมแพลตฟอร์มของคำสั่งซื้อที่อยู่ในรายงาน จะใช้ค่าจากรายงานแทนไฟล์คำสั่งซื้อทั้งหมด (ไม่บวกซ้ำ)</li>
              {Object.values(supersede).some(Boolean) && <li>ค่าใช้จ่ายที่กรอกเอง {Object.values(supersede).filter(Boolean).length} รายการจะไม่ถูกนับ (ไม่ลบ)</li>}
              <li>สร้างจุดกู้คืนก่อนบันทึก และบันทึกทั้งชุดในครั้งเดียว</li>
            </ul>
          )
        }
      />
      {step === "review" && review && review.plan.duplicateInFile.length > 0 && (
        <p className="text-xs text-slate-500">
          <Badge tone="amber">หมายเหตุ</Badge> รหัสรายการซ้ำในไฟล์ {review.plan.duplicateInFile.length} รายการ นับครั้งเดียว
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-50 p-2.5">
      <dd className="text-xl font-bold text-slate-900">{formatNumber(value)}</dd>
      <dt className="text-[11px] text-slate-500">{label}</dt>
    </div>
  );
}
