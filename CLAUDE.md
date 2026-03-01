# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Argus

Real-time visual verification and steering layer for autonomous AI agents — "Datadog for Autonomous Agents." A probe monitors agent terminal output via PTY + VLM, detects failures (stuck loops, destructive intent, hallucinations), and streams state to a dashboard with manual override controls (pause, kill, inject prompt).

## Commands

```bash
# Start the WebSocket hub (must be first)
bun run dev:hub

# Start the Next.js dashboard
bun run dev:dashboard

# Start the probe (wraps demo agent by default)
bun run dev:probe

# Wrap any command instead
bun run src/probe/probe.ts -- python3 my_agent.py

# Wrap a TUI app with PTY mode (v0.2.3)
ARGUS_PTY=1 bun run src/probe/probe.ts -- htop

# Build / lint
bun run build
bun run lint

# Run tests
bun test                    # all tests
bun run test:unit           # unit tests only
bun run test:integration    # integration tests only
bun run test:coverage       # with coverage report
```

Start order: hub → probe → dashboard.

## Architecture

```
                    ┌─── Pipe mode (default) ───┐
[any command] ──────┤                           ├──▶ probe.ts ──WS──▶ hub.ts ──WS──▶ page.tsx
                    └─── PTY mode (ARGUS_PTY=1) ┘       │            ▲  │               │
                         script -qefc + xterm/headless   │            │  │         pause/kill/inject
                                                      VLM tiers       │  └─ HTTP API ──▶ /api/*
                                                     (Tier 1+2)       │     (v0.2.4)
                                                         │            │
                                                   [StorageLayer]─────┘
                                                    ├─ SQLite (metadata, logs, events, frame refs)
                                                    └─ Filesystem (JPEG frames: tmpfs or disk)
```

**hub.ts** — Bun WebSocket server (:8000). Two endpoints: `/ws/probe` and `/ws/dashboard`. Probes register with `{type: "register", agent_id, metadata?}` on connect (idempotent — re-register preserves state). Hub maintains agent state and routes dashboard commands to the correct probe. Storage via `StorageLayer` abstraction (v0.2.4) — `createHub(port, config?: StorageConfig | string)` accepts SQLite path (backwards compat) or full `StorageConfig` with `dbPath`, `framePath`, `frameMode`, `frameTTL`. Frame persistence: hub decodes base64 from `frame_update`, writes JPEG to `FrameStore`, records metadata in SQLite, broadcasts to dashboards. Graceful shutdown via SIGINT/SIGTERM. Port configurable via `ARGUS_HUB_PORT`.

**probe.ts** — Process wrapper + two-tier VLM pipeline. Two capture modes:
- **Pipe mode** (default, `ARGUS_PTY=0`): Bun.spawn with piped stdout/stderr, rolling line buffer for screen state.
- **PTY mode** (`ARGUS_PTY=1`): Wraps command in `script -qefc` for real PTY allocation, feeds output to `@xterm/headless` Terminal for proper 2D grid capture via `terminal.ts`. Enables TUI app monitoring (htop, vim, AWOC).

Handles commands from hub: SIGSTOP (pause), SIGCONT (resume), SIGKILL (kill), stdin write (inject). Uses `chat_template_kwargs: {enable_thinking: false}` for Qwen3.5 reasoning models. Operator states (PAUSED, EXITED) are protected via `operatorOverride` flag — VLM cannot override them. Tier2 vision failures fall back to text analysis. Caches last VLM state and re-sends on reconnect. Graceful shutdown via SIGINT/SIGTERM. All config via env vars (see `.env.example`).

**VLM Pipeline:**
- Tier 1 (every 1s): Text-based fast binary check — "ANOMALY" or "OK" (5s timeout)
- Tier 2 (on escalation): Vision-based deep reasoning with 2x2 temporal frame grid → JSON with state classification + confidence (45s timeout). Falls back to text if no frames available.
- Visual capture (every 2s): ANSI → SVG (inline renderer) → JPEG (sharp) → base64. Frames stored in buffer and streamed to dashboard.
- Tier1 cooldown: configurable pause after tier2 escalation (`ARGUS_TIER1_COOLDOWN`, default 5s)

**page.tsx** — Next.js dashboard. CRT terminal aesthetic. Connects to `ws://localhost:8000/ws/dashboard`. Agent grid with live terminal feed, logs, state badges, confidence. Sidebar with pause/kill/inject controls. Auto-reconnects with exponential backoff.

**Agent states:** PROGRESSING, STUCK, DANGEROUS, HALLUCINATING, PAUSED, EXITED

## WebSocket Protocol

**Probe → Hub → Dashboard:**
- `register` — probe identifies itself with `{agent_id, metadata?: {task, command, start_time}}`
- `terminal_screen_update` — raw terminal text
- `log_update` — individual log line `{text, type}`
- `vlm_update` — state change from VLM `{agent_state, confidence_score, reasoning}`
- `frame_update` — base64 JPEG frame from visual pipeline
- `agent_disconnected` — probe disconnected, remove from UI
- `init` — full agent roster sent to dashboard on connect (includes metadata)

**Dashboard → Hub → Probe:**
- `command` — `{action: "pause"|"resume"|"kill"|"inject", content?: string}`

**HTTP API (v0.2.4):**
- `GET /api/agents` — all agents (including disconnected)
- `GET /api/agents/:id/history` — paginated VLM event timeline
- `GET /api/agents/:id/logs` — paginated logs with `?type=` filter
- `GET /api/agents/:id/frames` — paginated frame metadata *(v0.2.4)*
- `GET /api/frames/:path` — serve actual JPEG file *(v0.2.4)*
- Query params: `limit=100`, `offset=0`, `since=<timestamp>`, `before=<timestamp>`

## Environment Variables

