# Project Argus: Roadmap

Solo dev. No users until beta. Each version is tested, verified, and tagged before moving on.
AWOC integration phases are folded into version milestones — Argus remains a standalone product.

## Version Map

| Version | Milestone | AWOC Phase | Status |
|---------|-----------|------------|--------|
| v0.1.0 | Testable Foundation | — | Done, tagged |
| v0.2.0 | Multi-Agent Reliability | — | Done, tagged |
| v0.2.1 | Project Restructuring + ANSI Hardening | Phase 1 (parser) | Done, committed |
| **v0.3.0** | **Persistence + PTY Foundation** | **Phase 1 (validation)** | **Next** |
| v0.4.0 | Semantic Integration + Actuation | Phase 2–3 | Planned |
| v0.5.0 | Beta: Monitors AWOC in Production | Phase 4 | Planned |

---

## v0.1.0 — Testable Foundation (Done)

- [x] Refactor hub.ts: `createHub()` factory + `import.meta.main` guard
- [x] Refactor probe.ts: extract `probe-utils.ts`, parameterize deps
- [x] Extract `useAgentSocket` hook from page.tsx
- [x] Unit tests: extractJSON, screen buffer, hub routing, commands, pipeStream
- [x] Integration test: hub → probe → dashboard pipeline
- [x] Type safety: message schemas, validation guards
- [x] Fix silent failures (frame capture, stream close, dashboard JSON)
- [x] Timer cleanup on child process exit
- [x] Dashboard hub URL from `NEXT_PUBLIC_HUB_URL`
- [x] GitHub Actions CI: lint → build → test
- [x] 80%+ test coverage on core logic

## v0.2.0 — Multi-Agent Reliability (Done)

- [x] Graceful shutdown (SIGINT/SIGTERM) on hub and probe
- [x] Probe re-registration with cached VLM state
- [x] Hub idempotent register (preserves state)
- [x] Operator state protection (operatorOverride flag)
- [x] Tier2 vision→text fallback on endpoint failure
- [x] Inline ANSI→SVG renderer (replaced unmaintained ansi-to-svg package)
- [x] Rate limiting (screen interval 250ms, rAF batching, tier1 cooldown)
- [x] Multi-probe integration tests (5 scenarios)
- [x] Dashboard auto-reconnect with exponential backoff
- [x] Hub health check endpoint (`GET /health`)
- [x] 95 tests, 0 failures across 10 test files

## v0.2.1 — Project Restructuring + ANSI Hardening (Done)

- [x] Reorganized backend into `src/` structure (hub/, probe/, demo/)
- [x] Tests mirror `src/` layout: `tests/unit/{hub,probe,app}/`
- [x] Hardened ANSI→SVG parser for TUI compatibility:
  - Reverse video (SGR 7/27), italic (SGR 3/23)
  - Expanded escape stripping: scroll regions, window ops, single-char escapes, charset designation
  - Tests for alternate screen buffer, cursor save/restore, scroll regions
- [x] 101 tests, 0 failures (6 new ANSI parser tests)

---

## v0.3.0 — Persistence + PTY Foundation (Next)

Two independent tracks (PTY, SQLite) converging with agent metadata.

**Key breakthrough:** `script -qefc "cmd" /dev/null` allocates a real PTY via Bun.spawn (zero native addons). Combined with `@xterm/headless` v6.0.0 (zero deps, works under Bun), this gives proper 2D terminal grid capture for TUI apps — solving the pipe-vs-PTY limitation without node-pty.

### Track A: PTY Integration (`script` + `@xterm/headless`)

New dep: `@xterm/headless` v6.0.0 (zero deps, production)

- [ ] `src/probe/terminal.ts` — wraps `@xterm/headless` Terminal
  - `createTerminal(cols, rows)` → `TerminalWrapper`
  - `write(data)` — feed raw PTY bytes
  - `getGrid()` → `{ text, ansi }` — plain text + reconstructed SGR codes
  - SGR reconstruction: walk cells, track style changes, emit codes on transitions
  - Pure module, no WebSocket/process concerns
- [ ] `pipeToTerminal()` in `src/probe/probe-utils.ts` — reads chunks, feeds terminal, extracts log lines
- [ ] PTY mode in `src/probe/probe.ts` (behind `ARGUS_PTY=1`)
  - Wraps command in `script -qefc "stty rows R cols C; exec CMD" /dev/null`
  - Sets `TERM=xterm-256color` in spawn env
  - Screen broadcast from `terminal.getGrid().text`
  - Frame capture from `terminal.getGrid().ansi` → `ansiToSvg()`
  - Pipe mode (default `ARGUS_PTY=0`) unchanged
- [ ] `tests/unit/probe/terminal.test.ts` (~10 tests): grid text, cursor, SGR, alternate screen, resize
- [ ] `tests/integration/pty-pipeline.test.ts` (~3 tests): spawn via script, verify grid

### Track B: SQLite Persistence

Uses `bun:sqlite` (built-in, no dependency).

