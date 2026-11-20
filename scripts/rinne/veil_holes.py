#!/usr/bin/env python3
"""
补头纱 / 薄纱里被抠穿的洞：浅色纱面中间出现的小块全透明斑点（深色模式下像一块块黑斑）。
只补四周是中性白/灰纱面的小洞（指缝、手臂和身体之间的空隙四周是实心皮肤/衣服，不会被当成洞）。
颜色和 alpha 都从四周纱面插值，补完和周围一样是半透明的。

用法：python3 scripts/rinne/veil_holes.py [--write]   （不加 --write 只列出会补哪些；写入时同时更新 1x/2x 的 webp+avif 和哈希）
"""
import hashlib, io, json, os, sys

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
R = os.path.join(ROOT, "public/img/rinne")


def find(a, maxs=150):
    al = a[..., 3]
    tr = (al < 25).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(tr, connectivity=8)
    h, w = al.shape
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
    mask = np.zeros((h, w), np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    found = []
    for i in range(1, n):
        if i in edge or st[i, cv2.CC_STAT_AREA] > maxs or st[i, cv2.CC_STAT_AREA] < 4:
            continue
        x, y, bw, bh = st[i, :4]
        if max(bw, bh) > 2.5 * min(bw, bh):  # 细长的缝（两只脚之间、衣褶的缝）是真实空隙，不补
            continue
        x0, y0, x1, y1 = max(0, x - 6), max(0, y - 6), min(w, x + bw + 6), min(h, y + bh + 6)
        hole = (lab[y0:y1, x0:x1] == i).astype(np.uint8)
        ring = (cv2.dilate(hole, k) > 0) & (hole == 0)
        ra = al[y0:y1, x0:x1][ring].astype(np.float32)
        rc = a[y0:y1, x0:x1, :3][ring].astype(np.float32)
        if len(ra) == 0:
            continue
        lum = rc.mean()
        sat = (rc.max(-1) - rc.min(-1)).mean()
        # 纱：四周基本不透明、颜色是中性的白/灰（皮肤、彩色衣服饱和度更高），洞很小（指缝、臂弯空隙远比这大）
        if ra.mean() > 150 and lum > 90 and sat < 22:
            mask[y0:y1, x0:x1][hole > 0] = 1
            found.append((int(x), int(y), int(st[i, cv2.CC_STAT_AREA])))
    return mask, found


def fill(a, mask):
    m = cv2.dilate(mask, np.ones((3, 3), np.uint8))
    rgb = cv2.inpaint(np.ascontiguousarray(a[..., :3]), m, 6, cv2.INPAINT_TELEA)
    al = cv2.inpaint(np.ascontiguousarray(a[..., 3]), m, 6, cv2.INPAINT_TELEA)
    out = a.copy()
    out[..., :3][m > 0] = rgb[m > 0]
    out[..., 3][m > 0] = al[m > 0]
    return out


def main():
    write = "--write" in sys.argv
    p = os.path.join(ROOT, "lib", "rinne-assets.json")
    A = json.load(open(p))
    for o, moods in A["outfits"].items():
        for mo, meta in moods.items():
            if not isinstance(meta, dict) or "f" not in meta:
                continue
            src = f"{R}/{o}/{mo}-2x.{meta['f'][1]}.webp"
            if not os.path.exists(src):
                continue
            a = np.array(Image.open(src).convert("RGBA"))
            mask, found = find(a)
            if not found:
                continue
            print(o, mo, len(found), "holes", sum(f[2] for f in found), "px", flush=True)
            if not write:
                continue
            big = Image.fromarray(fill(a, mask))
            one = Image.open(f"{R}/{o}/{mo}.{meta['f'][0]}.webp")
            small = big.resize(one.size, Image.LANCZOS)
            for idx, im in enumerate([small, big]):
                suf = "-2x" if idx else ""
                for kind, key, q in [("webp", "f", A["tiers"]["webp_q"]), ("avif", "a", A["tiers"]["avif_q"])]:
                    buf = io.BytesIO()
                    im.save(buf, kind.upper(), quality=q, **({"method": 6} if kind == "webp" else {}))
                    data = buf.getvalue()
                    hsh = hashlib.md5(data).hexdigest()[:8]
                    old = f"{R}/{o}/{mo}{suf}.{meta[key][idx]}.{kind}"
                    if os.path.exists(old):
                        os.remove(old)
                    open(f"{R}/{o}/{mo}{suf}.{hsh}.{kind}", "wb").write(data)
                    meta[key][idx] = hsh
            meta["veil"] = 1
    if write:
        json.dump(A, open(p, "w"), ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
