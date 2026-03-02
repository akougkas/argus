# Session: Pre-v0.2.8 Visual Polish + Tagging

## Context

**Pinned agent + grid scaling complete and validated.** On top of the dual-feed card redesign:
- Pin/PinOff toggle in card header (`pinnedAgentId` client-only state in hook)
- Pinned card: full-width (`grid-column: 1 / -1`), `max-height: 800px`, green glow border
- One pin at a time, pinned agents render first in grid
- Dense mode (>6 agents): `minmax(380px)` grid, `align-content: start`
- Compact cards for non-pinned, non-selected: header + task + last VLM verdict snippet
- Selected agent always gets full card even in dense mode

**Validated in browser with 8 probes:**
- Pinned A-01 full-width flagship, 7 compact cards in 3-column rows
- Selecting different agents expands them, compact verdict snippets work
- Pin switching between agents works
- 339 tests, 0 failures. Lint clean. Build clean.

**No version bump yet.** Ready for final polish + v0.2.8 tagging.

## What to Do

### Phase 1: Continue Visual Debug Cycle

Run the pipeline, open Chrome, iterate on anything that looks off:

```bash
bun run dev:hub
bun run dev:dashboard
# Launch probes individually:
ARGUS_AGENT_ID=A-01 ARGUS_AGENT_TASK="Deploy frontend" bun run dev:probe
ARGUS_AGENT_ID=A-02 ARGUS_AGENT_TASK="Run migrations" bun run dev:probe
# etc.
```

Remaining visual items to check:
- [ ] Multi-agent selection: click agent in sidebar, card highlights, controls target correct agent
- [ ] Grid layout at 4, 8, 12 agents — check for overflow/cramping
- [ ] Pinned agent card: renders full-width, analysis pane has more room
- [ ] Inject prompt: type text, send, verify reaches probe stdin
- [ ] Reconnection: kill hub, dashboard shows RECONNECTING, restart hub, auto-reconnects
- [ ] Empty state placeholder when no agents connected
- [ ] GIF recording of key interactions for docs

### Phase 2: Pre-v0.2.8 Checklist

Before bumping to v0.2.8 (beta):
- [ ] All visual bugs fixed
- [ ] Pinned agent feature working (DONE)
- [ ] Multi-agent grid tested at scale (DONE — 8 probes validated)
- [ ] Tests updated for any new features (target: 350+)
- [ ] CLAUDE.md updated with pinned agent + grid scaling docs
- [ ] Consider: authentication on hub endpoints
- [ ] Consider: macOS `script` syntax compatibility
- [ ] Tag v0.2.8 + push

## Architecture Notes

### Pinned Agent (new)
- `pinnedAgentId` + `setPinnedAgentId` — client-only state in `useAgentSocket` hook return
- Not on `Agent` interface (it's UI state, not WS protocol)
- `pinnedAgents` / `unpinnedAgents` arrays computed in page.tsx, pinned render first
- `isDense` = `agents.length > 6`, triggers `.agentGridDense` class
- `isCompact` = `isDense && !isPinned && agent.id !== selectedAgentId`
- Compact cards: JSX conditionally skips `stateBanner` and `dualFeed` rendering
- `.compactVerdict` shows last VLM event's reasoning (truncated to 80 chars)

### Current Card Structure (JSX)
```
agentCard [+ agentCardPinned] [+ agentCardCompact]
  ├── agentHeader (name + pin button + badges + confidence)
  ├── task row
  ├── compactVerdict (compact only — last VLM reasoning)
  ├── stateBanner (conditional, not in compact)
  └── dualFeed (not in compact)
       ├── agentFeed (left)
       │    ├── visualPreview (120px max, raw terminal/frame)
       │    ├── previewDivider ("LOG FEED")
       │    └── agentLogs (scrollable)
       └── analysisFeed (right)
            ├── analysisFeedHeader ("VLM ANALYSIS")
            ├── vlmEvent[] (tier1=compact, tier2=full)
            └── analysisPlaceholder (when empty)
```

### CSS Classes Added This Session
- `.agentCardPinned` — full-width pinned card (grid-column: 1 / -1, max-height: 800px)
- `.agentCard.agentCardCompact` — overrides min-height/max-height for compact mode
- `.agentGridDense` — denser grid columns (380px min) + align-content: start
- `.pinButton`, `.pinButton.pinActive` — pin toggle with glow effect
- `.pinnedBadge` — sidebar pin indicator
- `.compactVerdict`, `.compactVerdictTime`, `.compactVerdictText` — verdict snippet in compact cards

### VLM Backend
- Endpoint: `http://100.74.131.112:8080/v1` (mini's llama-server via Tailscale)
- Model: `Qwen3.5-35B-A3B-UD-Q4_K_XL` (MoE, 3B active, 120 tok/s)
- Text-only — tier2 vision falls back to text automatically
- API key: `llamacpp`

## Key Files

- `src/app/useAgentSocket.ts` — pinnedAgentId state, VlmEvent interface, vlmEvents accumulation
- `src/app/page.tsx` — Pin toggle, pinnedAgents/unpinnedAgents split, compact card rendering
- `src/app/page.module.css` — Pinned, compact, dense grid styles
- `tests/unit/app/apply-message.test.ts` — 339 tests covering apply-message pure functions
- `src/hub/hub.ts` — WebSocket relay + HTTP API
- `src/probe/probe.ts` — VLM pipeline
- `src/demo/demo_agent.ts` — Demo agent for testing

## Commands

```bash
bun run dev:hub           # Start hub (port 8000, must be first)
bun run dev:dashboard     # Start Next.js dashboard (port 3000)
bun run dev:probe         # Start demo probe (A-01 by default)

# Multiple probes
ARGUS_AGENT_ID=A-02 ARGUS_AGENT_TASK="Run migrations" bun run dev:probe
ARGUS_AGENT_ID=A-03 ARGUS_AGENT_TASK="Security audit" bun run dev:probe

bun test                  # 339 tests
bun run lint              # ESLint
bun run build             # Production build
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
| v0.2.7+ | Dual-Feed Card Redesign | 339 |
| v0.2.7+ | Pinned Agent + Grid Scaling | 339 |

## Conventions

- **No version bumps** until visual polish done. Then tag v0.2.8.
- **Browser automation** — use `mcp__claude-in-chrome__*` tools for visual validation
- **Runtime:** Bun everywhere. No npm.
- **Dashboard:** CRT terminal aesthetic is sacred. Design tokens are great — don't change them.
- **Kill background processes** when switching contexts. Don't leave 13 bun processes running.
- **Multi-agent testing:** launch probes individually as separate background tasks with unique `ARGUS_AGENT_ID`.
