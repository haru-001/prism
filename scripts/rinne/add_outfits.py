"""把新画的立绘（夏装、运动装、礼服重画）接进现有资产。

输入：RINNE_NEW 目录下的 new_{outfit}_{mood}.png（灰底 RGB 原图，任意尺寸）
步骤：
  1. 用 make_alpha.matte 抠成 RGBA（同一条抠图管线，边缘处理一致）
  2. 对齐：把人物（含坐着的保温箱、台阶等道具）的高度缩放到旧图同一状态的人物高度，
     头顶、脚底落在旧图同样的位置，画布高 860、左右各留 14px，所以换装时人物不跳
  3. 重新计算 json 里的 ar（宽高比）、hx/hy（对话气泡连线落点，取上半身最左侧的手或道具）、
     ty（头顶）、bx（头部中心），头像裁切框按头部位置算
  4. 写 RGBA 母版到 MASTER，再由 make_alpha.py 编码 WebP / AVIF，make_alpha_small.py 出缩略图

用法：python add_outfits.py lib/rinne-assets.json public/img/rinne summer,sport,gown
"""
import json
import os
import sys

import numpy as np
from PIL import Image

import make_alpha
from make_alpha import MASTER, MOODS, matte, resize_rgba, write
from scipy import ndimage
from make_alpha_small import enc

NEW = os.environ.get("RINNE_NEW", "/workspace/work/redraw")
# 旧服装的抠图母版（只用来取人物高度和位置）
OLD = os.environ.get("RINNE_OLD", "/workspace/work/rinne-rgba-old")
H = 860
PAD = 14


# 坐着的道具（保温箱、跳箱）模型常常漏抠：灰底是纯色，和灰底差得多、又和人连在一起的区域也算主体。
# 地面阴影和灰底只差十几个色阶，阈值 40 以上不会被带进来
PROP_DIFF = {"summer/waiting", "sport/waiting"}
# 高度参照：默认用旧图同一状态；旧图是跳起来的，改用同服装 welcome 的身高
REF = {"sport/success": "welcome"}
# 全新的服装没有旧图：按另一套服装同一状态的人物高度和位置对齐
REFO = {"winter": "suit"}
# 连线落点的搜索范围（人物高度比例），默认 42%；抬腿的姿势缩小，免得连到脚上
BAND = {"sport/thinking": 0.3}


def with_props(im, base):
    def f(_im):
        m = base(_im)
        a = np.asarray(_im).astype(np.float32)
        h, w = a.shape[:2]
        edge = np.concatenate([a[:20].reshape(-1, 3), a[:, :20].reshape(-1, 3), a[:, -20:].reshape(-1, 3)])
        bg = np.median(edge, axis=0)
        # 比灰底亮或带颜色（保温箱）门槛低；比灰底暗的要暗很多才算（深灰跳箱），地面阴影只暗 50 左右，排除
        lum = a.mean(axis=2) - bg.mean()
        chroma = np.abs((a - a.mean(axis=2, keepdims=True)) - (bg - bg.mean())).max(axis=2)
        hard = (chroma > 25) | (lum > 25) | (lum < -90)
        hard = ndimage.binary_opening(hard, iterations=2)
        lab, n = ndimage.label(hard)
        near = ndimage.binary_dilation(m > 0.5, iterations=6)
        ids = np.unique(lab[near & hard])
        ids = ids[ids > 0]
        keep = ndimage.binary_fill_holes(np.isin(lab, ids)) & ~(m > 0.5)
        # 道具是方正的箱子：取凸包填实，边缘就是干净的直线，不会有笔刷一样的毛边
        import cv2
        lab2, n2 = ndimage.label(keep)
        if n2:
            sizes = ndimage.sum(keep, lab2, range(1, n2 + 1))
            # 腿在箱子前面，会把箱子切成左右几块：所有够大的块合起来取一个凸包
            big = np.isin(lab2, [i + 1 for i, z in enumerate(sizes) if z >= max(500, sizes.max() * 0.05)])
            pts = np.column_stack(np.where(big)[::-1]).astype(np.int32)
            hull = np.zeros(keep.shape, np.uint8)
            cv2.fillConvexPoly(hull, cv2.convexHull(pts), 1)
            hull = cv2.erode(hull, np.ones((3, 3), np.uint8))
            keep = hull > 0
        return np.maximum(m, keep.astype(np.float64))
    return f


