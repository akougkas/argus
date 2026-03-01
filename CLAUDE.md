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
bun run probe.ts -- python3 my_agent.py

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
[any command] ──PTY──▶ probe.ts ──WS──▶ hub.ts ──WS──▶ page.tsx (dashboard)
                        │                  ▲                │
                     VLM tiers             │          pause/kill/inject
                    (Tier 1+2)             └────────────────┘
```

**hub.ts** — Bun WebSocket server (:8000). Two endpoints: `/ws/probe` and `/ws/dashboard`. Probes register with `{type: "register", agent_id}` on connect. Hub maintains agent state and routes dashboard commands to the correct probe. Port configurable via `ARGUS_HUB_PORT`.

**probe.ts** — Process wrapper + two-tier VLM pipeline. Spawns any command via Bun.spawn with piped stdout/stderr. Maintains a rolling line buffer as the "screen" and streams diffs + log lines to hub. Handles commands from hub: SIGSTOP (pause), SIGCONT (resume), SIGKILL (kill), stdin write (inject). Uses `chat_template_kwargs: {enable_thinking: false}` for Qwen3.5 reasoning models. All config via env vars (see `.env.example`).

**VLM Pipeline:**
- Tier 1 (every 1s): Text-based fast binary check — "ANOMALY" or "OK" (5s timeout)
- Tier 2 (on escalation): Vision-based deep reasoning with 2x2 temporal frame grid → JSON with state classification + confidence (45s timeout). Falls back to text if no frames available.
- Visual capture (every 2s): ANSI → SVG (ansi-to-svg) → JPEG (sharp) → base64. Frames stored in buffer and streamed to dashboard.

**page.tsx** — Next.js dashboard. CRT terminal aesthetic. Connects to `ws://localhost:8000/ws/dashboard`. Agent grid with live terminal feed, logs, state badges, confidence. Sidebar with pause/kill/inject controls.

## WebSocket Protocol

**Probe → Hub → Dashboard:**
- `register` — probe identifies itself with agent_id
- `terminal_screen_update` — raw terminal text
- `log_update` — individual log line `{text, type}`
- `vlm_update` — state change from VLM `{agent_state, confidence_score, reasoning}`
- `frame_update` — base64 JPEG frame from visual pipeline
- `agent_disconnected` — probe disconnected, remove from UI
- `init` — full agent roster sent to dashboard on connect

**Dashboard → Hub → Probe:**
- `command` — `{action: "pause"|"resume"|"kill"|"inject", content?: string}`

**Agent states:** PROGRESSING, STUCK, DANGEROUS, HALLUCINATING

## Environment Variables

All in `.env.example`. Key ones:
- `ARGUS_VLM_URL` — OpenAI-compatible endpoint for text tier1 (default: `http://localhost:8080/v1`)
- `ARGUS_VLM_MODEL` — Text model name (default: `gpt-4o-mini`)
- `ARGUS_VISION_URL` / `ARGUS_VISION_MODEL` / `ARGUS_VISION_KEY` — Vision model for tier2 (defaults to VLM values)
- `ARGUS_AGENT_ID` — Agent identifier (default: `A-01`)
- `ARGUS_FRAME_INTERVAL` — Frame capture interval in ms (default: `2000`)
- `NEXT_PUBLIC_HUB_URL` — Dashboard WebSocket base URL (default: `ws://localhost:8000`)

## Key Files

- `hub.ts` — WebSocket relay with agent registry and command routing (`createHub()` factory)
- `probe.ts` — VLM monitoring pipeline (connects to hub, spawns child process)
- `probe-utils.ts` — Pure functions extracted from probe (screen buffers, JSON extraction, command handler, pipeStream)
- `src/app/useAgentSocket.ts` — Custom hook for dashboard WebSocket + `applyMessage()` pure function
- `demo_agent.ts` — Simulated SWE-agent that loops into failure (for demos)
- `src/app/page.tsx` — Dashboard UI (CRT terminal aesthetic)
- `src/app/globals.css` — Dark theme with scanlines, green-on-black
- `docs/architecture.md` — Full system design vision (Rust daemon, cloud, SaaS)
- `docs/plan.md` — Multi-phase roadmap
- `tests/unit/` — Unit tests (extract-json, screen-buffer, hub, handle-command, pipe-stream, anomaly-detection, apply-message)
- `tests/integration/` — Integration test (full hub pipeline lifecycle)

## Tech Stack

- **Runtime:** Bun (everything — backend, Next.js, scripts)
- **Frontend:** Next.js 16, React 19, TypeScript 5, CSS Modules
- **Process capture:** Bun.spawn with piped stdout/stderr, rolling line buffer
- **Visual pipeline:** ansi-to-svg + sharp (ANSI → SVG → JPEG)
- **VLM:** OpenAI SDK against any compatible endpoint (text tier1 + vision tier2)
- **Font:** JetBrains Mono | **Icons:** lucide-react

## Conventions

- Path alias: `@/*` → `./src/*`
- Flat file structure at root (hub.ts, probe.ts, demo_agent.ts) — this is a PoC
- ESLint flat config (v9) with next/core-web-vitals + next/typescript
- No npm — bun only (package-lock.json is gitignored)
