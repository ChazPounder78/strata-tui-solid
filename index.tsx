import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { SyntaxStyle, type TextareaRenderable } from "@opentui/core";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  health,
  loadTranscript,
  nowMs,
  readAttachment,
  readClipboard,
  saveTranscript,
  slots,
  stream,
  type Attachment,
  type Message,
} from "./src/api";
import { API_BASE, DEFAULT_MAX_CTX, DEFAULT_MODEL, DEFAULT_THINKING } from "./src/config";
import { bar, fmtTokens, hhmm, theme } from "./src/theme";

const TEXTAREA_KEYS = [
  { name: "return", action: "submit" as const },
  { name: "kpenter", action: "submit" as const },
  { name: "return", shift: true, action: "newline" as const },
  { name: "return", meta: true, action: "newline" as const },
];

const MAX_COMPOSER_ROWS = 12;

/** Rough count of wrapped rows a textarea buffer occupies at the given width. */
function visualRows(text: string, width: number): number {
  const w = Math.max(1, width);
  let total = 0;
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      total += 1;
      continue;
    }
    let rows = 1;
    let cur = 0;
    for (const word of line.split(" ")) {
      const len = word.length;
      if (cur === 0) {
        if (len > w) {
          rows += Math.floor(len / w);
          cur = len % w || w;
        } else {
          cur = len;
        }
      } else if (cur + 1 + len <= w) {
        cur += 1 + len;
      } else {
        rows += 1;
        if (len > w) {
          rows += Math.floor(len / w);
          cur = len % w || w;
        } else {
          cur = len;
        }
      }
    }
    total += rows;
  }
  return total;
}

function patchLast(prev: Message[], fn: (m: Message) => Message): Message[] {
  const copy = prev.slice();
  for (let i = copy.length - 1; i >= 0; i--) {
    if (copy[i]!.role === "assistant") {
      copy[i] = fn(copy[i]!);
      break;
    }
  }
  return copy;
}

