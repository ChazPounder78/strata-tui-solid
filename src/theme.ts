export const theme = {
  bg: "#0b0e14",
  panel: "#11151c",
  panelAlt: "#161b24",
  border: "#2a3140",
  borderFocus: "#4c8bf5",
  accent: "#7aa2f7",
  accentStrong: "#4c8bf5",
  user: "#9ece6a",
  assistant: "#7dcfff",
  text: "#c0caf5",
  dim: "#565f89",
  warn: "#e0af68",
  error: "#f7768e",
  reasoning: "#7a7f95",
  code: "#1a1f2b",
  // Muted memory-segment palette (no screaming colors)
  memStrata: "#6c7a9c", // what Strata/model actively uses — desaturated indigo
  memCached: "#5a7d7c", // reclaimable cache — desaturated teal
  memFree: "#333b4d", // untouched free — dark slate
};

/** A single colored run of a stacked bar. */
export type Seg = { chars: string; color: string };

/**
 * Split `width` cells into colored segments proportional to each `pct`.
 * The last segment absorbs rounding remainder so the bar always fills `width`.
 */
export function stackBar(width: number, parts: { pct: number; color: string }[]): Seg[] {
  const w = Math.max(0, Math.floor(width));
  if (w === 0 || parts.length === 0) return [];
  const total = parts.reduce((a, p) => a + Math.max(0, p.pct), 0) || 1;
  const out: Seg[] = [];
  let used = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    let cells: number;
    if (i === parts.length - 1) cells = w - used;
    else cells = Math.round((Math.max(0, p.pct) / total) * w);
    cells = Math.max(0, Math.min(w - used, cells));
    used += cells;
    if (cells > 0) out.push({ chars: "█".repeat(cells), color: p.color });
  }
  return out;
}

export function bar(pct: number, width = 12): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

/** Human-readable bytes, e.g. 22.1G / 60.3M. */
export function fmtBytes(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const g = 1024 ** 3;
  const m = 1024 ** 2;
  if (n >= g) return (n / g).toFixed(1) + "G";
  if (n >= m) return (n / m).toFixed(0) + "M";
  return String(n);
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

export function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
