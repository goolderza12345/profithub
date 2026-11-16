"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
  FileDown,
  FlaskConical,
  LayoutDashboard,
  Menu,
  Package,
  Receipt,
  Settings,
  TrendingUp,
  Upload,
} from "lucide-react";
import { useData } from "./data-provider";
import { Button, cn, Modal } from "./ui";

const NAV = [
  { href: "/", label: "ภาพรวม", icon: LayoutDashboard },
  { href: "/analysis", label: "วิเคราะห์กำไร", icon: BarChart3 },
  { href: "/products", label: "สินค้า", icon: Package },
  { href: "/import", label: "นำเข้ายอดขาย", icon: Upload },
  { href: "/expenses", label: "ค่าใช้จ่าย", icon: Receipt },
  { href: "/reports", label: "รายงาน", icon: FileDown },
  { href: "/how-it-works", label: "วิธีคำนวณกำไร", icon: BookOpen },
  { href: "/settings", label: "ตั้งค่าข้อมูล", icon: Settings },
];

const BOTTOM = [
  { href: "/", label: "ภาพรวม", icon: LayoutDashboard },
  { href: "/analysis", label: "วิเคราะห์", icon: BarChart3 },
  { href: "/import", label: "นำเข้า", icon: Upload },
  { href: "/expenses", label: "ค่าใช้จ่าย", icon: Receipt },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-emerald-500 text-white shadow-md shadow-brand-500/30">
        <TrendingUp size={20} strokeWidth={2.5} />
      </span>
      <span className="text-lg font-bold tracking-tight text-slate-900">
        Profit<span className="text-brand-600">Hub</span>
      </span>
    </Link>
  );
}

function DatasetSwitch({ compact = false }: { compact?: boolean }) {
  const { dataset, switchDataset, startDemo } = useData();
  return (
    <div className={cn("flex rounded-xl bg-slate-100 p-1 text-sm", compact ? "" : "w-full")} role="group" aria-label="ชุดข้อมูล">
      <button
        onClick={() => switchDataset("real")}
        className={cn("h-8 flex-1 whitespace-nowrap rounded-lg px-3 font-medium", dataset === "real" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
        aria-pressed={dataset === "real"}
      >
        ข้อมูลจริง
      </button>
      <button
        onClick={() => startDemo()}
        className={cn("h-8 flex-1 whitespace-nowrap rounded-lg px-3 font-medium", dataset === "demo" ? "bg-amber-400 text-amber-950 shadow-sm" : "text-slate-500")}
        aria-pressed={dataset === "demo"}
      >
        Demo
      </button>
    </div>
  );
}

function DemoBanner() {
  const { dataset, switchDataset } = useData();
  if (dataset !== "demo") return null;
  return (
    <div className="flex items-center gap-3 bg-amber-400 px-4 py-2 text-sm text-amber-950">
      <FlaskConical size={18} className="shrink-0" />
      <p className="flex-1 leading-snug">
        <b>โหมด Demo</b> — ตัวเลขทั้งหมดเป็นข้อมูลตัวอย่าง ไม่ใช่ข้อมูลจริงของร้าน และเก็บแยกจากข้อมูลจริง
      </p>
      <button onClick={() => switchDataset("real")} className="shrink-0 rounded-lg bg-amber-950/10 px-3 py-1 font-medium hover:bg-amber-950/20">
        ออกจาก Demo
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { error } = useData();

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-200 bg-white px-4 py-5 lg:flex">
        <Logo />
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex h-10 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition",
                isActive(pathname, href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              <Icon size={19} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="space-y-2">
          <p className="px-1 text-xs font-medium text-slate-500">ชุดข้อมูลที่แสดง</p>
          <DatasetSwitch />
          <p className="px-1 text-[11px] leading-relaxed text-slate-400">ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น (IndexedDB) ไม่ถูกส่งไปที่เซิร์ฟเวอร์</p>
        </div>
      </aside>

      <div className="lg:pl-64">
        <DemoBanner />
        {/* Top bar (mobile) */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200/70 bg-white/90 px-4 backdrop-blur lg:hidden">
          <Logo />
          <DatasetSwitch compact />
        </header>

        <main className="mx-auto max-w-6xl px-4 pb-28 pt-5 sm:px-6 lg:pb-10 lg:pt-8">
          {error && <div className="mb-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
          {children}
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="เมนูหลัก">
        <div className="grid grid-cols-5">
          {BOTTOM.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link key={href} href={href} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-brand-600" : "text-slate-500")}>
                <span className={cn("grid h-7 w-12 place-items-center rounded-full transition", active && "bg-brand-50")}>
                  <Icon size={21} />
                </span>
                {label}
              </Link>
            );
          })}
          <button onClick={() => setMenuOpen(true)} className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-slate-500">
            <span className="grid h-7 w-12 place-items-center rounded-full">
              <Menu size={21} />
            </span>
            เมนู
          </button>
        </div>
      </nav>

      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="เมนูทั้งหมด">
        <div className="grid grid-cols-2 gap-2">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMenuOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-2xl p-3 text-sm font-medium ring-1",
                isActive(pathname, href) ? "bg-brand-50 text-brand-700 ring-brand-100" : "text-slate-700 ring-slate-200",
              )}
            >
              <Icon size={20} />
              {label}
            </Link>
          ))}
        </div>
        <Button variant="secondary" className="mt-4 w-full" onClick={() => setMenuOpen(false)}>
          ปิดเมนู
        </Button>
      </Modal>
    </div>
  );
}
