# Session: v0.2.5 — Telemetry Receiver + AWOC Integration Foundation

## Context

**v0.2.4 complete and tagged.** StorageLayer + frame persistence + security hardening. All infrastructure for storing and querying visual state is in place.

**187 tests, 0 failures** across 17 test files. Lint clean. Build clean.

**Versioning:** Patch-level increments (0.2.x) until 1.0.

**Git tags:** v0.1.0 → v0.2.0 → v0.2.1 → v0.2.2 → v0.2.3 → v0.2.4

## The Big Picture

Argus is a **real-time visual verification and steering layer for autonomous AI agents** — "Datadog for Autonomous Agents." Currently it works as a standalone terminal monitor for *any* CLI process. The next leap is deep integration with AWOC (our multi-agent orchestrator) to go from "guessing from pixels" to "verifying against ground truth."

**Two-tier strategy:**
1. **Visual baseline** (done, v0.1–v0.2.4) — Probe wraps any CLI, VLM pipeline classifies agent state from terminal screenshots.
2. **Semantic hook** (v0.2.5+) — For AWOC specifically, a telemetry extension streams structured JSON (tool calls, run IDs, context %) over local UDP. Hub merges visual + semantic. VLM prompts include both pixels AND structured data.

**Endgame (v0.2.8):** 5 simultaneous AWOC probes under Argus with per-run targeted steering from the dashboard.

## AWOC Coordination Status

Requests to AWOC team are documented in `docs/awoc-sync.md` (3 requests):

| # | Request | Argus Side | AWOC Side |
|---|---------|-----------|-----------|
| 1 | Telemetry extension — hook `pi` event bus, stream JSON to `ARGUS_TELEMETRY_SOCKET` | **Not started** — need `telemetry-listener.ts` | **Not started** — need `src/extensions/argus-telemetry.ts` in AWOC |
| 2 | Graceful stdin injection — `/stoprun`, `/steer` via PTY | **Plumbing exists** (probe stdin inject works) | **Needs validation** |
| 3 | Run ID visibility in `awoc-dispatch` widget | N/A (VLM reads it) | **May already work** |

**Key constraint:** v0.2.5 can build the Argus receiver and test it with mock telemetry. End-to-end testing requires AWOC's extension. Design the interface now, ship independently.

Full integration plan: `docs/awoc-integration-plan.md`

## What to Build in v0.2.5

### Track A: Telemetry Receiver (Argus-side, no AWOC dependency)

Build the UDP listener that will receive structured JSON from AWOC's telemetry extension. Test with mock data.

1. **`src/probe/telemetry-listener.ts`** — New module
   - `createTelemetryListener(port: number)` → EventEmitter or callback-based
   - Listens on UDP socket (port from `ARGUS_TELEMETRY_PORT` env var, default 9100)
   - Parses incoming JSON, validates schema: `{ timestamp, event_type, run_id, data, telemetry }`
   - Emits typed events: `tool_start`, `tool_end`, `agent_start`, `turn_start`, `context_compact`
   - Graceful: if port in use or bind fails, log warning and continue without telemetry
   - Unit tests with mock UDP packets

2. **Probe integration** — Wire telemetry into probe.ts
   - Probe optionally starts telemetry listener alongside visual pipeline
   - Forward telemetry events to hub as new message type: `telemetry_update`
   - `{ type: "telemetry_update", agent_id, event_type, run_id, data, telemetry }`

3. **Hub merge** — Store and correlate
   - New `telemetry_events` table in db.ts (or extend `vlm_events`)
   - Hub stores telemetry alongside visual state
   - HTTP API: `GET /api/agents/:id/telemetry` — paginated telemetry timeline

4. **Enhanced Tier2 prompt** — When telemetry available, inject into VLM system prompt:
   - "The agent is currently executing tool 'dispatch_agent' with args {...}. Context usage: 45%. Active runs: 2."
   - Falls back to visual-only if no telemetry (graceful degradation)

### Track B: Tech Debt Cleanup