function App() {
  const renderer = useRenderer();
  const dims = useTerminalDimensions();
  const wide = () => dims().width >= 100;
  const syntax = createMemo(() =>
    SyntaxStyle.fromStyles(
      {
        default: { fg: theme.text },
        "markup.heading": { fg: theme.accent, bold: true },
        "markup.bold": { bold: true },
        "markup.italic": { italic: true },
        "markup.raw": { fg: theme.warn },
        "markup.link": { fg: theme.accent, underline: true },
        keyword: { fg: "#bb9af7" },
        string: { fg: theme.user },
        number: { fg: "#ff9e64" },
        comment: { fg: theme.dim, italic: true },
        function: { fg: theme.accent },
      },
      renderer.nativeScene,
    ),
  );

  const [messages, setMessages] = createSignal<Message[]>([]);
  const [model, setModel] = createSignal(DEFAULT_MODEL);
  const [thinking, setThinking] = createSignal(DEFAULT_THINKING);
  const [showReasoning, setShowReasoning] = createSignal(true);
  const [streaming, setStreaming] = createSignal(false);
  const [status, setStatus] = createSignal("ready");
  const [ctxUsed, setCtxUsed] = createSignal(0);
  const [maxCtx, setMaxCtx] = createSignal(DEFAULT_MAX_CTX);
  const [attachments, setAttachments] = createSignal<{ kind: "image" | "file"; att: Attachment }[]>([]);
  const [tokens, setTokens] = createSignal({ prompt: 0, completion: 0, rate: 0 });
  const [input, setInput] = createSignal("");
  const abort = { ctrl: undefined as AbortController | undefined };
  let composer: TextareaRenderable | undefined;

  let healthTimer: ReturnType<typeof setInterval> | null = null;
  let composerPoll: ReturnType<typeof setInterval> | null = null;

  const refreshStats = async () => {
    try {
      const h = await health();
      if (h.model) setModel(h.model);
      if (h.max_context) setMaxCtx(h.max_context);
    } catch {}
    try {
      const s = await slots();
      const slot = s[0];
      if (slot) {
        if (slot.n_ctx) setMaxCtx(slot.n_ctx);
        setCtxUsed(slot.n_prompt_tokens ?? 0);
      }
    } catch {}
  };

  onMount(async () => {
    try {
      setMessages(await loadTranscript());
    } catch {
      setStatus("transcript sync unavailable");
    }
    await refreshStats();
    healthTimer = setInterval(refreshStats, 3000);
    composerPoll = setInterval(() => {
      try {
        if (composer) {
          const t = composer.plainText ?? "";
          if (t !== input()) setInput(t);
        }
      } catch {}
    }, 30);
  });

  onCleanup(() => {
    if (healthTimer) clearInterval(healthTimer);
    if (composerPoll) clearInterval(composerPoll);
    abort.ctrl?.abort();
  });

  const send = async () => {
    const text = composer?.plainText ?? "";
    const atts = attachments();
    if ((!text.trim() && atts.length === 0) || streaming()) return;

    const userMsg: Message = {
      role: "user",
      text,
      time: nowMs(),
      images: atts.filter((a) => a.kind === "image").map((a) => a.att),
      files: atts.filter((a) => a.kind === "file").map((a) => a.att),
    };
    const asstMsg: Message = { role: "assistant", text: "", reasoning: "", time: nowMs() };
    const before = messages();
    setMessages([...before, userMsg, asstMsg]);
    composer?.clear();
    setInput("");
    setAttachments([]);
    setStreaming(true);
    setStatus("generating");
    const started = performance.now();
    let sawReasoning = false;

    abort.ctrl = new AbortController();
    try {
      for await (const ev of stream({
        model: model(),
        messages: [...before, userMsg],
        thinking: thinking(),
        signal: abort.ctrl.signal,
      })) {
        if (ev.type === "reasoning") {
          sawReasoning = true;
          setMessages((prev) => patchLast(prev, (m) => ({ ...m, reasoning: (m.reasoning ?? "") + ev.text })));
        } else if (ev.type === "content") {
          setMessages((prev) => patchLast(prev, (m) => ({ ...m, text: m.text + ev.text })));
        } else if (ev.type === "usage") {
          const prompt = Number(ev.usage.prompt_tokens ?? 0);
          const completion = Number(ev.usage.completion_tokens ?? 0);
          const secs = (performance.now() - started) / 1000;
          setTokens({ prompt, completion, rate: completion > 0 && secs > 0.25 ? completion / secs : 0 });
          setMessages((prev) =>
            patchLast(prev, (m) => ({
              ...m,
              meta: `${completion.toLocaleString()} tokens${
                secs > 0.25 ? ` · ${(completion / secs).toFixed(1)} tok/s` : ""
              }`,
              thinkSecs: sawReasoning ? Math.round(secs * 10) / 10 : m.thinkSecs,
            })),
          );
        }
      }
      setStatus("ready");
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setMessages((prev) => patchLast(prev, (m) => ({ ...m, stopped: true })));
        setStatus("stopped");
      } else {
        const msg = e?.message ?? String(e);
        setStatus(msg);
        setMessages((prev) => patchLast(prev, (m) => ({ ...m, error: msg })));
      }
    } finally {
      setStreaming(false);
      abort.ctrl = undefined;
      const final = messages();
      try {
        await saveTranscript(final);
      } catch {
        setStatus("save failed");
      }
      // Server /slots is the source of truth for context fill — refresh promptly
      // so the bar reflects the just-appended turn instead of waiting for the poll.
      refreshStats();
    }
  };

  const stop = () => {
    if (streaming()) abort.ctrl?.abort();
  };

  const attach = async (paths: string[]) => {
    for (const p of paths) {
      try {
        const { kind, att } = await readAttachment(p);
        setAttachments((a) => [...a, { kind, att }]);
        setStatus(`attached ${kind}: ${att.name}`);
      } catch (e: any) {
        setStatus(e?.message ?? String(e));
      }
    }
  };

  const command = (line: string) => {
    const parts = line.trim().split(/\s+/);
    const cmd = (parts[0] ?? "").toLowerCase();
    const arg = parts.slice(1).join(" ").replace(/^['"]|['"]$/g, "");
    switch (cmd) {
      case "/quit":
      case "/exit":
      case "/q":
        process.exit(0);
        break;
      case "/think":
        if (["none", "low", "medium", "high"].includes(arg)) {
          setThinking(arg);
          setStatus(`thinking: ${arg}`);
        } else setStatus("usage: /think none|low|medium|high");
        break;
      case "/show":
        setShowReasoning((v) => !v);
        setStatus(`thinking shown: ${showReasoning() ? "on" : "off"}`);
        break;
      case "/reset":
        setMessages([]);
        setCtxUsed(0);
        saveTranscript([]).catch(() => {});
        setStatus("new conversation");
        break;
      case "/image":
      case "/file":
        if (arg) attach([arg]);
        else setStatus(`usage: ${cmd} PATH`);
        break;
      case "/paste": {
        const text = readClipboard();
        if (text) {
          composer?.insertText(text);
          setStatus("pasted from clipboard");
        } else setStatus("clipboard empty");
        break;
      }
      case "/help":
        setStatus("Enter send · Shift+Enter newline · Esc stop · /think /show /reset /image /paste /quit");
        break;
      default:
        setStatus(`unknown command: ${cmd}`);
    }
  };

  const submit = () => {
    const text = composer?.plainText ?? "";
    if (text.trim().startsWith("/")) {
      command(text);
      composer?.clear();
      setInput("");
      return;
    }
    send();
  };

  useKeyboard((key) => {
    if (key.eventType !== "press") return;
    if (key.ctrl && key.name === "c") {
      if (streaming()) return stop();
      process.exit(0);
    }
    if (key.ctrl && key.name === "q") process.exit(0);
    if (key.name === "escape" && streaming()) stop();
    if (key.ctrl && key.name === "t") {
      setShowReasoning((v) => !v);
      setStatus(`thinking shown: ${showReasoning() ? "on" : "off"}`);
    }
  });

  const ctxPct = () => (maxCtx() > 0 ? Math.min(100, (ctxUsed() / maxCtx()) * 100) : 0);
  const ctxColor = () => (ctxPct() > 85 ? theme.error : ctxPct() > 60 ? theme.warn : theme.accent);

  // The composer grows upward with typed content; the footer stays pinned below.
  const contentWidth = () => {
    const main = dims().width - (wide() ? 30 : 0);
    return Math.max(8, main - 4); // minus border + padding
  };
  // Rows we can afford for the composer while keeping the header (2),
  // spacer (1), footer (1), borders (2) and a minimum chat area (6) visible.
  const composerMaxRows = () => Math.max(1, dims().height - 12);
  const composerRows = () =>
    Math.min(MAX_COMPOSER_ROWS, composerMaxRows(), visualRows(input(), contentWidth()));
  const composerHeight = () => composerRows() + 2; // + top/bottom border

  return (
    <box flexDirection="row" width="100%" height="100%" backgroundColor={theme.bg}>
      <box flexDirection="column" flexGrow={1} height="100%">
        <box
          height={2}
          flexDirection="row"
          justifyContent="space-between"
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={theme.panel}
        >
          <box flexDirection="row">
            <text fg={theme.accent}>
              <b>Strata</b>
            </text>
            <text fg={theme.dim}> · local chat</text>
          </box>
          <box flexDirection="row">
            <text fg={theme.dim}>{streaming() ? "generating " : status() + " "}</text>
            <text fg={theme.accent}>●</text>
          </box>
        </box>

        <scrollbox
          flexGrow={1}
          flexBasis={0}
          flexShrink={1}
          minHeight={0}
          paddingLeft={1}
          paddingRight={1}
          stickyScroll
          stickyStart="bottom"
        >
          <Show
            when={messages().length > 0}
            fallback={<text fg={theme.dim}> new conversation — type a message, or /help</text>}
          >
            <For each={messages()}>{(m) => <MessageView message={m} syntax={syntax()} showReasoning={showReasoning()} />}</For>
          </Show>
        </scrollbox>

        <box flexDirection="column" flexShrink={0} backgroundColor={theme.panelAlt}>
          <Show when={attachments().length > 0}>
            <box paddingLeft={1} flexDirection="row">
              <text fg={theme.dim}>attached: </text>
              <text fg={theme.accent}>
                {attachments()
                  .map((a) => `${a.kind === "image" ? "▣" : "⧉"} ${a.att.name}`)
                  .join("  ")}
              </text>
            </box>
          </Show>
          <box
            height={composerHeight()}
            borderStyle="single"
            borderColor={streaming() ? theme.border : theme.borderFocus}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={theme.panel}
          >
            <textarea
              ref={(el: TextareaRenderable) => {
                composer = el;
                if (composer) {
                  const handler = () => {
                    try {
                      if (!composer) return;
                      setInput(composer.plainText ?? "");
                    } catch {}
                  };
                  composer.onContentChange = handler as any;
                  handler();
                }
              }}
              onSubmit={submit}
              keyBindings={TEXTAREA_KEYS}
              wrapMode="word"
              placeholder="Ask anything…  (Enter to send · Shift+Enter newline)"
              placeholderColor={theme.dim}
              textColor={theme.text}
              focusedTextColor={theme.text}
              backgroundColor={theme.panel}
              focusedBackgroundColor={theme.panel}
              flexGrow={1}
            />
          </box>
          <box height={1} backgroundColor={theme.panelAlt} />
          <box
            height={1}
            flexDirection="row"
            alignItems="center"
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={ctxColor()}>
              {bar(ctxPct(), Math.max(8, contentWidth() - 5))}
              {`  ${ctxPct().toFixed(0)}%`}
            </text>
          </box>
        </box>
      </box>

      <Show when={wide()}>
        <Sidebar
          model={model()}
          thinking={thinking()}
          ctxUsed={ctxUsed()}
          maxCtx={maxCtx()}
          ctxPct={ctxPct()}
          ctxColor={ctxColor()}
          tokens={tokens()}
          count={messages().length}
          streaming={streaming()}
          status={status()}
        />
      </Show>
    </box>
  );
}

function MessageView(props: { message: Message; syntax: SyntaxStyle; showReasoning: boolean }) {
  const m = () => props.message;
  return (
    <box flexDirection="column" marginBottom={1}>
      <box height={1} flexDirection="row">
        <Show
          when={m().role === "user"}
          fallback={
            <box flexDirection="row">
              <text fg={theme.assistant}>
                <b>▲ Strata</b>
              </text>
              <text fg={theme.dim}>
                {"  "}
                {hhmm(m().time)}
                {m().meta ? ` · ${m().meta}` : ""}
                {m().stopped ? " · stopped" : ""}
              </text>
            </box>
          }
        >
          <box flexDirection="row">
            <text fg={theme.user}>
              <b>▌ You</b>
            </text>
            <text fg={theme.dim}>
              {"  "}
              {hhmm(m().time)}
            </text>
          </box>
        </Show>
      </box>

      <Show when={m().role === "assistant" && props.showReasoning && m().reasoning}>
        <box flexDirection="column" paddingLeft={2}>
          <text fg={theme.dim}>┄ thinking ┄</text>
          <text fg={theme.reasoning}>{m().reasoning}</text>
        </box>
      </Show>

      <Show when={(m().files?.length ?? 0) + (m().images?.length ?? 0) > 0}>
        <box flexDirection="row" paddingLeft={2}>
          <text fg={theme.dim}>
            {[
              ...(m().images ?? []).map((i) => `▣ ${i.name}`),
              ...(m().files ?? []).map((f) => `⧉ ${f.name}`),
            ].join("   ")}
          </text>
        </box>
      </Show>

      <box paddingLeft={2} flexDirection="column">
        <Show when={m().role === "assistant"} fallback={<text fg={theme.text}>{m().text}</text>}>
          <Show when={m().text} fallback={<text fg={theme.dim}>…</text>}>
            <markdown content={m().text} syntaxStyle={props.syntax} conceal fg={theme.text} />
          </Show>
        </Show>
      </box>

      <Show when={m().error}>
        <box paddingLeft={2}>
          <text fg={theme.error}>⚠ {m().error}</text>
        </box>
      </Show>
    </box>
  );
}

function Sidebar(props: {
  model: string;
  thinking: string;
  ctxUsed: number;
  maxCtx: number;
  ctxPct: number;
  ctxColor: string;
  tokens: { prompt: number; completion: number; rate: number };
  count: number;
  streaming: boolean;
  status: string;
}) {
  return (
    <box
      width={30}
      flexDirection="column"
      height="100%"
      borderStyle="single"
      borderColor={theme.border}
      backgroundColor={theme.panel}
    >
      <box paddingLeft={1} paddingRight={1} paddingTop={1}>
        <text fg={theme.accentStrong}>
          <b>Context</b>
        </text>
      </box>
      <box flexDirection="column" paddingLeft={1} paddingRight={1}>
        <text fg={props.ctxColor}>{props.ctxPct.toFixed(1)}% used</text>
        <text fg={theme.dim}>
          {fmtTokens(props.ctxUsed)} / {fmtTokens(props.maxCtx)} tokens
        </text>
      </box>

      <box paddingLeft={1} paddingTop={1}>
        <text fg={theme.accentStrong}>
          <b>Session</b>
        </text>
      </box>
      <box flexDirection="column" paddingLeft={1} paddingRight={1}>
        <Line label="model" value={props.model} />
        <Line label="thinking" value={props.thinking} />
        <Line label="messages" value={String(props.count)} />
        <Line label="prompt" value={fmtTokens(props.tokens.prompt)} />
        <Line label="output" value={fmtTokens(props.tokens.completion)} />
        <Line label="speed" value={props.tokens.rate > 0 ? `${props.tokens.rate.toFixed(1)} tok/s` : "—"} />
        <Line label="state" value={props.streaming ? "generating" : props.status} />
      </box>

      <box paddingLeft={1} paddingTop={1}>
        <text fg={theme.accentStrong}>
          <b>Keys</b>
        </text>
      </box>
      <box flexDirection="column" paddingLeft={1} paddingRight={1}>
        <text fg={theme.dim}>Enter · send</text>
        <text fg={theme.dim}>Shift+Enter · newline</text>
        <text fg={theme.dim}>Esc · stop</text>
        <text fg={theme.dim}>Ctrl+T · thinking</text>
        <text fg={theme.dim}>Ctrl+Q · quit</text>
      </box>

      <box paddingLeft={1} paddingTop={1}>
        <text fg={theme.accentStrong}>
          <b>Commands</b>
        </text>
      </box>
      <box flexDirection="column" paddingLeft={1} paddingRight={1}>
        <text fg={theme.dim}>/think /show /reset</text>
        <text fg={theme.dim}>/image /paste /help</text>
      </box>
    </box>
  );
}

function Line(props: { label: string; value: string }) {
  return (
    <box flexDirection="row">
      <text fg={theme.dim}>{props.label.padEnd(9)}</text>
      <text fg={theme.text}>{props.value}</text>
    </box>
  );
}

await render(() => <App />, { exitOnCtrlC: false });
