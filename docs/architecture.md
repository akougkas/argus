# Project Argus: Architecture

## Current Implementation

### System Topology

```
[any command] ──Bun.spawn──▶ probe.ts ──WebSocket──▶ hub.ts ──WebSocket──▶ page.tsx
                                │                       ▲                      │
                          VLM pipeline                  │              pause/resume/kill/inject
                         (text + vision)                └──────────────────────┘
```

### probe.ts — Edge Monitor
Process wrapper with two-tier VLM pipeline and visual capture.

- **Process capture:** Bun.spawn with piped stdout/stderr/stdin. Maintains dual rolling line buffers — stripped text for fast analysis, raw ANSI for visual rendering.
- **Visual pipeline:** Raw ANSI → SVG (ansi-to-svg) → JPEG (sharp, 960x540, q60). Captured every 2s into a 10-frame buffer. Streamed to dashboard as base64.
- **Tier 1 (every 1s):** Text-based binary check — "ANOMALY" or "OK". Fast, cheap, 10 tokens max. Uses text model.
- **Tier 2 (on escalation):** Composites last 4 frames into a 2x2 temporal grid. Sends to vision model for deep reasoning. Returns structured JSON with state classification, confidence, and reasoning. Falls back to text if no frames available.
- **Commands:** Handles SIGSTOP (pause), SIGCONT (resume), SIGKILL (kill), stdin write (inject) from dashboard via hub.

### hub.ts — WebSocket Relay
Bun WebSocket server on port 8000 with two endpoints.

- `/ws/probe` — Probes register with `{type: "register", agent_id}`. Hub maintains agent state map and forwards all probe messages to dashboards.
- `/ws/dashboard` — Dashboards receive full agent roster on connect (`init`). Commands routed to the correct probe by agent_id. Notifies dashboards on probe disconnect (`agent_disconnected`).

### page.tsx — Dashboard
Next.js with CRT terminal aesthetic. No mock data — only real connected probes appear.

- Agent grid with live terminal text feed, rendered JPEG frames, log stream, state badges, confidence scores.
- Sidebar with agent list and manual override controls (pause, resume, kill, inject prompt).
- Handles agent connect/disconnect dynamically.

## Design Principles

1. **Zero interference:** The probe must not affect the monitored agent's behavior. Separate process, async analysis, no shared state.
2. **Temporal reasoning:** Single-frame analysis is insufficient. The 2x2 grid gives the VLM temporal context to distinguish "currently erroring" from "stuck in a loop."
3. **Hybrid tiers:** Fast text tier1 as cheap pre-filter (99% of cycles). Expensive vision tier2 only on escalation.
4. **Universal wrapping:** `bun run probe.ts -- <anything>`. Works for any command that produces terminal output.

## Future Architecture (Aspirational)

### Rust Edge Daemon (argusd)
Replace Bun probe with a memory-safe Rust daemon for production deployments.
- Zero-copy visual extraction via X11/Wayland shared memory
- PTY multiplexing via `portable-pty`
- Strict resource bounding via cgroups (<1% CPU, <50MB RAM)
- eBPF kernel tracing for syscall monitoring

### Transport Layer
- WebRTC SFU for sub-150ms live streaming to remote dashboards
- gRPC over TLS for structured telemetry
- Kafka-backed temporal sliding window for multi-agent ingestion

### LLM MITM Steering
- Local HTTP proxy intercepts agent's outbound LLM API calls
- Injects system prompt overrides to course-correct without killing the agent
- Configurable auto-intervention thresholds

### SaaS Layer
- Auth and multi-tenancy
- Billing per agent-hour
- Timelapse generation with VLM chapter markers
- SDK packages for Python and Node.js
