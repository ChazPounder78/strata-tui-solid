import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { theme } from "./theme";

/** Parse the flat `key = "#hex"` lines from a colors.toml file. */
function parseHexMap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const m = raw.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*"(#[0-9a-fA-F]{3,8})"/);
    if (m && m[1] && m[2]) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Adopt the current Omarchy/Quickshell theme (from
 * `~/.local/state/omarchy/current/theme/colors.toml`) as the default palette.
 * Returns true if a theme was applied, false if we fell back to the built-in
 * palette. The in-memory `theme` object is mutated so every component picks up
 * the new colors — call this once at startup, before the first render.
 */
export function applyOmarchyTheme(): boolean {
  try {
    const path = join(homedir(), ".local", "state", "omarchy", "current", "theme", "colors.toml");
    const c = parseHexMap(readFileSync(path, "utf8"));
    // Need at least a background and foreground to consider it a real theme.
    if (!c.background || !c.foreground) return false;

    theme.bg = c.background;
    theme.panel = c.background;
    theme.panelAlt = c.selection ?? c.lighter_background ?? c.background;
    theme.border = c.lighter_background ?? c.selection ?? c.background;
    theme.borderFocus = c.accent ?? theme.borderFocus;
    theme.code = c.darker_background ?? theme.code;
    theme.chatBg = c.dark_background ?? c.darker_background ?? theme.chatBg;
    theme.assistantBg = c.lighter_background ?? theme.assistantBg;

    theme.accent = c.accent ?? theme.accent;
    theme.accentStrong = c.bright_magenta ?? c.accent ?? theme.accentStrong;
    theme.user = c.green ?? theme.user;
    theme.assistant = c.cyan ?? c.blue ?? theme.assistant;

    theme.text = c.foreground;
    theme.dim = c.muted ?? c.dark_foreground ?? theme.dim;
    theme.reasoning = c.dark_foreground ?? c.muted ?? theme.reasoning;
    theme.warn = c.orange ?? c.yellow ?? theme.warn;
    theme.error = c.red ?? c.bright_red ?? theme.error;

    return true;
  } catch {
    // No theme file (or unreadable) — keep the built-in palette.
    return false;
  }
}
