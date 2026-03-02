# Session: Dashboard UX Polish + Pinned Agent Feature

## Context

**Dual-feed card redesign complete and validated.** Each agent card now has:
- Left pane: visual preview (raw terminal/frame) + scrollable log feed, separated by "LOG FEED" divider
- Right pane: VLM analysis timeline with tier1 (compact `~` entries) / tier2 (full reasoning `>` entries)
- State banner (flow element, not overlay) — color-coded per state
- VlmEvent data model: `vlmEvents: VlmEvent[]` on Agent, capped at 50, tier classified by confidence threshold (≤50 = tier1, >50 = tier2)

**Validated in browser with live VLM pipeline:**
- All controls tested: Pause (SIGSTOP → blue banner), Resume (SIGCONT), Kill (SIGKILL → gray EXITED)
- VLM timeline accumulates events correctly across state transitions
- Multi-agent tested with 8 probes — grid works up to ~8, gets cramped beyond that
- 339 tests, 0 failures. Lint clean. Build clean.

**No version bump yet.** Still in hardening/polish phase before v0.2.8.

## What to Do

### Phase 1: Pinned/Flagship Agent Feature

**User request:** ability to pin an agent as "flagship" — gets a larger card for deeper observability. Supports hierarchical team scenarios (orchestrator + developers) where certain agents are more critical.

Design approach:
- Add `pinned: boolean` to Agent state (toggle via sidebar or card header)
- Pinned agent card spans full width of grid (grid-column: 1 / -1) with taller max-height
- Non-pinned agents flow in the normal grid below
- Only 1 pinned agent at a time (or 2-3 max)
- Pin icon in card header or sidebar agent list

Key files:
- `src/app/useAgentSocket.ts` — add `pinned` to Agent interface (client-only state, not from WS)
- `src/app/page.tsx` — pin toggle UI, card layout logic for pinned vs normal
- `src/app/page.module.css` — `.agentCardPinned` styles (full width, taller)

### Phase 2: Multi-Agent Grid Scaling

The current grid (`minmax(480px, 1fr)`) works for 1-8 agents. For 8+ agents:
- Consider reducing card min-width for high agent counts (e.g., 380px when >6 agents)
- Or: compact card variant for non-selected agents (collapse analysis pane, show only header + state badge + last VLM verdict)
- Think about pagination or virtual scrolling for 30+ agents

### Phase 3: Continue Visual Debug Cycle

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

### Phase 4: Pre-v0.2.8 Checklist

Before bumping to v0.2.8 (beta):
- [ ] All visual bugs fixed
- [ ] Pinned agent feature working
- [ ] Multi-agent grid tested at scale
- [ ] Tests updated for any new features (target: 350+)
- [ ] CLAUDE.md updated with new card layout docs
- [ ] Consider: authentication on hub endpoints
- [ ] Consider: macOS `script` syntax compatibility

## Architecture Notes

### Current Card Structure (JSX)
```
agentCard
  ├── agentHeader (name + badges + confidence)
  ├── task row
  ├── stateBanner (conditional, flow element)
  └── dualFeed
       ├── agentFeed (left)
       │    ├── visualPreview (120px max, raw terminal/frame)
       │    ├── previewDivider ("LOG FEED")
       │    └── agentLogs (scrollable)
       └── analysisFeed (right)
            ├── analysisFeedHeader ("VLM ANALYSIS")
            ├── vlmEvent[] (tier1=compact, tier2=full)
            └── analysisPlaceholder (when empty)
```

### VlmEvent Type
```typescript
interface VlmEvent {
  id: string;
  timestamp: string;
  state: AgentStateLabel;
  confidence: number;
  reasoning: string;
  tier: "tier1" | "tier2";  // confidence ≤ 50 = tier1, > 50 = tier2
}
```

### CSS Classes Added This Session
- `.stateBanner[data-state=*]` — colored state banners
- `.dualFeed`, `.agentFeed`, `.analysisFeed` — dual pane layout
- `.visualPreview`, `.previewDivider` — visual preview with labeled separator
- `.analysisFeedHeader` — "VLM ANALYSIS" label
- `.vlmEvent`, `.vlmCompact`, `.vlmOk/Warning/Danger` — timeline entries
- `.analysisPlaceholder` — empty state

### VLM Backend
- Endpoint: `http://100.74.131.112:8080/v1` (mini's llama-server via Tailscale)
- Model: `Qwen3.5-35B-A3B-UD-Q4_K_XL` (MoE, 3B active, 120 tok/s)
- Text-only — tier2 vision falls back to text automatically
- API key: `llamacpp`

## Key Files

- `src/app/useAgentSocket.ts` — VlmEvent interface, vlmEvents accumulation, tier classification
- `src/app/page.tsx` — Dual-feed card layout, state banners, VLM timeline
- `src/app/page.module.css` — All new dual-pane styles
- `tests/unit/app/apply-message.test.ts` — 10 new vlmEvents tests
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
| v0.2.7+ | Dual-Feed Card Redesign (no version bump) | 339 |

## Conventions

- **No version bumps** until pinned agent + grid scaling done. Then tag v0.2.8.
- **Browser automation** — use `mcp__claude-in-chrome__*` tools for visual validation
- **Runtime:** Bun everywhere. No npm.
- **Dashboard:** CRT terminal aesthetic is sacred. Design tokens are great — don't change them.
- **Kill background processes** when switching contexts. Don't leave 13 bun processes running.
- **Multi-agent testing:** launch probes individually as separate background tasks with unique `ARGUS_AGENT_ID`.
