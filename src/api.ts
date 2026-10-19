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

export type Slots = Array<{
  id: number;
  n_ctx: number;
  is_processing: boolean;
  n_prompt_tokens: number;
  [k: string]: unknown;
}>;

export type MetricsHw = {
  gpu_util?: number;
  gpu_mem_used?: number;
  gpu_mem_total?: number;
  gpu_temp?: number;
  gpu_power?: number;
  cpu?: number;
  ram_used?: number;
  ram_total?: number;
  tok_s?: number;
  prefill_tok_s_mean?: number;
};

export type MetricsStatic = {
  gpu_name?: string;
  cpu_name?: string;
  cores?: number;
  threads?: number;
};

export type MetricsLive = {
  state?: string | null;
  tok_s?: number | null;
  prefill_tok_s_mean?: number | null;
};

export type MetricsReq = {
  decode_tok_s?: number | null;
  hit_rate?: number | null;
  drafts_offered?: number;
  drafts_accepted?: number;
};

export type MetricsTotals = {
  requests?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  drafts_offered?: number;
  drafts_accepted?: number;
};

export type Metrics = {
  hardware?: MetricsHw;
  hardware_static?: MetricsStatic;
  live?: MetricsLive;
  requests?: MetricsReq[];
  totals?: MetricsTotals;
  engine?: Record<string, unknown>;
};

/** /proc/meminfo snapshot (bytes). */
export type MemInfo = {
  total: number;
  free: number;
  available: number;
  cached: number;
  buffers: number;
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

export async function slots(): Promise<Slots> {
  const res = await fetch(`${API_BASE}/slots`, { cache: "no-store" });
  if (!res.ok) throw new Error(`slots ${res.status}`);
  return (await res.json()) as Slots;
}

export async function metrics(): Promise<Metrics> {
  const res = await fetch(`${API_BASE}/metrics`, { cache: "no-store" });
  if (!res.ok) throw new Error(`metrics ${res.status}`);
  return (await res.json()) as Metrics;
}

/** Read the RAM used/cached/free split straight from /proc/meminfo (one file, cheap). */
export async function meminfo(): Promise<MemInfo | null> {
  try {
    const text = await Bun.file("/proc/meminfo").text();
    const vals: Record<string, number> = {};
    for (const line of text.split("\n")) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      const num = parseInt(line.slice(idx + 1).trim().split(/\s+/)[0] ?? "", 10);
      if (!Number.isNaN(num)) vals[key] = num * 1024; // kB → bytes
    }
    const total = vals["MemTotal"] ?? 0;
    const free = vals["MemFree"] ?? 0;
    const available = vals["MemAvailable"] ?? free;
    const cached = (vals["Cached"] ?? 0) + (vals["Buffers"] ?? 0);
    if (!total) return null;
    return { total, free, available, cached, buffers: vals["Buffers"] ?? 0 };
  } catch {
    return null;
  }
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

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** Build the OpenAI `content` for one message: plain string, or content parts when
 *  it carries images and/or file text. File text is inlined into the text part;
 *  images become `image_url` parts so the model actually sees them. */
function buildContent(m: Message): string | ContentPart[] {
  const images = m.images ?? [];
  const files = m.files ?? [];
  if (images.length === 0 && files.length === 0) return m.text;
  let text = m.text;
  for (const f of files) {
    if (f.text) text += `${text ? "\n\n" : ""}--- ${f.name} ---\n${f.text}`;
  }
  const parts: ContentPart[] = [{ type: "text", text }];
  for (const i of images) {
    if (i.url) parts.push({ type: "image_url", image_url: { url: i.url } });
  }
  return parts;
}

export function apiMessages(messages: Message[]) {
  return messages
    .filter((m) => !(m.role === "assistant" && !m.text && !m.reasoning))
    .map((m) => ({ role: m.role, content: buildContent(m) }));
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
  const mb = Math.round(MAX_FILE_BYTES / 1024 / 1024);
  if (type.startsWith("image/")) {
    if (file.size > MAX_FILE_BYTES) throw new Error(`image is larger than the ${mb} MB limit: ${name}`);
    const buf = Buffer.from(await file.arrayBuffer());
    const url = `data:${type};base64,${buf.toString("base64")}`;
    return { kind: "image", att: { name, url } };
  }
  const isText =
    type.startsWith("text/") ||
    TEXT_EXT.test(name) ||
    /^(makefile|dockerfile|readme|license)$/i.test(name);
  if (!isText) throw new Error(`not a picture or a text file: ${name}`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`file is larger than the ${mb} MB limit: ${name}`);
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
