"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Package, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { formatBaht, formatNumber } from "@/lib/format";
import type { Product } from "@/lib/types";
import { useData } from "../data-provider";
import { Button, Card, ConfirmDialog, EmptyState, Field, inputClass, Loading, Modal, PageHeader } from "../ui";

export function ProductsView() {
  const { ready, products, sales, saveProduct, deleteProduct } = useData();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sales) m.set(s.sku, (m.get(s.sku) ?? 0) + s.quantity - s.returnedQty);
    return m;
  }, [sales]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...products]
      .filter((p) => !q || p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [products, query]);

  if (!ready) return <Loading />;

  return (
    <>
      <PageHeader
        title="สินค้า"
        description="กำหนด SKU และต้นทุนต่อชิ้น เพื่อใช้คำนวณต้นทุนสินค้าในทุกรายการขาย"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus size={18} /> เพิ่มสินค้า
          </Button>
        }
      />

      {products.length === 0 ? (
        <EmptyState icon={<Package />} title="ยังไม่มีสินค้า" description="เพิ่มสินค้าพร้อมต้นทุนต่อชิ้นก่อนนำเข้ายอดขาย ระบบจะจับคู่รายการขายด้วย SKU">
          <Button onClick={() => setEditing("new")}>
            <Plus size={18} /> เพิ่มสินค้าแรก
          </Button>
        </EmptyState>
      ) : (
        <>
          <label className="relative mb-4 block sm:max-w-sm">
            <span className="sr-only">ค้นหาสินค้า</span>
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหา SKU หรือชื่อสินค้า" className={inputClass + " pl-10"} />
          </label>
          <p className="mb-2 text-sm text-slate-500">{formatNumber(list.length)} รายการ</p>

          {/* มือถือ: การ์ด */}
          <div className="space-y-2 md:hidden">
            {list.map((p) => (
              <Card key={p.id} className="!p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{p.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {p.sku} · ขายแล้ว {formatNumber(usage.get(p.sku) ?? 0)} ชิ้น
                    </p>
                  </div>
                  <p className="num shrink-0 font-semibold text-slate-900">{formatBaht(p.unitCost)}</p>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => setEditing(p)}>
                    <Pencil size={15} /> แก้ไข
                  </Button>
                  <Button size="sm" variant="ghost" className="flex-1 text-rose-600" onClick={() => { setDeleteError(null); setDeleting(p); }}>
                    <Trash2 size={15} /> ลบ
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          {/* คอมพิวเตอร์: ตาราง */}
          <Card className="hidden !p-0 md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">SKU</th>
                  <th className="px-5 py-3 font-medium">ชื่อสินค้า</th>
                  <th className="px-5 py-3 text-right font-medium">ต้นทุนต่อชิ้น</th>
                  <th className="px-5 py-3 text-right font-medium">ขายแล้ว (ชิ้น)</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">{p.sku}</td>
                    <td className="px-5 py-3 font-medium text-slate-900">{p.name}</td>
                    <td className="num px-5 py-3 text-right">{formatBaht(p.unitCost)}</td>
                    <td className="num px-5 py-3 text-right text-slate-600">{formatNumber(usage.get(p.sku) ?? 0)}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)} aria-label={`แก้ไข ${p.sku}`}>
                          <Pencil size={15} /> แก้ไข
                        </Button>
                        <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => { setDeleteError(null); setDeleting(p); }} aria-label={`ลบ ${p.sku}`}>
                          <Trash2 size={15} /> ลบ
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {list.length === 0 && <p className="py-8 text-center text-sm text-slate-500">ไม่พบสินค้าที่ค้นหา</p>}
        </>
      )}

      <ProductForm
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        product={editing}
        onClose={() => setEditing(null)}
        onSave={async (input) => {
          await saveProduct(input, editing && editing !== "new" ? editing.id : undefined);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        title="ลบสินค้า"
        message={
          <>
            ต้องการลบ <b>{deleting?.name}</b> ({deleting?.sku}) ใช่หรือไม่?
          </>
        }
        confirmLabel="ลบสินค้า"
        error={deleteError}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteProduct(deleting.id);
            setDeleting(null);
          } catch (e) {
            setDeleteError(e instanceof Error ? e.message : String(e));
          }
        }}
      />
    </>
  );
}

function ProductForm({
  product,
  onClose,
  onSave,
}: {
  product: Product | "new" | null;
  onClose: () => void;
  onSave: (input: { sku: string; name: string; unitCost: number }) => Promise<void>;
}) {
  const existing = product && product !== "new" ? product : null;
  const [sku, setSku] = useState(existing?.sku ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [cost, setCost] = useState(existing ? String(existing.unitCost) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const skuT = sku.trim();
    if (!skuT) errs.sku = "กรุณาระบุ SKU";
    else if (/[,\s]/.test(skuT)) errs.sku = "SKU ห้ามมีช่องว่างหรือเครื่องหมายจุลภาค";
    if (!name.trim()) errs.name = "กรุณาระบุชื่อสินค้า";
    const c = Number(cost.replace(/,/g, ""));
    if (cost.trim() === "" || !Number.isFinite(c)) errs.cost = "กรุณาระบุต้นทุนเป็นตัวเลข";
    else if (c < 0) errs.cost = "ต้นทุนต้องไม่ติดลบ";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await onSave({ sku: skuT, name, unitCost: Math.round(c * 100) / 100 });
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={!!product} onClose={onClose} title={existing ? "แก้ไขสินค้า" : "เพิ่มสินค้า"}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="SKU" hint="รหัสสินค้า ต้องตรงกับคอลัมน์ sku ในไฟล์ยอดขาย" error={errors.sku}>
          <input value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} className={inputClass + " font-mono"} placeholder="เช่น TS-001" autoCapitalize="characters" />
        </Field>
        <Field label="ชื่อสินค้า" error={errors.name}>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="เช่น เสื้อยืดคอตตอน สีขาว" />
        </Field>
        <Field label="ต้นทุนต่อชิ้น (บาท)" hint="รวมค่าสินค้าที่ซื้อมา/ผลิต ไม่รวมค่าแพ็กและค่าส่ง (บันทึกแยกในค่าใช้จ่าย)" error={errors.cost}>
          <input value={cost} onChange={(e) => setCost(e.target.value)} className={inputClass + " num"} inputMode="decimal" placeholder="0.00" />
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
