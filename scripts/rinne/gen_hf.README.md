# Free, code-driven image-to-video: findings (2026-11-24)

**Result: there's no working clip yet.** Every free GPU route needs either a quota that this sandbox's shared IP has already used up, or a free account token that we don't have. The script and adapters are ready. One step unblocks them: a **free Hugging Face account plus a read token** (no card), exported as `HF_TOKEN`.

## What was tried (test frame `startframes/suit-guide.png`, the given prompt, 3 s, seed 42)

| Backend key | Space id | Model | End frame? | Result today (anonymous) |
|---|---|---|---|---|
| `wan_flf` | `multimodalart/wan-2-2-first-last-frame` | Wan2.2-I2V-A14B FLF, Lightning 8 steps, 16 fps, ≤832 px | yes (start = end) | `You have exceeded your ZeroGPU runs limit. Authenticate with a Hugging Face token` (fails in about 2 s) |
| `wan_r3gm` | `r3gm/wan2-2-fp8da-aoti-preview2` | Wan2.2 I2V A14B fp8 AoT, 6 steps, has `last_image` plus a built-in upscaler option | yes | first try: my input-format bug (fixed, needs `handle_file`); second try: same "runs limit" quota error |
| `ltx_flf` | `linoyts/LTX-2-3-First-Last-Frame` | LTX-2.3 first/last keyframes | yes | `ZeroGPU quota (150s requested vs. -75s left)` |
| `wan_i2v` | `zerogpu-aoti/wan2-2-fp8da-aoti-faster` | Wan2.2 I2V A14B, 6 steps | **no** (return to pose not guaranteed) | "runs limit" quota error |
| `wan_s2v` | `Wan-AI/Wan2.2-S2V` (official, runs on Alibaba DashScope, **no ZeroGPU quota, anonymous OK**) | Wan2.2 speech-to-video, fed near-silent audio | no; ignores the text prompt | accepted, but the queue showed **rank 184 of 185, ETA about 13.5 h**, so it was cancelled after about 15 min. Not usable. |

Why the anonymous attempts fail: ZeroGPU gives **unauthenticated users 2 GPU-min/day, counted per IP**. The sandbox's egress IP is shared, so that allowance was already spent (we even showed a negative balance). This isn't something we can wait out reliably.

## Other GPU-hosted spaces
I queried the HF Spaces API for image-to-video, Wan, i2v, FramePack, LTX and first-last spaces that are RUNNING. Every GPU-backed one is ZeroGPU, so the same quota applies. The cpu-basic ones are wrappers that need the user's own paid key: `wavespeed/*` needs a WaveSpeed key, `zemi123/multi-i2v-ai` needs Replicate, and the `akhaliq-veo3.1` clones use HF Inference Providers, which are billed.

## Free quota per backend (with a free HF token; source: https://huggingface.co/docs/hub/spaces-zerogpu)
Tiers: anonymous 2 min/day (per IP), **free account 5 min/day**, PRO 40 min/day (paid, excluded). The quota resets 24 h after first use. A Space *reserves* its declared duration before it runs, so a request is refused unless the remaining quota is at least that duration. Actual use is what gets charged.

| Backend | Declared GPU duration per call (from its app.py) | Estimated clips/day on a free account (300 s) |
|---|---|---|
| `wan_i2v` | dynamic: 10 + 6 steps × ~4.5 s ≈ **37 s** at 464×832, 49 frames | about **6 to 8** |
| `wan_flf` | fixed **120 s** reservation, ~30 to 60 s actual | about **3 to 5** (the last ones are blocked once <120 s remain) |
| `ltx_flf` | 75 s, size xlarge = **150 s** quota | about **2** |
| `wan_r3gm` | dynamic, size **xlarge (2× cost)** | about **2 to 4** |
| `wan_s2v` | no ZeroGPU (DashScope) | unlimited in theory, but a 13 h queue in practice |

Realistically one free token gives **about 5 to 10 clips/day** if we try `wan_flf` first and fall back through the rest. These numbers are estimates from the Spaces' code, not yet measured, so check them with the first token run.

## Next options if HF quota is too small (all free, none tried, each needs an account that only the user can create)
- **Kaggle Notebooks**: 30 GPU-h/week, driven from code via the `kaggle` CLI (push a notebook, poll, download output). Running Wan2.2-TI2V-5B or Wan2.1-FLF2V there would give dozens of clips/week. It needs a Kaggle account with phone verification for GPU. This is the biggest free pool.
- **Zhipu `cogvideox-flash`** (open.bigmodel.cn): listed as $0 image-to-video API. China-domestic signup, unverified; lower quality than Wan.
- **Magic Hour API**: free signup credits with no card, but an unpublished amount. Fine as a trial, not as a pipeline.

## Script: `gen_hf.py`
```
pip install gradio_client pillow
export HF_TOKEN=hf_xxx          # optional but required in practice
python gen_hf.py START.png "prompt" out.mp4 [--sheet] [--seconds 3] [--seed 42] \
       [--backends wan_flf,wan_r3gm,ltx_flf,wan_i2v,wan_s2v]   # or env HF_I2V_BACKENDS
```
- Each backend is one small adapter function registered in `BACKENDS`. To add a Space, write about 6 lines.
- The start frame is also used as the **end frame** (loop-safe). The image is pre-scaled to ≤832 px long side, with dims that are multiples of 16 (32 for LTX). The magenta background is untouched.
- It tries backends in order. Quota errors (`QUOTA`), errors, a hopeless queue (rank >30) or a timeout (900 s) each fall through to the next backend. It prints the winning backend name on stdout; exit code 0 means OK and 2 means all failed.
- Output is a **plain H.264 yuv420p MP4, no audio**, at the backend's native size and fps (Wan: 16 fps, about 464×832). It goes straight into `make_clip.py` / `fix_ai_clip.py`, which handle the upscale or crop and the chroma key.
- `--sheet` writes `<out>.sheet.jpg` (6 frames side by side) for QA: check identity, hands, a flat magenta background, and the return to the start pose.
- Verified today: the fallback chain runs end to end and fails fast on quota (about 4 s per backend). **No clip has been produced, so quality is unjudged.**
