"use client";

import { useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { CHANNEL_OPTIONS } from "@/lib/csv";
import { formatThaiDate, toISODate } from "@/lib/dates";
import { formatBaht } from "@/lib/format";
import { round2, sum } from "@/lib/money";
import { filterByRange } from "@/lib/profit";
import { EXPENSE_CATEGORIES, EXPENSE_LABELS, type Expense, type ExpenseCategory } from "@/lib/types";
import { LIMITS } from "@/lib/validation";
import { useData, type ExpenseInput } from "../data-provider";
import { RangeFilter } from "../range-filter";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, inputClass, Loading, Modal, PageHeader } from "../ui";

export function ExpensesView() {
  const { ready, expenses, sales, range, saveExpense, deleteExpense } = useData();
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [category, setCategory] = useState<ExpenseCategory | "all">("all");

  const inRange = useMemo(() => filterByRange(expenses, range).sort((a, b) => b.date.localeCompare(a.date)), [expenses, range]);
  const totals = useMemo(() => {
    const t = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, 0])) as Record<ExpenseCategory, number>;
    for (const e of inRange) t[e.category] = round2(t[e.category] + e.amount);
    return t;
  }, [inRange]);
  const salesInRange = useMemo(() => filterByRange(sales, range), [sales, range]);
  const orderFees = useMemo(
    () => ({
      platform: sum(salesInRange.map((s) => s.platformFee)),
      shipping: sum(salesInRange.map((s) => s.shippingFee)),
    }),
    [salesInRange],
  );
  const list = category === "all" ? inRange : inRange.filter((e) => e.category === category);
  const channels = useMemo(() => [...new Set([...CHANNEL_OPTIONS, ...sales.map((s) => s.channel)])], [sales]);

  if (!ready) return <Loading />;

  const overlap: string[] = [];
  if (orderFees.platform > 0 && totals.platform_fee > 0) overlap.push("ค่าธรรมเนียมแพลตฟอร์ม");
  if (orderFees.shipping > 0 && totals.shipping > 0) overlap.push("ค่าขนส่งที่ร้านออก");

  return (
    <>
      <PageHeader
        title="ค่าใช้จ่าย"
        description="บันทึกค่าใช้จ่ายที่ไม่ได้อยู่ในไฟล์ยอดขาย เช่น ค่าโฆษณา ค่าบรรจุภัณฑ์ ค่าแพ็กเกจรายเดือน"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus size={18} /> เพิ่มค่าใช้จ่าย
          </Button>
        }
      />
      <RangeFilter />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <button
          onClick={() => setCategory("all")}
          className={`rounded-2xl p-3 text-left ring-1 transition ${category === "all" ? "bg-brand-600 text-white ring-brand-600" : "bg-white ring-slate-200"}`}
        >
          <p className={`text-xs ${category === "all" ? "text-brand-100" : "text-slate-500"}`}>รวมทุกประเภท</p>
          <p className="num mt-1 font-bold">{formatBaht(sum(Object.values(totals)))}</p>
        </button>
        {EXPENSE_CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-2xl p-3 text-left ring-1 transition ${category === c ? "bg-brand-600 text-white ring-brand-600" : "bg-white ring-slate-200"}`}
          >
            <p className={`truncate text-xs ${category === c ? "text-brand-100" : "text-slate-500"}`}>{EXPENSE_LABELS[c]}</p>
            <p className="num mt-1 font-bold">{formatBaht(totals[c])}</p>
          </button>
        ))}
      </div>

      <Card className="mb-4 !p-4">
        <p className="text-sm text-slate-600">
          ค่าธรรมเนียมที่มาจาก <b>ไฟล์ยอดขาย</b> ในช่วงนี้ (นับแยกแล้ว ไม่ต้องบันทึกซ้ำ): แพลตฟอร์ม{" "}
          <b className="num">{formatBaht(orderFees.platform)}</b> · ขนส่ง <b className="num">{formatBaht(orderFees.shipping)}</b>
        </p>
        {overlap.length > 0 && (
          <p className="mt-2 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle size={18} className="shrink-0" />
            <span>
              มีทั้ง {overlap.join(" และ ")} จากไฟล์ยอดขาย และที่บันทึกเองในช่วงเวลาเดียวกัน — ตรวจสอบว่าไม่ใช่รายการเดียวกัน
              เพื่อไม่ให้หักซ้ำ (ระบบหักทั้งสองแหล่ง)
            </span>
          </p>
        )}
      </Card>

      {list.length === 0 ? (
        <EmptyState icon={<Receipt />} title="ไม่มีค่าใช้จ่ายในช่วงนี้" description="เพิ่มค่าใช้จ่าย เช่น ค่าโฆษณา หรือค่ากล่อง เพื่อให้กำไรสุทธิตรงกับความจริง">
          <Button onClick={() => setEditing("new")}>
            <Plus size={18} /> เพิ่มค่าใช้จ่าย
          </Button>
        </EmptyState>
      ) : (
        <Card className="!p-0">
          <ul className="divide-y divide-slate-100">
            {list.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="brand">{EXPENSE_LABELS[e.category]}</Badge>
                    <Badge>{e.channel || "ทุกช่องทาง"}</Badge>
                  </div>
                  <p className="mt-1 truncate text-sm text-slate-800">{e.note || "—"}</p>
                  <p className="text-xs text-slate-500">{formatThaiDate(e.date)}</p>
                </div>
                <p className="num shrink-0 font-semibold text-slate-900">{formatBaht(e.amount)}</p>
                <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(e)} aria-label="แก้ไข">
                    <Pencil size={15} />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setDeleting(e)} aria-label="ลบ">
                    <Trash2 size={15} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ExpenseForm
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        expense={editing}
        channels={channels}
        onClose={() => setEditing(null)}
        onSave={async (input) => {
          await saveExpense(input, editing && editing !== "new" ? editing.id : undefined);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        title="ลบค่าใช้จ่าย"
        message={deleting ? `ลบ ${EXPENSE_LABELS[deleting.category]} ${formatBaht(deleting.amount)} วันที่ ${formatThaiDate(deleting.date)} ใช่หรือไม่? การลบนี้ย้อนกลับไม่ได้ และกำไรสุทธิจะเปลี่ยนตาม` : ""}
        confirmLabel="ลบ"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await deleteExpense(deleting.id);
          setDeleting(null);
        }}
      />
    </>
  );
}

function ExpenseForm({
  expense,
  channels,
  onClose,
  onSave,
}: {
  expense: Expense | "new" | null;
  channels: string[];
  onClose: () => void;
  onSave: (input: ExpenseInput) => Promise<void>;
}) {
  const existing = expense && expense !== "new" ? expense : null;
  const [date, setDate] = useState(existing?.date ?? toISODate(new Date()));
  const [category, setCategory] = useState<ExpenseCategory>(existing?.category ?? "ads");
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [channel, setChannel] = useState(existing?.channel ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errs.date = "กรุณาเลือกวันที่";
    const a = Number(amount.replace(/,/g, ""));
    if (amount.trim() === "" || !Number.isFinite(a)) errs.amount = "กรุณาระบุจำนวนเงิน";
    else if (a <= 0) errs.amount = "จำนวนเงินต้องมากกว่า 0";
    else if (a > LIMITS.maxAmount) errs.amount = "จำนวนเงินสูงผิดปกติ";
    if (note.trim().length > LIMITS.noteLength) errs.note = `หมายเหตุยาวเกิน ${LIMITS.noteLength} ตัวอักษร`;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await onSave({ date, category, amount: round2(a), channel, note: note.trim() });
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={!!expense} onClose={onClose} title={existing ? "แก้ไขค่าใช้จ่าย" : "เพิ่มค่าใช้จ่าย"}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field label="วันที่" error={errors.date}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </Field>
          <Field label="จำนวนเงิน (บาท)" error={errors.amount}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className={inputClass + " num"} />
          </Field>
        </div>
        <Field label="ประเภท">
          <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className={inputClass}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        {(category === "platform_fee" || category === "shipping") && (
          <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
            บันทึกเฉพาะส่วนที่ <b>ไม่ได้อยู่ในไฟล์ยอดขาย</b> (เช่น ค่าแพ็กเกจรายเดือน หรือค่าส่งที่จ่ายรวม) เพื่อไม่ให้หักซ้ำ
          </p>
        )}
        <Field label="ช่องทาง" hint="ระบุเพื่อใช้คำนวณกำไรแยกตามช่องทาง">
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className={inputClass}>
            <option value="">ทุกช่องทาง (ไม่ระบุ)</option>
            {channels.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="หมายเหตุ" error={errors.note}>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} placeholder="เช่น Shopee Ads สัปดาห์ที่ 1" />
        </Field>
        {errors.form && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{errors.form}</p>}
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "กำลังบันทึก…" : "บันทึก"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
