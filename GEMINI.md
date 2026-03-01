# Argus

## Project Overview
Argus is a real-time visual verification and steering tool for autonomous AI agents. It consists of a lightweight probe that monitors the terminal output of an agent via VLM-powered visual analysis. It detects failures, stuck loops, dangerous behavior, or hallucinations in real-time and provides a dashboard for humans to intervene (pause, resume, kill, or inject input).

The architecture uses a two-tier pipeline:
- **Tier 1 (Fast Perception):** Text-based binary anomaly check.
- **Tier 2 (Deep Reasoning):** Uses a vision model on terminal screenshots composited into a 2x2 grid to classify the agent's state (`PROGRESSING`, `STUCK`, `DANGEROUS`, `HALLUCINATING`).

**Main Technologies:**
- Runtime: Bun
- Frontend: Next.js 16, React 19, CSS Modules
- Backend: Bun WebSocket server (`hub.ts`)
- Visual Pipeline: `ansi-to-svg` + `sharp` (ANSI → SVG → JPEG)
- Language: TypeScript

## Building and Running
The project uses `bun` as its package manager and runtime. Ensure you copy `.env.example` to `.env` before starting.

**Install Dependencies:**
```bash
bun install
```

**Run Development Servers:**
You need to run the following commands in separate terminals:
1. Start the WebSocket hub:
   ```bash
   bun run dev:hub
   ```
2. Start the Next.js Dashboard:
   ```bash
   bun run dev:dashboard
   ```
3. Start the Probe (wraps the demo agent by default):
   ```bash
   bun run dev:probe
   ```
   *To wrap any specific command:* `bun run probe.ts -- python3 my_agent.py`

## Testing and Linting
- **Run all tests:** `bun test`
- **Run unit tests:** `bun run test:unit`
- **Run integration tests:** `bun run test:integration`
- **Test coverage:** `bun run test:coverage`
- **Linting:** `bun run lint`

## Development Conventions
- **Language:** TypeScript is used across both frontend and backend.
- **Testing:** Uses Bun's built-in test runner (`bun test`). Tests are organized into `tests/unit` and `tests/integration`.
- **Formatting & Linting:** ESLint is configured for code linting (`eslint.config.mjs`).
- **Styling:** CSS Modules are used for styling React components (e.g., `src/app/page.module.css`).
- **Environment Variables:** VLM endpoints and configuration options are managed via the `.env` file (refer to `.env.example` for defaults).
