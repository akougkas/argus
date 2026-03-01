# AWOC / Argus Sync & Requests

> **Purpose:** This document tracks coordination requests from the Argus team to the AWOC team. It outlines the specific features, APIs, and hooks needed within the AWOC platform to achieve a deep, "first-class citizen" integration with the Argus verification dashboard.

---

## Request 1: The Argus Telemetry Extension

**Context:**
Argus currently monitors agents purely by scraping terminal output (ANSI -> SVG). While powerful, it relies on VLM inference which can be imperfect. Because AWOC is built on the robust `pi` SDK, we want to tap into its internal event bus to stream deterministic state data to Argus.

**Request:**
We need a new, optional extension in AWOC (e.g., `src/extensions/argus-telemetry.ts`) that listens to core lifecycle events and broadcasts them over a local socket.

**Technical Details:**
1.  **The Hook:** Use `pi.on("tool_call")`, `pi.on("agent_start")`, `pi.on("turn_start")`, and `pi.on("session_before_compact")`.
2.  **The Transport:** The extension should attempt to connect to a local UDP socket or Named Pipe (port/path provided via an environment variable, e.g., `ARGUS_TELEMETRY_SOCKET`). If the socket isn't there, it fails silently (meaning Argus isn't running).
3.  **The Payload Schema:** When an event fires, send a structured JSON payload:
    ```json
    {
      "timestamp": 1715802134000,
      "event_type": "tool_execution_start",
      "run_id": "r-12345",
      "data": {
        "tool_name": "dispatch_agent",
        "args": {"task": "Update CSS"}
      },
      "telemetry": {
        "context_percent": 45.2,
        "active_runs": 2
      }
    }
    ```

**Why we need this:**
This data will be merged with our visual frames in the Argus Hub. It allows our Tier 2 Deep Reasoner to evaluate exactly *what* AWOC is doing, rather than guessing based on screen pixels.

---

## Request 2: Targeted Steering Input (Graceful Interruption)

**Context:**
Currently, the Argus "Kill" and "Pause" buttons send blunt POSIX signals (`SIGKILL`, `SIGSTOP`) to the entire process tree. We want to offer granular control for AWOC multi-agent runs.

**Request:**
Ensure that `pi-tui` and AWOC can gracefully handle rapid standard input injections while processing. Specifically, if Argus injects a string like `/stoprun <id>\n` or `/steer Stop working on the backend\n` into AWOC's `stdin`, it must be immediately processed by the orchestrator, even if it is currently streaming a response or waiting on a worker.

**Technical Details:**
1.  Verify that `pi.addInputListener` or the standard input handling in `pi-tui` does not drop inputs if injected programmatically via a PTY wrapper.
2.  Confirm the behavior of the `/steer` command: Will it interrupt an active tool call or streaming generation immediately?

**Why we need this:**
This allows the human operator on the Argus dashboard to click a "Correct Course" button, type a message, and have Argus pipe that directly into AWOC's command line, seamlessly redirecting the orchestrator.

---

## Request 3: Exposing Internal Run IDs to the TUI

**Context:**
If the Argus operator sees a worker stuck in a loop on the visual dashboard, they need to know its ID to stop it.

**Request:**
Ensure that the `Run ID` (e.g., the short identifier used for `/stoprun`) is clearly visible in the `awoc-dispatch` widget for every active and queued run.

**Technical Details:**
In `src/extensions/awoc-core/ui.ts` (specifically in `updateRunWidget`), ensure the `run.id` is rendered alongside the agent name and elapsed time. *(Note: Reviewing the current codebase, it seems this might already be partially implemented as `run.id` is in the format string, but please ensure it's easily readable for OCR/VLM extraction).*

**Why we need this:**
If the semantic link (Request 1) is severed, the visual fallback requires the VLM to read the Run ID off the screen to suggest the correct intervention command to the user.
