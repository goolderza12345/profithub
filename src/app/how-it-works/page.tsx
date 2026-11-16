import type { Metadata } from "next";
import { calcLine } from "@/lib/profit";
import { formatBaht } from "@/lib/format";

export const metadata: Metadata = { title: "วิธีคำนวณกำไร" };

const example = calcLine(
  {
    id: "ex",
    orderId: "EX-1",
    date: "2026-11-01",
    channel: "Shopee",
    sku: "TS-001",
    quantity: 2,
    unitPrice: 199,
    discount: 20,
    refund: 0,
    returnedQty: 0,
    platformFee: 45.36,
    shippingFee: 0,
    dedupeKey: "ex",
    batchId: "ex",
  },
  85,
);
const ads = 50;

const STEPS = [
  { name: "ยอดขายก่อนหัก", formula: "ราคาขายต่อชิ้น × จำนวนชิ้น", source: "ไฟล์ยอดขาย" },
  { name: "ยอดขายสุทธิ", formula: "ยอดขายก่อนหัก − ส่วนลดที่ร้านออก − เงินคืนลูกค้า", source: "ไฟล์ยอดขาย" },
  { name: "ต้นทุนสินค้า", formula: "ต้นทุนต่อชิ้น × (จำนวนชิ้น − ชิ้นที่ได้รับคืน)", source: "หน้าสินค้า + ไฟล์ยอดขาย" },
  { name: "กำไรขั้นต้น", formula: "ยอดขายสุทธิ − ต้นทุนสินค้า", source: "คำนวณ" },
  { name: "ค่าธรรมเนียมในคำสั่งซื้อ", formula: "ค่าธรรมเนียมแพลตฟอร์ม + ค่าขนส่งที่ร้านออก", source: "ไฟล์ยอดขาย" },
  { name: "ค่าใช้จ่ายที่บันทึกเอง", formula: "ค่าโฆษณา + ค่าบรรจุภัณฑ์ + ค่าใช้จ่ายอื่น ฯลฯ", source: "หน้าค่าใช้จ่าย" },
  { name: "กำไรสุทธิ", formula: "กำไรขั้นต้น − ค่าธรรมเนียมในคำสั่งซื้อ − ค่าใช้จ่ายที่บันทึกเอง", source: "คำนวณ" },
  { name: "อัตรากำไรสุทธิ", formula: "กำไรสุทธิ ÷ ยอดขายสุทธิ × 100", source: "คำนวณ" },
];

export default function Page() {
  const net = example.lineProfit - ads;
  const rows: [string, number, boolean?][] = [
    ["ยอดขายก่อนหัก (199 × 2)", example.grossSales],
    ["− ส่วนลดที่ร้านออก", -example.discount],
    ["= ยอดขายสุทธิ", example.netRevenue, true],
    ["− ต้นทุนสินค้า (85 × 2)", -example.cogs],
    ["= กำไรขั้นต้น", example.netRevenue - example.cogs, true],
    ["− ค่าธรรมเนียมแพลตฟอร์ม (จากไฟล์)", -example.platformFee],
    ["− ค่าโฆษณา (บันทึกเอง)", -ads],
    ["= กำไรสุทธิ", net, true],
  ];
  return (
    <article className="max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">วิธีคำนวณกำไร</h1>
      <p className="mt-1 text-sm text-slate-500">ProfitHub แยกรายรับ ส่วนลด เงินคืน ต้นทุน ค่าธรรมเนียม และค่าใช้จ่ายออกจากกันอย่างชัดเจน</p>

      <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
        <h2 className="font-semibold text-slate-900">สูตรทีละขั้น</h2>
        <ol className="mt-3 space-y-3">
          {STEPS.map((s, i) => (
            <li key={s.name} className="flex gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{i + 1}</span>
              <div>
                <p className="font-medium text-slate-900">{s.name}</p>
                <p className="text-sm text-slate-600">{s.formula}</p>
                <p className="text-xs text-slate-400">ที่มา: {s.source}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
        <h2 className="font-semibold text-slate-900">ตัวอย่าง</h2>
        <p className="mt-1 text-sm text-slate-600">
          ขายเสื้อ 2 ตัว ตัวละ 199 บาท ให้ส่วนลด 20 บาท ต้นทุนตัวละ 85 บาท Shopee หักค่าธรรมเนียม 45.36 บาท และจ่ายค่าโฆษณา 50 บาท
        </p>
        <dl className="num mt-3 space-y-1.5 text-sm">
          {rows.map(([label, value, strong]) => (
            <div key={label} className={`flex justify-between gap-3 ${strong ? "font-semibold text-slate-900" : "text-slate-600"}`}>
              <dt>{label}</dt>
              <dd>{formatBaht(value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-4 rounded-2xl bg-amber-50 p-5 text-sm text-amber-950 ring-1 ring-amber-200">
        <h2 className="font-semibold">หลักการไม่หักซ้ำ</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>ทุกจำนวนเงินมีที่มาเดียว: ค่าธรรมเนียมต่อคำสั่งซื้อมาจากไฟล์ยอดขาย ค่าใช้จ่ายอื่นมาจากหน้าค่าใช้จ่าย ระบบหักแต่ละรายการเพียงครั้งเดียว</li>
          <li>ถ้าไฟล์ยอดขายมีค่าธรรมเนียมแพลตฟอร์มแล้ว อย่าบันทึกค่าธรรมเนียมเดียวกันซ้ำในหน้าค่าใช้จ่าย (ระบบจะเตือนเมื่อพบทั้งสองแหล่งในช่วงเดียวกัน)</li>
          <li>รายการขายซ้ำ (ช่องทาง + เลขคำสั่งซื้อ + SKU เดียวกัน) จะไม่ถูกนำเข้าซ้ำ</li>
          <li>เงินคืนลดยอดขายสุทธิ ส่วนต้นทุนสินค้าจะไม่คิดเฉพาะชิ้นที่ได้รับคืนเข้าสต็อก (คอลัมน์ returned_qty)</li>
          <li>ต้นทุนสินค้าใช้ต้นทุนต่อชิ้นปัจจุบันในหน้าสินค้า หากแก้ต้นทุน ตัวเลขย้อนหลังจะเปลี่ยนตาม</li>
          <li>กำไรแยกตามสินค้าไม่ปันส่วนค่าใช้จ่ายที่บันทึกเอง ส่วนกำไรแยกตามช่องทางหักเฉพาะค่าใช้จ่ายที่ระบุช่องทางนั้น</li>
          <li>ตัวเลขทั้งหมดปัดเศษเป็นสตางค์ และยังไม่รวมภาษี (VAT / ภาษีเงินได้)</li>
        </ul>
      </section>
    </article>
  );
}
