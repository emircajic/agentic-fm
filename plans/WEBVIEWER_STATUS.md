# Webviewer Output Channel — Build Status

Session-persistent notes on what was built, what remains, every quirk discovered, and where to resume. Read this at the start of any session continuing webviewer output channel work.

---

## What was built

### Process management (companion_server.py)

The companion server already has Vite lifecycle management. These endpoints exist and work:

- `GET /webviewer/status` — returns `{ "running": true/false }` based on whether the companion-spawned Vite process is alive
- `POST /webviewer/start` — spawns `npm run dev` in the `webviewer/` directory as a detached child process
- `POST /webviewer/stop` — sends SIGTERM to the Vite process group

**Important distinction**: this `/webviewer/status` checks process state (did the companion start Vite?), not URL reachability (is the Vite server actually serving requests?). The push channel needs a separate reachability check — see below.

### Webviewer AI chat SSE

The webviewer already uses SSE for AI provider streaming (`webviewer/src/api/client.ts`). This is a separate SSE connection between the webviewer and the AI provider — it has nothing to do with the agent output channel. It is not reusable as-is but confirms the webviewer can consume SSE streams.

---

## What is not yet built

### Companion: SSE broadcast stream

`GET /webviewer/events` — a long-lived SSE endpoint on the companion server. The webviewer connects here once at startup and keeps the connection open. When the agent calls `/webviewer/push`, the companion broadcasts the payload to all connected clients via this stream.

Implementation notes:
- Use Python's standard HTTP chunked response with `Content-Type: text/event-stream` and `Cache-Control: no-cache`
- Keep a thread-safe list of connected response objects; iterate and write `data: ...\n\n` to each on push
- Remove dead connections (broken pipe / closed socket) from the list on write failure
- The `BaseHTTPRequestHandler` approach used in the rest of the companion server can handle this — the handler stays alive for the duration of the SSE connection by not returning from `do_GET`

### Companion: `/webviewer/push` endpoint

`POST /webviewer/push` — accepts `{ "type": "preview"|"diff"|"result", "content": "...", "before": "..." }` and broadcasts to all connected SSE clients.

- Validates `type` is one of the known payload types
- Serialises payload as a JSON SSE event: `data: {"type": "preview", "content": "..."}\n\n`
- Returns `{ "success": true, "clients": N }` where N is the number of connected clients (0 = webviewer not connected, not an error)

### Companion: URL-reachability status check

A second status concept distinct from process state: **is the webviewer URL actually reachable?** Skills use this to decide output routing.

Options:
1. Add a `webviewer_url` field to `automation.json`. The agent reads this and does a `GET {webviewer_url}/health` (or any fast check) to determine availability — no companion involvement needed.
2. Expose it via companion: `GET /webviewer/available` — companion reads `webviewer_url` from config and proxies the reachability check.

Option 1 is simpler. The agent (or skill) does: `curl -s --max-time 2 {webviewer_url}` and treats any 2xx as available.

### Webviewer: "Agent output" panel

A new panel in the webviewer UI that:
- Opens a persistent `EventSource` connection to `{companion_url}/webviewer/events` on mount
- On `preview` event: renders `content` in a read-only Monaco editor instance with FileMaker HR syntax highlighting
- On `diff` event: renders a Monaco diff editor with `before` on the left and `content` on the right; developer can edit the right pane inline
- On `result` event: renders structured output (expression, result value, error context) — format TBD
- Panel is shown/hidden based on whether the companion SSE connection is active

### `automation.json` field

Add `"webviewer_url": "http://localhost:5173"` (or leave empty/omit to disable). Skills read this to determine whether to attempt webviewer push.

---

## Current status

