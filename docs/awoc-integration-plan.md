# AWOC + Argus Integration Plan

## 1. Vision & Goals

The goal of this integration is to elevate **Argus** from a generalized "dumb terminal" monitor into an intelligent, semantic verification dashboard, using **AWOC** as the flagship demonstration of this capability.

While Argus remains an independent product capable of monitoring *any* terminal process via its visual pipeline, a deep integration with AWOC will provide a "first-class citizen" experience. This means Argus won't just "see" the AWOC terminal; it will *understand* it through a synchronized telemetry side-channel, allowing for flawless detection of complex agent states, precise steering, and rich contextual rendering on the Argus dashboard.

By hooking directly into AWOC's `pi` engine (specifically the `ExtensionAPI`), Argus can cross-reference what it sees visually with exact, structured JSON metadata (tool calls, state transitions, token usage). This creates a deterministic, hyper-reliable verification loop.

## 2. Two-Tier Integration Strategy

The integration will follow the two-tier architecture of Argus itself, ensuring graceful degradation if the semantic link fails.

### Tier 1: Visual-Only (The Baseline)
- **Mechanism:** The Argus Probe wraps the `awoc` CLI command (e.g., `bun run probe.ts -- awoc`).
- **Functionality:** Argus uses `ansi-to-svg` to capture the `pi-tui` interface (headers, tool traces, active runs widgets). The VLM pipeline analyzes these frames.
- **Value:** Proves Argus works out-of-the-box with complex terminal UIs.
- **Limitations:** Relies on OCR and VLM inference, which can occasionally hallucinate or miss rapid state changes.

### Tier 2: Semantic Hook (The Deep Integration)
- **Mechanism:** A new Argus SDK/Extension (`@argus-ai/awoc-extension`) installed within the AWOC environment.
- **Functionality:** This extension hooks into the `pi` event bus (`agent_start`, `tool_call`, `message_update`) and streams structured state data to the Argus Hub via a lightweight side-channel (e.g., a local UDP socket or IPC pipe).
- **Value:**
  - **Deterministic State:** Argus *knows* a tool is running; it doesn't have to guess from pixels.
  - **Enhanced VLM Prompts:** The side-channel JSON is injected into the Tier 2 Vision prompt (e.g., *"The terminal shows this image, AND the agent is currently executing tool 'dispatch_agent' with these args..."*), drastically improving VLM accuracy.
  - **Granular Control:** Instead of sending a blunt `SIGSTOP` to pause everything, Argus can send a targeted `/stoprun <id>` to AWOC to halt a specific runaway worker.

## 3. Architecture Blueprint

### 3.1 The Argus Side (What we build here)

1.  **Semantic Telemetry Ingestion (Hub):** Update `hub.ts` to accept structured telemetry data (JSON) in addition to the standard terminal output stream.
2.  **State Synthesis:** The Hub merges the visual frames (ANSI->SVG->JPEG) with the semantic telemetry for the given timeframe.
3.  **Enhanced Prompting (Tier 2):** Modify the VLM prompt generator to include the structured telemetry.
4.  **Targeted Steering API:** Expand the Argus intervention API. Instead of just sending POSIX signals (`SIGSTOP`/`SIGCONT`), allow for application-specific commands (e.g., injecting AWOC slash commands like `/stoprun <id>` or `/steer <msg>` via stdin or a dedicated control socket).
5.  **Dashboard Upgrades:** Update the Next.js dashboard to visualize this semantic data alongside the terminal view (e.g., a side panel showing the active tool, run ID, and raw context usage).

### 3.2 The Interconnect (The Bridge)

We need a reliable, low-latency way for the AWOC extension to send data to the Argus Probe/Hub.

- **Option A (Simplest):** The AWOC extension prints special, hidden ANSI sequences (APCs - Application Program Commands) that the Argus Probe intercepts and strips before rendering.
- **Option B (Cleaner):** A local IPC mechanism (e.g., Named Pipes or a localhost UDP socket). The Argus Probe opens a socket; the AWOC extension connects to it and streams JSON. *Recommendation: We will proceed with Option B for robustness.*

## 4. Implementation Phases

### Phase 1: The Visual Baseline (Days 1-2)
- Validate that the existing Argus `probe.ts` correctly captures and renders the complex `pi-tui` output of AWOC (especially the sticky headers and updating widgets).
- Tune the `ansi-to-svg` parser if it struggles with specific `pi-tui` escape sequences or cursor positioning.
- *Goal: A flawless visual representation of AWOC in the Argus dashboard.*

### Phase 2: The Semantic Side-Channel (Days 3-5)
- **In Argus:** Implement a local UDP/IPC listener in `probe.ts` to receive telemetry payloads. Forward these payloads to the Hub.
- **In AWOC (via Coordination):** Request the AWOC team to implement the telemetry extension (see `docs/awoc-sync.md`).
- *Goal: Argus Hub receives real-time JSON updates about AWOC's internal state.*

### Phase 3: Synthesized Verification (Days 6-8)
- Update the Argus VLM pipeline. When an anomaly check is triggered, bundle the last N frames *plus* the latest telemetry JSON.
- Rewrite the VLM system prompt to prioritize the semantic data while using the visual frames for context.
- *Goal: Near 100% accuracy in anomaly detection.*

### Phase 4: Granular Steering (Days 9-10)
- Expose new intervention buttons on the Argus dashboard specific to AWOC (e.g., "Halt Run [ID]", "Steer Run [ID]").
- Implement the plumbing to map these buttons to standard input injections or IPC control commands back to AWOC.
- *Goal: The user can surgically intervene in AWOC workflows from the Argus UI.*
