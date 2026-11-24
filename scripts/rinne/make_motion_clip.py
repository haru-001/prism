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

import cv2
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


def ease_ends(t, w=0.12):
    """首尾各 12% 时长内把动作幅度平滑收到 0：从静态图起步、回到静态图时速度为 0，不会“咯噔”一下"""
    return float(smooth(min(t, 1 - t) / w))


def wave(t, n, e):  # n 个来回的正弦，首尾收到 0
    return math.sin(2 * math.pi * n * t) * e


def beats(t, n):  # n 次 0→1→0 的拍子
    return (1 - math.cos(2 * math.pi * n * t)) / 2


def motion(mood, t, side):
    """返回动作参数（角度单位度，正值逆时针；side=+1/-1 表示手伸出的方向）：
    lean 上半身侧倾、tilt 歪头、nod 点头（头部下移，占画布高度）、arm 伸出那只手绕肩抬起的角度、
    shift 重心左右移（占宽度，腿跟着斜一点）、hop 整体上跳（占高度）、sy 上半身竖向缩放（呼吸 / 挺身 / 缩肩）"""
    b, e = bump(t), ease_ends(t)
    m = dict(lean=0.0, tilt=0.0, nod=0.0, arm=0.0, shift=0.0, hop=0.0, sy=1 + 0.006 * b)
    if mood == "guide":  # 朝示意方向侧身前倾，手往外抬着「请看这边」点两下，头跟着点一下
        m.update(lean=2.4 * side * b, tilt=2.2 * side * b, arm=(5.0 * b + 2.2 * beats(t, 2) * b) * side,
                 nod=0.006 * beats(t, 2) * b, shift=0.012 * side * b)
    elif mood == "thinking":  # 重心慢慢移到一边，歪头「嗯……」停一下再换个方向想，最后回正
        s = wave(t, 1, e)
        m.update(lean=1.0 * s, tilt=3.6 * math.sin(math.pi * t) ** 2 * side + 1.4 * wave(t, 2, e), shift=-0.010 * s,
                 nod=0.004 * beats(t, 3) * e, sy=1 + 0.008 * b)
    elif mood == "error":  # 缩肩低头鞠躬两次，头歪向一边表示抱歉
        d = beats(t, 2)
        m.update(lean=0.6 * side * d, tilt=2.6 * side * b, nod=0.012 * d, sy=1 - 0.018 * d, shift=0.004 * side * b)
    elif mood == "imaging":  # 专注取景：上身前探，头左右看两下找角度，手稳住
        m.update(lean=1.4 * side * b, tilt=1.6 * wave(t, 2, e), nod=0.005 * b, arm=1.6 * side * b, sy=1 + 0.010 * b,
                 shift=0.006 * side * b)
    elif mood == "welcome":  # 打招呼：手抬起来挥三下，身体跟着晃，歪头笑
        m.update(lean=1.2 * side * b, tilt=2.8 * side * b, arm=(5.5 * b + 4.0 * wave(t, 3, e)) * side,
                 shift=0.008 * wave(t, 1.5, e), nod=0.004 * beats(t, 3) * e)
    elif mood == "success":  # 开心：小跳两下（落地微微下蹲），头点两下，手抬起来
        d = beats(t, 2)
        hop = max(0.0, math.sin(4 * math.pi * t)) * e
        m.update(lean=0.8 * side * b, tilt=2.4 * side * d, hop=0.014 * hop, sy=1 + 0.012 * hop - 0.010 * max(0.0, -math.sin(4 * math.pi * t)) * e,
                 arm=4.5 * side * b, nod=0.004 * d)
    elif mood == "waiting":  # 等待：重心左右换一下，呼吸，轻轻歪头看一眼
        m.update(lean=0.6 * wave(t, 1, e), tilt=1.8 * side * b + 0.8 * wave(t, 2, e), shift=0.008 * wave(t, 1, e), sy=1 + 0.009 * b)
    return m