| Feature | Status |
|---|---|
| Vite process management (`/webviewer/start`, `/webviewer/stop`) | ✅ Built |
| Process-state status check (`GET /webviewer/status`) | ✅ Built |
| Companion SSE broadcast stream (`GET /webviewer/events`) | 🔴 Not built |
| `/webviewer/push` endpoint | 🔴 Not built |
| URL-reachability check (`webviewer_url` in automation.json) | 🔴 Not built |
| Webviewer "Agent output" panel | 🔴 Not built |
| `preview` payload → Monaco HR display | 🔴 Not built |
| `diff` payload → Monaco diff editor | 🔴 Not built |
| `result` payload → structured output display | 🔴 Not built |
| Terminal fallback when webviewer unavailable | 🔵 Design only — no skills exist yet to enforce this |

---

## Test plan

Tests are ordered from infrastructure up. Each step is a prerequisite for the next.

### 1. Companion SSE stream

```bash
# Terminal A — connect and keep open
curl -N http://local.hub:8765/webviewer/events

# Terminal B — push a test payload
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"type": "preview", "content": "Set Variable [ $x ; 1 ]"}' \
  http://local.hub:8765/webviewer/push
```

**Expected**: Terminal A receives `data: {"type":"preview","content":"Set Variable [ $x ; 1 ]"}\n\n` within ~100ms.

### 2. Multi-client broadcast

Connect two `curl -N` listeners. Push one payload. Confirm both receive it.

### 3. Dead-client cleanup

Connect a listener, close it with Ctrl+C, push a payload. Confirm the companion does not error and `clients: 0` is returned.

### 4. URL reachability check

```bash
# Vite running
curl -s --max-time 2 http://localhost:5173 | head -5   # should return HTML

# Vite stopped — expect timeout/connection refused
```

Confirm skill routing logic correctly detects availability in both states.

### 5. Webviewer SSE connection

Open the webviewer in a browser. Check browser DevTools → Network for a persistent `EventSource` connection to `{companion_url}/webviewer/events`. Confirm it shows `(pending)` / open status.

### 6. `preview` payload end-to-end

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"type": "preview", "content": "# Test\nSet Variable [ $x[1] ; 42 ]\nExit Script [ $x ]"}' \
  http://local.hub:8765/webviewer/push
```

**Expected**: Agent output panel appears in webviewer with Monaco rendering the HR script. FileMaker syntax highlighting active (keywords, variable sigils, etc.).

### 7. `diff` payload end-to-end

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"type": "diff", "before": "Set Variable [ $x[1] ; 1 ]", "content": "Set Variable [ $x[1] ; 42 ]"}' \
  http://local.hub:8765/webviewer/push
```

**Expected**: Monaco diff editor opens with old value on left, new value on right. Change highlighted.

### 8. Fallback when Vite is stopped

Stop the Vite server. Trigger a skill that produces HR output. Confirm:
- Terminal output is produced normally
- No error is raised
- No attempt is made to push to `/webviewer/push`

### 9. Reconnection after Vite restart

Stop Vite, then restart it. Confirm the webviewer's EventSource reconnects automatically (browsers retry SSE connections by default — verify the `retry:` field is set in the SSE response if needed).

---

## Key files

| File | Purpose |
|---|---|
| `agent/scripts/companion_server.py` | HTTP companion server — add SSE stream and `/webviewer/push` here |
| `agent/config/automation.json` | Add `webviewer_url` field |
| `webviewer/src/` | Vite app — add Agent output panel here |
| `plans/SKILL_INTERFACES.md` | Full interface contract for the webviewer output channel |

---

## What to do next

### 1. Add `webviewer_url` to automation.json

```json
"webviewer_url": "http://localhost:5173"
```

### 2. Build companion SSE stream + `/webviewer/push`

In `companion_server.py`:
- Add a thread-safe `_sse_clients: list` at module level
- `do_GET` routes `/webviewer/events` to `_handle_webviewer_events` — sets headers, appends `self` to client list, loops on a queue until connection closes
- `do_POST` routes `/webviewer/push` to `_handle_webviewer_push` — validates payload, broadcasts to all clients, returns client count
- Run tests 1–3 above before moving to the webviewer side

### 3. Build webviewer Agent output panel

- Add `EventSource` hook that connects to `{companion_url}/webviewer/events`
- Add panel component: Monaco read-only for `preview`, Monaco diff for `diff`, plain render for `result`
- Run tests 5–9 above
