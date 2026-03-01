# Next Session: Visual VLM Pipeline

## Context
The text-based VLM pipeline works end-to-end (probe → hub → dashboard, with tier1/tier2 detection via Qwen3.5 on homelab). But we're sending stripped text to the VLM, not images. The product vision is **visual monitoring** — terminal screenshots fed to a VLM's vision API.

## Why Visual > Text
1. **Information density** — An image carries layout, colors, error highlighting, progress bars, cursor position. "An image is worth 1000 words" literally applies here.
2. **Token efficiency** — DeepSeek research showed compressing text into images is more token-efficient than raw text for LLM analysis. A 480p terminal screenshot ~ 258 vision tokens vs 500+ text tokens.
3. **Temporal reasoning** — Send 4 sequential frames as a grid/strip. VLM sees time progression in one inference instead of parsing interleaved text dumps.
4. **Universality** — Works for any visual output (browsers, IDEs, GUIs), not just terminals.

## Implementation Plan: ANSI-to-SVG + sharp

### New Dependencies
- `ansi-to-svg` — Converts raw ANSI terminal output (with escape codes) to SVG
- `sharp` — Rasterizes SVG to PNG/JPEG, fast native bindings

### Changes to probe.ts

#### 1. Capture raw ANSI output (not stripped)
Currently we strip ANSI codes for the screen buffer. For visual mode, keep the raw ANSI stream for the last N screen states.

```
Raw ANSI buffer → ansi-to-svg → SVG string → sharp → JPEG buffer → base64
```

#### 2. New function: captureFrame()
```typescript
async function captureFrame(): Promise<string> {
  const rawAnsi = getRawScreen(); // last 24 lines with ANSI codes intact
  const svg = ansiToSvg(rawAnsi, { /* dark theme, JetBrains Mono */ });
  const jpeg = await sharp(Buffer.from(svg))
    .resize(960, 540)
    .jpeg({ quality: 60 })
    .toBuffer();
  return jpeg.toString('base64');
}
```

#### 3. Modify VLM calls to use vision API
Tier 1 sends a single frame image. Tier 2 composites 4 frames into a 2x2 grid for temporal analysis using sharp.composite().

#### 4. Frame buffer
Replace `screenHistory: string[]` with `frameBuffer: Buffer[]` — stores last 10 JPEG frames.

### VLM Model Consideration
- Qwen3.5-35B-A3B is **text-only** (no vision)
- Need a vision model: Qwen2.5-VL-7B, LLaVA, or GPT-4o-mini
- Could run Qwen2.5-VL-7B on homelab via llama.cpp
- Or use GPT-4o-mini for the PoC (cheap, fast, excellent vision)
- **Hybrid approach:** keep text-based tier1 as fast pre-filter, use vision for tier2 deep reasoning only

## Dashboard Fixes
1. Remove mock agents (A-02 through A-04) from page.tsx — only show real connected probes
2. Handle `agent_disconnected` message from hub
3. Add a "Resume" button (currently only pause exists, no way to unpause from UI)
4. Wire `frame_update` messages to display terminal screenshots in the visual feed area
