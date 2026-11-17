"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, Download, FlaskConical, History, RotateCcw, ShieldCheck, Trash2, Upload, XCircle } from "lucide-react";
import { MAX_BACKUP_BYTES, parseBackup, restoreImpact, type BackupCheck } from "@/lib/backup";
import { downloadText } from "@/lib/download";
import { formatNumber } from "@/lib/format";
import type { Snapshot, SnapshotCounts } from "@/lib/db";
import { useData } from "../data-provider";
import { Button, buttonClass, Card, ConfirmDialog, inputClass, Loading, Modal, PageHeader } from "../ui";

const fmtTime = (iso: string) => new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });

function CountsRow({ counts }: { counts: SnapshotCounts }) {
  return (
    <span>
      สินค้า {formatNumber(counts.products)} · รายการขาย {formatNumber(counts.sales)} · ค่าใช้จ่าย {formatNumber(counts.expenses)}
    </span>
  );
}

export function SettingsView() {
  const d = useData();
  const { ready, dataset, products, sales, expenses, batches } = d;
  const [confirm, setConfirm] = useState<"clear" | "reset" | null>(null);
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [check, setCheck] = useState<(BackupCheck & { fileName: string }) | null>(null);
  const [restoreTyped, setRestoreTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [pointToRestore, setPointToRestore] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!ready) return <Loading />;
  const isDemo = dataset === "demo";
  const label = isDemo ? "ข้อมูล Demo" : "ข้อมูลจริง";
  const current: SnapshotCounts = { products: products.length, sales: sales.length, expenses: expenses.length, batches: batches.length };
  const hasData = current.products + current.sales + current.expenses > 0;

  async function run(fn: () => Promise<void>, success: string) {
    setBusy(true);
    setFailure(null);
    setMessage(null);
    try {
      await fn();
      setMessage(success);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function backupNow() {
    await run(async () => {
      const { fileName, text } = await d.exportBackup();
      downloadText(fileName, text, "application/json;charset=utf-8");
      d.markBackedUp();
    }, "ดาวน์โหลดไฟล์สำรองข้อมูลแล้ว เก็บไฟล์ไว้ในที่ปลอดภัย (เช่น Google Drive)");
  }

  async function pickBackup(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setMessage(null);
    setFailure(null);
    setRestoreTyped("");
    if (file.size > MAX_BACKUP_BYTES) {
      setCheck({ ok: false, errors: ["ไฟล์ใหญ่เกิน 50 MB"], warnings: [], fileName: file.name });
      return;
    }
    const text = await file.text();
    setCheck({ ...parseBackup(text, dataset), fileName: file.name });
  }

  const restoreWord = "กู้คืน";
  const needTyping = hasData;

  return (
    <>
      <PageHeader title="ตั้งค่าข้อมูล" description="สำรอง กู้คืน และจัดการข้อมูลที่เก็บไว้ในเบราว์เซอร์นี้" />
      {message && (
        <p className="mb-4 flex gap-2 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
          <CheckCircle2 size={18} className="shrink-0" /> {message}
        </p>
      )}
      {failure && (
        <p className="mb-4 flex gap-2 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200">
          <XCircle size={18} className="shrink-0" /> ไม่สำเร็จ ข้อมูลเดิมไม่ถูกเปลี่ยนแปลง: {failure}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="flex items-center gap-2 font-semibold text-slate-900">
            <Database size={18} /> ชุดข้อมูลที่กำลังแสดง
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            ข้อมูลจริงและข้อมูล Demo ถูกเก็บในฐานข้อมูลแยกกัน (<code>profithub-real</code> / <code>profithub-demo</code>) จึงไม่ปะปนกัน
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant={isDemo ? "secondary" : "primary"} onClick={() => d.switchDataset("real")}>
              ข้อมูลจริง
            </Button>
            <Button variant={isDemo ? "primary" : "secondary"} onClick={() => d.startDemo()}>
              <FlaskConical size={18} /> Demo
            </Button>
          </div>
          <dl className="num mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              ["สินค้า", current.products],
              ["รายการขาย", current.sales],
              ["ค่าใช้จ่าย", current.expenses],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-slate-50 p-3">
                <dd className="text-lg font-bold">{formatNumber(Number(v))}</dd>
                <dt className="text-xs text-slate-500">{k}</dt>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 font-semibold text-slate-900">
            <ShieldCheck size={18} /> สำรองข้อมูล (Backup)
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            ดาวน์โหลด{label}ทั้งหมด (สินค้า รายการขายพร้อมต้นทุน ณ วันนำเข้า ค่าใช้จ่าย และประวัติการนำเข้า) เป็นไฟล์ JSON
          </p>
          <p className="mt-2 text-xs text-slate-500">
            สำรองล่าสุด: {d.lastBackupAt ? fmtTime(d.lastBackupAt) : <span className="font-medium text-amber-700">ยังไม่เคยสำรองในเบราว์เซอร์นี้</span>}
          </p>
          <Button className="mt-3 w-full" onClick={backupNow} disabled={busy || !hasData}>
            <Download size={18} /> ดาวน์โหลดไฟล์สำรองข้อมูล
          </Button>
          {!hasData && <p className="mt-2 text-center text-xs text-slate-500">ยังไม่มีข้อมูลให้สำรอง</p>}

          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-medium text-slate-700">การเก็บข้อมูลถาวรในเบราว์เซอร์</p>
            {d.persist === "persisted" && <p className="mt-1 text-emerald-700">เปิดแล้ว — เบราว์เซอร์จะไม่ลบข้อมูลเองเมื่อพื้นที่เต็ม</p>}
            {d.persist === "not-persisted" && (
              <>
                <p className="mt-1">ยังไม่เปิด เบราว์เซอร์อาจลบข้อมูลเมื่อพื้นที่เครื่องใกล้เต็ม</p>
                <Button size="sm" variant="secondary" className="mt-2" onClick={() => d.requestPersist()}>
                  ขอให้เก็บข้อมูลถาวร
                </Button>
                <p className="mt-1 text-[11px] text-slate-500">บางเบราว์เซอร์จะอนุญาตเมื่อใช้งานบ่อยหรือติดตั้งเป็นแอปเท่านั้น</p>
              </>
            )}
            {(d.persist === "unsupported" || d.persist === "unknown") && <p className="mt-1">เบราว์เซอร์นี้ไม่รองรับ — แนะนำให้สำรองข้อมูลเป็นประจำ</p>}
          </div>
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 font-semibold text-slate-900">
            <Upload size={18} /> กู้คืนจากไฟล์สำรอง (Restore)
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            ระบบจะตรวจไฟล์ทั้งหมดก่อน แล้วจึงแทนที่{label}ในครั้งเดียว หากเกิดข้อผิดพลาดกลางทาง ข้อมูลเดิมจะยังอยู่ครบ และจะเก็บจุดกู้คืนของข้อมูลเดิมไว้ให้อัตโนมัติ
          </p>
          <input ref={fileRef} id="backup-input" type="file" accept=".json,application/json" className="sr-only" onChange={(e) => pickBackup(e.target.files?.[0])} />
          <label htmlFor="backup-input" className={buttonClass("secondary", "md", "mt-3 w-full cursor-pointer")}>
            <Upload size={18} /> เลือกไฟล์สำรองข้อมูล (.json)
          </label>
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 font-semibold text-slate-900">
            <History size={18} /> จุดกู้คืนอัตโนมัติ
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            ระบบเก็บสำเนาก่อนการกู้คืน การลบชุดนำเข้า และการลบข้อมูลทั้งหมด (ล่าสุด 5 จุด เก็บในเบราว์เซอร์นี้)
          </p>
          {d.restorePoints.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">ยังไม่มีจุดกู้คืน</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {d.restorePoints.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">{p.reason}</p>
                    <p className="text-xs text-slate-500">
                      {fmtTime(p.createdAt)} · <CountsRow counts={p.counts} />
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setPointToRestore(p.id)}>
                    <RotateCcw size={15} /> ย้อนกลับ
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="font-semibold text-slate-900">ลบข้อมูล</h2>
          <p className="mt-1 text-sm text-slate-500">ข้อมูลอยู่ในเบราว์เซอร์นี้เท่านั้น หากล้างข้อมูลเบราว์เซอร์หรือเปลี่ยนเครื่อง ข้อมูลจะไม่ตามไป ควรดาวน์โหลดไฟล์สำรองก่อนเสมอ</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {isDemo && (
              <Button variant="secondary" onClick={() => setConfirm("reset")}>
                <RotateCcw size={18} /> รีเซ็ตข้อมูล Demo ใหม่
              </Button>
            )}
            <Button
              variant="danger"
              disabled={!hasData}
              onClick={() => {
                setTyped("");
                setConfirm("clear");
              }}
            >
              <Trash2 size={18} /> ลบ{label}ทั้งหมด
            </Button>
          </div>
        </Card>
      </div>

      {/* ผลตรวจไฟล์ + ยืนยันการกู้คืน */}
      <Modal open={!!check} onClose={() => setCheck(null)} title="ตรวจสอบไฟล์สำรองข้อมูล">
        {check && (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-slate-500">{check.fileName}</p>
            {!check.ok ? (
              <>
                <p className="flex gap-2 font-medium text-rose-700">
                  <XCircle size={18} className="shrink-0" /> ไฟล์ไม่ผ่านการตรวจสอบ — ไม่มีการเปลี่ยนแปลงข้อมูล
                </p>
                <ul className="max-h-60 list-disc space-y-1 overflow-y-auto rounded-xl bg-rose-50 p-3 pl-7 text-xs text-rose-800">
                  {check.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
                <Button variant="secondary" className="w-full" onClick={() => setCheck(null)}>
                  ปิด
                </Button>
              </>
            ) : (
              <>
                <p className="flex gap-2 font-medium text-emerald-700">
                  <CheckCircle2 size={18} className="shrink-0" /> ไฟล์ถูกต้อง สำรองเมื่อ {fmtTime(check.backup!.exportedAt)}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-medium text-slate-500">ข้อมูลปัจจุบัน (จะถูกแทนที่)</p>
                    <p className="mt-1 text-xs text-slate-700">
                      <CountsRow counts={current} />
                    </p>
                  </div>
                  <div className="rounded-xl bg-brand-50 p-3">
                    <p className="text-xs font-medium text-brand-700">ข้อมูลจากไฟล์</p>
                    <p className="mt-1 text-xs text-slate-700">
                      <CountsRow counts={check.backup!.counts} />
                    </p>
                  </div>
                </div>
                {(() => {
                  const im = restoreImpact(d as unknown as Snapshot, check.backup!);
                  const items = [
                    im.ordersUpdatedAfter && `คำสั่งซื้อ ${formatNumber(im.ordersUpdatedAfter)} รายการที่อัปเดตหลังวันที่สำรอง`,
                    im.revisionsAfter && `ประวัติการเปลี่ยนแปลง ${formatNumber(im.revisionsAfter)} ครั้ง`,
                    im.refundsAffected && `การคืนเงินใน ${formatNumber(im.refundsAffected)} คำสั่งซื้อ`,
                    im.settlementReportsAfter && `รายงานการเงิน ${formatNumber(im.settlementReportsAfter)} ไฟล์`,
                    im.batchesAfter && `การนำเข้า ${formatNumber(im.batchesAfter)} ครั้ง`,
                    ...im.droppedKinds.map((k) => `${k.label} ทั้งหมด ${formatNumber(k.count)} รายการ (ไฟล์รุ่นเก่าไม่มีข้อมูลนี้)`),
                  ].filter(Boolean) as string[];
                  return items.length ? (
                    <div className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800" data-testid="restore-impact">
                      <p className="font-medium">ข้อมูลต่อไปนี้ในเครื่องจะหายไป (กู้คืนแบบแทนที่ทั้งชุด ไม่มีการกู้คืนบางส่วน):</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {items.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null;
                })()}
                {check.warnings.length > 0 && (
                  <ul className="list-disc space-y-1 rounded-xl bg-amber-50 p-3 pl-7 text-xs text-amber-900">
                    {check.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                {hasData && (
                  <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                    <AlertTriangle size={16} className="shrink-0" />
                    <div>
                      <p>
                        {label}ปัจจุบันทั้งหมดจะถูก<b>แทนที่</b>ด้วยข้อมูลจากไฟล์ ระบบจะเก็บจุดกู้คืนไว้ให้ แต่แนะนำให้ดาวน์โหลดไฟล์สำรองของข้อมูลปัจจุบันก่อน
                      </p>
                      <Button size="sm" variant="secondary" className="mt-2" onClick={backupNow} disabled={busy}>
                        <Download size={15} /> สำรองข้อมูลปัจจุบันก่อน
                      </Button>
                    </div>
                  </div>
                )}
                {needTyping && (
                  <label className="block text-xs text-slate-600">
                    พิมพ์ <b>{restoreWord}</b> เพื่อยืนยัน
                    <input value={restoreTyped} onChange={(e) => setRestoreTyped(e.target.value)} className={inputClass + " mt-1"} />
                  </label>
                )}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button variant="secondary" onClick={() => setCheck(null)}>
                    ยกเลิก
                  </Button>
                  <Button
                    disabled={busy || (needTyping && restoreTyped.trim() !== restoreWord)}
                    onClick={() =>
                      run(async () => {
                        await d.restoreBackup(check.backup!);
                        setCheck(null);
                      }, "กู้คืนข้อมูลสำเร็จ — หากผิดพลาด สามารถย้อนกลับได้จาก “จุดกู้คืนอัตโนมัติ”")
                    }
                  >
                    {busy ? "กำลังกู้คืน…" : "กู้คืนข้อมูล"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!pointToRestore}
        title="ย้อนกลับไปยังจุดกู้คืน"
        message={
          <>
            <p>{label}ปัจจุบันจะถูกแทนที่ด้วยข้อมูล ณ จุดกู้คืนนี้</p>
            <p className="mt-2 text-xs text-slate-500">ระบบจะเก็บข้อมูลปัจจุบันเป็นจุดกู้คืนใหม่ก่อน จึงย้อนกลับได้อีกครั้ง</p>
          </>
        }
        confirmLabel="ย้อนกลับ"
        onClose={() => setPointToRestore(null)}
        onConfirm={() => {
          const id = pointToRestore;
          setPointToRestore(null);
          if (id) void run(() => d.restoreFromPoint(id), "ย้อนกลับไปยังจุดกู้คืนแล้ว");
        }}
      />
      <ConfirmDialog
        open={confirm === "reset"}
        title="รีเซ็ตข้อมูล Demo"
        message="ข้อมูล Demo ทั้งหมดจะถูกลบและสร้างใหม่ (ข้อมูลจริงไม่ได้รับผลกระทบ)"
        confirmLabel="รีเซ็ต"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void run(() => d.resetDemo(), "สร้างข้อมูล Demo ใหม่แล้ว");
        }}
      />
      <ConfirmDialog
        open={confirm === "clear"}
        title={`ลบ${label}ทั้งหมด`}
        message={
          <>
            <p>
              จะลบ <CountsRow counts={current} /> ใน{label}
            </p>
            <p className="mt-2 text-xs text-slate-500">ระบบเก็บจุดกู้คืนไว้ในเบราว์เซอร์นี้ แต่ถ้าล้างข้อมูลเบราว์เซอร์จะกู้คืนไม่ได้ — ดาวน์โหลดไฟล์สำรองก่อน</p>
            {!isDemo && (
              <label className="mt-3 block">
                พิมพ์ <b>ลบ</b> เพื่อยืนยัน
                <input value={typed} onChange={(e) => setTyped(e.target.value)} className={inputClass + " mt-1"} />
              </label>
            )}
          </>
        }
        confirmLabel="ลบทั้งหมด"
        error={!isDemo && typed !== "" && typed.trim() !== "ลบ" ? "พิมพ์คำว่า ลบ ให้ถูกต้อง" : null}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!isDemo && typed.trim() !== "ลบ") {
            setTyped(typed || " ");
            return;
          }
          setConfirm(null);
          void run(() => d.clearCurrent(), `ลบ${label}ทั้งหมดแล้ว (ย้อนกลับได้จากจุดกู้คืนอัตโนมัติ)`);
        }}
      />
    </>
  );
}
