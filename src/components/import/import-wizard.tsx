"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, FileSpreadsheet, Plus, ShieldAlert, Upload, X } from "lucide-react";
import { ADAPTERS, getAdapter, type AdapterId } from "@/lib/import/adapters";
import { IMPORT_FIELDS, type AmountScope, type ImportFieldKey, type ScopeableField } from "@/lib/import/fields";
import {
  defaultOptions,
  headerFingerprint,
  mappingFromSaved,
  mappingProblems,
  mappingToSaved,
  needsConfirmation,
  suggestMapping,
  type ColumnMapping,
  type MappingOptions,
  type MappingSuggestion,
  type MatchConfidence,
} from "@/lib/import/mapping";
import { CHANNEL_OPTIONS } from "@/lib/import/parse";
import { loadSavedMapping, saveMapping } from "@/lib/import/saved-mappings";
import { buildTable, detectHeaderRow, readSourceFile, type SourceFile } from "@/lib/import/table";
import { formatNumber } from "@/lib/format";
import { useData } from "../data-provider";
import { Badge, Button, buttonClass, Card, cn, inputClass, Segmented } from "../ui";
import { ImportReview } from "./import-review";

type Step = "source" | "mapping" | "review";

const STEPS: { id: Step | "done"; label: string }[] = [
  { id: "source", label: "เลือกไฟล์" },
  { id: "mapping", label: "จับคู่คอลัมน์" },
  { id: "review", label: "ตรวจสอบ" },
  { id: "done", label: "สรุปผล" },
];

const CONF_LABEL: Record<MatchConfidence, { text: string; tone: "green" | "amber" | "brand" | "slate" }> = {
  verified: { text: "ตรงรูปแบบที่ยืนยันแล้ว", tone: "green" },
  alias: { text: "ชื่อคอลัมน์ตรงกัน", tone: "green" },
  saved: { text: "จำจากครั้งก่อน", tone: "brand" },
  fuzzy: { text: "ระบบเดา — โปรดตรวจ", tone: "amber" },
  manual: { text: "เลือกเอง", tone: "slate" },
};

