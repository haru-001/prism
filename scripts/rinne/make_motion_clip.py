#!/usr/bin/env python3
"""
不依赖视频模型的短视频：用静态立绘做上半身动作（以腰为支点前倾/摇摆、以颈为支点歪头点头、呼吸起伏），
下半身不动，首尾完全等于静态图，叠在立绘上播放无缝。AI 生成的 MP4 到手后可用 make_clip.py 覆盖同名文件。

- 分辨率和 2x 立绘一致（高 860），高分屏上播放时不会比静态图糊
- 缩放/旋转都在预乘 alpha 下做，发梢边缘不出白边
- 每段自动把角度收到不会被画布裁边的范围

用法：python3 scripts/rinne/make_motion_clip.py [outfit ...]   （不填就做全部九套）
"""
import glob, json, math, os, subprocess, sys, tempfile

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
H = 860
FPS = 20
OUTFITS = ["suit", "gown", "summer", "home", "trench", "qipao", "bridal", "sport", "winter"]
# clip -> (mood, 秒数)
CLIPS = {"guide-point": ("guide", 2.6), "think-loop": ("thinking", 3.2), "error-sorry": ("error", 2.4), "imaging-work": ("imaging", 2.6)}
WAIST = 0.47  # 腰（上半身支点）在画布高度上的位置
BAND = 0.07  # 上下半身过渡带（占画布高度）


def bump(t):  # 0→1→0，两端速度为 0
    return (1 - math.cos(2 * math.pi * t)) / 2


def motion(mood, t, side):
    """返回 (上半身角度, 头部角度, 上半身竖向缩放)。角度单位度，正值逆时针；side=+1/-1 表示手伸出的方向"""
    b = bump(t)
    breath = 1 + 0.006 * b
    if mood == "guide":  # 朝示意方向前倾，头跟着歪一下
        return (2.2 * side * b, 2.0 * side * b, breath)
    if mood == "thinking":  # 歪头想一想：先歪向一边，再慢慢回来，上身轻摇
        s = math.sin(2 * math.pi * t)
        return (0.9 * s, 3.2 * math.sin(math.pi * t) ** 2 * (1 if side > 0 else -1) + 0.8 * s, breath)
    if mood == "error":  # 两次低头致歉：上身微微下沉，头点两下
        d = (1 - math.cos(4 * math.pi * t)) / 2
        return (0.6 * side * d, 2.4 * side * d, 1 - 0.014 * d)
    if mood == "imaging":  # 专注取景：上身向前探一点，呼吸更明显
        return (1.2 * side * b, 0.8 * side * math.sin(2 * math.pi * t), 1 + 0.010 * b)
    return (0.0, 0.0, 1.0)


def premul(im):
    return im.convert("RGBa")


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def render(src, W, mood, t, k, geo):
    """src: 预乘后的立绘（W×H）；k: 角度系数（防裁边）；geo: 支点信息"""
    ua, ha, sy = motion(mood, t, geo["side"])
    ua, ha = ua * k, ha * k
    cx, wy, ny = geo["cx"], geo["wy"], geo["ny"]
    upper = src
    if abs(sy - 1) > 1e-6:  # 上半身以腰为基准竖向缩放（呼吸 / 下沉）
        nh = round(wy * sy)
        top = src.crop((0, 0, W, round(wy))).resize((W, nh), Image.LANCZOS)
        upper = Image.new("RGBa", (W, H), (0, 0, 0, 0))
        upper.paste(src, (0, 0))
        upper.paste(Image.new("RGBa", (W, round(wy)), (0, 0, 0, 0)), (0, 0))
        upper.paste(top, (0, round(wy) - nh))
    if abs(ha) > 1e-4:  # 头：以颈为支点
        head = upper.rotate(ha, resample=Image.BICUBIC, center=(cx, ny))
        m = smooth((ny + 0.03 * H - np.arange(H)) / (0.06 * H))[:, None]
        upper = blend(head, upper, m, W)
    if abs(ua) > 1e-4:  # 上半身：以腰为支点
        upper = upper.rotate(ua, resample=Image.BICUBIC, center=(cx, wy))
    m = smooth((wy + BAND * H / 2 - np.arange(H)) / (BAND * H))[:, None]
    out = blend(upper, src, m, W)
    return out.convert("RGBA")


def blend(a, b, m, W):
    A = np.asarray(a, dtype=np.float32)
    B = np.asarray(b, dtype=np.float32)
    M = np.repeat(m, W, axis=1)[..., None].astype(np.float32)
    return Image.fromarray(np.clip(A * M + B * (1 - M) + 0.5, 0, 255).astype(np.uint8), "RGBa")


def geometry(still_rgba, meta, W):
    a = np.asarray(still_rgba)[..., 3] > 128
    wy = WAIST * H
    ny = (meta.get("ty", 0.03) + 0.115) * H
    cols = np.where(a[: int(wy)].any(axis=0))[0]
    cx = meta.get("bx", 0.5) * W
    # 手伸向哪边：上半身不透明像素多的那一侧
    left = a[: int(wy), : int(cx)].sum()
    right = a[: int(wy), int(cx):].sum()
    side = 1 if left > right else -1  # 逆时针 = 头往左
    return {"cx": cx, "wy": wy, "ny": ny, "side": side}


def lost(src, W, mood, k, geo, n):
    base = np.asarray(src.convert("RGBA"))[..., 3].astype(np.float64).sum()
    worst = 0.0
    for i in range(0, n + 1, max(1, n // 12)):
        f = render(src, W, mood, i / n, k, geo)
        worst = max(worst, (base - np.asarray(f)[..., 3].astype(np.float64).sum()) / base)
    return worst


def main(outfits):
    assets = json.load(open(os.path.join(ROOT, "lib", "rinne-assets.json")))
    for o in outfits:
        for clip, (mood, secs) in CLIPS.items():
            meta = assets["outfits"][o][mood]
            path = os.path.join(ROOT, "public/img/rinne", o, f"{mood}-2x.{meta['f'][1]}.webp")
            still = Image.open(path).convert("RGBA")
            W = still.width + (still.width % 2)
            if still.size != (W, H):
                c = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                c.paste(still.resize((still.width, H), Image.LANCZOS) if still.height != H else still, (0, 0))
                still = c
            src = premul(still)
            geo = geometry(still, meta, W)
            n = int(secs * FPS)
            k = 1.0
            # 动作大到人物被画布裁边（>0.4% 像素丢失，竖向下沉本身约 0.5% 不计）时收小角度
            allow = 0.004 + (0.007 if mood == "error" else 0)
            while k > 0.35 and lost(src, W, mood, k, geo, n) > allow:
                k -= 0.1
            out = os.path.join(ROOT, "public/img/rinne/clips", o, f"{clip}.webm")
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with tempfile.TemporaryDirectory() as td:
                for i in range(n + 1):
                    f = still if i in (0, n) else render(src, W, mood, i / n, k, geo)
                    f.save(os.path.join(td, f"f_{i:04d}.png"))
                subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", os.path.join(td, "f_%04d.png"),
                                       "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "38", "-row-mt", "1",
                                       "-deadline", "good", "-cpu-used", "2",
                                       "-auto-alt-ref", "0", "-metadata:s:v:0", "alpha_mode=1", out])
            print(o, clip, f"{W}x{H}", f"k={k:.1f}", os.path.getsize(out), flush=True)


if __name__ == "__main__":
    main(sys.argv[1:] or OUTFITS)
