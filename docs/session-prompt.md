# Session: v0.3.0 — Persistence + PTY Foundation

## Context

v0.2.1 committed (not tagged — incremental restructure). 101 tests, 0 failures. Lint/build clean.

**What was accomplished:**
- v0.1.0: Testable foundation — factories, unit/integration tests, CI
- v0.2.0: Multi-agent reliability — graceful shutdown, reconnection, inline ANSI→SVG, rate limiting
- v0.2.1: Project restructured into `src/` layout, ANSI parser hardened for TUI (reverse video, italic, expanded escape stripping)

**Key breakthrough discovered during planning:** `script -qefc "cmd" /dev/null` allocates a real PTY via Bun.spawn (zero native addons). Combined with `@xterm/headless` v6.0.0 (zero deps), this gives proper 2D terminal grid capture for TUI apps — solving the pipe-vs-PTY limitation without node-pty.

## Version Map

| Version | Milestone | Status |
|---------|-----------|--------|
| v0.1.0 | Testable Foundation | Done, tagged |
| v0.2.0 | Multi-Agent Reliability | Done, tagged |
| v0.2.1 | Restructure + ANSI Hardening | Done, committed |
| **v0.3.0** | **Persistence + PTY Foundation** | **This session** |
| v0.4.0 | Semantic Integration + Actuation | Planned |
| v0.5.0 | Beta: Monitors AWOC in Production | Planned |

## v0.3.0 Deliverables

### Track A: PTY Integration
- [ ] `bun add @xterm/headless`
- [ ] `src/probe/terminal.ts` — wraps `@xterm/headless` Terminal
  - `createTerminal(cols=80, rows=24)` → `TerminalWrapper`
  - `write(data)` — feed raw PTY bytes
  - `getGrid()` → `{ text: string, ansi: string }` — plain text + reconstructed SGR
  - SGR reconstruction: walk cells, track style changes, emit escape codes on transitions
  - Pure module, no WebSocket/process concerns
- [ ] `pipeToTerminal(stream, terminal, sendLog)` in `probe-utils.ts`
- [ ] PTY mode in `probe.ts` behind `ARGUS_PTY=1` flag
  - Wraps command: `script -qefc "stty rows R cols C 2>/dev/null; exec CMD" /dev/null`
  - Sets `TERM=xterm-256color` in spawn env
  - Screen broadcast: `terminal.getGrid().text` instead of `getScreen()`
  - Frame capture: `terminal.getGrid().ansi` fed to `ansiToSvg()`
  - Pipe mode (default) completely unchanged
- [ ] `tests/unit/probe/terminal.test.ts` (~10 tests)
- [ ] `tests/integration/pty-pipeline.test.ts` (~3 tests)

### Track B: SQLite Persistence
- [ ] `src/hub/db.ts` using `bun:sqlite`
  - `createDb(path?)` → `DbInstance`
  - Schema: `agents` (id, state, confidence, reasoning, task, command, start_time, last_seen), `logs` (id, agent_id, text, type, timestamp), `vlm_events` (id, agent_id, state, confidence, reasoning, timestamp)
  - Indexed on `(agent_id, timestamp)`
  - `:memory:` for tests, file path for production
  - No frames table in v0.3.0
- [ ] Hub integration: `createHub(port, dbPath?)`
  - On register: `db.insertAgent()` (upsert)
  - On vlm_update: `db.insertVlmEvent()` + `db.updateAgentState()`
  - On log_update: `db.insertLog()`
  - On startup: `db.getAllAgents()` preloads agents map
- [ ] HTTP API endpoints in hub `fetch()`:
  - `GET /api/agents` — all agents (including disconnected)
  - `GET /api/agents/:id/history` — paginated timeline
  - `GET /api/agents/:id/logs` — paginated logs with `?type=` filter
  - Query params: `limit=100`, `offset=0`, `since=<timestamp>`
- [ ] `tests/unit/hub/db.test.ts` (~10 tests)
- [ ] Extended integration tests for persistence + HTTP API

### Track C: Agent Metadata
- [ ] `register` message gains optional `metadata: { task, command, start_time }`
- [ ] Probe reads `ARGUS_AGENT_TASK`, auto-populates command from SPAWN_CMD
- [ ] Hub `AgentState` gains `task`, `command`, `startTime` fields
- [ ] Dashboard `applyMessage()` populates from init data

### Track D: AWOC Phase 1 Validation
- [ ] Wrap `awoc` (or `htop`/`vim`) with PTY mode, verify dashboard rendering
- [ ] Verify frame capture produces readable JPEGs of TUI
- [ ] Verify VLM analysis works against TUI content

## Implementation Order

1. `bun add @xterm/headless`
2. Create `src/probe/terminal.ts` + `tests/unit/probe/terminal.test.ts`
3. Add `pipeToTerminal()` to `src/probe/probe-utils.ts`
4. Wire PTY mode into `src/probe/probe.ts` (behind `ARGUS_PTY=1`)
5. Create `tests/integration/pty-pipeline.test.ts`
6. Create `src/hub/db.ts` + `tests/unit/hub/db.test.ts`
7. Integrate db.ts into `src/hub/hub.ts` + add HTTP API endpoints
8. Extend `tests/integration/pipeline.test.ts` for persistence
9. Add agent metadata to probe register + hub AgentState + useAgentSocket
10. Update `.env.example`, `CLAUDE.md`, `ROADMAP.md`
11. Manual AWOC/TUI validation
12. `git tag v0.3.0`

