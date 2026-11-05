"""各功能页（图库、渠道、用量、令牌、日志、设置）页首的棱音像，每套服装一张。

原图：RINNE_NEW 下的 page_{outfit}_{page}.png（灰底 RGB，有的画到大腿，有的是全身）
处理：
  1. 用 make_alpha.matte 抠图
  2. 统一裁成「头顶到大腿中部」：全身图取人物高度的 62%，画到大腿就取到底边；左右各留 8px
  3. 缩放到高 PAGE_H（显示高度 180px 的 2 倍），只出这一档，AVIF + WebP 各一份，控制体积
  4. 写进 json：outfits[o].pages[page] = {ar, hx, hy, bx, f: webp 哈希, a: avif 哈希}
     hx / hy 是连线落点（上半身最靠左的手或道具），bx 是头部中心
下沿在 CSS 里用遮罩渐隐，所以裁切边不会生硬。

用法：python make_pages.py lib/rinne-assets.json public/img/rinne [outfit/page ...]
"""
import io
import json
import os
import sys

import numpy as np
from PIL import Image

from make_alpha import matte, resize_rgba, write

NEW = os.environ.get("RINNE_NEW", "/workspace/work/redraw")
CACHE = os.environ.get("RINNE_PAGE_CACHE", "/workspace/work/rinne-pages")
PAGES = ["gallery", "channels", "usage", "tokens", "logs", "settings"]
PAGE_H = 360
PAD = 8
KEEP = 0.62  # 全身图保留的人物高度比例（到大腿中部）


def enc(im, fmt):
    b = io.BytesIO()
    if fmt == "webp":
        im.save(b, "WEBP", quality=76, alpha_quality=70, method=6, exact=False)
    else:
        im.save(b, "AVIF", quality=48, speed=4)
    return b.getvalue()


def bbox(a, thr=128):
    m = a > thr
    ys = np.where(m.any(1))[0]
    xs = np.where(m.any(0))[0]
    return xs[0], ys[0], xs[-1] + 1, ys[-1] + 1


def build(o, p):
    cp = os.path.join(CACHE, o, f"{p}.png")
    if os.path.exists(cp):
        rgba = Image.open(cp).convert("RGBA")
    else:
        rgba = matte(Image.open(os.path.join(NEW, f"page_{o}_{p}.png")).convert("RGB"), f"page/{o}/{p}")
        os.makedirs(os.path.dirname(cp), exist_ok=True)
        rgba.save(cp)
    A = np.asarray(rgba)[..., 3]
    x0, y0, x1, y1 = bbox(A)
    H = rgba.height
    cut = y1 >= H - 3  # 人物被底边裁到：原图就是半身
    if cut:
        bot = y1
    else:
        bot = y0 + round((y1 - y0) * KEEP)
    # 横向范围只看保留下来的这一段
    seg = A[y0:bot]
    xs = np.where((seg > 128).any(0))[0]
    x0, x1 = xs[0], xs[-1] + 1
    crop = rgba.crop((x0, y0, x1, bot))
    s = (PAGE_H - PAD) / crop.height
    w = max(1, round(crop.width * s))
    fig = resize_rgba(crop, (w, PAGE_H - PAD))
    W = w + 2 * PAD
    canvas = Image.new("RGBA", (W, PAGE_H), (0, 0, 0, 0))
    canvas.paste(fig, (PAD, PAD), fig)
    a = np.asarray(canvas)[..., 3].astype(np.float32)
    # 头部中心：顶端 14% 高度内 alpha 的加权中心
    head = a[PAD : PAD + round(PAGE_H * 0.14)]
    cols = head.sum(0)
    bx = float((cols * np.arange(W)).sum() / max(cols.sum(), 1)) / W
    # 连线落点：顶端到 70% 里最靠左的不透明像素
    band = a[: round(PAGE_H * 0.7)] > 128
    rows = np.where(band.any(1))[0]
    lx = [int(np.argmax(band[r])) for r in rows]
    k = int(np.argmin(lx))
    return canvas, {"ar": round(W / PAGE_H, 4), "hx": round((lx[k] + 3) / W, 4), "hy": round(rows[k] / PAGE_H, 4), "bx": round(bx, 4)}


def main():
    meta, root = sys.argv[1], sys.argv[2]
    only = set(sys.argv[3:])
    J = json.load(open(meta))
    for o in J["outfits"]:
        pages = J["outfits"][o].setdefault("pages", {})
        for p in PAGES:
            if only and f"{o}/{p}" not in only:
                continue
            if not os.path.exists(os.path.join(NEW, f"page_{o}_{p}.png")):
                continue
            canvas, e = build(o, p)
            d = os.path.join(root, o)
            os.makedirs(d, exist_ok=True)
            e["f"] = write(d, f"page-{p}", enc(canvas, "webp"), "webp")
            e["a"] = write(d, f"page-{p}", enc(canvas, "avif"), "avif")
            pages[p] = e
            json.dump(J, open(meta, "w"), ensure_ascii=False, separators=(",", ":"))
            print("page", o, p, e["ar"], flush=True)
    J["tiers"]["page"] = PAGE_H
    json.dump(J, open(meta, "w"), ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
