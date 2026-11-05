"""把棱音立绘从「灰色影棚底」抠成真正的透明图（RGBA），并重新导出各档 WebP / AVIF。

为什么：原来的立绘都是 RGB，人物站在 #d9d8db 的灰底上，界面只能用同色的「舞台」框住她，
放到别的底色（深色模式、卡片、渐变）上就是一块灰方块，边缘也会露出灰白边。

做法（每个「服装 + 状态」一次，以 860px 舞台图为源）：
  1. 主体：rembg isnet-general-use（人 + 道具）∪ u2net_human_seg（人），软掩膜取最大值。
  2. 抠图：由掩膜生成三分图（确定前景 / 确定背景 / 未知带），pymatting 闭式抠图求出头发、
     头纱、蕾丝这类半透明边缘的 alpha；地面阴影不在主体里，自然去掉（界面里另用 CSS 投影）。
  3. 去灰边：pymatting estimate_foreground_ml 估计纯前景色，边缘像素不再混着灰底，
     放到任何底色上都没有白边 / 灰边。
  4. 缩放在预乘 alpha 下做（Lanczos），小档不会出现暗边或亮边。
  5. 画布尺寸、人物位置、连接点都不变（rinne-assets.json 里的 ar/hx/hy/bx 照用），只换哈希。

用法：python make_alpha.py public/img/rinne lib/rinne-assets.json [outfit/mood ...]
"""
import glob
import hashlib
import io
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

os.environ.setdefault("U2NET_HOME", "/workspace/work/u2net")
from rembg import new_session, remove  # noqa: E402
from pymatting import estimate_alpha_cf, estimate_foreground_ml  # noqa: E402

MOODS = ["welcome", "guide", "thinking", "success", "error", "imaging", "waiting"]
OUTFITS = ["suit", "gown", "summer", "home", "trench", "qipao", "bridal", "sport"]
STAGE = (430, 860)
MINI = (100, 250)
WEBP_Q = 82
AVIF_Q = 60

_s = {}
# 浅色道具补抠：源图里被整平进灰底的道具（如夏装「等待」的保温箱）边缘已经被抹花，
# 补抠会连带抠出光晕和笔刷痕，默认关闭；这类图建议重画（见 docs/rinne）
USE_PROPS = False


def sess(name):
    if name not in _s:
        _s[name] = new_session(name)
    return _s[name]


def soft_mask(im):
    a = np.asarray(remove(im, session=sess("isnet-general-use"), only_mask=True)).astype(np.float32) / 255
    b = np.asarray(remove(im, session=sess("u2net_human_seg"), only_mask=True)).astype(np.float32) / 255
    return np.maximum(a, b)


