# Next Session: v0.1.0 — Foundations & Test Harness

## Context

Argus is at feature-parity for Phase 1 (text PoC) and Phase 2 (visual pipeline). But the codebase has zero tests, no CI, silent error paths, and structural issues that block testability. Before adding any new features, we need to harden what exists into a proper v0.1.0 release.

This is a solo dev project. No users, no data migrations, no backwards compatibility concerns until v0.5 (beta). Move fast but build correctly.

## Version Map

| Version | Milestone | Focus |
| ------- | --------- | ----- |
| v0.1.0  | **This session** — Testable foundation | Refactor for testability, test harness, CI, type safety |
| v0.2.0  | Hardening | Reconnection, error recovery, resource cleanup, multi-probe |
| v0.3.0  | Persistence & Metadata | SQLite logs, agent metadata, post-mortem replay |
| v0.4.0  | Actuation | Auto-pause thresholds, webhook notifications |
| v0.5.0  | Beta | Dashboard polish, docs, first real agent workflow tested end-to-end |

## What v0.1.0 Must Deliver

### 1. Refactor for Testability

The top-level `connect()` in probe.ts and `Bun.serve()` in hub.ts execute on import, making unit testing impossible. Fix this.

**hub.ts:**
- Extract server creation into `export function createHub(port: number)`.
- Guard the top-level call: `if (import.meta.main) createHub(PORT);`
- Export the `agents` map (read-only) or expose a `getAgentState(id)` helper for test assertions.

**probe.ts:**
- Extract pure functions into a separate `probe-utils.ts`: `extractJSON`, `pushLine`, `getScreen`, `pushRawLine`, `getRawScreen`, `captureFrame`, `compositeGrid`.
- Extract `handleCommand` to take explicit deps (childProc) instead of reading module-level state.
- Guard `connect()` with `if (import.meta.main)`.
- Add `resetState()` for tests to clear screen buffers and frame buffer between runs.

**page.tsx:**
- Extract WebSocket message parsing into a `useAgentSocket(url)` custom hook so the message dispatch logic can be tested without React rendering.

### 2. Unit Tests (bun:test)

Target: **80%+ coverage on core logic**, not UI.

```
tests/
  unit/
    extract-json.test.ts      # extractJSON: valid JSON, fenced, embedded, malformed, empty
    screen-buffer.test.ts     # pushLine, getScreen, pushRawLine, getRawScreen, bounds
    hub.test.ts               # createHub: register, routing, disconnect, init broadcast
    handle-command.test.ts    # pause/resume/kill/inject with mocked childProc
    pipe-stream.test.ts       # pipeStream: line splitting, ANSI stripping, raw buffering
    anomaly-detection.test.ts # Tier1 result parsing (ANOMALY, OK, edge cases)
  integration/
    pipeline.test.ts          # Hub + probe + dashboard WS: register → screen → command → disconnect
```

**Test infrastructure:**
- Create `bunfig.toml` with test config, coverage thresholds (80% lines/functions).
- Add `happydom.ts` preload for any future component tests.
- Add scripts: `"test": "bun test"`, `"test:unit": "bun test tests/unit"`, `"test:integration": "bun test tests/integration"`, `"test:coverage": "bun test --coverage"`.

**Integration test pattern:**
- `createHub(0)` for random port → connect probe WS + dashboard WS → send register → verify init arrives → send command → verify routing → close probe → verify agent_disconnected.

### 3. Type Safety Cleanup

Replace every `any` that matters. Leave `as any` on OpenAI SDK calls (they require it).

- Define `ProbeMessage`, `DashboardMessage`, `VlmResult`, `CommandPayload` types.
- Add a `validateMessage(raw: unknown): ProbeMessage | null` guard for hub.ts message parsing.
- Type `handleCommand(msg: CommandPayload, proc: ChildProcess)` explicitly.
- Type `extractJSON` return as `VlmResult | null`.

### 4. Fix Silent Failures

These are bugs, not features:

| Location | Fix |
| -------- | --- |
| probe.ts frame capture `catch {}` | Log at debug level, count consecutive failures, warn after 5 |
| probe.ts pipeStream `catch {}` | Log the error, distinguish EOF from failure |
| page.tsx `JSON.parse(event.data)` | Wrap in try/catch, log malformed messages |
| probe.ts spawn failure | Set `probeStarted = false` correctly (it already does, but add a log and notify hub) |

### 5. Timer Cleanup

probe.ts has 3 `setInterval` calls that never clear. When the child process exits:
- Clear the screen broadcast interval.
- Clear the frame capture interval.
- Clear the tier1 perception interval.
- Store interval IDs and call `clearInterval` in the exit handler.

### 6. Dashboard Hub URL from Env

page.tsx hardcodes `ws://localhost:8000/ws/dashboard`. Make it configurable:
- Read from `NEXT_PUBLIC_HUB_URL` env var (Next.js convention for client-side env).
- Default to `ws://localhost:8000` if unset.

### 7. GitHub Actions CI

`.github/workflows/ci.yml`:
- Trigger on push to main and PRs.
- Steps: `bun install` → `bun run lint` → `bun run build` → `bun test`.
- Use `oven-sh/setup-bun@v2`.
- Cache `node_modules` and `~/.bun/install/cache`.

### 8. Version Tagging

- Add `"version": "0.1.0"` to package.json (already 0.1.0, confirm).
- After all tests pass: `git tag v0.1.0` and push tag.
- Update docs/progress.md to reflect v0.1.0 scope.

## Execution Order

1. **Refactor hub.ts** — `createHub()` + `import.meta.main` guard. No behavior change.
2. **Refactor probe.ts** — Extract `probe-utils.ts`, parameterize `handleCommand`, guard `connect()`.
3. **Extract `useAgentSocket` hook** from page.tsx.
4. **Write unit tests** — start with pure functions (extractJSON, screen buffer), then hub, then commands.
5. **Write integration test** — full pipeline.
6. **Fix silent failures and timer cleanup.**
7. **Add types** — message schemas, validation.
8. **Dashboard env var** for hub URL.
9. **CI pipeline** — GitHub Actions.
10. **Tag v0.1.0** — commit, tag, push.

## What v0.1.0 Does NOT Include

- No new features (no multi-probe, no persistence, no auto-pause).
- No dashboard visual changes (sacred).
- No dependency swaps (ansi-to-svg stays for now despite being unmaintained).
- No SSIM, no webhooks, no MITM proxy.

## Known Technical Debt (Carry to v0.2.0)

- `ansi-to-svg` is unmaintained (last updated 2021). Evaluate `ansi-to-html` + Puppeteer or custom renderer.
- `screenHistory` (text) is redundant now that `frameBuffer` (JPEG) exists for tier2. Remove in v0.2.
- Reconnection logic: probe reconnects to hub, but dashboard does not auto-reconnect.
- No health check endpoint on hub (needed for monitoring).
- Memory: `lineBuffer` in pipeStream can grow unbounded before first newline.
- React keys use `Math.random()` — should use monotonic counter.

## Success Criteria

- [ ] `bun test` runs and passes with 0 failures.
- [ ] `bun test --coverage` shows 80%+ on `probe-utils.ts` and `hub.ts`.
- [ ] `bun run build` passes with no type errors.
- [ ] `bun run lint` passes (pre-existing `any` warnings OK on OpenAI SDK calls).
- [ ] GitHub Actions CI green on push.
- [ ] `git tag v0.1.0` applied to clean commit.
