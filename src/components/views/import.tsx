"use client";

import { useState } from "react";
import { AlertTriangle, Copy, Download, History, Trash2 } from "lucide-react";
import { SALES_COLUMNS, SAMPLE_CSV } from "@/lib/csv";
import { downloadText } from "@/lib/download";
import { formatNumber } from "@/lib/format";
import { ImportWizard } from "../import/import-wizard";
import { useData } from "../data-provider";
import { SettlementImport } from "../import/settlement-import";
import { Button, Card, ConfirmDialog, Loading, PageHeader, Segmented } from "../ui";

export function ImportView() {
  const { ready, batches, deleteBatch, dataset } = useData();
  const [batchToDelete, setBatchToDelete] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"orders" | "settlement">("orders");

  if (!ready) return <Loading />;

  return (
    <>
      <PageHeader title="นำเข้ายอดขาย" description="อัปโหลด CSV หรือ Excel จับคู่คอลัมน์ ตรวจสอบทุกแถว แล้วจึงยืนยันบันทึก — รายการที่เคยนำเข้าแล้วจะถูกข้าม" />

      {dataset === "demo" && (
        <div className="mb-4 flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>
            ขณะนี้อยู่ใน <b>โหมด Demo</b> — ไฟล์ที่นำเข้าจะถูกเก็บในชุดข้อมูล Demo ไม่ใช่ข้อมูลจริง หากต้องการนำเข้าข้อมูลจริง ให้สลับเป็น “ข้อมูลจริง” ก่อน
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-4">
            <Segmented<"orders" | "settlement">
              value={mode}
              onChange={setMode}
              options={[
                { value: "orders", label: "ไฟล์คำสั่งซื้อ" },
                { value: "settlement", label: "รายงานการเงิน" },
              ]}
            />
          </div>
          {mode === "orders" ? <ImportWizard /> : <SettlementImport />}
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
        }}
      />
    </>
  );
}
