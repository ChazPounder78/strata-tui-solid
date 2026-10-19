# strata-tui-solid

An [opencode](https://opencode.ai)-flavoured terminal chat for the local **Strata**
model, built with [OpenTUI](https://opentui.com) (Zig core) + SolidJS and run on Bun.

It speaks the same wire protocol as the Strata web app and the shared transcript
(`strata-sync` on `:7577`), so conversations stay in sync with the web UI.

## Features

- Streaming chat against `http://127.0.0.1:8080/v1/chat/completions`.
- Markdown rendering for replies (headings, lists, code, tables) with syntax colours.
- Right-hand sidebar: context window usage bar + %, prompt/output token counts,
  throughput, session state, keybindings and commands.
- Multi-line composer: `Enter` sends, `Shift+Enter` inserts a newline, `Esc` stops.
- Optional reasoning ("thinking") stream, toggled with `Ctrl+T`.
- Attachments: images (base64 data URL) and text files up to 512 KB.
- Shared transcript read/write through `strata-sync`.

## Requirements

- Bun (the app is launched through `bun`).
- The Strata engine on `:8080` (`systemctl --user start strata`).
- `strata-sync` on `:7577` for the shared transcript (optional).

## Run

```sh
bun install
bun index.tsx            # or: bun run start
```

The launcher installed on this machine is `strata-tui-solid`.

## Keys

| Key           | Action                     |
| ------------- | -------------------------- |
| Enter         | send                       |
| Shift+Enter   | newline                    |
| Esc           | stop the current reply     |
| Ctrl+T        | show/hide reasoning        |
| Ctrl+C        | stop, or quit when idle    |
| Ctrl+Q        | quit                       |

## Commands

`/think none|low|medium|high`, `/show`, `/reset`, `/image PATH`, `/paste`, `/help`, `/quit`

## Configuration

- `STRATA_API` (default `http://127.0.0.1:8080`)
- `STRATA_SYNC` (default `http://127.0.0.1:7577/transcript`)
