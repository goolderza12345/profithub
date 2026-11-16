const baht = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const num = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 });

export const formatBaht = (n: number) => baht.format(n);
export const formatNumber = (n: number) => num.format(n);
export const formatCompact = (n: number) => compact.format(n);
export const formatPercent = (n: number | null) =>
  n === null ? "—" : `${(n * 100).toLocaleString("th-TH", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