All in `.env.example`. Key ones:
- `ARGUS_VLM_URL` — OpenAI-compatible endpoint for text tier1 (default: `http://localhost:8080/v1`)
- `ARGUS_VLM_MODEL` — Text model name (default: `gpt-4o-mini`)
- `ARGUS_VISION_URL` / `ARGUS_VISION_MODEL` / `ARGUS_VISION_KEY` — Vision model for tier2 (defaults to VLM values)
- `ARGUS_AGENT_ID` — Agent identifier (default: `A-01`)
- `ARGUS_FRAME_INTERVAL` — Frame capture interval in ms (default: `2000`)
- `ARGUS_SCREEN_INTERVAL` — Screen broadcast interval in ms (default: `250`)
- `ARGUS_TIER1_COOLDOWN` — Cooldown after tier2 before tier1 resumes in ms (default: `5000`)
- `NEXT_PUBLIC_HUB_URL` — Dashboard WebSocket base URL (default: `ws://localhost:8000`)
- `ARGUS_PTY` — PTY mode: 0=pipe (default), 1=pty via `script` + `@xterm/headless` *(v0.2.3)*
- `ARGUS_PTY_COLS` / `ARGUS_PTY_ROWS` — Terminal dimensions in PTY mode (default: 80x24) *(v0.2.3)*
- `ARGUS_DB_PATH` — SQLite file path; empty = no persistence *(v0.2.3)*
- `ARGUS_FRAME_PATH` — Frame storage root (default: `/dev/shm/argus-frames` or `/tmp/argus-frames`) *(v0.2.4)*
- `ARGUS_FRAME_MODE` — `ephemeral` (tmpfs, auto-cleanup) or `persist` (disk, keep all) *(v0.2.4)*
- `ARGUS_FRAME_TTL` — Auto-cleanup interval in ms, ephemeral mode only (default: `300000`) *(v0.2.4)*
- `ARGUS_AGENT_TASK` — Agent task description sent in register metadata *(v0.2.3)*

## Key Files

- `src/hub/hub.ts` — WebSocket relay with agent registry, command routing, HTTP API (`createHub()` factory)
- `src/hub/storage.ts` — StorageLayer abstraction: StorageConfig, FrameStore (filesystem-backed), createStorage factory *(v0.2.4)*
- `src/hub/db.ts` — SQLite persistence layer using `bun:sqlite` — agents, logs, vlm_events, frames tables *(v0.2.4)*
- `src/probe/probe.ts` — VLM monitoring pipeline (connects to hub, spawns child process, pipe or PTY mode)
- `src/probe/probe-utils.ts` — Pure functions extracted from probe (screen buffers, JSON extraction, command handler, pipeStream, pipeToTerminal)
- `src/probe/terminal.ts` — `@xterm/headless` wrapper with SGR reconstruction for PTY mode *(v0.2.3)*
- `src/probe/ansi-to-svg.ts` — Inline ANSI→SVG renderer (replaces unmaintained ansi-to-svg package)
- `src/app/useAgentSocket.ts` — Custom hook for dashboard WebSocket + `applyMessage()` pure function + rAF message batching
- `src/demo/demo_agent.ts` — Simulated SWE-agent that loops into failure (for demos)
- `src/app/page.tsx` — Dashboard UI (CRT terminal aesthetic)
- `src/app/globals.css` — Dark theme with scanlines, green-on-black
- `ROADMAP.md` — Single source of truth for versioning (v0.1–v0.5)
- `docs/session-prompt.md` — Continuation prompt for next Claude session
- `tests/helpers.ts` — Shared test utilities (wsUrl, waitForMessage, waitForOpen)
- `tests/unit/hub/` — Hub unit tests (routing, db)
- `tests/unit/probe/` — Probe unit tests (extract-json, screen-buffer, handle-command, pipe-stream, anomaly-detection, ansi-to-svg, terminal)
- `tests/unit/app/` — Dashboard unit tests (apply-message)
- `tests/unit/hub/storage.test.ts` — FrameStore unit tests *(v0.2.4)*
- `tests/unit/hub/hardening.test.ts` — Security hardening tests (path traversal, oversized frame, error resilience) *(v0.2.4)*
- `tests/integration/` — Integration tests (pipeline lifecycle, multi-probe orchestration, pty-pipeline, frame persistence)
- `docs/awoc-integration-plan.md` — Full AWOC integration strategy (4 phases, 2-tier architecture)
- `docs/awoc-sync.md` — Coordination requests to AWOC team (telemetry extension, steering, run IDs)

## Tech Stack

- **Runtime:** Bun (everything — backend, Next.js, scripts)
- **Frontend:** Next.js 16, React 19, TypeScript 5, CSS Modules
- **Process capture:** Bun.spawn — pipe mode (stdout/stderr) or PTY mode (`script` + `@xterm/headless`)
- **Terminal emulation:** `@xterm/headless` v6.0.0 — headless xterm for 2D grid capture in PTY mode *(v0.2.3)*
- **Visual pipeline:** Inline ANSI→SVG renderer + sharp (SVG → JPEG)
- **Persistence:** `StorageLayer` — SQLite for metadata (agents, logs, VLM events, frame metadata), filesystem for frame JPEGs (tmpfs ephemeral / disk persistent) *(v0.2.4)*
- **VLM:** OpenAI SDK against any compatible endpoint (text tier1 + vision tier2)
- **Font:** JetBrains Mono | **Icons:** lucide-react

## Conventions

- Path alias: `@/*` → `./src/*`
- Backend code in `src/hub/`, `src/probe/`, `src/demo/` — tests mirror under `tests/unit/`
- ESLint flat config (v9) with next/core-web-vitals + next/typescript
- No npm — bun only (package-lock.json is gitignored)
