"""头像（64 / 128）和衣柜缩略图（120×160 / 240×320）也换成透明图。

原来的头像、缩略图是从同一张灰底画布裁出来的。这里先用模板匹配找到原图在 860px 舞台图里的裁切框，
再从抠好的 RGBA 母版（make_alpha.py 生成）里按同一个框裁，所以构图和原来完全一样，只是底色变透明。
界面里头像下面垫一层品牌色渐变圆底（Logo.tsx 的 IdolAvatar），衣柜卡片同理。

用法：python make_alpha_small.py public/img/rinne lib/rinne-assets.json
"""
import glob
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

from make_alpha import MASTER, MOODS, OUTFITS, SRC, resize_rgba, write

import io


def enc(im):
    b = io.BytesIO()
    im.save(b, "WEBP", quality=80, alpha_quality=80, method=6, exact=False)
    return b.getvalue()


def find_box(stage_l, small_l, aspect):
    """在 stage 灰度图里找 small 的位置，返回 (x, y, w, h)，单位是 stage 像素"""
    best = None
    for w in range(40, 400, 4):
        h = round(w * aspect)
        if h >= stage_l.shape[0] or w >= stage_l.shape[1]:
            break
        t = cv2.resize(small_l, (w, h), interpolation=cv2.INTER_AREA)
        _, mx, _, loc = cv2.minMaxLoc(cv2.matchTemplate(stage_l, t, cv2.TM_CCOEFF_NORMED))
        if best is None or mx > best[0]:
            best = (mx, w, h, loc)
    _, w0, _, _ = best
    for w in range(max(8, w0 - 4), w0 + 5):
        h = round(w * aspect)
        t = cv2.resize(small_l, (w, h), interpolation=cv2.INTER_AREA)
        _, mx, _, loc = cv2.minMaxLoc(cv2.matchTemplate(stage_l, t, cv2.TM_CCOEFF_NORMED))
        if mx > best[0]:
            best = (mx, w, h, loc)
    mx, w, h, (x, y) = best
    return mx, (x, y, w, h)


def crop_rgba(master, box, size):
    x, y, w, h = box
    W, H = master.size
    # 框超出画布的部分补透明
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(master.crop((max(0, x), max(0, y), min(W, x + w), min(H, y + h))), (max(0, -x), max(0, -y)))
    return resize_rgba(canvas, size)


def gray(p):
    return np.asarray(Image.open(p).convert("L")).astype(np.float32)


def main():
    root, meta = sys.argv[1], sys.argv[2]
    J = json.load(open(meta))
    for o in OUTFITS:
        for m in MOODS:
            e = J["outfits"][o][m]
            if e.get("avatarAlpha"):
                continue
            stage = gray(glob.glob(os.path.join(SRC, o, f"{m}-2x.????????.webp"))[0])
            av = gray(glob.glob(os.path.join(SRC, o, f"{m}-avatar-2x.????????.webp"))[0])
            score, box = find_box(stage, av, 1.0)
            if score < 0.85:
                print("跳过（没对上）", o, m, score)
                continue
            master = Image.open(os.path.join(MASTER, o, f"{m}.png")).convert("RGBA")
            d = os.path.join(root, o)
            f = e["f"]
            f[4] = write(d, f"{m}-avatar", enc(crop_rgba(master, box, (64, 64))), "webp")
            f[5] = write(d, f"{m}-avatar-2x", enc(crop_rgba(master, box, (128, 128))), "webp")
            e["avatarAlpha"] = 1
            print("avatar", o, m, round(score, 3), flush=True)
        # 衣柜缩略图（welcome 姿势，3:4）
        t = J["outfits"][o]["thumb"]
        if len(t) == 2:
            # 缩略图就是 welcome 整张立绘按高度放进 3:4 画布、左右留白，直接用母版生成
            master = Image.open(os.path.join(MASTER, o, "welcome.png")).convert("RGBA")
            W, H = master.size
            cw = round(H * 3 / 4)
            canvas = Image.new("RGBA", (cw, H), (0, 0, 0, 0))
            canvas.paste(master, ((cw - W) // 2, 0))
            d = os.path.join(root, "wardrobe")
            J["outfits"][o]["thumb"] = [
                write(d, o, enc(resize_rgba(canvas, (120, 160))), "webp"),
                write(d, f"{o}-2x", enc(resize_rgba(canvas, (240, 320))), "webp"),
                "alpha",
            ]
            print("thumb", o, flush=True)
        json.dump(J, open(meta, "w"), ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
