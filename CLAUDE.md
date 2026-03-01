# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Argus

Real-time visual verification and steering layer for autonomous AI agents — "Datadog for Autonomous Agents." A probe monitors agent terminal output via PTY + VLM, detects failures (stuck loops, destructive intent, hallucinations), and streams state to a dashboard with manual override controls.

## Commands

```bash
# Frontend (Next.js dashboard)
npm run dev          # Dev server
npm run build        # Production build
npm run lint         # ESLint

# Backend (Bun WebSocket hub + probe)
bun run hub.ts       # Start WebSocket server on :8000
bun run probe.ts     # Start VLM probe (spawns demo_agent.ts via PTY)
bun run demo_agent.ts  # Run demo agent standalone
```

Start order: hub → probe → dashboard (`npm run dev`).

## Architecture

```
demo_agent.ts ──PTY──▶ probe.ts ──WS──▶ hub.ts ──WS──▶ page.tsx
  (agent)        ANSI    (VLM monitor)    (relay)        (dashboard)
                                                            │
                                                     pause/kill/inject
                                                            │
                                                    hub.ts ──▶ probe.ts
```

**hub.ts** — Bun WebSocket server (:8000). Routes: `/ws/probe` (probe connections), `/ws/dashboard` (frontend connections). In-memory agent state, broadcasts updates to all dashboards.

**probe.ts** — Two-tier VLM pipeline using xterm headless + node-pty:
- Tier 1 (every 1s): Fast anomaly detection — "OK" vs "ANOMALY"
- Tier 2 (on escalation): Deep reasoning with temporal context → classifies state + confidence score
- VLM endpoint: local llama.cpp server, model `Qwen3.5-35B-A3B-UD-Q4_K_XL`
- Broadcasts terminal screen diffs every 50ms

**page.tsx** — Next.js dashboard. Connects to `ws://localhost:8000/ws/dashboard`. Shows agent cards with live terminal feed, logs, state badges, confidence scores. Sidebar with pause/kill/inject controls.

**Agent states:** PROGRESSING (green), STUCK (yellow), DANGEROUS (red), HALLUCINATING (red).

**WS message types:** `init`, `frame_update`, `terminal_screen_update`, `log_update`, `vlm_update`, `update`, `pause`, `kill`, `inject`.

## Key Files

- `src/app/page.tsx` — Dashboard UI (~570 lines, all in one component)
- `src/app/globals.css` — CRT-styled dark theme (scanlines, green-on-black)
- `hub.ts` — WebSocket relay server
- `probe.ts` — PTY + two-tier VLM monitoring
- `demo_agent.ts` — Simulated SWE-agent that loops into failure
- `poc/observer.ts` — Alternative screenshot-based PoC (Phase 1 reference)
- `docs/architecture.md` — Full system design with production vision
- `docs/plan.md` — Multi-phase roadmap (PoC → Rust → Cloud → SaaS)

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript 5, CSS Modules (no Tailwind)
- **Backend:** Bun runtime, native Bun WebSocket server
- **Terminal:** node-pty + @xterm/headless for PTY capture
- **VLM:** OpenAI-compatible API client against local llama.cpp
- **Icons:** lucide-react
- **Font:** JetBrains Mono

## Project Status

Phase 0 (scaffold) and Phase 1 (PoC) complete. No tests exist yet. The Python probe from early Phase 1 has been replaced by TypeScript (`probe.ts`). Phases 2-5 (Rust daemon, cloud infra, actuation, SaaS) are planned but not started.

## Conventions

- Path alias: `@/*` → `./src/*`
- Bun for backend runtime and non-Next scripts; npm for Next.js
- ESLint flat config (v9) with next/core-web-vitals + next/typescript
- CRT terminal aesthetic: green-on-black, scanlines, glow effects
