# Session: v0.2.8 — Beta

## Context

**v0.2.7 complete and tagged.** Steering UX + Dashboard Controls. Telemetry data wired into dashboard — sidebar shows run ID, active tool, context % bar. Steering buttons (Halt Run, Steer Agent) conditionally appear when telemetry is active. Agent cards show CTX % badge.

**329 tests, 0 failures** across 21 test files. Lint clean. Build clean.

**Versioning:** Patch-level increments (0.2.x) until 1.0.

**Git tags:** v0.1.0 → v0.2.0 → v0.2.1 → v0.2.2 → v0.2.3 → v0.2.4 → v0.2.5 → v0.2.6 → v0.2.7

## The Big Picture

**Progression:**
1. **Visual baseline** (done, v0.1–v0.2.4) — VLM classifies state from screenshots.
2. **Semantic hook** (done, v0.2.5) — Telemetry receiver + Tier2 enrichment.
3. **Actuation** (done, v0.2.6) — Steering commands, integration tests.
4. **Steering UX** (done, v0.2.7) — Dashboard UI for per-run control.
5. **Beta** (v0.2.8, this session) — CLI entry point, auth, docs, 5 simultaneous AWOC probes.

**Endgame (v0.2.8):** 5 simultaneous AWOC probes under Argus with per-run targeted steering from the dashboard. Ready for first users.

## AWOC Coordination Status

| # | Request | Argus Side | AWOC Side |
|---|---------|-----------|-----------|
| 1 | Telemetry extension | **Done** (v0.2.5) | **Not started** |
| 2 | Graceful stdin injection | **Done** (v0.2.6) — stoprun/steer translation | **Needs validation** |
| 3 | Run ID visibility | N/A | **May already work** |

## What to Build in v0.2.8

### CLI Entry Point
1. **`src/cli.ts`** — `bunx argus -- <cmd>` entry point
   - Starts hub + probe in a single process
   - Auto-opens dashboard in browser
   - Clean shutdown on Ctrl+C

### Authentication
2. **Bearer token on hub WS + HTTP** — Simple shared secret
   - `ARGUS_AUTH_TOKEN` env var
   - Probes and dashboard send token in WS URL or HTTP header
   - Reject unauthenticated connections

### Keyboard Shortcuts (deferred from v0.2.7)
3. **`src/app/useKeyboardShortcuts.ts`** — Keyboard shortcuts for dashboard
   - `p` pause, `r` resume, `k` kill, `h` halt run, `s` steer
   - `1-9` select agent by index
   - `Esc` deselect

### Post-mortem Timeline (deferred from v0.2.7)
4. **VLM event timeline view** — Simple chronological display
   - Fetches from `GET /api/agents/:id/history`
   - Scrollable list with state, confidence, reasoning, timestamp
   - Optional: telemetry events interleaved

### Documentation
5. **Getting started guide**, API reference, AWOC integration guide
6. **README rewrite** with badges, screenshots, quickstart

### End-to-End
7. **5 simultaneous AWOC probes** under Argus — validation run

## Key Files

- `src/app/page.tsx` — Dashboard UI (CRT aesthetic — telemetry panel + steering buttons added in v0.2.7)
- `src/app/useAgentSocket.ts` — WebSocket hook + pure functions (AgentTelemetry + telemetry_update handler added in v0.2.7)
- `src/app/page.module.css` — Dark theme styles
- `src/hub/hub.ts` — WebSocket relay + HTTP API
- `src/probe/probe.ts` — VLM monitoring pipeline
- `src/probe/probe-utils.ts` — Command handler (stoprun/steer ready)
- `src/probe/steering.ts` — AWOC command builder

## Version History

| Version | What | Tests |
|---------|------|-------|
| v0.1.0 | Testable Foundation | 80+ |
| v0.2.0 | Multi-Agent Reliability | 95 |
| v0.2.1 | Project Restructuring + ANSI Hardening | 101 |
| v0.2.2 | Pre-Persistence Hub Hardening | 126 |
| v0.2.3 | Persistence + PTY | 146 |
| v0.2.4 | Storage Layer + Frame Persistence | 187 |
| v0.2.5 | Telemetry Receiver + AWOC Integration | 286 |
| v0.2.6 | Actuation & Targeted Steering | 310 |
| v0.2.7 | Steering UX + Dashboard Controls | 329 |
| **v0.2.8** | **Beta** | **Target: 350+** |

## Conventions

- **Runtime:** Bun everywhere. No npm.
- **Testing:** Test-first. Unit tests mirror `src/` structure under `tests/unit/`.
- **Patterns:** Factory functions, `import.meta.main` guards, pure function extraction.
- **Dashboard:** CRT terminal aesthetic is sacred. Don't touch design fundamentals.
- **Versioning:** Patch increments. Each version tested + tagged before next.
- **Subagents:** Use parallel subagent coders for independent implementation tracks.
