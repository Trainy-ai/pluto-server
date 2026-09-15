# @trainy/pluto-bridge

Use your own **Claude Code** or **Codex** to power the chat in
[Pluto](https://pluto.trainy.ai). The bridge is a small server on your
machine: the Pluto web app sends it chat messages, it runs your agent CLI, and
the agent looks up your experiment data through the Pluto MCP server.

Inference runs on your machine, under your own Claude or ChatGPT
subscription. Conversations never pass through Pluto's servers.

```
Pluto Chat (browser) ──▶ pluto-bridge (127.0.0.1) ──▶ claude / codex ──▶ Pluto MCP
```

## Requirements

- Node.js 20.10 or newer
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`) or
  [Codex](https://github.com/openai/codex) (`codex`), installed and signed in
- A Pluto API key: create one at <https://pluto.trainy.ai/api-keys>

## Start

```bash
PLUTO_API_KEY=mlpi_... npx @trainy/pluto-bridge@1.0.0
```

Use the exact command shown on the Pluto Chat page, because it pins the
version. The bridge prints a port and a pairing token:

```
Pluto bridge listening on http://127.0.0.1:8377
Agent: claude
Allowed origins: https://pluto.trainy.ai
Pluto tools: read-only (pass --allow-writes to let the agent change tags, notes and dashboards)

In the Pluto Chat page, choose “Local agent” and enter:
  Port:  8377
  Token: 4f1f4ea69b...
```

In Pluto, open **Chat**, choose **Local agent**, click **Connect agent** and
enter that port and token. The token is saved in
`~/.config/pluto-bridge/token`, so after a restart the pairing keeps working.

## Options

| Flag | Meaning |
|------|---------|
| `--agent claude\|codex` | Which CLI answers chats (default `claude`) |
| `--port <n>` | Loopback port (default `8377`) |
| `--allow-writes` | Let the agent add/remove tags, edit notes, and create, edit or restore dashboards. Off by default. |
| `--origin <origin>` | Also accept chats from this Pluto web origin. Repeatable. Needed for self-hosted Pluto. |
| `--mcp-url <url>` | Pluto MCP endpoint for self-hosted Pluto (default `https://pluto-mcp.trainy.ai/mcp/`) |
| `--mcp-config <path>` | Claude only: an MCP config file to use instead of `--mcp-url`. It must define a server named `pluto`. |
| `--token <s>` | Use this pairing token for one run, without saving it |
| `--rotate-token` | Replace the saved pairing token. Pair the Chat page again afterwards. |
| `--claude-bin` / `--codex-bin` | Paths to the agent binaries |

### Self-hosted Pluto

```bash
PLUTO_API_KEY=mlpi_... npx @trainy/pluto-bridge@1.0.0 \
  --origin https://pluto.example.com \
  --mcp-url https://pluto-mcp.example.com/mcp/
```

If the bridge logs `Refused a request from <origin>`, restart it with
`--origin <origin>`.

## Security

- **Loopback only.** The bridge listens on `127.0.0.1`, so other machines
  cannot reach it.
- **Pairing token.** Every request must carry the token. The token file is
  readable only by you (`0600`).
- **Origin allowlist.** Browsers may call the bridge only from
  `https://pluto.trainy.ai` and any origins you add with `--origin`. Someone who
  sees your token still cannot use it from another website.
- **Read-only by default.** The agent gets an explicit list of Pluto read
  tools, and nothing that changes data unless you pass `--allow-writes`.
  Your agent enforces this, so text in run data cannot talk the model past
  it:
  - **Claude Code** runs with `--strict-mcp-config`. Only the bridge's `pluto`
    server is loaded, and the write tools are in `--disallowedTools`, which
    takes precedence over your own allow rules.
  - **Codex** runs with `--ignore-user-config`. Only the bridge's `pluto`
    server is loaded, with `enabled_tools` set to the granted tools, and shell
    commands run in the `read-only` sandbox.
- **Your API key stays off the command line.** The agent reads
  `PLUTO_API_KEY` from its environment, so the key never appears in the
  process list.
- **No runtime dependencies**, and no install scripts.

Because Codex runs with `--ignore-user-config`, your `~/.codex/config.toml`
settings, such as model choice, do not apply to bridge chats. Sign-in still
comes from `CODEX_HOME`.

## License

MIT
