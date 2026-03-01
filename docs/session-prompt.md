# Session: v0.3.0 — Persistence + PTY Foundation (Continuation)

## Context

**Previous session accomplished:**
- v0.2.1 tagged (restructure + ANSI hardening)
- v0.2.2 tagged (pre-persistence hub hardening: metadata, connected flag, preserve-on-disconnect)
- Track A (PTY) complete and committed (not tagged — WIP toward v0.3.0)
- Track C (Agent Metadata) complete — done as part of v0.2.2

**Current state:** 126 tests, 0 failures, 12 test files. Lint clean (1 pre-existing img warning). Build clean.

**Git log (most recent first):**
```
4779802 v0.3.0 WIP: PTY foundation (Track A complete)
6291d93 v0.2.2: Pre-persistence hub hardening  ← tagged v0.2.2
41082ba v0.3.0–v0.5.0 roadmap + repository organization
9aa4006 Restructure project into src/ layout    ← tagged v0.2.1
```

## What's Done

### Track A: PTY Integration — COMPLETE
- [x] `@xterm/headless` v6.0.0 installed (zero deps)
- [x] `src/probe/terminal.ts` — headless xterm wrapper with SGR reconstruction
  - `createTerminal(cols, rows)` → `TerminalWrapper`
  - `write(data)` → Promise (uses callback internally for reliable processing)
  - `getGrid()` → `{ text, ansi }` — plain text + reconstructed SGR codes
  - Supports: 16-color, 256-color, bold, dim, italic, underline, inverse, background
  - Requires `allowProposedApi: true` for buffer access
  - 100% function coverage, 95% line coverage
- [x] `pipeToTerminal(stream, terminal, sendLog)` in `probe-utils.ts`
- [x] PTY mode in `probe.ts` behind `ARGUS_PTY=1`
  - Wraps command: `script -qefc "stty rows R cols C 2>/dev/null; exec CMD" /dev/null`
  - Sets `TERM=xterm-256color` in spawn env
  - Screen broadcast from `terminal.getGrid().text`
  - Frame capture from `terminal.getGrid().ansi` → `captureFrameFromGrid()` (inline in probe.ts)
  - Tier2 text fallback reads from terminal grid in PTY mode
  - Reconnect re-sends terminal grid in PTY mode
  - Terminal disposed on child exit
  - Pipe mode (default) completely unchanged
- [x] 17 terminal unit tests + 3 PTY integration tests

### Track C: Agent Metadata — COMPLETE (done in v0.2.2)
- [x] `register` message accepts `metadata: { task, command, start_time }`
- [x] Probe reads `ARGUS_AGENT_TASK`, sends command + start_time
- [x] Hub `AgentState` has `task`, `command`, `startTime`, `lastSeen`, `connected`
- [x] Hub preserves agents on disconnect (`connected: false`)
- [x] Hub `init` sends only connected agents
- [x] Hub health counts only connected agents
- [x] Dashboard `applyMessage()` populates task from init data
- [x] 5 new hub tests for metadata, reconnect, health counts, init filtering

## What Remains

### Track B: SQLite Persistence — NOT STARTED
This is the main work for this session.

**Step 6: Create `src/hub/db.ts` + `tests/unit/hub/db.test.ts`**
- Use `bun:sqlite` (built-in, no dependency)
- `createDb(path?)` → `DbInstance`
- Schema:
  ```sql
  CREATE TABLE agents (
    id TEXT PRIMARY KEY, state TEXT, confidence REAL, reasoning TEXT,
    task TEXT, command TEXT, start_time INTEGER, last_seen INTEGER
  );
  CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT, text TEXT,
    type TEXT, timestamp INTEGER
  );
  CREATE INDEX idx_logs_agent_ts ON logs(agent_id, timestamp);
  CREATE TABLE vlm_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT, state TEXT,
    confidence REAL, reasoning TEXT, timestamp INTEGER
  );
  CREATE INDEX idx_vlm_agent_ts ON vlm_events(agent_id, timestamp);
  ```
- Methods: `insertAgent()`, `updateAgentState()`, `insertLog()`, `insertVlmEvent()`, `getAllAgents()`, `getAgentHistory()`, `getAgentLogs()`
- `:memory:` for tests, file path for production (`ARGUS_DB_PATH`)
- WAL mode, foreign keys ON
- ~10 tests: CRUD, pagination (limit/offset/since), upsert, chronological ordering