def bbox(a, thr=0.5):
    m = a > thr * 255
    ys = np.where(m.any(1))[0]
    xs = np.where(m.any(0))[0]
    return xs[0], ys[0], xs[-1] + 1, ys[-1] + 1


DIRECT = os.environ.get("RINNE_DIRECT") == "1"


def place_direct(J, root, o, m, rgba):
    from headtop import headtop
    e = J["outfits"][o][m]
    A = np.asarray(rgba)[..., 3]
    x0, y0, x1, y1 = bbox(A)
    t, _, _ = headtop(A)
    # 参照：同服装上一版 welcome 的头顶和脚底位置
    ro = o if os.path.isdir(os.path.join(OLD, o)) else REFO.get(o, o)
    ref = np.asarray(Image.open(os.path.join(OLD, ro, "welcome.png")).convert("RGBA"))[..., 3]
    rt, rb, _ = headtop(ref)
    s = (rb - rt) / (y1 - t)
    # 举手的姿势手会超出画布顶：整体缩小一点，让最高点留 4px
    top = rb - (y1 - y0) * s
    if top < 4:
        s = (rb - 4) / (y1 - y0)
    cut = rgba.crop((x0, y0, x1, y1))
    nw, nh = max(1, round((x1 - x0) * s)), max(1, round((y1 - y0) * s))
    fig = resize_rgba(cut, (nw, nh))
    W = nw + 2 * PAD
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    canvas.paste(fig, (PAD, rb - nh), fig)
    a = np.asarray(canvas)[..., 3].astype(np.float32)
    ht, _, hcx = headtop(a)
    body = rb - ht
    # 头部中心：头顶往下 9% 身高内、头部附近（±8% 身高）的 alpha 加权中心
    hh = round(body * 0.09)
    lo, hi = max(0, hcx - round(body * 0.08)), min(W, hcx + round(body * 0.08))
    head = a[ht : ht + hh, lo:hi]
    cols = head.sum(0)
    hxc = lo + float((cols * np.arange(hi - lo)).sum() / max(cols.sum(), 1))
    band = a[ht : ht + round(body * BAND.get(f"{o}/{m}", 0.42))] > 128
    rows = np.where(band.any(1))[0]
    lx = [np.argmax(band[r]) for r in rows]
    k = int(np.argmin(lx))
    ax, ay = lx[k] + 3, ht + rows[k]
    e.update(ar=round(W / H, 4), hx=round(ax / W, 4), hy=round(ay / H, 4), ty=round(ht / H, 4), bx=round(hxc / W, 4), alpha=1)
    os.makedirs(os.path.join(MASTER, o), exist_ok=True)
    canvas.save(os.path.join(MASTER, o, f"{m}.png"))
    side = round(body * 0.2)
    bx0 = round(hxc - side / 2)
    by0 = max(0, ht - round(H * 0.01))
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(canvas.crop((max(0, bx0), by0, min(W, bx0 + side), by0 + side)), (max(0, -bx0), 0))
    d = os.path.join(root, o)
    os.makedirs(d, exist_ok=True)
    e["f"][4] = write(d, f"{m}-avatar", enc(resize_rgba(sq, (64, 64))), "webp")
    e["f"][5] = write(d, f"{m}-avatar-2x", enc(resize_rgba(sq, (128, 128))), "webp")
    e["avatarAlpha"] = 1
    print("ok", o, m, e["ar"], e["hx"], e["hy"], flush=True)


