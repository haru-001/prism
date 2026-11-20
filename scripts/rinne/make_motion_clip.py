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


def motion(mood, t, side):
    """返回 (上半身角度, 头部角度, 上半身竖向缩放)。角度单位度，正值逆时针；side=+1/-1 表示手伸出的方向"""
    b = bump(t)
    e = ease_ends(t)
    breath = 1 + 0.006 * b
    if mood == "guide":  # 朝示意方向前倾，头跟着歪一下
        return (2.2 * side * b, 2.0 * side * b, breath)
    if mood == "thinking":  # 歪头想一想：先歪向一边，再慢慢回来，上身轻摇
        s = math.sin(2 * math.pi * t) * e
        return (0.9 * s, 3.2 * math.sin(math.pi * t) ** 2 * (1 if side > 0 else -1) + 0.8 * s, breath)
    if mood == "error":  # 两次低头致歉：上身微微下沉，头点两下
        d = (1 - math.cos(4 * math.pi * t)) / 2
        return (0.6 * side * d, 2.4 * side * d, 1 - 0.014 * d)
    if mood == "imaging":  # 专注取景：上身向前探一点，呼吸更明显
        return (1.2 * side * b, 0.8 * side * math.sin(2 * math.pi * t) * e, 1 + 0.010 * b)
    if mood == "welcome":  # 打招呼：微微侧身、歪头
        return (1.0 * side * b, 2.6 * side * b, breath)
    if mood == "success":  # 开心：歪头两下 + 轻轻挺身
        d = (1 - math.cos(4 * math.pi * t)) / 2
        return (0.8 * side * b, 2.2 * side * d, 1 + 0.010 * b)
    if mood == "waiting":  # 等待：呼吸 + 轻轻歪头
        return (0.5 * side * b, 1.6 * side * b, 1 + 0.008 * b)
    return (0.0, 0.0, 1.0)


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


def render(src, W, mood, t, k, geo):
    """src: 预乘 alpha 的立绘（H×W×4 float32）。
    用连续的形变场代替“旋转后按横条混合”：角度随高度平滑过渡（腰以下 0、腰以上全角度，颈部同理），
    每个像素只采样一次，不会在腰和脖子处出现重影、断裂或手臂错位"""
    ua, ha, sy = motion(mood, t, geo["side"])
    ua, ha = ua * k, ha * k
    cx, wy, ny = geo["cx"], geo["wy"], geo["ny"]
    Y, X = np.mgrid[0:H, 0:W].astype(np.float32)
    ww = smooth((wy + BAND * H / 2 - Y) / (BAND * H))  # 1 = 腰以上
    x1, y1 = rot_inv(X, Y, cx, wy, ua * ww)
    wn = smooth((ny + 0.03 * H - y1) / (0.06 * H))  # 1 = 颈以上
    x2, y2 = rot_inv(x1, y1, cx, ny, ha * wn)
    w2 = smooth((wy + BAND * H / 2 - y2) / (BAND * H))
    y3 = y2 + w2 * ((wy - (wy - y2) / sy) - y2)  # 上半身以腰为基准竖向缩放（呼吸 / 下沉）
    out = cv2.remap(src, x2.astype(np.float32), y3.astype(np.float32), cv2.INTER_LANCZOS4,
                    borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    out = np.clip(out, 0, 255)
    out[..., :3] = np.minimum(out[..., :3], out[..., 3:4])  # 三次插值的过冲不能超过 alpha（否则边缘发白）
    return unpremul(out)


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
    base = src[..., 3].astype(np.float64).sum()
    worst = 0.0
    for i in range(0, n + 1, max(1, n // 12)):
        f = render(src, W, mood, i / n, k, geo)
        worst = max(worst, (base - np.asarray(f)[..., 3].astype(np.float64).sum()) / base)
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
                                       "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "33", "-row-mt", "1",
                                       "-deadline", "good", "-cpu-used", "3",
                                       "-auto-alt-ref", "0", "-metadata:s:v:0", "alpha_mode=1", out])
            print(o, clip, f"{W}x{H}", f"k={k:.1f}", os.path.getsize(out), flush=True)


if __name__ == "__main__":
    main(sys.argv[1:] or OUTFITS)