def premul(im):
    a = np.asarray(im.convert("RGBA"), dtype=np.float32)
    a[..., :3] *= a[..., 3:4] / 255
    return a


def unpremul(p):
    a = p[..., 3:4]
    out = p.copy()
    out[..., :3] = np.where(a > 0.5, p[..., :3] * 255 / np.maximum(a, 1e-3), 0)
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), "RGBA")


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def rot_inv(x, y, cx, cy, deg):
    """把输出坐标按逆时针 deg 的旋转反推回原图坐标（deg 可以是逐像素数组）"""
    th = np.radians(deg)
    c, s = np.cos(th), np.sin(th)
    dx, dy = x - cx, y - cy
    return cx + dx * c - dy * s, cy + dx * s + dy * c


def render(src, W, mood, t, k, geo, pad=0, raw=False):
    """src: 预乘 alpha 的立绘（H×W×4 float32）。
    整张图用一个连续的形变场（输出坐标 → 原图坐标）一次采样：每个动作只作用在平滑过渡的区域里
    （腰以上、颈以上、肩膀外侧的手臂），过渡带里是拉伸而不是切开，不会重影、断裂或出现缺块"""
    m = motion(mood, t, geo["side"])
    cx, wy, ny, fy = geo["cx"], geo["wy"], geo["ny"], geo["fy"]
    Y, X = np.mgrid[-pad:H + pad, -pad:W + pad].astype(np.float32)
    # 0. 整体上跳 + 重心平移（脚底不动，越往上偏得越多，到腰部以上整段平移）
    y0 = Y + m["hop"] * k * H
    lift = np.clip((fy - y0) / max(fy - wy, 1), 0, 1)
    x0 = X - m["shift"] * k * W * smooth(lift)
    # 1. 上半身绕腰侧倾
    ww = smooth((wy + BAND * H / 2 - y0) / (BAND * H))
    x1, y1 = rot_inv(x0, y0, cx, wy, m["lean"] * k * ww)
    # 2. 伸出去的那只手绕肩膀抬起：只动躯干外侧、肩以下腰以上的部分，边界是平滑过渡
    if m["arm"] and geo["arm_w"] > 0:
        sx, sy_ = geo["shoulder"]
        out = (sx - x1) * geo["side"]  # 往手伸出方向为正
        wa = smooth(out / (0.05 * W)) * smooth((y1 - (ny - 0.01 * H)) / (0.04 * H)) * smooth((wy + 0.02 * H - y1) / (0.05 * H))
        x1, y1 = rot_inv(x1, y1, sx, sy_, -m["arm"] * k * geo["arm_w"] * wa)
    # 3. 歪头 + 点头
    wn = smooth((ny + 0.03 * H - y1) / (0.06 * H))
    x2, y2 = rot_inv(x1, y1, cx, ny, m["tilt"] * k * wn)
    y2 = y2 - m["nod"] * k * H * wn
    # 4. 上半身以腰为基准竖向缩放（呼吸 / 挺身 / 缩肩）
    sy = 1 + (m["sy"] - 1) * k
    w2 = smooth((wy + BAND * H / 2 - y2) / (BAND * H))
    y3 = y2 + w2 * ((wy - (wy - y2) / sy) - y2)
    out = cv2.remap(src, x2.astype(np.float32), y3.astype(np.float32), cv2.INTER_LANCZOS4,
                    borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    out = np.clip(out, 0, 255)
    out[..., :3] = np.minimum(out[..., :3], out[..., 3:4])  # 三次插值的过冲不能超过 alpha（否则边缘发白）
    return out if raw else unpremul(out)


def geometry(still_rgba, meta, W):
    a = np.asarray(still_rgba)[..., 3] > 128
    wy = WAIST * H
    ny = (meta.get("ty", 0.03) + 0.115) * H
    cx = meta.get("bx", 0.5) * W
    rows = np.where(a.any(axis=1))[0]
    fy = float(rows[-1]) if len(rows) else H - 1.0
    # 手伸向哪边：上半身不透明像素多的那一侧
    left = a[: int(wy), : int(cx)].sum()
    right = a[: int(wy), int(cx):].sum()
    side = 1 if left > right else -1  # 逆时针 = 头往左
    # 躯干半宽：用另一侧（没伸手那侧）胸口那几行的宽度估计；肩膀在躯干边缘、颈下方一点
    band = a[int(ny + 0.06 * H): int(ny + 0.12 * H)]
    if side == 1:
        far = np.where(band[:, int(cx):].any(axis=0))[0]
        half = (far.max() + 1) if len(far) else 0.12 * W
    else:
        far = np.where(band[:, : int(cx)].any(axis=0))[0]
        half = (int(cx) - far.min()) if len(far) else 0.12 * W
    half = float(min(max(half, 0.06 * H), 0.16 * H))
    sx = cx - side * (half + 0.01 * H)
    # 伸手那侧躯干外面有多少东西：几乎没有（手垂在身侧、画布很窄）就不做抬手，免得把头发、袖口拉变形
    region = a[int(ny): int(wy)]
    xs = np.arange(W)[None, :]
    outside = ((sx - xs) * side > 0.03 * H) & region
    arm_w = float(np.clip(outside.sum() / (0.004 * H * H) - 0.3, 0, 1))
    return {"cx": cx, "wy": wy, "ny": ny, "fy": fy, "side": side, "shoulder": (sx, ny + 0.05 * H), "arm_w": arm_w}


def lost(src, W, mood, k, geo, n, pad=48):
    """在四周加宽 pad 的画布上渲染，统计落到原画布外面（会被裁掉）的人物像素占比。
    只算真正出界的部分：低头、缩肩时上下身重叠导致的面积变化不算缺失"""
    worst = 0.0
    for i in range(0, n + 1, max(1, n // 16)):
        a = render(src, W, mood, i / n, k, geo, pad=pad, raw=True)[..., 3].astype(np.float64)
        tot = a.sum()
        inner = a[pad:pad + H, pad:pad + W].sum()
        worst = max(worst, (tot - inner) / max(tot, 1))
    return worst


# 原 AI 视频和立绘对不上（衣服颜色不同）时，用立绘动作代替：python3 make_motion_clip.py qipao/login-wave
EXTRA = {"login-wave": ("welcome", 2.6), "idle-blink": ("waiting", 3.0), "image-done": ("success", 2.6)}


def main(args):
    assets = json.load(open(os.path.join(ROOT, "lib", "rinne-assets.json")))
    todo = []
    for a in args:
        if "/" in a:
            o, c = a.split("/")
            todo.append((o, c, (CLIPS.get(c) or EXTRA[c])))
        else:
            todo += [(a, c, v) for c, v in CLIPS.items()]
    for o, clip, (mood, secs) in todo:
        if True:
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
            # 动作大到人物被画布裁边时收小幅度：出界像素要几乎为 0（头发丝级别）
            allow = 0.0006
            while k > 0.35 and lost(src, W, mood, k, geo, n) > allow:
                k -= 0.1
            out = os.path.join(ROOT, "public/img/rinne/clips", o, f"{clip}.webm")
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with tempfile.TemporaryDirectory() as td:
                for i in range(n + 1):
                    f = still if i in (0, n) else render(src, W, mood, i / n, k, geo)
                    f.save(os.path.join(td, f"f_{i:04d}.png"))
                subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", os.path.join(td, "f_%04d.png"),
                                       "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "33", "-row-mt", "1",
                                       "-deadline", "good", "-cpu-used", "3",
                                       "-auto-alt-ref", "0", "-metadata:s:v:0", "alpha_mode=1", out])
            print(o, clip, f"{W}x{H}", f"k={k:.1f}", os.path.getsize(out), flush=True)


if __name__ == "__main__":
    main(sys.argv[1:] or OUTFITS)
