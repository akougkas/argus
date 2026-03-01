# Project Argus: Architectural Blueprint

## System Definition
Argus is a deterministic, asynchronous multimodal monitoring daemon and verification pipeline with real-time actuation (steering) capabilities for autonomous AI agents. It acts as a "Baby Monitor / Security Camera" for autonomous systems.

## 1. System Topology & Isolation
The system is strictly decoupled into three physically isolated planes to prevent the Observer Effect (monitoring tools consuming CPU/RAM needed by the agent).

### 1.1 The Telemetry Plane (`argusd` / Rust Edge Daemon)
The probe resides inside the agent’s execution environment (Docker container, VM, or bare metal). Written in Rust to guarantee memory safety and strict resource bounding via Linux cgroups (Target: < 1% CPU, < 50MB RAM).
*   **Zero-Copy Visual Extraction:** Hooks directly into Xvfb (X11 Virtual Frame Buffer) or Wayland shared memory (`shmget`). Extracts BGRA pixel data directly from RAM.
*   **Terminal State Capture (PTY Multiplexing):** Acts as a hypervisor, spawning the agent's entry process inside a pseudo-terminal (PTY) via the `portable-pty` crate.
*   **Kernel-Level Tracing (eBPF):** Deploys eBPF probes on specific syscalls (`execve`, `openat`, `connect`) to detect silent destructive actions synchronously.

### 1.2 The Transport & Routing Plane (Go / WebRTC)
*   **Human Pipeline:** Encodes frames via hardware-accelerated H.264 and pushes them via UDP to a Pion WebRTC Selective Forwarding Unit (SFU) for sub-150ms latency.
*   **Machine Pipeline:** Telemetry for the AI Overseer is batched and pushed via gRPC over TLS 1.3 into an Apache Kafka partitioned topic, feeding a Redis-backed temporal sliding window.

### 1.3 The Cognitive Overseer Plane (VLM State Machine)
*   A Temporal.io worker cluster orchestrates the verification loop, utilizing **Gemini 1.5 Flash** for its 1M+ token context and low-cost multimodal image ingestion.

## 2. Core Algorithmic Pipeline: Spatiotemporal Entropy Reduction
To avoid bankruptcy by streaming continuous video to a Vision-Language Model (VLM), we use a Lossy-Semantic Compression Algorithm at the edge.

### 2.1 Visual Variance Filtering (SSIM)
We sample by state variance, not strictly by time.
*   Calculates the Structural Similarity Index Measure (SSIM) against the last transmitted keyframe.
*   **If $\Delta < 0.05$:** Screen hasn't materially changed. Drop frame.
*   **If $\Delta \ge 0.05$:** Significant visual change. Promote to Keyframe, encode to WebP (Quality 60), transmit to buffer.

### 2.2 Log Deduplication (Rabin-Karp Filter)
*   Implements a rolling hash on 10-line chunks of terminal output.
*   If a hash collision occurs in a 60-second window, dynamic payload collapse is triggered (e.g., `[... Error trace dynamically suppressed: repeated 142 times ...]`).

## 3. Actuation Mechanics: The "Steering Wheel" API
### 3.1 The Hard Brake (OS-Level Freeze)
*   If the VLM detects a `DESTRUCTIVE_ACTION`, the Cloud issues a gRPC `PAUSE` command.
*   `argusd` intercepts and sends a `SIGSTOP` signal to the agent's PID tree, freezing it in RAM.
*   Concurrently modifies host iptables to drop all outbound packets (air-gapping).

### 3.2 The Soft Steer (LLM MITM Prompt Injection)
*   If the VLM detects a `STUCK_LOOP`, `argusd` runs a local proxy intercepting the agent's outbound HTTP calls to its intelligence provider.
*   It physically mutates the JSON `messages` array, prepending a system override context before forwarding the request.

## 4. The VLM Verification State Machine
Uses Constrained Decoding (Structured Outputs) to force the VLM to return a strict JSON AST.
```json
{
  "agent_state": "ENUM: [NOMINAL_PROGRESS, STUCK_LOOP, DESTRUCTIVE_INTENT, HALLUCINATION]",
  "confidence_score": "FLOAT: 0.0 - 1.0",
  "reasoning_trace": "STRING",
  "requires_sigstop": "BOOLEAN",
  "mitm_steering_prompt": "OPTIONAL_STRING"
}
```

## 5. Security & Threat Mitigation
*   **Information Disclosure (PII Leakage):** Edge-Level Semantic Redaction using a quantized ONNX model to draw black bounding boxes over detected secrets before frames leave the VPC.
*   **Visual Prompt Injection:** Strict JSON output parsing and slight Gaussian blur on visual payloads to degrade OCR of tiny injected text.
*   **Denial of Service:** Hard OS-level cgroups restrict `argusd` to 0.5 vCPUs. Degrades gracefully by dropping frames.
*   **VLM Hallucination:** Automatic intervention requires $N$ consecutive flagged epochs with Confidence > 0.90, corroborated by host metrics.