**Step 7: Integrate db.ts into `src/hub/hub.ts` + HTTP API**
- `createHub(port, dbPath?)` — optionally creates DbInstance
- Wire into message handlers:
  - `register` → `db.insertAgent()` (upsert)
  - `vlm_update` → `db.insertVlmEvent()` + `db.updateAgentState()`
  - `log_update` → `db.insertLog()`
  - On startup: `db.getAllAgents()` preloads agents map (survived restart)
- HTTP API in `fetch()`:
  - `GET /api/agents` — all agents (including disconnected)
  - `GET /api/agents/:id/history` — paginated VLM event timeline
  - `GET /api/agents/:id/logs` — paginated logs with `?type=` filter
  - Query params: `limit=100`, `offset=0`, `since=<timestamp>`
  - Return JSON with `Content-Type: application/json`

**Step 8: Extend integration tests for persistence**
- Test in `tests/integration/pipeline.test.ts` or new file:
  - Register probe, send logs/VLM updates, verify data in DB
  - Stop hub, recreate with same DB path, verify agents preloaded
  - Test HTTP API endpoints return correct data with pagination

### Track D: AWOC Phase 1 Validation — NOT STARTED
- Manual only — no code needed
- `ARGUS_PTY=1 bun run src/probe/probe.ts -- htop` (or `vim`, `awoc` if available)
- Verify dashboard renders TUI correctly, frame capture works, VLM analysis works

### Final Steps
- Step 10: Update `ROADMAP.md` checkboxes
- Step 12: `git tag v0.3.0`

## Key Technical Notes Discovered During Implementation

- **`@xterm/headless` requires `allowProposedApi: true`** to access `buffer.active` (the grid)
- **`write()` is async** — must use callback (`term.write(data, callback)`) or wrap in Promise for reliable reads
- **Bold is a bitmask** — `cell.isBold()` returns `134217728` (truthy), not `true`. Use `!!cell.isBold()`
- **PTY sends CRLF** — `\r\n` not just `\n`. The terminal emulator handles this correctly
- **`captureFrameFromGrid()`** — inline helper in probe.ts that converts terminal ANSI → SVG → JPEG (mirrors `captureFrame()` but from grid output)
- **Hub preserves agents on disconnect** — `agents.delete()` replaced with `connected = false` in v0.2.2. This was necessary prep for persistence.

## File Map

### Already Created
| File | Status |
|------|--------|
| `src/probe/terminal.ts` | Complete — xterm wrapper + SGR reconstruction |
| `tests/unit/probe/terminal.test.ts` | Complete — 17 tests |
| `tests/integration/pty-pipeline.test.ts` | Complete — 3 tests |

### Still Need to Create
| File | Purpose |
|------|---------|
| `src/hub/db.ts` | SQLite persistence layer |
| `tests/unit/hub/db.test.ts` | DB CRUD + pagination tests |

### Already Modified (this session)
| File | Changes |
|------|---------|
| `src/hub/hub.ts` | v0.2.2: metadata, connected flag, preserve-on-disconnect, connectedAgents() |
| `src/probe/probe.ts` | PTY mode, metadata register, captureFrameFromGrid(), terminal grid in tier2/reconnect |
| `src/probe/probe-utils.ts` | Added pipeToTerminal(), import TerminalWrapper type |
| `src/app/useAgentSocket.ts` | v0.2.2: task from init data |
| `.env.example` | PTY + DB + metadata env vars |
| `CLAUDE.md` | Architecture, protocol, env vars, tech stack |
| `ROADMAP.md` | Created (merged plan.md + progress.md) |
| `docs/session-prompt.md` | This file |

### Still Need to Modify
| File | Changes Needed |
|------|----------------|
| `src/hub/hub.ts` | DB integration + HTTP API endpoints |
| `ROADMAP.md` | Check off completed items |

## Success Criteria (Remaining)

- [ ] Hub persists agent state to SQLite, survives restart
- [ ] HTTP API returns paginated agent history and logs
- [ ] All tests pass (~130+ total after DB tests)
- [ ] `bun run lint` clean
- [ ] `bun run build` succeeds
- [ ] `git tag v0.3.0`
