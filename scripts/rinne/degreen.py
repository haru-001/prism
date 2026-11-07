"""绿幕直出图的去绿处理（第三轮起所有立绘都走这条，不再用 u2net）。

generate_image(transparent_background) 先在 #00FF00 上画再抠，会留下：地面绿色阴影、发丝和边缘的绿溢色、零散绿斑。
  1. 明显偏绿的像素（g > max(r,b)*1.25+8）alpha 置 0（地面阴影、漏抠的背景）
  2. 去溢色：g = min(g, max(r,b)+6)；半透明像素（头纱、发丝）再压到 (r+b)/2+2
  3. 只保留和人物连通的大块（小于最大块 2% 的碎片丢掉），填洞
  4. alpha 3x3 中值滤波，再向内收 1px，边缘 0.6px 羽化
用法：python degreen.py 输入.png 输出.png  （或 输入目录 输出目录）
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage


def degreen(im):
    a = np.asarray(im.convert("RGBA")).astype(np.float32)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    mx = np.maximum(r, b)
    green = g > mx * 1.25 + 8
    al = np.where(green, 0, al)
    g = np.minimum(g, mx + 6)
    # 半透明处（头纱、发丝）透出的是绿底：再压一档，不让它偏薄荷色
    semi = (al > 0) & (al < 235)
    g = np.where(semi, np.minimum(g, (r + b) / 2 + 2), g)
    solid = al > 128
    lab, n = ndimage.label(solid)
    if n:
        sizes = ndimage.sum(solid, lab, range(1, n + 1))
        keep = np.isin(lab, [i + 1 for i, z in enumerate(sizes) if z >= sizes.max() * 0.02])
        keep = ndimage.binary_dilation(keep, iterations=3)
        al = np.where(keep, al, 0)
    am = Image.fromarray(al.astype(np.uint8)).filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.MinFilter(3))
    am = am.filter(ImageFilter.GaussianBlur(0.6))
    al = np.asarray(am).astype(np.float32)
    # 透明处颜色清零，免得缩放时把绿色带进边缘
    out = np.dstack([r, g, b, al]).clip(0, 255).astype(np.uint8)
    out[al == 0, :3] = 0
    im2 = Image.fromarray(out, "RGBA")
    return im2.crop(im2.getbbox())


if __name__ == "__main__":
    s, d = sys.argv[1], sys.argv[2]
    if os.path.isdir(s):
        os.makedirs(d, exist_ok=True)
        for f in sorted(os.listdir(s)):
            if f.endswith(".png"):
                degreen(Image.open(os.path.join(s, f))).save(os.path.join(d, f))
    else:
        degreen(Image.open(s)).save(d)
