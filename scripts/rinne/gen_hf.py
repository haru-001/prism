#!/usr/bin/env python3
"""Free image-to-video via Hugging Face Spaces (gradio_client), pluggable backends.

Usage:
  python gen_hf.py START.png "prompt" out.mp4 [--backends wan_flf,ltx_flf,...] [--seconds 3] [--seed 42]

- Start AND end frame = the same PNG (loop-safe idle clips), where the backend supports it.
- Tries backends in order; on quota / error it falls through to the next one.
- Output is always a plain H.264 MP4 (yuv420p) at the backend's native size/fps,
  so make_clip.py / fix_ai_clip.py consume it unchanged.
- Optional auth: export HF_TOKEN=hf_xxx (free HF account => 5 min ZeroGPU/day instead of 2 min
  per IP anonymously). The token is read from the environment only, never written anywhere.

Add a backend: write a function f(client_img_path, prompt, seconds, seed, token) -> local video
path, and register it in BACKENDS with its space id.
"""
import argparse, os, shutil, subprocess, sys, tempfile, time

from gradio_client import Client, handle_file

NEG = ("色调艳丽,过曝,细节模糊不清,字幕,风格,作品,画作,整体发灰,最差质量,低质量,JPEG压缩残留,丑陋的,残缺的,"
       "多余的手指,画得不好的手部,画得不好的脸部,畸形的,毁容的,形态畸形的肢体,手指融合,杂乱的背景,三条腿,"
       "背景人很多,倒着走,camera movement,zoom,background change,text")


class QuotaError(RuntimeError):
    pass


def _client(space, token):
    kw = {"verbose": False}
    if token:
        kw["token"] = token  # gradio_client>=1.0 uses `token`
    return Client(space, **kw)


def _run(c, *args, api_name, max_rank=30, timeout=900):
    """submit() + poll; give up early if the queue is hopeless (rank > max_rank) or on timeout."""
    j = c.submit(*args, api_name=api_name)
    t = time.time()
    while not j.done():
        st = j.status()
        rank = getattr(st, "rank", None)
        if rank is not None and rank > max_rank:
            j.cancel()
            raise RuntimeError(f"queue too long: rank {rank}, eta {getattr(st, 'eta', None)}")
        if time.time() - t > timeout:
            j.cancel()
            raise RuntimeError(f"timeout after {timeout}s")
        time.sleep(3)
    return j.result()


def _vid(r):
    """Normalise gradio outputs (str | dict | tuple) to a local file path."""
    if isinstance(r, (list, tuple)):
        r = r[0]
    if isinstance(r, dict):
        r = r.get("video") or r.get("path") or r.get("value")
    return r


