# Project Argus: Progress Tracker

## Phase 0: Foundations
- [x] Next.js dashboard with CRT terminal aesthetic
- [x] Architecture blueprint and execution plan
- [x] Dark mode UI with live agent grid, state badges, confidence scores

## Phase 1: Working PoC (Text-Based VLM)
- [x] Bun WebSocket hub with dynamic agent registry and command routing
- [x] Probe wraps any command via Bun.spawn, streams logs + screen state
- [x] Two-tier VLM pipeline: fast perception (tier1) + deep reasoning (tier2)
- [x] Homelab Qwen3.5 integration with thinking mode disabled
- [x] Dashboard controls: pause (SIGSTOP), kill (SIGKILL), inject (stdin write)
- [x] Demo agent simulating SWE-agent failure loop
- [x] End-to-end detection: PROGRESSING → STUCK → DANGEROUS state transitions

## Phase 2: Visual VLM Pipeline (Next)
- [ ] ANSI-to-SVG rendering of terminal output
- [ ] sharp rasterization to JPEG frames
- [ ] Vision API integration (tier2 with image input)
- [ ] Temporal frame grid (2x2 composite for multi-frame analysis)
- [ ] Frame streaming to dashboard (frame_update messages)
- [ ] Vision-capable model on homelab (Qwen2.5-VL-7B or similar)

## Phase 3: Dashboard Polish
- [ ] Remove mock agents, show only connected probes
- [ ] Handle agent_disconnected message
- [ ] Add Resume button (unpause after SIGSTOP)
- [ ] Display visual frames in the feed area

## Future Phases
- Rust daemon (argusd) for zero-copy capture and resource bounding
- WebRTC live streaming for sub-150ms latency
- Cloud backend with Kafka/Redis temporal buffers
- MITM proxy for LLM prompt injection steering
- SaaS: auth, billing, timelapse summaries, SDK packages