## Key Decisions Already Made

| Decision | Rationale |
|----------|-----------|
| PTY opt-in (`ARGUS_PTY=0` default) | Pipe mode works for most agents. PTY adds complexity only needed for TUI apps |
| `script` command, not node-pty | Zero native addons. node-pty has SIGHUP bug under Bun |
| `@xterm/headless` v6.0.0 | Zero deps, proper VT emulation. Previous `xterm/headless` had async write issues — v6.0.0 needs validation |
| `terminal.ts` is pure | No WebSocket, no process spawning. Just feed bytes, get grid. Testable in isolation |
| `bun:sqlite`, not external package | Built into Bun runtime. WAL mode for concurrent reads |
| DB is optional (`ARGUS_DB_PATH`) | Hub works without persistence. Tests use `:memory:` |
| No frames table in v0.3.0 | Frames are large. Visual replay deferred to v0.4.0 |
| `createHub(port, dbPath?)` | Backward-compatible factory signature |

## File Map

### New Files
| File | Purpose |
|------|---------|
| `src/probe/terminal.ts` | @xterm/headless wrapper with SGR reconstruction |
| `src/hub/db.ts` | SQLite persistence layer |
| `tests/unit/probe/terminal.test.ts` | Terminal grid tests |
| `tests/unit/hub/db.test.ts` | DB CRUD tests |
| `tests/integration/pty-pipeline.test.ts` | End-to-end PTY test |

### Modified Files
| File | Changes |
|------|---------|
| `src/probe/probe.ts` | PTY mode (lines ~138–180), metadata in register |
| `src/probe/probe-utils.ts` | Add `pipeToTerminal()` |
| `src/hub/hub.ts` | DB integration, HTTP API, metadata in AgentState |
| `src/app/useAgentSocket.ts` | Metadata fields in applyMessage |
| `.env.example` | New env vars |
| `package.json` | @xterm/headless dependency |

### Do NOT Touch
| File | Reason |
|------|--------|
| `src/app/page.tsx` | Dashboard aesthetic is sacred — metadata display is a v0.3.0 stretch goal |
| `src/app/globals.css` | CRT theme locked |
| `src/probe/ansi-to-svg.ts` | No changes needed — fed reconstructed ANSI from terminal grid |
| `src/demo/demo_agent.ts` | Works fine as-is |

## Technical Notes

### `script` command syntax (Linux)
```bash
script -qefc "stty rows 24 cols 80 2>/dev/null; exec <cmd>" /dev/null
```
- `-q` quiet (no "Script started" banner)
- `-e` pass through exit code
- `-f` flush after each write
- `-c` command to run
- `/dev/null` typescript file (discard)
- `stty` sets terminal dimensions inside the PTY
- `exec` replaces shell with command (clean process tree)

**macOS variant:** `script -q /dev/null <cmd>` (no `-e`, `-f`, `-c` flags — different argument order). Cross-platform support is a v0.5.0 concern.

### @xterm/headless buffer API
```typescript
import { Terminal } from '@xterm/headless';
const term = new Terminal({ cols: 80, rows: 24 });
term.write(data);  // synchronous in headless mode
const buffer = term.buffer.active;
for (let y = 0; y < term.rows; y++) {
  const line = buffer.getLine(y);
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    // cell.getChars(), cell.getFgColor(), cell.getBgColor(), cell.isBold(), etc.
  }
}
```

### bun:sqlite usage
```typescript
import { Database } from 'bun:sqlite';
const db = new Database(path ?? ':memory:');
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
// Use db.prepare() for parameterized queries
// Use db.transaction() for atomic multi-statement ops
```

## Risks

| Risk | Mitigation |
|------|------------|
| SGR reconstruction complexity | Start with 16 basic colors + bold/dim/underline. 256-color and RGB are stretch |
| `script` portability (Linux vs macOS) | Linux only for v0.3.0. macOS in v0.5.0 |
| `@xterm/headless` v6 async issues | Previous version had write issues under Bun. Test synchronous write early (step 2) |
| SQLite write contention under high message rate | WAL mode + batch inserts if needed |
| Hub factory signature change | `dbPath` is optional, backward-compatible |

## Success Criteria

- [ ] PTY mode captures TUI output (htop, vim) with correct grid layout
- [ ] `terminal.getGrid().ansi` produces valid ANSI for ansi-to-svg
- [ ] Hub persists agent state to SQLite, survives restart
- [ ] HTTP API returns paginated agent history and logs
- [ ] Agent metadata (task, command, start_time) flows probe → hub → dashboard
- [ ] All existing tests pass + new tests (~125 total)
- [ ] `bun run lint` clean
- [ ] `bun run build` succeeds
- [ ] `git tag v0.3.0`

## Tech Debt Carried Forward

- No authentication on hub endpoints (target: v0.5.0)
- No frame persistence / visual replay (target: v0.4.0)
- Dashboard frame pipeline untested in CI (target: v0.4.0)
- macOS `script` syntax not supported (target: v0.5.0)
- useAgentSocket low line coverage (target: v0.4.0)