def props(rgb, m, below=0.0):
    """两个模型都容易漏掉的浅色道具（白色保温箱、台阶、浅色靠垫）：比灰底明显亮或带颜色、
    并且和人连在一起的区域也算主体。比灰底暗的只是地面阴影，不要。"""
    import cv2
    a = (rgb * 255).astype(np.float32)
    excl = ndimage.binary_dilation(m > 0.3, iterations=25)
    w = (~excl).astype(np.float32)
    ws = cv2.GaussianBlur(w, (0, 0), 40)
    field = np.dstack([cv2.GaussianBlur(a[..., c] * w, (0, 0), 40) / np.maximum(ws, 1e-3) for c in range(3)])
    bright = a.mean(axis=2) - field.mean(axis=2)
    chroma = np.abs((a - a.mean(axis=2, keepdims=True)) - (field - field.mean(axis=2, keepdims=True))).sum(axis=2)
    # 灰底是导出时整平过的纯色（217,216,219），压缩噪声只有 ±2，所以阈值可以很低
    soft = np.maximum(np.clip((bright - 2.5) / 6, 0, 1), np.clip((chroma - 6) / 8, 0, 1))
    hard = soft > 0.5
    hard = cv2.morphologyEx(hard.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
    lab, n = ndimage.label(hard)
    if not n:
        return np.zeros_like(m)
    if below:
        ys = np.where((m > 0.5).any(axis=1))[0]
        cut = int(ys.min() + (ys.max() - ys.min()) * below)
        hard[:cut] = False
    near = ndimage.binary_dilation(m > 0.5, iterations=4)
    ids = np.unique(lab[near & hard])
    ids = ids[ids > 0]
    sizes = ndimage.sum(hard, lab, ids) if len(ids) else []
    ids = [i for i, s in zip(ids, sizes) if s > 1500]
    keep = np.isin(lab, ids)
    keep = ndimage.binary_fill_holes(keep)
    # 区域内取软值，边缘自然过渡
    zone = ndimage.binary_dilation(keep, iterations=3)
    return np.where(zone, np.maximum(soft, keep * 1.0), 0)


# 按图补抠浅色道具（键 "服装/状态"，值：只在人物身高这个比例以下找，避开手臂周围的光晕）。
# 2026-11-05 试过 summer/waiting（保温箱）、sport/waiting（台阶）：源图里这两件道具已经被
# 原导出脚本抹进灰底、边缘全是笔刷痕，补抠出来更难看，所以留空；这几张建议重画（见 docs/rinne/alpha.md）
PROPS_BELOW: dict = {}


def matte(im, key=""):
    """im: RGB 860px。返回 RGBA uint8。"""
    rgb = np.asarray(im).astype(np.float64) / 255
    m = soft_mask(im)
    if USE_PROPS:
        m = np.maximum(m, props(rgb, m))
    elif key in PROPS_BELOW:
        m = np.maximum(m, props(rgb, m, PROPS_BELOW[key]))
    # 未知带只留轮廓两侧各 2px：棱音身上大量白色 / 浅灰（婚纱、衬衫）和灰底很接近，
    # 未知带太宽时闭式抠图会把脸、手的边缘抠虚；头纱、发丝由模型软掩膜本身的过渡带保留
    core = m > 0.5
    fg = ndimage.binary_erosion(core, iterations=2) & (m > 0.8)
    bg = ~ndimage.binary_dilation(core, iterations=2) & (m < 0.2)
    # 去掉孤立的小块（背景里的噪点被当成前景）
    lab, n = ndimage.label(fg)
    if n > 1:
        sizes = ndimage.sum(fg, lab, range(1, n + 1))
        keep = np.isin(lab, np.where(sizes >= max(200, sizes.max() * 0.002))[0] + 1)
        fg = keep
    tri = np.full(m.shape, 0.5)
    tri[fg] = 1.0
    tri[bg] = 0.0
    alpha = np.clip(estimate_alpha_cf(rgb, tri), 0, 1)
    # 半透明区（头纱、薄纱）：模型给的是 0.2~0.8 的软值，比闭式抠图更稳，取两者较大者
    semi = (m > 0.2) & (m < 0.8) & ~ndimage.binary_dilation(m > 0.8, iterations=3)
    alpha[semi] = np.maximum(alpha[semi], m[semi])
    alpha[alpha < 0.02] = 0
    alpha[alpha > 0.98] = 1
    F = estimate_foreground_ml(rgb, alpha)
    F = np.clip(F, 0, 1)
    out = np.dstack([F, alpha])
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA")


def resize_rgba(im, size):
    """预乘 alpha 下缩放，避免边缘发暗 / 发亮。"""
    a = np.asarray(im).astype(np.float32) / 255
    pm = np.dstack([a[..., :3] * a[..., 3:4], a[..., 3:4]])
    chans = [Image.fromarray(pm[..., i]).resize(size, Image.LANCZOS) for i in range(4)]
    r = np.dstack([np.asarray(c) for c in chans])
    r = np.clip(r, 0, 1)
    al = r[..., 3:4]
    rgb = np.where(al > 1e-4, r[..., :3] / np.maximum(al, 1e-4), 0)
    return Image.fromarray((np.dstack([np.clip(rgb, 0, 1), al]) * 255 + 0.5).astype(np.uint8), "RGBA")


def enc(im, fmt):
    b = io.BytesIO()
    if fmt == "webp":
        im.save(b, "WEBP", quality=WEBP_Q, alpha_quality=90, method=6, exact=False)
    else:
        im.save(b, "AVIF", quality=AVIF_Q, speed=4)
    return b.getvalue()


def write(dirp, stem, data, ext):
    h = hashlib.sha256(data).hexdigest()[:8]
    for old in glob.glob(os.path.join(dirp, f"{stem}.????????.{ext}")):
        os.remove(old)
    with open(os.path.join(dirp, f"{stem}.{h}.{ext}"), "wb") as f:
        f.write(data)
    return h


SRC = os.environ.get("RINNE_SRC", "/workspace/work/rinne-orig")


def one(root, outfit, mood, entry):
    d = os.path.join(root, outfit)
    # 源图：抠图前的 RGB 原图（不要拿已经抠过的图再抠一次）
    src = glob.glob(os.path.join(SRC, outfit, f"{mood}-2x.????????.webp"))[0]
    im = Image.open(src).convert("RGB")
    rgba = matte(im, f"{outfit}/{mood}")
    W2 = rgba.width
    H2 = rgba.height
    W1 = round(W2 * STAGE[0] / H2)
    mw = [round(W2 * h / H2) for h in MINI]
    tiers = [
        ("", resize_rgba(rgba, (W1, STAGE[0]))),
        ("-2x", rgba),
        ("-sm", resize_rgba(rgba, (mw[0], MINI[0]))),
        ("-sm-2x", resize_rgba(rgba, (mw[1], MINI[1]))),
    ]
    f = list(entry["f"])
    a = list(entry["a"])
    for i, (suf, img) in enumerate(tiers):
        f[i] = write(d, mood + suf, enc(img, "webp"), "webp")
        a[i] = write(d, mood + suf, enc(img, "avif"), "avif")
    entry["f"] = f
    entry["a"] = a
    entry["alpha"] = 1
    return entry


def main():
    root, meta = sys.argv[1], sys.argv[2]
    only = set(sys.argv[3:])
    J = json.load(open(meta))
    for o in OUTFITS:
        for m in MOODS:
            if only and f"{o}/{m}" not in only:
                continue
            e = J["outfits"][o][m]
            if e.get("alpha") and not only:
                continue
            J["outfits"][o][m] = one(root, o, m, e)
            json.dump(J, open(meta, "w"), ensure_ascii=False, separators=(",", ":"))
            print("done", o, m, flush=True)


if __name__ == "__main__":
    main()
