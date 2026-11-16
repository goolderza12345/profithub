"use client";

import { CalendarDays } from "lucide-react";
import { formatThaiDate, PRESET_LABELS, type RangePreset } from "@/lib/dates";
import { useData } from "./data-provider";
import { inputClass } from "./ui";

const PRESETS: RangePreset[] = ["7d", "30d", "90d", "this_month", "last_month", "all", "custom"];

export function RangeFilter() {
  const { rangeState, setRangeState, range } = useData();
  const label =
    range.from || range.to
      ? `${range.from ? formatThaiDate(range.from) : "เริ่มต้น"} – ${range.to ? formatThaiDate(range.to) : "ล่าสุด"}`
      : "ทุกช่วงเวลา";
  return (
    <div className="mb-5 space-y-2">
      <div className="flex items-center gap-2">
        <label className="relative flex-1 sm:max-w-56">
          <span className="sr-only">ช่วงเวลา</span>
          <CalendarDays size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <select
            value={rangeState.preset}
            onChange={(e) => {
              const preset = e.target.value as RangePreset;
              setRangeState({
                preset,
                custom: preset === "custom" && !rangeState.custom.from ? { from: range.from, to: range.to } : rangeState.custom,
              });
            }}
            className={inputClass + " appearance-none pl-10 font-medium"}
          >
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {PRESET_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <span className="text-sm text-slate-500">{label}</span>
      </div>
      {rangeState.preset === "custom" && (
        <div className="grid grid-cols-2 gap-2 sm:max-w-md">
          <label className="text-xs text-slate-500">
            ตั้งแต่
            <input
              type="date"
              value={rangeState.custom.from ?? ""}
              onChange={(e) => setRangeState({ ...rangeState, custom: { ...rangeState.custom, from: e.target.value || null } })}
              className={inputClass + " mt-1"}
            />
          </label>
          <label className="text-xs text-slate-500">
            ถึง
            <input
              type="date"
              value={rangeState.custom.to ?? ""}
              onChange={(e) => setRangeState({ ...rangeState, custom: { ...rangeState.custom, to: e.target.value || null } })}
              className={inputClass + " mt-1"}
            />
          </label>
        </div>
      )}
    </div>
  );
}