5. **Dashboard frame pipeline CI test** — Deferred from v0.2.4
6. **`useAgentSocket` coverage** — 40% → 60%+ lines

### New Env Vars (planned)
- `ARGUS_TELEMETRY_PORT` — UDP port for telemetry listener (default: 9100)

### Telemetry Schema (from `docs/awoc-sync.md`)

```typescript
interface TelemetryPayload {
  timestamp: number;
  event_type: "tool_execution_start" | "tool_execution_end" | "agent_start" | "turn_start" | "context_compact";
  run_id: string;
  data: {
    tool_name?: string;
    args?: Record<string, unknown>;
    result?: unknown;
    agent_name?: string;
  };
  telemetry: {
    context_percent: number;
    active_runs: number;
  };
}
```

## Architecture (v0.2.5 target)

```
                    ┌─── Pipe mode (default) ───┐
[any command] ──────┤                           ├──▶ probe.ts ──WS──▶ hub.ts ──WS──▶ page.tsx
                    └─── PTY mode (ARGUS_PTY=1) ┘       │            ▲  │               │
                         script -qefc + xterm/headless   │            │  │         pause/kill/inject
                                                      VLM tiers       │  └─ HTTP API ──▶ /api/*
                                                     (Tier 1+2)       │
                                                         │            │
                                                   [StorageLayer]─────┘
                                                    ├─ SQLite (agents, logs, events, frames, telemetry)
                                                    └─ Filesystem (JPEG frames: tmpfs or disk)

                    [AWOC Extension] ──UDP──▶ telemetry-listener.ts ──▶ probe.ts
                     (pi event bus)           (port 9100)                  │
                                                                    telemetry_update ──▶ hub
```

## Key Files (current state, for reference)

- `src/hub/hub.ts` — WebSocket relay + HTTP API + frame handling (92% func, 90% line coverage)
- `src/hub/storage.ts` — StorageLayer: StorageConfig, FrameStore, createStorage factory
- `src/hub/db.ts` — SQLite: agents, logs, vlm_events, frames tables (100% func coverage)
- `src/probe/probe.ts` — VLM pipeline, pipe/PTY modes, process wrapper
- `src/probe/probe-utils.ts` — Pure functions (screen buffer, JSON extraction, command handler)
- `src/probe/terminal.ts` — @xterm/headless wrapper for PTY grid capture
- `src/probe/ansi-to-svg.ts` — Inline ANSI→SVG renderer
- `src/app/page.tsx` — Dashboard (CRT aesthetic — do NOT modify design)
- `src/app/useAgentSocket.ts` — Dashboard WebSocket hook
- `docs/awoc-sync.md` — Coordination requests to AWOC team (3 requests)
- `docs/awoc-integration-plan.md` — Full integration strategy (4 phases)

## Version History (context for new session)

| Version | What | Tests |
|---------|------|-------|
| v0.1.0 | Testable Foundation — factory pattern, unit tests, CI | 80+ |
| v0.2.0 | Multi-Agent Reliability — graceful shutdown, re-registration, VLM fallback | 95 |
| v0.2.1 | Project Restructuring + ANSI Hardening | 101 |
| v0.2.2 | Pre-Persistence Hub Hardening — metadata, agent lifecycle | 126 |
| v0.2.3 | Persistence + PTY — SQLite, script+xterm/headless, HTTP API | 146 |
| v0.2.4 | Storage Layer + Frame Persistence + Security Hardening | 187 |
| **v0.2.5** | **Telemetry Receiver + AWOC Integration Foundation** | **Target: 200+** |

## Conventions

- **Runtime:** Bun everywhere. No npm.
- **Testing:** Test-first. Unit tests mirror `src/` structure under `tests/unit/`.
- **Patterns:** Factory functions (`createX()`), `import.meta.main` guards, pure function extraction.
- **Dashboard:** CRT terminal aesthetic is sacred. Don't touch design.
- **Versioning:** Patch increments. Each version tested + tagged before next.
- **Subagents:** Use parallel subagent coders for independent implementation tracks.
