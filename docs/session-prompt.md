# Session: v0.2.7 Validation — End-to-End Hardening

## Context

**v0.2.7 tagged.** Seven versions of features built without live validation against an actual running dashboard. Time to stop building and start testing. This session is about running the full pipeline, opening the dashboard in a browser, and verifying everything works visually and functionally.

**No version bumps.** This is hardening, debugging, and validation only.

**329 tests, 0 failures** across 21 test files. Lint clean. Build clean. But unit tests don't catch visual bugs, WebSocket timing issues, or UI regressions.

## What to Do

### Phase 1: Bring Up the Pipeline

1. **Start the hub** — `bun run dev:hub` (port 8000)
2. **Start the dashboard** — `bun run dev:dashboard` (Next.js dev server)
3. **Open the dashboard in Chrome** — use browser automation tools
4. **Start the demo probe** — `bun run dev:probe` (wraps demo_agent.ts)
5. **Verify**: Agent appears in sidebar, card renders, terminal feed shows output

### Phase 2: Visual Validation

Use browser automation (`mcp__claude-in-chrome__*`) to verify:

- [ ] Agent card renders with correct state badge, confidence, task
- [ ] Terminal feed scrolls with log entries
- [ ] Frame/PTY screen updates display correctly
- [ ] VLM state transitions (PROGRESSING → STUCK → DANGEROUS) reflected in UI
- [ ] State-specific styling: danger red flash, warning yellow, paused blue, exited gray
- [ ] Overlay alerts appear for DANGEROUS/STUCK/PAUSED/EXITED states
- [ ] Connection indicator shows LIVE (green dot) when connected
- [ ] Connection indicator shows RECONNECTING (red dot) when hub is down

### Phase 3: Sidebar Controls

- [ ] Select agent in sidebar → highlights correctly
- [ ] Pause button → agent enters PAUSED state, card shows blue overlay
- [ ] Resume button → agent resumes PROGRESSING
- [ ] Kill button → agent enters EXITED state
- [ ] Inject prompt → text reaches the probe's stdin
- [ ] Multi-agent: start 2+ probes, verify independent selection and control

### Phase 4: Telemetry + Steering (v0.2.7 features)

Since AWOC isn't connected, simulate telemetry by sending raw WS messages:
- [ ] Telemetry panel appears in sidebar when telemetry_update arrives
- [ ] Run ID, tool name, context % bar all render correctly
- [ ] Context % bar color transitions (green → yellow → red) at thresholds
- [ ] CTX badge appears in agent card header
- [ ] Halt Run button appears when telemetry active
- [ ] Steer Agent textarea + button appear when telemetry active
- [ ] Halt Run sends stoprun command with correct run ID
- [ ] Steer sends steer command with textarea content

### Phase 5: Edge Cases & Hardening

- [ ] Disconnect hub → dashboard shows RECONNECTING → restart hub → auto-reconnects
- [ ] Kill probe → agent_disconnected removes from UI
- [ ] Rapid state changes → no UI glitches or stale data
- [ ] Multiple agents → grid layout works, cards don't overlap
- [ ] Empty state (no agents) → placeholder message shows
- [ ] Fix any bugs found during testing

### Phase 6: Record & Document

- [ ] GIF recording of key interactions for README/docs
- [ ] Document any bugs found and fixed
- [ ] Update test count if new tests added for bugs

## How to Simulate Telemetry

Without AWOC, inject telemetry via a script or `websocat`:

```bash
# Connect as a probe and send telemetry
# Or modify demo_agent.ts to emit fake telemetry events
```

Alternatively, use the browser console to send WS messages directly to the hub.

## Key Files

- `src/hub/hub.ts` — WebSocket relay (port 8000)
- `src/probe/probe.ts` — Process wrapper + VLM pipeline
- `src/demo/demo_agent.ts` — Demo agent that loops into failure
- `src/app/page.tsx` — Dashboard UI
- `src/app/useAgentSocket.ts` — WebSocket hook + telemetry handler
- `src/app/globals.css` + `src/app/page.module.css` — Styles

## Commands

```bash
bun run dev:hub           # Start hub (must be first)
bun run dev:dashboard     # Start Next.js dashboard
bun run dev:probe         # Start demo probe

# Multiple probes with different IDs
ARGUS_AGENT_ID=A-02 bun run dev:probe
ARGUS_AGENT_ID=A-03 ARGUS_PTY=1 bun run dev:probe -- htop
```

## Version History

| Version | What | Tests |
|---------|------|-------|
| v0.1.0 | Testable Foundation | 80+ |
| v0.2.0 | Multi-Agent Reliability | 95 |
| v0.2.1 | Project Restructuring + ANSI Hardening | 101 |
| v0.2.2 | Pre-Persistence Hub Hardening | 126 |
| v0.2.3 | Persistence + PTY | 146 |
| v0.2.4 | Storage Layer + Frame Persistence | 187 |
| v0.2.5 | Telemetry Receiver + AWOC Integration | 286 |
| v0.2.6 | Actuation & Targeted Steering | 310 |
| v0.2.7 | Steering UX + Dashboard Controls | 329 |

## Conventions

- **No version bumps this session.** Fix bugs in-place, commit as patches.
- **Browser automation** — use `mcp__claude-in-chrome__*` tools for visual validation
- **GIF recording** — capture key interactions with `mcp__claude-in-chrome__gif_creator`
- **Runtime:** Bun everywhere. No npm.
- **Dashboard:** CRT terminal aesthetic is sacred.
