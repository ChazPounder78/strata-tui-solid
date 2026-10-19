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
};

export function bar(pct: number, width = 12): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

export function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
