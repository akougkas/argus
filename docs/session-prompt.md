# Session: v0.2.5 — AWOC Semantic Integration

## Context

**v0.2.4 complete and tagged.** StorageLayer + frame persistence + security hardening + hardening tests.

**187 tests, 0 failures** across 17 test files. Lint clean. Build clean.

**Versioning:** Patch-level increments (0.2.x) until 1.0.

**Git tags:** v0.1.0 → v0.2.0 → v0.2.1 → v0.2.2 → v0.2.3 → v0.2.4

## What Was Done in v0.2.4

### Core Implementation
- `src/hub/storage.ts` — StorageConfig, FrameStore (async writeFrame), StorageLayer, createStorage factory
- `src/hub/db.ts` — frames table + insertFrame, getFrames, deleteFramesBefore
- `src/hub/hub.ts` — `createHub(port, config?: StorageConfig | string)`, frame_update handler, HTTP frame endpoints
- `.env.example` — ARGUS_FRAME_PATH, ARGUS_FRAME_MODE, ARGUS_FRAME_TTL

### Security Hardening (Gemini Pro review)
1. Path traversal fix — `getFrame()` uses `path.resolve()` + canonical boundary check
2. Try/catch on all storage ops — DB and frame writes non-fatal
3. Base64 size limit — 5MB max, rejects oversized `frame_update`
4. Raw relay optimization — hub broadcasts raw WS string (zero re-serialization)
5. Hub-authoritative timestamps — frame filenames use `Date.now()` from hub
6. Async frame writes — `fs/promises.writeFile`, fire-and-forget with `.catch()`
7. Reconnect jitter — probe adds `Math.random() * 1000` to backoff
8. Timer guard — `clearIntervals()` at top of `startProbe()`
9. Cleanup partial failure resilience — try/catch around individual `unlinkSync`

### Tests Added
- `tests/unit/hub/storage.test.ts` — 14 FrameStore unit tests
- `tests/unit/hub/hardening.test.ts` — 12 hardening tests (path traversal, oversized frame, storage error resilience, cleanup)
- `tests/unit/hub/db.test.ts` — 8 frame method tests
- `tests/unit/hub/hub.test.ts` — 1 frame_update hub test
- `tests/integration/frames.test.ts` — 5 frame pipeline integration tests
- `tests/integration/persistence.test.ts` — 1 frame persistence integration test

## What's Next: v0.2.5

Per ROADMAP.md — AWOC Semantic Integration (Phase 2–3):

- [ ] `src/probe/telemetry-listener.ts` — UDP socket for structured JSON from AWOC extension
- [ ] Hub merges telemetry with visual state
- [ ] Tier2 prompt enhanced: visual frames + telemetry JSON
- [ ] Dashboard sidebar: active tool, run ID, context usage
- [ ] State transition timeline visualization

### Also Due
- Dashboard frame pipeline testing in CI (deferred from v0.2.4)
- useAgentSocket line coverage improvement (40% → target 60%+)

## Architecture

```
                    ┌─── Pipe mode (default) ───┐
[any command] ──────┤                           ├──▶ probe.ts ──WS──▶ hub.ts ──WS──▶ page.tsx
                    └─── PTY mode (ARGUS_PTY=1) ┘       │            ▲  │               │
                         script -qefc + xterm/headless   │            │  │         pause/kill/inject
                                                      VLM tiers       │  └─ HTTP API ──▶ /api/*
                                                     (Tier 1+2)       │
                                                         │            │
                                                   [StorageLayer]─────┘
                                                    ├─ SQLite (agents, logs, events, frame refs)
                                                    └─ Filesystem (JPEG frames: tmpfs or disk)
```