- [ ] `src/hub/db.ts`
  - `createDb(path?)` → `DbInstance`
  - Schema: `agents`, `logs`, `vlm_events` (indexed on `(agent_id, timestamp)`)
  - `:memory:` for tests, file path for production (`ARGUS_DB_PATH`)
  - No frames table (deferred to v0.4.0)
- [ ] Hub integration: `createHub(port, dbPath?)`
  - On register: upsert agent
  - On vlm_update: insert event + update state
  - On log_update: insert log
  - On startup: preload agents from DB (survives restarts)
- [ ] HTTP API in hub `fetch()`:
  - `GET /api/agents` — all agents (including disconnected)
  - `GET /api/agents/:id/history` — paginated timeline
  - `GET /api/agents/:id/logs` — paginated logs with `?type=` filter
  - Query params: `limit=100`, `offset=0`, `since=<timestamp>`
- [ ] `tests/unit/hub/db.test.ts` (~10 tests): CRUD, pagination, upsert, ordering
- [ ] Extended integration tests for persistence through restart + HTTP API

### Track C: Agent Metadata

- [ ] `register` message gains optional `metadata: { task, command, start_time }`
- [ ] Probe reads `ARGUS_AGENT_TASK`, auto-populates command from SPAWN_CMD
- [ ] Hub: `AgentState` gains `task`, `command`, `startTime` fields
- [ ] Dashboard: `applyMessage()` populates metadata from `init`

### Track D: AWOC Phase 1 Validation

Manual validation after PTY works:
- [ ] `ARGUS_PTY=1 bun run src/probe/probe.ts -- awoc` (or `htop`/`vim`)
- [ ] Verify dashboard renders TUI correctly
- [ ] Verify frame capture produces readable JPEGs
- [ ] Verify VLM analysis works against TUI content

### Implementation Order

1. `bun add @xterm/headless`
2. Create `src/probe/terminal.ts` + tests
3. Add `pipeToTerminal()` to probe-utils.ts
4. Wire PTY mode into probe.ts (behind `ARGUS_PTY=1`)
5. Create PTY integration tests
6. Create `src/hub/db.ts` + tests
7. Integrate db.ts into hub.ts + HTTP API
8. Extend integration tests for persistence
9. Add agent metadata to probe register + hub + useAgentSocket
10. Update `.env.example`, `CLAUDE.md`, `ROADMAP.md`
11. Manual AWOC/TUI validation
12. `git tag v0.3.0`

### New Env Vars

- `ARGUS_PTY=0` — PTY mode (0=pipe, 1=pty)
- `ARGUS_PTY_COLS=80` — Terminal columns
- `ARGUS_PTY_ROWS=24` — Terminal rows
- `ARGUS_DB_PATH=` — SQLite path (empty = no persistence)
- `ARGUS_AGENT_TASK=` — Agent task description

### Expected: ~125 tests, 0 failures

---

## v0.4.0 — Semantic Integration + Actuation (Planned)

**AWOC Phase 2–3: Semantic side-channel + synthesized verification**

- [ ] `src/probe/telemetry-listener.ts` — UDP socket for structured JSON from AWOC extension
- [ ] Hub merges telemetry with visual state
- [ ] Tier2 prompt enhanced: visual frames + telemetry JSON
- [ ] Dashboard sidebar: active tool, run ID, context usage

**Actuation:**

- [ ] Auto-pause: configurable confidence threshold + state match + N-confirmation gate
- [ ] `src/hub/webhooks.ts` — HTTP POST on state transitions (Slack-compatible)
- [ ] State transition history table + dashboard timeline visualization

**Optional:** Frames persistence for visual replay

### Expected: ~150 tests

---

## v0.5.0 — Beta: Monitors AWOC in Production (Planned)

**AWOC Phase 4: Granular steering**

- [ ] Granular steering: dashboard buttons → stdin injection of `/stoprun`, `/steer`
- [ ] Run IDs from telemetry or OCR'd from visual feed

**Polish:**

- [ ] `src/app/useKeyboardShortcuts.ts` — keyboard shortcuts
- [ ] Post-mortem replay view with timeline scrubber
- [ ] Log search/filter (client-side)

**Ship:**

- [ ] `src/cli.ts` entry point → `bunx argus -- <cmd>`
- [ ] Auth basics: bearer token on hub WS + HTTP
- [ ] Documentation: getting-started, configuration, API reference, AWOC guide
- [ ] README rewrite with badges, screenshots
- [ ] End-to-end: 5 simultaneous AWOC probes under Argus

### Expected: ~175+ tests

---

## Technical Debt (Tracked)

| Item | Introduced | Target |
|------|-----------|--------|
| No authentication on hub endpoints | v0.1.0 | v0.5.0 |
| No frame persistence / visual replay | v0.2.0 | v0.4.0 |
| Dashboard frame pipeline untested in CI | v0.1.0 | v0.4.0 |
| useAgentSocket low line coverage (40%) | v0.2.0 | v0.4.0 |
