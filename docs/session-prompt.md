# Session: v0.2.6 — Actuation & Targeted Steering

## Context

**v0.2.5 complete and tagged.** Telemetry receiver + AWOC integration foundation. UDP listener receives structured JSON from AWOC, stores in SQLite, enriches Tier2 VLM prompt with semantic context. Extracted 8 pure functions from dashboard hook for testability.

**286 tests, 0 failures** across 18 test files. Lint clean. Build clean.

**Versioning:** Patch-level increments (0.2.x) until 1.0.

**Git tags:** v0.1.0 → v0.2.0 → v0.2.1 → v0.2.2 → v0.2.3 → v0.2.4 → v0.2.5

## The Big Picture

**Two-tier strategy progression:**
1. **Visual baseline** (done, v0.1–v0.2.4) — Probe wraps any CLI, VLM classifies state from screenshots.
2. **Semantic hook** (done, v0.2.5) — Telemetry receiver + Tier2 enrichment. Tested with mock UDP; end-to-end requires AWOC's extension.
3. **Actuation** (v0.2.6, this session) — Targeted steering: AWOC-specific commands (stoprun, steer) via stdin injection. Integration tests for telemetry + steering pipelines.
4. **Steering UX** (v0.2.7) — Dashboard UI for per-run control.

**Endgame (v0.2.8):** 5 simultaneous AWOC probes under Argus with per-run targeted steering from the dashboard.

**Key constraint:** The telemetry receiver (v0.2.5) is tested with mock UDP only. End-to-end validation requires AWOC's `src/extensions/argus-telemetry.ts`, which doesn't exist yet. v0.2.6 should prove the full wiring via integration tests before building more features on top.

## AWOC Coordination Status

Requests documented in `docs/awoc-sync.md`:

| # | Request | Argus Side | AWOC Side |
|---|---------|-----------|-----------|
| 1 | Telemetry extension | **Done** (v0.2.5) — receiver, storage, VLM enrichment | **Not started** — need `src/extensions/argus-telemetry.ts` in AWOC |
| 2 | Graceful stdin injection — `/stoprun`, `/steer` | **Plumbing exists** (probe stdin inject works); **v0.2.6** adds AWOC translation layer | **Needs validation** |
| 3 | Run ID visibility in `awoc-dispatch` widget | N/A (VLM reads it) | **May already work** |

## What to Build in v0.2.6

### Track A: Steering Module (independent, no AWOC dependency)

1. **`src/probe/steering.ts`** — New module
   - `buildSteeringCommand(action, runId?, content?)` → stdin string
   - Actions: `stoprun <id>` → `/stoprun <id>\n`, `steer <message>` → `/steer <message>\n`
   - Pure functions, no state — translates dashboard actions to AWOC stdin strings
   - Validates run IDs are non-empty strings
   - Unit tests in `tests/unit/probe/steering.test.ts`

2. **Extended hub command routing** — Add `"stoprun"` and `"steer"` actions
   - Hub already routes `command` messages from dashboard to probe
   - Add new action types alongside existing `pause/resume/kill/inject`
   - Hub passes through to probe; probe calls steering module to build stdin string
   - Update `handleCommand()` in `probe-utils.ts` to handle `stoprun` and `steer`
   - Tests for new actions in existing hub and probe test files

### Track B: Integration Tests (independent, proves v0.2.5 wiring)

3. **Telemetry integration test** — `tests/integration/telemetry.test.ts`
   - Spin up hub + connect probe WS + mock UDP sender
   - Send mock telemetry UDP packet → verify:
     - `telemetry_update` arrives at dashboard WS
     - Event stored in SQLite `telemetry_events` table
     - `GET /api/agents/:id/telemetry` returns the event
   - Test multiple event types, filtering by run_id

4. **Steering integration test** — `tests/integration/steering.test.ts`
   - Spin up hub + probe WS (probe wraps `cat` or simple echo process)
   - Send `stoprun` command from dashboard WS → verify:
     - Command routed through hub to probe
     - Correct `/stoprun <id>\n` string written to child stdin
   - Same for `steer` command
   - Verify existing `pause/resume/kill/inject` still work (regression)

### Sequencing

Tracks A and B are fully independent — launch in parallel:
- Track A: steering.ts + hub routing + probe-utils update + unit tests
- Track B: telemetry integration test + steering integration test

Then verify all tests pass together.

### Telemetry Schema (reference, from v0.2.5)

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

### Steering Command Protocol (new in v0.2.6)

```typescript
// Dashboard → Hub → Probe (extends existing command protocol)
{
  type: "command",
  agent_id: "A-01",
  action: "stoprun" | "steer",  // new actions
  content: "run-id-123"         // for stoprun: run ID; for steer: message
}

// Probe translates to AWOC stdin:
// stoprun → "/stoprun run-id-123\n"
// steer   → "/steer Stop working on the backend\n"
```

## Key Files (current state)

- `src/hub/hub.ts` — WebSocket relay + HTTP API + telemetry handling (92% func, 90% line)
- `src/hub/storage.ts` — StorageLayer: StorageConfig, FrameStore, createStorage factory
- `src/hub/db.ts` — SQLite: agents, logs, vlm_events, frames, telemetry_events (100% func, 96% line)
- `src/probe/probe.ts` — VLM pipeline + telemetry listener + pipe/PTY modes
- `src/probe/probe-utils.ts` — Pure functions: screen buffer, JSON extraction, command handler, pipeStream
- `src/probe/telemetry-listener.ts` — UDP telemetry receiver (createTelemetryListener factory, 75% func, 94% line)
- `src/probe/terminal.ts` — @xterm/headless wrapper for PTY grid capture
- `src/probe/ansi-to-svg.ts` — Inline ANSI→SVG renderer
- `src/app/page.tsx` — Dashboard (CRT aesthetic — do NOT modify design)
- `src/app/useAgentSocket.ts` — Dashboard WebSocket hook + 8 extracted pure helpers (96% func, 61% line)
- `tests/helpers.ts` — Shared test utilities (wsUrl, waitForMessage, waitForOpen)
- `docs/awoc-sync.md` — Coordination requests to AWOC team
- `docs/awoc-integration-plan.md` — Full integration strategy (4 phases)

## Version History

| Version | What | Tests |
|---------|------|-------|
| v0.1.0 | Testable Foundation — factory pattern, unit tests, CI | 80+ |
| v0.2.0 | Multi-Agent Reliability — graceful shutdown, re-registration, VLM fallback | 95 |
| v0.2.1 | Project Restructuring + ANSI Hardening | 101 |
| v0.2.2 | Pre-Persistence Hub Hardening — metadata, agent lifecycle | 126 |
| v0.2.3 | Persistence + PTY — SQLite, script+xterm/headless, HTTP API | 146 |
| v0.2.4 | Storage Layer + Frame Persistence + Security Hardening | 187 |
| v0.2.5 | Telemetry Receiver + AWOC Integration Foundation | 286 |
| **v0.2.6** | **Actuation & Targeted Steering** | **Target: 310+** |

## Conventions

- **Runtime:** Bun everywhere. No npm.
- **Testing:** Test-first. Unit tests mirror `src/` structure under `tests/unit/`.
- **Patterns:** Factory functions (`createX()`), `import.meta.main` guards, pure function extraction.
- **Dashboard:** CRT terminal aesthetic is sacred. Don't touch design.
- **Versioning:** Patch increments. Each version tested + tagged before next.
- **Subagents:** Use parallel subagent coders for independent implementation tracks.
