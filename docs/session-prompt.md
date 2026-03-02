# Session: v0.2.7 — Steering UX + Dashboard Controls

## Context

**v0.2.6 complete and tagged.** Actuation & targeted steering. Steering module translates dashboard commands (`stoprun`, `steer`) to AWOC stdin strings. Full integration tests prove telemetry and steering pipelines work end-to-end.

**310 tests, 0 failures** across 21 test files. Lint clean. Build clean.

**Versioning:** Patch-level increments (0.2.x) until 1.0.

**Git tags:** v0.1.0 → v0.2.0 → v0.2.1 → v0.2.2 → v0.2.3 → v0.2.4 → v0.2.5 → v0.2.6

## The Big Picture

**Progression:**
1. **Visual baseline** (done, v0.1–v0.2.4) — VLM classifies state from screenshots.
2. **Semantic hook** (done, v0.2.5) — Telemetry receiver + Tier2 enrichment.
3. **Actuation** (done, v0.2.6) — Steering commands, integration tests.
4. **Steering UX** (v0.2.7, this session) — Dashboard UI for per-run control.

**Endgame (v0.2.8):** 5 simultaneous AWOC probes under Argus with per-run targeted steering from the dashboard.

## AWOC Coordination Status

| # | Request | Argus Side | AWOC Side |
|---|---------|-----------|-----------|
| 1 | Telemetry extension | **Done** (v0.2.5) | **Not started** |
| 2 | Graceful stdin injection | **Done** (v0.2.6) — stoprun/steer translation | **Needs validation** |
| 3 | Run ID visibility | N/A | **May already work** |

## What to Build in v0.2.7

### Dashboard Controls (page.tsx modifications — carefully scoped)

**Important:** The CRT terminal aesthetic is sacred. These additions should feel like natural extensions of the existing UI, not redesigns.

1. **Telemetry sidebar panel** — When telemetry_update arrives:
   - Show active tool, run ID, context usage % below the existing VLM state display
   - Wire `applyMessage` to handle `telemetry_update` and store on Agent type
   - Small, unobtrusive — single line or collapsible section

2. **Steering buttons** — Below existing pause/kill/inject controls:
   - "Halt Run" button → sends `stoprun` command with run ID from telemetry
   - "Steer" button → opens inject-like text input, sends `steer` command
   - Only visible when telemetry is active (graceful degradation)

3. **Dashboard WebSocket: `telemetry_update` handling**
   - Extend `Agent` type with optional telemetry fields
   - Add `telemetry_update` case to `applyMessage` and `isKnownMessageType`
   - Tests for the new message type

### Post-mortem / Timeline (if time permits)

4. **VLM event timeline view** — Simple chronological display of VLM events
   - Fetches from `GET /api/agents/:id/history`
   - Scrollable list with state, confidence, reasoning, timestamp
   - Optional: telemetry events interleaved

## Key Files

- `src/app/page.tsx` — Dashboard UI (CRT aesthetic — CAREFUL with changes)
- `src/app/useAgentSocket.ts` — WebSocket hook + pure functions
- `src/app/globals.css` — Dark theme styles
- `src/hub/hub.ts` — WebSocket relay + HTTP API
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
| **v0.2.7** | **Steering UX + Dashboard Controls** | **Target: 330+** |

## Conventions

- **Runtime:** Bun everywhere. No npm.
- **Testing:** Test-first. Unit tests mirror `src/` structure under `tests/unit/`.
- **Patterns:** Factory functions, `import.meta.main` guards, pure function extraction.
- **Dashboard:** CRT terminal aesthetic is sacred. Don't touch design fundamentals.
- **Versioning:** Patch increments. Each version tested + tagged before next.
- **Subagents:** Use parallel subagent coders for independent implementation tracks.
