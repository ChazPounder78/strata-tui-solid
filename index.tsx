import { render } from "@opentui/solid"
import { createSignal, onMount, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"

const API_BASE = "http://127.0.0.1:8080"
const SYNC_URL = "http://127.0.0.1:7577/transcript"

type Message = {
  role: "user" | "assistant"
  text: string
  time: number
}

const App = () => {
  const [messages, setMessages] = createSignal<Message[]>([])
  const [input, setInput] = createSignal("")
  const [model, setModel] = createSignal("local")
  const [streaming, setStreaming] = createSignal(false)
  const [status, setStatus] = createSignal("ready")

  onMount(async () => {
    try {
      const h = await fetch(`${API_BASE}/health`).then(r => r.json()).catch(() => null)
      if (h?.model) setModel(h.model)
    } catch {}
    try {
      const t = await fetch(SYNC_URL).then(r => r.json())
      setMessages((t.messages || []) as Message[])
    } catch {}
  })

  const send = async () => {
    const text = input()
    if (!text || text.trim() === "" || streaming()) return
    const userMsg: Message = { role: "user", text, time: Date.now() }
    const asstMsg: Message = { role: "assistant", text: "", time: Date.now() }
    const msgsBefore = messages()
    setMessages([...msgsBefore, userMsg, asstMsg])
    setInput("")
    setStreaming(true)
    setStatus("generating")
    try {
      const res = await fetch(`${API_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model(),
          messages: [
            ...msgsBefore.map(m => ({ role: m.role, content: m.text })),
            { role: "user", content: text },
          ],
          stream: true,
          reasoning_effort: "high",
          temperature: 0.6,
          top_p: 0.95,
          top_k: 20,
        }),
      })
      if (!res.body) throw new Error("no body")
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split("\n")) {
          const l = line.trim()
          if (!l.startsWith("data:")) continue
          const d = l.slice(5).trim()
          if (d === "[DONE]") continue
          try {
            const j = JSON.parse(d)
            const delta = j.choices?.[0]?.delta
            if (delta?.content) {
              setMessages((prev) => {
                const last = prev[prev.length - 1]
                if (last?.role === "assistant") {
                  return [...prev.slice(0, -1), { ...last, text: last.text + delta.content }]
                }
                return prev
              })
            }
          } catch {}
        }
      }
      try {
        await fetch(SYNC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: messages() }),
        })
      } catch {}
      setStatus("ready")
    } catch (e: any) {
      setStatus(e?.message || "error")
    } finally {
      setStreaming(false)
    }
  }

  useKeyboard((key) => {
    if (key.eventType !== "press") return
    if (key.name === "enter" && !key.shift && !key.ctrl && !key.alt && !key.meta) {
      send()
    }
    if ((key.ctrl && key.name === "c") || (key.ctrl && key.name === "q")) {
      process.exit(0)
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box height={1} paddingX={1} border="single" borderColor="cyan">
        <text>STRATA · {model()} · {streaming() ? "generating" : status()}</text>
      </box>
      <scrollbox flexGrow={1} paddingX={1}>
        <For each={messages()}>
          {(m) => (
            <box flexDirection="column" marginBottom={1}>
              <text color={m.role === "user" ? "green" : "cyan"}>{m.role === "user" ? "You:" : "AI:"}</text>
              <text>{m.text}</text>
            </box>
          )}
        </For>
      </scrollbox>
      <box height={3} paddingX={1} border="single" borderColor="blue">
        <textarea
          value={input()}
          onInput={(v) => setInput(String(v))}
          onSubmit={send}
          flexGrow={1}
        />
      </box>
    </box>
  )
}

await render(() => <App />)