def _prep(png, max_side, mult=16):
    """Downscale to <= max_side long edge, dims multiple of `mult`, RGB. Returns temp path."""
    from PIL import Image
    im = Image.open(png).convert("RGB")
    w, h = im.size
    s = min(1.0, max_side / max(w, h))
    nw, nh = max(mult, int(w * s) // mult * mult), max(mult, int(h * s) // mult * mult)
    p = tempfile.mktemp(suffix=".png")
    im.resize((nw, nh), Image.LANCZOS).save(p)
    return p, (nw, nh)


# ---------------- backends ----------------
# Each returns a local video path or raises. GPU-seconds noted are rough per 3 s clip.

def b_wan_flf(png, prompt, seconds, seed, token):
    """multimodalart/wan-2-2-first-last-frame: Wan2.2-I2V-A14B FLF, 8-step Lightning, 16 fps, max 832px."""
    p, _ = _prep(png, 832)
    c = _client("multimodalart/wan-2-2-first-last-frame", token)
    r = _run(c, handle_file(p), handle_file(p), prompt, NEG, float(seconds), 8, 1.0, 1.0,
                  seed, False, api_name="/generate_video")
    return _vid(r)


def b_wan_r3gm(png, prompt, seconds, seed, token):
    """r3gm/wan2-2-fp8da-aoti-preview2: Wan2.2 I2V A14B fp8 AoT, optional last_image, 6 steps."""
    p, _ = _prep(png, 832)
    c = _client("r3gm/wan2-2-fp8da-aoti-preview2", token)
    r = _run(c, handle_file(p), handle_file(p), prompt, 6, NEG, float(seconds), 1, 1, seed, False,
                  api_name="/generate_video")
    return _vid(r)


def b_ltx_flf(png, prompt, seconds, seed, token):
    """linoyts/LTX-2-3-First-Last-Frame: LTX-2.3 keyframes (first+last). Width/height passed explicitly."""
    p, (w, h) = _prep(png, 960, 32)
    c = _client("linoyts/LTX-2-3-First-Last-Frame", token)
    r = _run(c, handle_file(p), handle_file(p), None, prompt, float(seconds), False, seed, False,
                  h, w, api_name="/generate_video")
    return _vid(r)


def b_wan_i2v(png, prompt, seconds, seed, token):
    """zerogpu-aoti/wan2-2-fp8da-aoti-faster: Wan2.2 I2V, NO end frame (return-to-pose not guaranteed)."""
    p, _ = _prep(png, 832)
    c = _client("zerogpu-aoti/wan2-2-fp8da-aoti-faster", token)
    r = _run(c, handle_file(p), prompt, 6, NEG, float(seconds), 1, 1, seed, False,
                  api_name="/generate_video")
    return _vid(r)


def b_wan_s2v(png, prompt, seconds, seed, token):
    """Wan-AI/Wan2.2-S2V (official, runs on Alibaba DashScope, no ZeroGPU quota). Audio-driven:
    fed near-silent noise so she idles; ignores the text prompt; no end-frame control."""
    wav = tempfile.mktemp(suffix=".wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                    f"anoisesrc=d={seconds}:c=pink:a=0.003", "-ar", "16000", "-ac", "1", wav], check=True)
    c = _client("Wan-AI/Wan2.2-S2V", token)
    r = _run(c, handle_file(png), handle_file(wav), "480P", api_name="/predict")
    return _vid(r)


BACKENDS = {
    "wan_flf": b_wan_flf,
    "wan_r3gm": b_wan_r3gm,
    "ltx_flf": b_ltx_flf,
    "wan_i2v": b_wan_i2v,
    "wan_s2v": b_wan_s2v,
}
DEFAULT_ORDER = "wan_flf,wan_r3gm,ltx_flf,wan_i2v,wan_s2v"


def contact_sheet(mp4, n=6):
    """6 evenly spaced frames side by side -> <out>.sheet.jpg (for quick QA)."""
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                                "csv=p=0", mp4], capture_output=True, text=True).stdout.strip() or 3)
    jpg = os.path.splitext(mp4)[0] + ".sheet.jpg"
    fps = n / dur
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp4, "-vf",
                    f"fps={fps:.4f},scale=-2:640,tile={n}x1", "-frames:v", "1", jpg], check=True)
    return jpg


def to_mp4(src, out):
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-an", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-crf", "16", "-movflags", "+faststart", out], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("png"); ap.add_argument("prompt"); ap.add_argument("out")
    ap.add_argument("--backends", default=os.environ.get("HF_I2V_BACKENDS", DEFAULT_ORDER))
    ap.add_argument("--seconds", type=float, default=3.0)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--sheet", action="store_true", help="also write <out>.sheet.jpg contact sheet")
    a = ap.parse_args()
    token = os.environ.get("HF_TOKEN") or None
    errors = []
    for name in [b.strip() for b in a.backends.split(",") if b.strip()]:
        fn = BACKENDS[name]
        t = time.time()
        try:
            print(f"[{name}] generating...", file=sys.stderr)
            v = fn(a.png, a.prompt, a.seconds, a.seed, token)
            to_mp4(v, a.out)
            if a.sheet:
                contact_sheet(a.out)
            print(f"[{name}] OK in {time.time()-t:.0f}s -> {a.out}", file=sys.stderr)
            print(name)
            return 0
        except Exception as e:
            msg = str(e)
            kind = "QUOTA" if ("quota" in msg.lower() or "runs limit" in msg.lower()) else "ERROR"
            print(f"[{name}] {kind} after {time.time()-t:.0f}s: {msg[:300]}", file=sys.stderr)
            errors.append((name, kind, msg[:300]))
    print("ALL BACKENDS FAILED", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