def main():
    meta, root, outfits = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
    only = set(sys.argv[4].split(",")) if len(sys.argv) > 4 else None
    J = json.load(open(meta))
    for o in outfits:
        if o not in J["outfits"]:
            # 新服装：照参照服装的结构建一份空条目，哈希由后面的步骤填
            import copy
            base = copy.deepcopy(J["outfits"][REFO[o]])
            for m in MOODS:
                base[m].update(f=[""] * 6, a=[""] * 4, alpha=0, avatarAlpha=0)
            base["thumb"] = ["", ""]
            J["outfits"][o] = base
        for m in MOODS:
            if only and f"{o}/{m}" not in only:
                continue
            e = J["outfits"][o][m]
            key = f"{o}/{m}"
            if DIRECT:
                # 第三轮起：绿幕直出、已去绿的 RGBA，不再抠图；按「头顶到脚底」对齐（举过头顶的手不算身高）
                place_direct(J, root, o, m, Image.open(os.path.join(NEW, f"new_{o}_{m}.png")).convert("RGBA"))
                continue
            src = Image.open(os.path.join(NEW, f"new_{o}_{m}.png")).convert("RGB")
            base = make_alpha.soft_mask
            if key in PROP_DIFF:
                make_alpha.soft_mask = with_props(src, base)
            try:
                rgba = matte(src, key)
            finally:
                make_alpha.soft_mask = base
            A = np.asarray(rgba)[..., 3]
            x0, y0, x1, y1 = bbox(A)
            # 旧图同一状态的人物位置
            ref = REF.get(f"{o}/{m}", m)
            old = np.asarray(Image.open(os.path.join(OLD, REFO.get(o, o), f"{ref}.png")).convert("RGBA"))[..., 3]
            _, oy0, _, oy1 = bbox(old)
            s = (oy1 - oy0) / (y1 - y0)
            cut = rgba.crop((x0, y0, x1, y1))
            nw, nh = max(1, round((x1 - x0) * s)), oy1 - oy0
            fig = resize_rgba(cut, (nw, nh))
            W = nw + 2 * PAD
            canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            canvas.paste(fig, (PAD, oy0), fig)
            a = np.asarray(canvas)[..., 3].astype(np.float32)
            # 头部：顶端 9% 高度内的 alpha 加权中心
            hh = round(nh * 0.09)
            head = a[oy0 : oy0 + hh]
            cols = head.sum(0)
            hxc = float((cols * np.arange(W)).sum() / max(cols.sum(), 1))
            # 连线落点：上半身（顶端到 42%）里最靠左的不透明像素
            band = a[oy0 : oy0 + round(nh * BAND.get(f"{o}/{m}", 0.42))] > 128
            rows = np.where(band.any(1))[0]
            lx = [np.argmax(band[r]) for r in rows]
            k = int(np.argmin(lx))
            ax, ay = lx[k] + 3, oy0 + rows[k]
            e.update(
                ar=round(W / H, 4),
                hx=round(ax / W, 4),
                hy=round(ay / H, 4),
                ty=round(oy0 / H, 4),
                bx=round(hxc / W, 4),
                alpha=1,
            )
            os.makedirs(os.path.join(MASTER, o), exist_ok=True)
            canvas.save(os.path.join(MASTER, o, f"{m}.png"))
            # 头像：以头部中心为准的正方形，边长约人物高度的 20%，顶边比头顶高 1%
            side = round(nh * 0.2)
            bx0 = round(hxc - side / 2)
            by0 = max(0, oy0 - round(H * 0.01))
            sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            sq.paste(canvas.crop((max(0, bx0), by0, min(W, bx0 + side), by0 + side)), (max(0, -bx0), 0))
            d = os.path.join(root, o)
            os.makedirs(d, exist_ok=True)
            e["f"][4] = write(d, f"{m}-avatar", enc(resize_rgba(sq, (64, 64))), "webp")
            e["f"][5] = write(d, f"{m}-avatar-2x", enc(resize_rgba(sq, (128, 128))), "webp")
            e["avatarAlpha"] = 1
            print("ok", o, m, e["ar"], e["hx"], e["hy"], flush=True)
        J["outfits"][o]["thumb"] = J["outfits"][o]["thumb"][:2]
        json.dump(J, open(meta, "w"), ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
