import { API_BASE, SYNC_URL, MAX_FILE_BYTES } from "./config";

export type Role = "user" | "assistant";

export type Attachment = { name: string; url?: string; text?: string };

export type Message = {
  role: Role;
  text: string;
  time: number;
  reasoning?: string;
  thinkSecs?: number;
  meta?: string;
  stopped?: boolean;
  error?: string;
  images?: Attachment[];
  files?: Attachment[];
};

export type Health = {
  model?: string;
  max_context?: number;
  images?: boolean;
  [k: string]: unknown;
};

export type StreamEvent =
  | { type: "reasoning"; text: string }
  | { type: "content"; text: string }
  | { type: "usage"; usage: Record<string, number> }
  | { type: "done" };

export function nowMs(): number {
  return Date.now();
}

export async function health(): Promise<Health> {
  const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(`health ${res.status}`);
  return (await res.json()) as Health;
}

export async function loadTranscript(): Promise<Message[]> {
  const res = await fetch(SYNC_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`transcript ${res.status}`);
  const body = (await res.json()) as { messages?: Message[] };
  return body.messages ?? [];
}

export async function saveTranscript(messages: Message[]): Promise<void> {
  await fetch(SYNC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: messages.map(snapshot) }),
  });
}

function snapshot(m: Message): Message {
  return {
    role: m.role,
    text: m.text,
    time: m.time,
    ...(m.reasoning ? { reasoning: m.reasoning } : {}),
    ...(m.thinkSecs != null ? { thinkSecs: m.thinkSecs } : {}),
    ...(m.meta ? { meta: m.meta } : {}),
    ...(m.stopped ? { stopped: true } : {}),
    ...(m.error ? { error: m.error } : {}),
    images: (m.images ?? []).map((i) => ({ name: i.name })),
    files: (m.files ?? []).map((f) => ({ name: f.name })),
  };
}

export function apiMessages(messages: Message[]) {
  return messages
    .filter((m) => !(m.role === "assistant" && !m.text && !m.reasoning))
    .map((m) => ({ role: m.role, content: m.text }));
}

export type StreamOpts = {
  base?: string;
  model: string;
  messages: Message[];
  thinking?: string;
  signal?: AbortSignal;
};

export async function* stream(opts: StreamOpts): AsyncGenerator<StreamEvent> {
  const base = (opts.base ?? API_BASE).replace(/\/$/, "");
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      messages: apiMessages(opts.messages),
      stream: true,
      reasoning_effort: opts.thinking ?? "high",
      temperature: 0.6,
      top_p: 0.95,
      top_k: 20,
    }),
  });
  if (!res.ok || !res.body) {
    let detail = `${res.status}`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) detail = j.error.message;
    } catch {}
    throw new Error(detail);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let j: any;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.error) throw new Error(j.error.message ?? "engine error");
      if (j.usage) yield { type: "usage", usage: j.usage };
      const delta = j.choices?.[0]?.delta;
      if (delta?.reasoning_content) yield { type: "reasoning", text: delta.reasoning_content };
      if (delta?.content) yield { type: "content", text: delta.content };
    }
  }
  yield { type: "done" };
}

const TEXT_EXT =
  /\.(txt|md|markdown|rst|tex|py|pyi|ipynb|js|mjs|cjs|ts|tsx|jsx|vue|svelte|json|jsonl|csv|tsv|log|ya?ml|toml|ini|cfg|conf|env|xml|html?|css|scss|less|c|cc|cpp|cxx|h|hh|hpp|cu|cuh|rs|go|java|kt|kts|swift|rb|php|pl|lua|r|jl|scala|sql|sh|bash|zsh|fish|ps1|psm1|bat|cmd|diff|patch|gradle|cmake|mk|proto|graphql)$/i;

export async function readAttachment(
  path: string,
): Promise<{ kind: "image" | "file"; att: Attachment }> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`no such file: ${path}`);
  const name = path.split("/").pop() || path;
  const type = file.type || "";
  if (type.startsWith("image/")) {
    const buf = Buffer.from(await file.arrayBuffer());
    const url = `data:${type};base64,${buf.toString("base64")}`;
    return { kind: "image", att: { name, url } };
  }
  const isText =
    type.startsWith("text/") ||
    TEXT_EXT.test(name) ||
    /^(makefile|dockerfile|readme|license)$/i.test(name);
  if (!isText) throw new Error(`not a picture or a text file: ${name}`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`file is larger than 512 KB: ${name}`);
  const text = await file.text();
  if (text.includes("\0")) throw new Error(`looks like a binary file: ${name}`);
  return { kind: "file", att: { name, text } };
}

export function copyToClipboard(text: string): boolean {
  for (const cmd of [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "-b"]]) {
    try {
      const p = Bun.spawnSync(cmd, { stdin: Buffer.from(text) });
      if (p.exitCode === 0) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export function readClipboard(): string {
  for (const cmd of [
    ["wl-paste", "--no-newline"],
    ["xclip", "-selection", "clipboard", "-o"],
    ["xsel", "-b", "-o"],
  ]) {
    try {
      const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "ignore" });
      if (p.exitCode === 0) {
        return p.stdout.toString().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      }
    } catch {
      continue;
    }
  }
  return "";
}
