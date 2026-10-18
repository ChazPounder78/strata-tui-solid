import { render } from "@opentui/solid"
import { createSignal, onMount, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"

const API_BASE = "http://127.0.0.1:8080"
const SYNC_URL = "http://127.0.0.1:7577/transcript"

type Message = {
  role: "user" | "assistant"
  text: string
  time: number
  reasoning?: string
  meta?: string
  error?: string
  stopped?: boolean
  images?: any[]
  files?: any[]
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
    const text = input().trim()
    if (!text || streaming()) return
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
          const data = l.slice(5).trim()
          if (data === "[DONE]") continue
          try {
            const j = JSON.parse(data)
            const delta = j.choices?.[0]?.delta
            if (delta?.content) {
              setMessages((prev) => {
                const last = prev[prev.length - 1]
                if (last?.role === "assistant") {
                  last.text += delta.content
                  return [...prev.slice(0, -1), { ...last }]
                }
                return prev
              })
            }
            if (delta?.reasoning_content) {
              setMessages((prev) => {
                const last = prev[prev.length - 1]
                if (last?.role === "assistant") {
                  last.reasoning = (last.reasoning || "") + delta.reasoning_content
                  return [...prev.slice(0, -1), { ...last }]
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
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last?.role === "assistant") {
          last.error = e?.message
          return [...prev.slice(0, -1), { ...last }]
        }
        return prev
      })
    } finally {
      setStreaming(false)
    }
  }

  useKeyboard((key) => {
    if (key.name === "return" && key.eventType !== "release") {
      send()
    }
    if ((key.name === "c" && key.ctrl) || (key.name === "q" && key.ctrl)) {
      process.exit(0)
    }
    if (key.name === "escape") {
      // could stop stream later
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box borderStyle="round" borderColor="cyan" padding={1} justifyContent="space-between">
        <text>STRATA · {model()}</text>
        <text color="gray">{streaming() ? "generating..." : status()}</text>
      </box>
      <scrollbox flexGrow={1} padding={1} flexDirection="column">
        <For each={messages()}>
          {(m) => (
            <box flexDirection="column" marginBottom={1}>
              <text color={m.role === "user" ? "green" : "cyan"} bold>
                {m.role === "user" ? "You" : "AI"} · {new Date(m.time).toLocaleTimeString()}
              </text>
              {m.reasoning && <text color="gray">{m.reasoning}</text>}
              <text>{m.text}</text>
              {m.error && <text color="red">{m.error}</text>}
            </box>
          )}
        </For>
      </scrollbox>
      <box padding={1} flexDirection="column">
        <textarea
          value={input()}
          onInput={(v) => setInput(String(v))}
          height={3}
          placeholder="type message... (Enter to send, Ctrl+C to quit)"
        />
      </box>
    </box>
  )
}

await render(() => <App />)
