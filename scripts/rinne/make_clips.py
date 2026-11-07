"""棱音短视频：两张关键帧（同一姿势的微小变化）合成 2 秒左右的循环，输出带透明通道的 WebM（VP9 + alpha）。

关键帧 B：绿幕直出 → degreen.py 去绿；A 是该状态的 RGBA 母版，B 对齐到 A 的画布（见 align）。
时间轴用「停留 + 两帧交叉淡化」，像定格动画，避免长交叉淡化的重影。
Safari 对 VP9 透明支持不稳定：前端只在 Chromium/Firefox 播视频，其余继续用静态立绘。
用法：python make_clips.py 输出目录
"""
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from headtop import headtop  # noqa: E402

V = "/workspace/work/video"
H = 480
FPS = 12
# 名称: (关键帧 A, 关键帧 B, 时间轴 [(帧, 秒)...]，"A>B" 表示两帧交叉淡化)
OUTFITS = ["suit", "gown", "summer", "sport", "home", "trench", "qipao", "bridal", "winter"]
# 场景: (底图状态, 关键帧后缀, 时间轴 [(帧, 秒)...]，"A>B" 表示两帧交叉淡化)
#   idle-blink：空对话待机眨眼；login-wave：登录页（职业装是挥手，其余服装是眨眼/笑）；image-done：生图完成
SCENES = {
    "idle-blink": ("waiting", "blink", [("A", 1.8), ("B", 0.17), ("A", 0.4)]),
    "login-wave": ("welcome", "wink", [("A", 0.6), ("A>B", 0.17), ("B", 0.6), ("B>A", 0.17), ("A", 0.3)]),
    "image-done": ("success", "cheer", [("A", 0.4), ("A>B", 0.17), ("B", 1.1), ("B>A", 0.25), ("A", 0.3)]),
}


def norm(im):
    a = np.asarray(im)[..., 3]
    t, b, cx = headtop(a)
    return im, t, b, cx


MASTER = "/workspace/work/rinne-rgba"


def align(o, mood, pb):
    """A 直接用该状态的 RGBA 母版（和页面上的静态立绘同一张画布），B 按头顶/脚底/头部中心对齐到 A。
    视频和静态图像素对齐，前端把视频叠在图片上面就行，不会跳。"""
    A = Image.open(os.path.join(MASTER, o, f"{mood}.png")).convert("RGBA")
    _, ta, ba, ca = norm(A)
    B, tb, bb, cb = norm(Image.open(pb).convert("RGBA"))
    s = (ba - ta) / (bb - tb)
    B = B.resize((round(B.width * s), round(B.height * s)), Image.LANCZOS)
    tb, bb, cb = round(tb * s), round(bb * s), round(cb * s)
    cbv = Image.new("RGBA", A.size)
    cbv.paste(B, (ca - cb, ba - bb))
    w = round(A.width * H / A.height) // 2 * 2
    return A.resize((w, H), Image.LANCZOS), cbv.resize((w, H), Image.LANCZOS)


def blend(a, b, t):
    x = np.asarray(a).astype(np.float32) / 255
    y = np.asarray(b).astype(np.float32) / 255
    pa, pb = x[..., :3] * x[..., 3:], y[..., :3] * y[..., 3:]
    al = x[..., 3:] * (1 - t) + y[..., 3:] * t
    rgb = (pa * (1 - t) + pb * t) / np.maximum(al, 1e-4)
    return Image.fromarray((np.dstack([rgb, al]) * 255).clip(0, 255).astype(np.uint8), "RGBA")


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    meta = {}
    jobs = [(o, sc, *SCENES[sc]) for o in OUTFITS for sc in SCENES]
    for o, sc, mood, kf, tl in jobs:
        name = f"{o}/{sc}"
        os.makedirs(os.path.join(out, o), exist_ok=True)
        A, B = align(o, mood, os.path.join(V, f"kf_{o}_{kf}.png"))
        frames = []
        for key, sec in tl:
            n = max(1, round(sec * FPS))
            for i in range(n):
                if key == "A":
                    frames.append(A)
                elif key == "B":
                    frames.append(B)
                else:
                    src, dst = (A, B) if key == "A>B" else (B, A)
                    frames.append(blend(src, dst, (i + 1) / (n + 1)))
        with tempfile.TemporaryDirectory() as d:
            for i, f in enumerate(frames):
                f.save(os.path.join(d, f"{i:04d}.png"))
            dst = os.path.join(out, f"{name}.webm")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(d, "%04d.png"),
                            "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "42", "-row-mt", "1",
                            "-auto-alt-ref", "0", "-an", dst], check=True)
            # 首帧海报（静态兜底 + 视频加载前占位）
            pass
        print(name, len(frames), "帧", os.path.getsize(dst) // 1024, "KB", A.size)
        meta[name] = [A.width, A.height]
    import json
    json.dump(meta, open(os.path.join(out, "clips.json"), "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
