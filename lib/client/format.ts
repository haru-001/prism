/** 1536 → "1.5 KB"，给容量看板用 */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let x = n;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x >= 100 || i === 0 ? Math.round(x) : Number(x.toFixed(1))} ${u[i]}`;
}

export function fmtPct(r: number): string {
  const p = r * 100;
  return `${p >= 10 || p === 0 ? Math.round(p) : Number(p.toFixed(1))}%`;
}
