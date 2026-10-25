# tldraw MCP app

This is the tldraw MCP app. It exposes an interactive tldraw canvas to AI agents via the [Model Context Protocol app specification](https://github.com/modelcontextprotocol/ext-apps/), so you can work in tldraw with agents in any MCP client that supports the MCP app spec.

## Architecture

The app has two parts: a **server** and a **widget**.

### Server

The server runs in Cloudflare Workers via `src/worker.ts`, using a Durable Object (`TldrawMCP`) backed by SQLite for persistent checkpoint storage.

It exposes:

- `search` — query the extracted Editor API spec in a sandboxed dynamic worker
- `exec` — execute JavaScript against the live editor in the widget via a pending-request callback bridge
- `_exec_callback` — app-only tool the widget calls to resolve a pending `exec` request
- `save_checkpoint` / `read_checkpoint` — app-only tools used by the widget for checkpoint persistence

### Widget

The widget is a React app (`src/widget/mcp-app.tsx`) that renders a full tldraw canvas inside the MCP host's iframe.

When the AI calls `exec`, the server creates a pending request and the widget picks it up, runs the code through a focused editor proxy (`src/widget/focused/`) that translates between an AI-friendly shape format (simple string IDs, flat `_type` shapes) and tldraw's internal `TLShape`/`TLShapeId` types, then calls `_exec_callback` to resolve the pending request with the result. Canvas state is checkpointed to the Durable Object's SQLite database and to the browser's local storage.

## Developing

### Prerequisites

The widget build depends on generated files (`editor-api.json`, `method-map.json`) that are extracted from the editor's TypeScript declarations. Before you can develop or build the mcp-app, you need to build the core packages first:

```bash
# from the repo root
pnpm build
```

This produces the `.tsbuild/` output that `pnpm extract-api` reads from. The `build` and `dev` scripts run `extract-api` automatically, so you don't need to call it separately.

### Package scripts

Run all commands from `apps/mcp-app`.

| Command           | What it does                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm build`      | Build the widget HTML                                                                                           |
| `pnpm dev`        | Build widget + start local Cloudflare worker (HTTP MCP on `localhost:8787`)                                     |
| `pnpm dev:tunnel` | Build widget + start a stable named Cloudflare tunnel + local worker with `WORKER_ORIGIN` set to the tunnel URL |
| `pnpm run deploy` | Build widget + deploy the Cloudflare worker to production                                                       |

`pnpm dev:tunnel` requires the `cloudflared` CLI to be installed on your machine and a one-time `cloudflared tunnel login`. It serves a stable per-user hostname (`<user>-mcp-app-dev.tldraw.xyz`) via a named tunnel, so the URL you register in hosted MCP clients stays the same across runs instead of changing every time. The user slug defaults to `whoami`; override it (or the zone/port) with `MCP_TUNNEL_USER`, `MCP_TUNNEL_ZONE`, and `PORT`. The zone must be a Cloudflare-hosted zone (`tldraw.xyz` is; `tldraw.dev`/`tldraw.com` are on Vercel and won't work).

The worker defaults to production-safe behavior in `wrangler.toml`, including setting `MCP_IS_DEV="false"`. Local HTTP dev scripts override that with `MCP_IS_DEV=true` so local Claude/ChatGPT connectors suppress `ui.domain` while production deployments keep it enabled.

### Cursor setup

Add these two servers in `~/.cursor/mcp.json`:

```json
{
	"mcpServers": {
		"tldraw": {
			"transport": "http",
			"url": "https://tldraw-mcp-app.tldraw.workers.dev/mcp"
		},
		"tldraw-local": {
			"command": "npx",
			"args": ["-y", "mcp-remote", "http://127.0.0.1:8787/mcp"]
		}
	}
}
```

### Claude Desktop local setup

For local Claude Desktop development, use `claude_desktop_config.json` with the local HTTP server:

```json
{
	"mcpServers": {
		"tldraw-local": {
			"command": "npx",
			"args": ["-y", "mcp-remote", "http://127.0.0.1:8787/mcp"]
		}
	}
}
```

### Claude Desktop remote setup

If you'd like to try the remote MCP server in Claude Desktop, use the in-app connector flow rather than adding the production URL to `claude_desktop_config.json`.

1. Open Claude Desktop
2. In the sidebar, go to **Customize**
3. Open **Connectors**
4. Click the button to add a connector, then choose **Add custom connector**
5. Give it a name such as `tldraw`
6. Paste `https://tldraw-mcp-app.tldraw.workers.dev/mcp` as the server URL

The **Add custom connector** option is not available on the free plan, so you may need Max or another paid plan.

If you need Notion access in Claude Desktop, use the Notion MCP connector for that separately.

### ChatGPT local dev

ChatGPT requires an HTTPS origin, so you need a Cloudflare tunnel. You must be an admin of your OpenAI org/workspace to do local dev.

First-time setup (once per machine):

1. Run `cloudflared tunnel login` and choose the `tldraw.xyz` zone

Then, each session:

1. Run `pnpm dev:tunnel` in `apps/mcp-app`
2. It serves your stable hostname, e.g. `https://<user>-mcp-app-dev.tldraw.xyz` (the first run also creates the named tunnel and its DNS route)
3. In ChatGPT web (not the desktop app), go to **Apps** and add your app using that URL
4. You can then test in both ChatGPT web and the desktop or mobile apps

Because the hostname is stable per user, you only add the app in ChatGPT once — subsequent `pnpm dev:tunnel` runs reuse the same URL.

`dev:tunnel` automatically wires `WORKER_ORIGIN` to the stable tunnel URL and sets `MCP_IS_DEV=true` for the local worker.

### Iteration loop

1. Make code changes in `apps/mcp-app`
2. Run the relevant script (`dev` or `dev:tunnel`)
3. Disconnect and reconnect the MCP server in your client (or reload the page/app)
4. When making widget changes, make sure to rebuild, either by running `pnpm build` or rerunning any of the dev scripts.

Reconnecting the server after changes is the most reliable way to pick up new code, especially when the widget HTML changes.

## Session storage lifecycle

Each MCP session is a `TldrawMCP` Durable Object. It keeps up to `MAX_CHECKPOINTS` (50) canvas snapshots and destroys itself after `IDLE_TTL_MS` (7 days) without a checkpoint save — a schedule armed in `init()` and re-armed on every check.

## Contact

Find us on Twitter/X at [@tldraw](https://twitter.com/tldraw).

## Community

Have questions, comments or feedback? [Join our discord](https://discord.tldraw.com/?utm_source=github&utm_medium=readme&utm_campaign=sociallink). For the latest news and release notes, visit [tldraw.dev](https://tldraw.dev).

## Local presenter authoring

The dedicated presenter service runs locally without Cloudflare, a hosted widget, model subprocesses, or API keys. From the repo root:

```sh
pnpm --filter mcp-app dev:presenter
```

Configure a native MCP client with Streamable HTTP URL `http://127.0.0.1:5481/mcp`. The service binds only `127.0.0.1`; an MCP client disconnect does not stop it. SIGINT/SIGTERM closes transports and the listener. State is in memory and resets on restart; browser library persistence/export remains independent.

Open `http://localhost:5420/presenter-canvas/full` with the examples dev server running. After a draft arrives, choose **Rehearse this deck**, then use the audience **Next** controls to advance beats. Schema metadata and submit receipts include this `presenterUrl`.

Tools:

- `presenter_schema({})`: version 1 document JSON schema, authoring rules, and browser bridge metadata.
- `presenter_get({})`: `{sourceId, revision, document}`; initially revision 0 and document null.
- `presenter_submit({expectedSourceId, expectedRevision, document})`: validate and replace the server draft, returning `{sourceId, revision, saved, presenterUrl, browser}`. Read the latest `presenter_get` first and supply its source UUID and revision together, including revision 0 for the first submit. Invalid input and source or revision conflicts preserve the current draft. A conflict returns `isError: true` and `saved: false`.
- `presenter_preview({document})`: validate and summarize without saving or rendering.
- `presenter_status({})`: browser self-reports, with `connected` true only while a heartbeat is at most 30 seconds old.

The data schema mirrors the independent example's `document.ts` without importing the examples package. Documents contain version, title, canvas width/height, and beats with unique IDs, titles, notes, and actions. Stroke actions contain timing, color, and ordered `{x,y,pressure}` points; text actions contain timing, text, and coordinates. Bounds match the example: 100 beats, 500 actions per beat, 50000 points per stroke, 200000 positions total, canvas 100–4096 pixels, pressure 0–1, start 0–600000 ms and duration 1–600000 ms. HTTP bodies are limited to 16 MiB. No JavaScript execution or file paths are accepted.

Browser bridge (JSON, no credentials):

- `GET /presenter/draft` returns `{sourceId, revision, document}`. Poll about once per second. A new source ID means the service restarted; revision numbers are scoped to that source.
- `GET /presenter/status` returns `{sourceId, revision, connected, browsers, browserTtlMs}`.
- `POST /presenter/ack` takes `{sourceId, revision, browserId, state, rehearsalSourceId, rehearsalRevision, message?}`. Use a stable random browser ID per tab; `state` is `received`, `applied`, or `error`. `rehearsalSourceId` (UUID) and `rehearsalRevision` must both be null when no server-sourced rehearsal is active, or both present to identify the exact source and revision selected for the active rehearsal. Keep that pair while its rehearsal remains active, including across server restarts. `message` is optional, at most 1000 characters. Repeat the acknowledgement as a heartbeat. Response is `{accepted:true, ...status}`. The main `sourceId` and `revision` must match the current server envelope. Stale main source/revision or future rehearsal revisions belonging to the current server source return 409; rehearsal counters from older sources cannot be validated by the restarted server and are accepted. Missing or mismatched rehearsal pairs and other invalid bodies return 400. Up to 16 recent browser clients are retained.

Only `http://localhost:5420` and `http://127.0.0.1:5420` browser Origins are allowed. Browser acknowledgement requires an allowed Origin; native MCP requests must omit Origin. Host must be loopback with the actual listening port. CORS preflight accepts Content-Type and GET/POST/OPTIONS; credentials are neither required nor enabled.

The frontend should run its authoritative `parsePresentation` before replacing the editable draft and acknowledging `applied`; on failure, retain local data and acknowledge `error`. Polling must not replace an active rehearsal. Track the source/revision pair explicitly when choosing a rehearsal and report the pair for the exact active audience rehearsal ID. Identical draft content does not establish rehearsal attribution. Preserve the old pair across a server restart while that rehearsal remains active; use both null for a local or otherwise unattributed rehearsal. A saved server draft, an accepted editable draft, and visible playback are separate facts. Browser status is self-reported and does not verify pixels. Playback stays under the existing local controls; these tools do not start playback. A shareable frontend still works without this local service; remote pages do not receive local bridge access.

Run the real SDK transport and boundary tests with `pnpm --filter mcp-app test run src/presenter/server.test.ts`.