export function StepIndicator({ current }: { current: Step | "done" }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <ol className="mb-4 grid grid-cols-4 gap-1" aria-label="ขั้นตอนการนำเข้า">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex flex-col items-center gap-1 text-center" aria-current={i === idx ? "step" : undefined}>
          <span
            className={cn(
              "h-1.5 w-full rounded-full",
              i < idx ? "bg-brand-600" : i === idx ? "bg-brand-400" : "bg-slate-200",
            )}
          />
          <span className={cn("text-[11px] font-medium", i === idx ? "text-brand-700" : "text-slate-500")}>
            {i + 1}. {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ImportWizard() {
  const { dataset } = useData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("source");
  const [adapterId, setAdapterId] = useState<AdapterId>("generic");
  const [source, setSource] = useState<SourceFile | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [suggestion, setSuggestion] = useState<MappingSuggestion>({ mapping: {}, confidence: {} });
  const [options, setOptions] = useState<MappingOptions>(defaultOptions(getAdapter("generic")));
  const [confirmed, setConfirmed] = useState(false);
  const [finished, setFinished] = useState(false);

  const adapter = getAdapter(adapterId);
  const sheet = source?.sheets[sheetIndex];
  const table = useMemo(
    () => (sheet ? buildTable(sheet, headerIndex, source!.kind === "csv") : null),
    [sheet, headerIndex, source],
  );

  function suggestFor(headers: string[], a = adapter): { s: MappingSuggestion; o: MappingOptions } {
    const saved = loadSavedMapping(headerFingerprint(a.id, headers));
    const fromSaved = saved && mappingFromSaved(saved.columns, headers);
    if (saved && fromSaved) return { s: fromSaved, o: { ...saved.options, fixedChannel: a.channel ?? saved.options.fixedChannel } };
    return { s: suggestMapping(headers, a), o: defaultOptions(a) };
  }

  function prepare(file: SourceFile, sheetIdx: number, headerIdx: number | null, a = adapter) {
    const sh = file.sheets[sheetIdx];
    const hIdx = headerIdx ?? detectHeaderRow(sh.rows);
    const t = buildTable(sh, hIdx, file.kind === "csv");
    const { s, o } = suggestFor(t.headers, a);
    setSheetIndex(sheetIdx);
    setHeaderIndex(hIdx);
    setSuggestion(s);
    setOptions(o);
    setConfirmed(false);
  }

  async function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setReadError(null);
    setReading(true);
    try {
      const res = await readSourceFile(file.name, await file.arrayBuffer());
      if (!res.ok) {
        setReadError(res.error);
        return;
      }
      const firstWithData = Math.max(0, res.file.sheets.findIndex((s) => s.rows.length > 0));
      if (!res.file.sheets[firstWithData]?.rows.length) {
        setReadError("ไฟล์ไม่มีข้อมูล");
        return;
      }
      setSource(res.file);
      prepare(res.file, firstWithData, null);
      setFinished(false);
      setStep("mapping");
    } finally {
      setReading(false);
    }
  }

  function restart() {
    setSource(null);
    setStep("source");
    setReadError(null);
    setFinished(false);
  }

  const setMapping = (key: ImportFieldKey, cols: number[]) => {
    setSuggestion((s) => {
      const mapping: ColumnMapping = { ...s.mapping, [key]: cols.filter((c) => c >= 0) };
      const confidence = { ...s.confidence, [key]: "manual" as MatchConfidence };
      if (!mapping[key]!.length) {
        delete mapping[key];
        delete confidence[key];
      }
      return { mapping, confidence };
    });
    setConfirmed(false);
  };

  const problems = table ? mappingProblems(suggestion.mapping, options, table.headers) : [];
  const mustConfirm = needsConfirmation(adapter, suggestion);
  const sample = table?.rows[0]?.cells ?? [];
  const reviewMode = step === "review" && table;

  function toReview() {
    if (!table) return;
    saveMapping(headerFingerprint(adapter.id, table.headers), {
      columns: mappingToSaved(suggestion.mapping, table.headers),
      options,
      savedAt: new Date().toISOString(),
    });
    setStep("review");
  }

  return (
    <div>
      <StepIndicator current={finished ? "done" : step} />

      {step === "source" && (
        <div className="space-y-4">
          <Card>
            <h2 className="font-semibold text-slate-900">แหล่งข้อมูลของไฟล์</h2>
            <p className="mt-1 text-sm text-slate-500">แต่ละแพลตฟอร์มใช้รูปแบบไฟล์ต่างกัน เลือกให้ตรงกับไฟล์ที่จะนำเข้า</p>
            <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="แหล่งข้อมูล">
              {ADAPTERS.map((a) => (
                <button
                  key={a.id}
                  role="radio"
                  aria-checked={a.id === adapterId}
                  onClick={() => setAdapterId(a.id)}
                  className={cn(
                    "rounded-2xl p-3 text-left ring-1 transition",
                    a.id === adapterId ? "bg-brand-50 ring-2 ring-brand-500" : "bg-white ring-slate-200",
                  )}
                >
                  <p className="text-sm font-semibold text-slate-900">{a.label}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{a.description}</p>
                  <span className="mt-2 inline-block">
                    {a.verified ? <Badge tone="green">ใช้งานได้</Badge> : <Badge tone="amber">ยังไม่ยืนยันรูปแบบไฟล์</Badge>}
                  </span>
                </button>
              ))}
            </div>
            {!adapter.verified && (
              <p className="mt-3 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                <ShieldAlert size={18} className="shrink-0" />
                <span>{adapter.supportNote}</span>
              </p>
            )}
          </Card>

          <Card>
            <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/50 px-4 py-8 text-center">
              <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600">
                <FileSpreadsheet />
              </div>
              <p className="font-medium text-slate-900">เลือกไฟล์ยอดขาย (.csv หรือ .xlsx)</p>
              <p className="mt-1 text-xs text-slate-500">รองรับภาษาไทย UTF-8, UTF-16 และ Windows-874 · ไม่เกิน 10 MB / 20,000 แถว</p>
              <input
                ref={fileRef}
                id="import-file"
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <label htmlFor="import-file" className={buttonClass("primary", "md", "mt-4 cursor-pointer")}>
                <Upload size={18} /> {reading ? "กำลังอ่านไฟล์…" : "เลือกไฟล์"}
              </label>
              {dataset === "demo" && <p className="mt-3 text-xs font-medium text-amber-700">โหมด Demo: ไฟล์จะถูกนำเข้าในชุดข้อมูล Demo</p>}
            </div>
            {readError && (
              <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
                {readError}
              </p>
            )}
          </Card>
        </div>
      )}

      {step === "mapping" && source && table && sheet && (
        <div className="space-y-4">
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{source.fileName}</p>
                <p className="text-xs text-slate-500">
                  {source.kind === "xlsx" ? "Excel (.xlsx)" : `CSV · ${source.encoding}`} · {adapter.label} · {formatNumber(table.rows.length)} แถวข้อมูล
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={restart}>
                เปลี่ยนไฟล์
              </Button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {source.sheets.length > 1 && (
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">ชีต</span>
                  <select className={inputClass} value={sheetIndex} onChange={(e) => prepare(source, Number(e.target.value), null)}>
                    {source.sheets.map((s, i) => (
                      <option key={i} value={i}>
                        {s.name} ({formatNumber(s.rows.length)} แถว)
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">แถวหัวตาราง</span>
                <select className={inputClass} value={headerIndex} onChange={(e) => prepare(source, sheetIndex, Number(e.target.value))}>
                  {sheet.rows.slice(0, 20).map((r, i) => (
                    <option key={i} value={i}>
                      แถว {sheet.rowNumbers[i]}: {r.filter(Boolean).slice(0, 3).join(", ").slice(0, 40)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!adapter.verified && (
              <details className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                <summary className="cursor-pointer font-medium">
                  <AlertTriangle size={16} className="mr-1 inline" />
                  รูปแบบไฟล์ {adapter.label} ยังไม่ผ่านการตรวจสอบ — แตะเพื่ออ่านคำแนะนำ
                </summary>
                <p className="mt-2">{adapter.supportNote}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                  {adapter.tips.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

          <Card>
            <h2 className="font-semibold text-slate-900">จับคู่คอลัมน์</h2>
            <p className="mt-1 text-xs text-slate-500">
              เลือกคอลัมน์ในไฟล์ที่ตรงกับแต่ละช่อง ช่องที่ไม่บังคับถ้าเลือก “ไม่มีในไฟล์” ระบบจะบันทึกว่า <b>ไม่มีข้อมูล</b> (ไม่ใช่ศูนย์) และแสดงกำไรเป็นค่าประมาณ
              · ถ้าเลือกคอลัมน์แล้วแต่ช่องว่าง จะถือว่าเป็น 0
            </p>
            <ul className="mt-3 divide-y divide-slate-100">
              {IMPORT_FIELDS.map((f) => {
                if (f.key === "channel" && adapter.channel) {
                  return (
                    <li key={f.key} className="py-3 text-sm">
                      <span className="font-medium text-slate-800">{f.label}</span>
                      <span className="ml-2 text-slate-500">{adapter.channel} (ทั้งไฟล์)</span>
                    </li>
                  );
                }
                const cols = suggestion.mapping[f.key] ?? [];
                const conf = suggestion.confidence[f.key];
                const problem = problems.find((p) => p.field === f.key);
                const required = f.required === true || (f.required === "price" && !suggestion.mapping.unitPrice && !suggestion.mapping.lineTotal);
                return (
                  <li key={f.key} className="py-3" data-field={f.key}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800">
                        {f.label}
                        {required && <span className="text-rose-500"> *</span>}
                      </p>
                      {conf && <Badge tone={CONF_LABEL[conf].tone}>{CONF_LABEL[conf].text}</Badge>}
                    </div>
                    <p className="text-xs text-slate-500">{f.hint}</p>
                    <div className="mt-2 space-y-2">
                      {(cols.length ? cols : [-1]).map((col, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <select
                            aria-label={`คอลัมน์สำหรับ ${f.label}${i ? ` (${i + 1})` : ""}`}
                            className={cn(inputClass, "min-w-0 flex-1", conf === "fuzzy" && "border-amber-400")}
                            value={col}
                            onChange={(e) => {
                              const next = [...cols];
                              next[i] = Number(e.target.value);
                              setMapping(f.key, next);
                            }}
                          >
                            <option value={-1}>— ไม่มีในไฟล์ —</option>
                            {table.headers.map((h, ci) => (
                              <option key={ci} value={ci}>
                                {h}
                                {sample[ci] ? ` (เช่น ${sample[ci].slice(0, 20)})` : ""}
                              </option>
                            ))}
                          </select>
                          {i > 0 && (
                            <button
                              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200"
                              aria-label={`ลบคอลัมน์ที่ ${i + 1} ของ ${f.label}`}
                              onClick={() => setMapping(f.key, cols.filter((_, j) => j !== i))}
                            >
                              <X size={18} />
                            </button>
                          )}
                        </div>
                      ))}
                      {f.multi && cols.length > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={firstFree(table.headers.length, suggestion.mapping).length === 0}
                          onClick={() => setMapping(f.key, [...cols, ...firstFree(table.headers.length, suggestion.mapping)])}
                        >
                          <Plus size={15} /> รวมอีกคอลัมน์
                        </Button>
                      )}
                      {f.key === "channel" && !cols.length && (
                        <label className="block text-xs text-slate-600">
                          ช่องทางเดียวสำหรับทั้งไฟล์
                          <select
                            className={cn(inputClass, "mt-1")}
                            value={options.fixedChannel ?? ""}
                            onChange={(e) => setOptions({ ...options, fixedChannel: e.target.value || null })}
                          >
                            <option value="">— เลือกช่องทาง —</option>
                            {CHANNEL_OPTIONS.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {isScopeable(f.key) && cols.length > 0 && (
                        <div className="text-xs text-slate-600">
                          <p className="mb-1">ค่านี้ในไฟล์เป็นของ</p>
                          <Segmented<AmountScope>
                            value={options.scopes[f.key]}
                            onChange={(v) => setOptions({ ...options, scopes: { ...options.scopes, [f.key]: v } })}
                            options={[
                              { value: "line", label: "แต่ละบรรทัด" },
                              { value: "order", label: "ทั้งคำสั่งซื้อ (ซ้ำทุกบรรทัด)" },
                            ]}
                          />
                        </div>
                      )}
                    </div>
                    {problem && <p className="mt-1 text-xs text-rose-600">{problem.message}</p>}
                  </li>
                );
              })}
            </ul>

            <label className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={options.negativeAsDeduction}
                onChange={(e) => setOptions({ ...options, negativeAsDeduction: e.target.checked })}
              />
              <span>
                ไฟล์แสดงรายการหัก (ส่วนลด เงินคืน ค่าธรรมเนียม ค่าขนส่ง) เป็นตัวเลขติดลบ
                <span className="block text-xs text-slate-500">ถ้าเลือก ระบบจะใช้ค่าสัมบูรณ์ ถ้าไม่เลือก ค่าติดลบจะถูกแจ้งเป็นข้อผิดพลาด</span>
              </span>
            </label>

            {problems.filter((p) => !p.field || !IMPORT_FIELDS.some((f) => f.key === p.field)).map((p) => (
              <p key={p.message} className="mt-2 text-sm text-rose-600">
                {p.message}
              </p>
            ))}
            {problems.length > 0 && (
              <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
                ยังจับคู่คอลัมน์ไม่ครบ ({problems.length} รายการ) — แก้ไขช่องที่มีข้อความสีแดง
              </p>
            )}

            {mustConfirm && (
              <label className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>ฉันตรวจสอบแล้วว่าแต่ละช่องตรงกับคอลัมน์ที่ถูกต้อง{!adapter.verified && " (รูปแบบไฟล์นี้ยังไม่ผ่านการตรวจสอบจากระบบ)"}</span>
              </label>
            )}
            {!mustConfirm && problems.length === 0 && Object.keys(suggestion.confidence).length > 0 && (
              <p className="mt-3 flex items-center gap-2 text-xs text-emerald-700">
                <BadgeCheck size={16} /> จับคู่คอลัมน์ได้ตรงกับรูปแบบที่รู้จัก
              </p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={restart}>
                <ArrowLeft size={18} /> ย้อนกลับ
              </Button>
              <Button disabled={problems.length > 0 || (mustConfirm && !confirmed)} onClick={toReview}>
                ตรวจสอบข้อมูล <ArrowRight size={18} />
              </Button>
            </div>
          </Card>
        </div>
      )}

      {reviewMode && source && (
        <ImportReview
          source={source}
          table={table}
          adapterId={adapter.id}
          mapping={suggestion.mapping}
          options={options}
          onOptionsChange={setOptions}
          onBack={() => {
            setFinished(false);
            setStep("mapping");
          }}
          onRestart={restart}
          onFinished={setFinished}
        />
      )}
    </div>
  );
}

const isScopeable = (k: ImportFieldKey): k is ScopeableField => (["discount", "refund", "platformFee", "shippingFee"] as string[]).includes(k);

/** คอลัมน์แรกที่ยังไม่ถูกใช้ (สำหรับปุ่ม "รวมอีกคอลัมน์") */
function firstFree(count: number, mapping: ColumnMapping): number[] {
  const used = new Set(Object.values(mapping).flat());
  for (let i = 0; i < count; i++) if (!used.has(i)) return [i];
  return [];
}
