#!/usr/bin/env python3
"""
把 AI 生成的纯色背景 MP4 转成棱音用的透明 WebM（VP9 + alpha）。

用法：
  python3 scripts/rinne/make_clip.py <输入.mp4> <outfit> <clip> --frame <起始帧.json>

起始帧 .json 是做起始帧时记下的：人物在 1080x1920 画布里的位置 (x, y, w, h) 和抠像色 key。
输出 public/img/rinne/clips/<outfit>/<clip>.webm：
  - 高 480，宽 = 这套服装这个状态的立绘比例 × 480（和 lib/rinne-assets.json 的 ar 对齐，叠在静态图上不偏）
  - 16fps，VP9 透明通道，单段控制在约 150KB 内
  - 首尾各 3 帧淡回静态立绘，换回静态图时不跳
生成后记得在 components/rinne/RinneClip.tsx 的 CLIP_FILES 里给这套服装加上这个 clip。
"""
import argparse, glob, json, os, subprocess, sys, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CLIP_MOOD = {"guide-point": "guide", "think-loop": "thinking", "error-sorry": "error", "imaging-work": "imaging",
             "idle-blink": "waiting", "login-wave": "welcome", "image-done": "success"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("outfit")
    ap.add_argument("clip", choices=list(CLIP_MOOD))
    ap.add_argument("--frame", required=True)
    ap.add_argument("--fps", type=int, default=16)
    ap.add_argument("--crf", type=int, default=38)
    ap.add_argument("--sim", default="0.30", help="chromakey similarity")
    a = ap.parse_args()

    meta = json.load(open(a.frame))
    mood = CLIP_MOOD[a.clip]
    assets = json.load(open(os.path.join(ROOT, "lib", "rinne-assets.json")))
    ar = assets["outfits"][a.outfit][mood]["ar"]
    H = 480
    W = int(round(ar * H / 2) * 2)
    still = glob.glob(os.path.join(ROOT, "public/img/rinne", a.outfit, f"{mood}-2x.*.webp"))[0]

    # 生成视频可能不是 1080x1920，按比例换算裁切框
    probe = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                     "stream=width,height", "-of", "csv=p=0", a.src]).decode().strip().split(",")
    sw, sh = int(probe[0]), int(probe[1])
    k = sw / 1080
    x, y, w, h = (round(meta[n] * k) for n in ("x", "y", "w", "h"))
    key = "0x" + meta["key"]

    out_dir = os.path.join(ROOT, "public/img/rinne/clips", a.outfit)
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"{a.clip}.webm")

    with tempfile.TemporaryDirectory() as td:
        frames = os.path.join(td, "f_%04d.png")
        vf = (f"fps={a.fps},crop={w}:{h}:{x}:{y},"
              f"chromakey={key}:{a.sim}:0.08,despill=type={'magenta' if meta['key'] == 'ff00ff' else 'green'},"
              f"scale={W}:{H}:flags=lanczos,format=rgba")
        # despill 只支持 green/blue；品红背景用 hue 压一下边缘的紫色
        if meta["key"] == "ff00ff":
            vf = vf.replace("despill=type=magenta,", "")
        else:
            vf = vf.replace("despill=type=green,", "despill=type=green:mix=0.6,")
        subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-i", a.src, "-vf", vf, frames])

        # 首尾淡回静态立绘
        from PIL import Image
        st = Image.open(still).convert("RGBA").resize((W, H), Image.LANCZOS)
        files = sorted(glob.glob(os.path.join(td, "f_*.png")))
        n = len(files)
        for i, f in enumerate(files):
            d = min(i, n - 1 - i)
            if d < 3:
                im = Image.open(f).convert("RGBA")
                Image.blend(st, im, d / 3).save(f)

        subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-framerate", str(a.fps), "-i", frames,
                               "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", str(a.crf),
                               "-row-mt", "1", "-an", "-auto-alt-ref", "0", "-metadata:s:v:0", "alpha_mode=1", out])
    print(out, os.path.getsize(out), "bytes", f"{W}x{H}")
    print(f'下一步：在 RinneClip.tsx 的 CLIP_FILES.{a.outfit} 里加上 "{a.clip}"')


if __name__ == "__main__":
    sys.exit(main())
