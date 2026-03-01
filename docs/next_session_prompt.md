# Next Session: v0.3.0 — Persistence & Metadata

## Context

v0.2.0 is tagged. Multi-agent reliability hardened:
- Graceful shutdown (SIGINT/SIGTERM) for hub and probe — no zombie processes
- Probe re-registration after hub restart — caches VLM state, re-sends on reconnect
- Hub registration idempotent — preserves state on re-register
- Multi-probe orchestration tested — 5 integration tests covering isolation, routing, reconnection
- `ansi-to-svg` replaced with inline renderer (~150 lines, 0 external deps, 14 tests)
- Rate limiting: screen broadcast 100ms→250ms, dashboard message batching via rAF, tier1 cooldown after tier2
- 95 tests, 0 failures. Lint clean. Build clean.

## Version Map

| Version | Milestone | Focus |
| ------- | --------- | ----- |
| v0.1.0  | Done | Testable foundation, bug fixes, CI |
| v0.2.0  | Done | Multi-agent reliability, reconnection, ansi-to-svg replacement |
| v0.3.0  | **This session** | Persistence, agent metadata, replay |
| v0.4.0  | Actuation | Auto-pause thresholds, webhook notifications |
| v0.5.0  | Beta | Dashboard polish, docs, first real agent workflow |

## What v0.3.0 Should Deliver

### 1. SQLite Persistence Layer
- Store agent logs, VLM verdicts, and state transitions
- Survive hub restarts — reload agent history on startup
- Schema: agents table, logs table, vlm_events table, frames table (optional)
- Use Bun's built-in SQLite (`bun:sqlite`) — no extra dependency

### 2. Agent Metadata
- Probe sends metadata on register: `{task, command, start_time}`
- Hub stores and forwards to dashboard
- Dashboard shows task description and uptime per agent card
- Env var: `ARGUS_AGENT_TASK` for probe metadata

### 3. Post-Mortem Replay
- API endpoint on hub: `GET /api/agents/:id/history`
- Returns timeline of state transitions, VLM verdicts, key log entries
- Dashboard replay view (or at minimum, scrollable history panel)

### 4. Log Retention
- Current: 50 log lines in memory per agent
- With SQLite: unlimited retention, paginated retrieval
- Dashboard: lazy-load older logs on scroll

## Known Technical Debt (Carry to v0.4.0)
- Dashboard frame capture pipeline untested in CI
- React keys: monotonic counter done for logs, verify no Math.random() remains
- No authentication on hub endpoints
- Probe doesn't verify VLM endpoint is reachable before starting agent

## Success Criteria
- [ ] Hub persists agent state to SQLite, survives restart
- [ ] Agent metadata visible on dashboard cards
- [ ] History API endpoint returns agent timeline
- [ ] All existing tests pass + new tests for persistence
- [ ] `git tag v0.3.0`
