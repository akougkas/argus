# Project Argus: Progress Tracker

## Phase 0: Foundations
- [x] Initial Next.js web application scaffolding.
- [x] High-fidelity UI implementation (`src/app/page.tsx`) with mocked agent data, dark mode aesthetics, and terminal themes.
- [x] Define architectural blueprint (`docs/architecture.md`).
- [x] Define execution plan (`docs/plan.md`).
- [x] Initialize tracking system (`docs/progress.md`).

## Phase 1: Proof of Concept (Local Python Probe)
- [x] Create `python-probe` directory.
- [x] Implement `screencapture`/`mss` logic for local screen polling (every 5s).
- [x] Implement simple pixel-diffing/SSIM to discard redundant frames.
- [x] Integrate Gemini 1.5 Flash API for the 60-second evaluation loop.
- [x] Build simple local WebSocket/HTTP server to feed the Next.js dashboard.
- [x] Wire Next.js dashboard to consume real data instead of `MOCK_AGENTS`.

## Phase 2: The Core Telemetry Moat (Rust)
- [ ] Setup `argusd` Rust binary project.
- [ ] Implement X11/Wayland zero-copy memory extraction.
- [ ] Implement `portable-pty` process wrapper.
- [ ] Implement robust SSIM matrix math with SIMD.

## Phase 3: Cloud Backend
- [ ] Setup Go/FastAPI backend.
- [ ] Implement WebRTC SFU (LiveKit or Pion).
- [ ] Integrate Kafka/Redis for sliding frame buffers.
- [ ] Move VLM orchestration to Temporal.io.

## Phase 4: Actuation & Steering
- [ ] Implement `SIGSTOP` / `SIGCONT` freeze mechanisms in Rust daemon.
- [ ] Implement MITM HTTP Proxy for prompt injection in Rust daemon.
- [ ] Wire up Next.js dashboard control buttons to the backend API.

## Pending Decisions / Blockers
- **PoC Demo Environment:** Decide which local open-source agent (e.g., OpenDevin, SWE-agent, or a simple mock script) to use for the viral demo video. A purposefully broken mock script might be easier to control for the narrative.
- **Next.js Backend:** The Next.js app can handle the simple HTTP proxy for the PoC, but a dedicated Go/Rust backend is needed for production WebRTC. We will stick to Next.js API routes or a simple FastAPI server for Phase 1.
