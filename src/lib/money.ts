/** ปัดเศษเป็นสตางค์ ป้องกันปัญหาทศนิยมของ floating point */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function sum(values: number[]): number {
  return round2(values.reduce((a, b) => a + b, 0));
}
