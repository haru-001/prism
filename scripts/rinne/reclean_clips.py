#!/usr/bin/env python3
"""
给已有的透明 WebM（AI 生成的那 27 段）逐帧去白边，原尺寸、原帧率重新编码，覆盖原文件。
用法：python3 scripts/rinne/reclean_clips.py idle-blink login-wave image-done
"""
import glob, os, shutil, subprocess, sys, tempfile
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from defringe import defringe

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def fps_of(f):
    r = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", f]).decode().strip()
    a, b = r.split("/")
    return float(a) / float(b)


def main(clips):
    for f in sorted(glob.glob(os.path.join(ROOT, "public/img/rinne/clips/*/*.webm"))):
        if os.path.basename(f)[:-5] not in clips:
            continue
        fps = fps_of(f)
        with tempfile.TemporaryDirectory() as td:
            subprocess.check_call(["ffmpeg", "-v", "error", "-c:v", "libvpx-vp9", "-i", f, "-pix_fmt", "rgba", os.path.join(td, "f_%04d.png")])
            for p in sorted(glob.glob(os.path.join(td, "f_*.png"))):
                Image.fromarray(defringe(np.array(Image.open(p).convert("RGBA")), choke=16)).save(p)
            tmp = os.path.join(td, "out.webm")
            subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-framerate", f"{fps:g}", "-i", os.path.join(td, "f_%04d.png"),
                                   "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "34", "-row-mt", "1",
                                   "-auto-alt-ref", "0", "-metadata:s:v:0", "alpha_mode=1", tmp])
            before = os.path.getsize(f)
            shutil.move(tmp, f)
        print(os.path.relpath(f, ROOT), before, os.path.getsize(f), flush=True)


if __name__ == "__main__":
    main(sys.argv[1:] or ["idle-blink", "login-wave", "image-done"])
