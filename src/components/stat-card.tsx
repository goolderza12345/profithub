import type { ReactNode } from "react";
import { cn } from "./ui";

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "slate",
  className,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  icon: ReactNode;
  tone?: "slate" | "brand" | "green" | "red" | "amber";
  className?: string;
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    brand: "bg-brand-50 text-brand-600",
    green: "bg-emerald-50 text-emerald-600",
    red: "bg-rose-50 text-rose-600",
    amber: "bg-amber-50 text-amber-600",
  };
  return (
    <div className={cn("rounded-2xl bg-white p-4 ring-1 ring-slate-200/70 shadow-sm", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-slate-500">{label}</p>
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-xl", tones[tone])}>{icon}</span>
      </div>
      <p className={cn("mt-2 truncate text-xl font-bold tracking-tight sm:text-2xl", tone === "red" ? "text-rose-600" : "text-slate-900")}>{value}</p>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
