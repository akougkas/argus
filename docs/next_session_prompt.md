# Next Session: v0.2.0 — Multi-Agent & Reliability

## Context

v0.1.0 is tagged and hardened. All bugs from visual testing are fixed:
- Tier1 VLM dedup (no re-analysis on unchanged screens)
- PAUSED/EXITED agent states with dashboard overlays and badges
- Child exit sends EXITED state to dashboard (no stale cards)
- screenHistory removed, tier2 text fallback uses getScreen() directly
- Dashboard auto-reconnects with exponential backoff
- Hub health check endpoint (GET /health)
- Bounded lineBuffer (64KB safety valve in pipeStream)
- 74 tests, 0 failures. Lint clean. Build clean.

## Version Map

| Version | Milestone | Focus |
| ------- | --------- | ----- |
| v0.1.0  | Done | Testable foundation, bug fixes, CI |
| v0.2.0  | **This session** | Multi-agent reliability, reconnection edge cases |
| v0.3.0  | Persistence & Metadata | SQLite logs, agent metadata, post-mortem replay |
| v0.4.0  | Actuation | Auto-pause thresholds, webhook notifications |
| v0.5.0  | Beta | Dashboard polish, docs, first real agent workflow |

## What v0.2.0 Should Deliver

### 1. Multi-Probe Orchestration
- Test with 2+ probes running simultaneously against one hub
- Verify command routing isolation (pause A-01 doesn't affect A-02)
- Dashboard grid should show multiple agent cards

### 2. Probe Re-registration After Hub Restart
- Probe reconnects to hub (already works), but doesn't re-register
- After hub restart, probe should re-send `register` message on reconnect
- Hub should rebuild agent state from re-registration

### 3. Replace ansi-to-svg
- Unmaintained since 2021, potential security/compat risk
- Evaluate: `ansi-to-html` + custom renderer, or `terminal-to-html`
- Must produce equivalent visual output for frame capture pipeline

### 4. Graceful Shutdown
- Hub: close all WS connections, stop server cleanly
- Probe: clear intervals, kill child process, close WS on SIGINT/SIGTERM
- No zombie processes after Ctrl+C

### 5. Rate Limiting / Backpressure
- Dashboard receiving too many messages? Screen updates every 100ms is aggressive
- Consider batching screen updates or reducing frequency
- Tier1 should have configurable cooldown after escalation

## Known Technical Debt (Carry to v0.3.0)
- No persistence — all state is in-memory
- No agent metadata (task description, start time)
- Dashboard frame capture pipeline untested in CI
- React keys: monotonic counter done for logs, verify no Math.random() remains

## Success Criteria
- [ ] 2+ probes running simultaneously, commands route correctly
- [ ] Hub restart → probes re-register → dashboard rebuilds
- [ ] ansi-to-svg replaced with maintained alternative
- [ ] Clean shutdown on SIGINT for hub and probe
- [ ] All existing tests pass + new tests for multi-probe scenarios
- [ ] `git tag v0.2.0`
