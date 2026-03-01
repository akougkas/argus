# Project Argus: Versioned Roadmap

Solo dev. No users until beta. Each version is tested, verified, and tagged before moving on.

## v0.1.0 — Testable Foundation (NEXT)
Refactor for testability. Zero new features.
- Refactor hub.ts and probe.ts: export factories, guard top-level execution with `import.meta.main`
- Extract pure functions into `probe-utils.ts`
- Extract `useAgentSocket` hook from page.tsx
- Unit tests (bun:test): extractJSON, screen buffer, hub routing, command handling, pipe stream
- Integration test: full pipeline (hub → probe → dashboard)
- Type safety: message schemas, validation guards, eliminate unnecessary `any`
- Fix silent failures: log frame errors, distinguish EOF from stream errors, try/catch dashboard JSON
- Timer cleanup: clear all intervals on child process exit
- Dashboard hub URL from `NEXT_PUBLIC_HUB_URL` env var
- GitHub Actions CI: lint → build → test
- Target: 80%+ coverage on core logic

## v0.2.0 — Hardening
Make it survive real-world conditions.
- Dashboard auto-reconnect with exponential backoff
- Hub health check endpoint (`GET /health`)
- Probe: VLM health check at startup, retry on failure
- Probe: bound `lineBuffer` growth (max line length)
- Probe: spawn failure retry with backoff
- Remove redundant `screenHistory` (frameBuffer covers tier2)
- Evaluate `ansi-to-svg` replacement (unmaintained since 2021)
- React key fix: monotonic counter instead of Math.random()
- Memory profiling and leak audit

## v0.3.0 — Multi-Agent & Persistence
Support real workflows with multiple agents and post-mortem analysis.
- Multi-probe: run N probes with unique ARGUS_AGENT_ID, verify hub routing
- Agent metadata: task name, start time, wrapped command (sent in register message)
- SQLite log persistence: structured storage for logs, VLM verdicts, state transitions
- Post-mortem replay: query logs by agent + time range via API
- SSIM-based frame deduplication at probe level (skip unchanged screens)
- Dashboard: agent metadata display, log search/filter

## v0.4.0 — Actuation & Alerts
Close the feedback loop.
- Auto-pause: configurable confidence threshold triggers SIGSTOP automatically
- Webhook notifications: HTTP POST on state transitions (PROGRESSING → STUCK, etc.)
- Slack integration (optional, via webhook URL)
- State transition history: track all state changes with timestamps
- Dashboard: state transition timeline visualization

## v0.5.0 — Beta
First version you'd trust with a real agent.
- End-to-end test: run a real coding agent (Claude Code, Aider, etc.) under Argus
- Dashboard polish: responsive layout, keyboard shortcuts, accessibility
- Documentation: troubleshooting guide, agent wrapping examples, API reference
- Performance audit: measure probe overhead, optimize frame pipeline
- Package as installable tool: `bunx argus -- python3 my_agent.py`
- Release notes, changelog, tagged GitHub release
