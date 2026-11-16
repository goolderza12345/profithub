"use client";

import { useState } from "react";
import { Database, FlaskConical, RotateCcw, Trash2 } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { useData } from "../data-provider";
import { Button, Card, ConfirmDialog, inputClass, Loading, PageHeader } from "../ui";

export function SettingsView() {
  const { ready, dataset, products, sales, expenses, switchDataset, startDemo, resetDemo, clearCurrent } = useData();
  const [confirm, setConfirm] = useState<"clear" | "reset" | null>(null);
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  if (!ready) return <Loading />;
  const isDemo = dataset === "demo";

  return (
    <>
      <PageHeader title="ตั้งค่าข้อมูล" description="จัดการชุดข้อมูลที่เก็บไว้ในเบราว์เซอร์นี้" />
      {message && <p className="mb-4 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-emerald-200">{message}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="flex items-center gap-2 font-semibold text-slate-900">
            <Database size={18} /> ชุดข้อมูลที่กำลังแสดง
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            ข้อมูลจริงและข้อมูล Demo ถูกเก็บในฐานข้อมูลแยกกัน (<code>profithub-real</code> / <code>profithub-demo</code>) จึงไม่ปะปนกัน
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant={isDemo ? "secondary" : "primary"} onClick={() => switchDataset("real")}>
              ข้อมูลจริง
            </Button>
            <Button variant={isDemo ? "primary" : "secondary"} onClick={() => startDemo()}>
              <FlaskConical size={18} /> Demo
            </Button>
          </div>
          <dl className="num mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 p-3">
              <dd className="text-lg font-bold">{formatNumber(products.length)}</dd>
              <dt className="text-xs text-slate-500">สินค้า</dt>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <dd className="text-lg font-bold">{formatNumber(sales.length)}</dd>
              <dt className="text-xs text-slate-500">รายการขาย</dt>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <dd className="text-lg font-bold">{formatNumber(expenses.length)}</dd>
              <dt className="text-xs text-slate-500">ค่าใช้จ่าย</dt>
            </div>
          </dl>
        </Card>

        <Card>
          <h2 className="font-semibold text-slate-900">การจัดการข้อมูล</h2>
          <p className="mt-1 text-sm text-slate-500">
            ข้อมูลอยู่ในเบราว์เซอร์นี้เท่านั้น หากล้างข้อมูลเบราว์เซอร์หรือเปลี่ยนเครื่อง ข้อมูลจะไม่ตามไป แนะนำให้ส่งออกรายงานเก็บไว้เป็นระยะ
          </p>
          <div className="mt-4 space-y-2">
            {isDemo && (
              <Button variant="secondary" className="w-full" onClick={() => setConfirm("reset")}>
                <RotateCcw size={18} /> รีเซ็ตข้อมูล Demo ใหม่
              </Button>
            )}
            <Button
              variant="danger"
              className="w-full"
              onClick={() => {
                setTyped("");
                setConfirm("clear");
              }}
            >
              <Trash2 size={18} /> ลบ{isDemo ? "ข้อมูล Demo" : "ข้อมูลจริง"}ทั้งหมด
            </Button>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirm === "reset"}
        title="รีเซ็ตข้อมูล Demo"
        message="ข้อมูล Demo ทั้งหมดจะถูกลบและสร้างใหม่ (ข้อมูลจริงไม่ได้รับผลกระทบ)"
        confirmLabel="รีเซ็ต"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await resetDemo();
          setConfirm(null);
          setMessage("สร้างข้อมูล Demo ใหม่แล้ว");
        }}
      />
      <ConfirmDialog
        open={confirm === "clear"}
        title={isDemo ? "ลบข้อมูล Demo ทั้งหมด" : "ลบข้อมูลจริงทั้งหมด"}
        message={
          <>
            <p>
              สินค้า รายการขาย และค่าใช้จ่ายทั้งหมดใน{isDemo ? "ชุด Demo" : "ชุดข้อมูลจริง"}จะถูกลบถาวร และกู้คืนไม่ได้
            </p>
            {!isDemo && (
              <label className="mt-3 block">
                พิมพ์ <b>ลบ</b> เพื่อยืนยัน
                <input value={typed} onChange={(e) => setTyped(e.target.value)} className={inputClass + " mt-1"} />
              </label>
            )}
          </>
        }
        confirmLabel="ลบถาวร"
        error={!isDemo && typed !== "" && typed.trim() !== "ลบ" ? "พิมพ์คำว่า ลบ ให้ถูกต้อง" : null}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!isDemo && typed.trim() !== "ลบ") {
            setTyped(typed || " ");
            return;
          }
          await clearCurrent();
          setConfirm(null);
          setMessage(isDemo ? "ลบข้อมูล Demo แล้ว" : "ลบข้อมูลจริงทั้งหมดแล้ว");
        }}
      />
    </>
  );
}
