"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatThaiDate } from "@/lib/dates";
import { formatBaht, formatCompact } from "@/lib/format";
import type { DailyPoint } from "@/lib/profit";

export function DailyChart({ data }: { data: DailyPoint[] }) {
  return (
    <div className="h-72 w-full sm:h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => formatThaiDate(d, false)}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis tickFormatter={(v: number) => formatCompact(v)} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            formatter={(v, name) => [formatBaht(Number(v)), name]}
            labelFormatter={(d) => formatThaiDate(String(d))}
            contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar isAnimationActive={false} dataKey="netRevenue" name="ยอดขายสุทธิ" fill="#818cf8" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Line isAnimationActive={false} dataKey="netProfit" name="กำไรสุทธิ" stroke="#059669" strokeWidth={2.5} dot={false} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
