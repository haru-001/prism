#!/usr/bin/env python3
"""
逐帧体检 63 段透明 WebM：卡顿（跳帧/冻结/起停突变）、首尾接缝、失真（清晰度下降、压缩块）、穿模/撕裂（新出现的破洞、alpha 面积突变）。
用法：python3 scripts/rinne/qa_clips.py [outfit ...] > qa.tsv ；--sheet 目录  额外输出每套的联络表（深色底，每段取 6 帧）
"""
import glob, json, os, subprocess, sys

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CLIP_MOOD = {"idle-blink": "waiting", "login-wave": "welcome", "image-done": "success",
             "guide-point": "guide", "think-loop": "thinking", "error-sorry": "error", "imaging-work": "imaging"}


def decode(path):
    p = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate",
                        "-of", "json", path], capture_output=True, text=True)
    s = json.loads(p.stdout)["streams"][0]
    w, h = s["width"], s["height"]
    num, den = map(int, s["r_frame_rate"].split("/"))
    raw = subprocess.run(["ffmpeg", "-v", "error", "-c:v", "libvpx-vp9", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
                         capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w, 4), num / den


def still_for(o, clip, w, h, assets):
    m = CLIP_MOOD[clip]
    meta = assets["outfits"][o][m]
    im = cv2.imread(os.path.join(ROOT, "public/img/rinne", o, f"{m}-2x.{meta['f'][1]}.webp"), cv2.IMREAD_UNCHANGED)
    im = cv2.cvtColor(im, cv2.COLOR_BGRA2RGBA)
    if im.shape[0] != h:
        im = cv2.resize(im, (round(im.shape[1] * h / im.shape[0]), h), interpolation=cv2.INTER_AREA)
    c = np.zeros((h, w, 4), np.uint8)
    ww = min(w, im.shape[1])
    c[:, :ww] = im[:, :ww]
    return c


def pm(f):  # 预乘后的 RGB（float）
    a = f[..., 3:4].astype(np.float32) / 255
    return f[..., :3].astype(np.float32) * a


def holes(alpha):
    """人物内部的透明孔（被不透明像素包围、和画布边缘不连通）的像素数"""
    t = (alpha < 100).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(t, 4)
    h, w = t.shape
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
    return int(sum(st[i, cv2.CC_STAT_AREA] for i in range(1, n) if i not in edge and st[i, cv2.CC_STAT_AREA] >= 6))


def sharp(f, mask):
    g = cv2.cvtColor(np.ascontiguousarray(pm(f).astype(np.uint8)), cv2.COLOR_RGB2GRAY)
    lap = cv2.Laplacian(g, cv2.CV_32F)
    return float(lap[mask].var())


def ghost(f):
    """双重影/拖影：亮度图里重复边缘的比例（边缘的自相关在 2~6px 位移处的峰值）"""
    g = cv2.cvtColor(np.ascontiguousarray(pm(f).astype(np.uint8)), cv2.COLOR_RGB2GRAY).astype(np.float32)
    e = np.abs(cv2.Sobel(g, cv2.CV_32F, 0, 1)) + np.abs(cv2.Sobel(g, cv2.CV_32F, 1, 0))
    e = e - e.mean()
    base = float((e * e).mean()) + 1e-6
    best = 0.0
    for dx, dy in [(0, 3), (3, 0), (0, 4), (4, 0), (2, 2), (-2, 2)]:
        sh = np.roll(np.roll(e, dy, 0), dx, 1)
        best = max(best, float((e * sh).mean()) / base)
    return best


def analyze(o, clip, assets):
    path = os.path.join(ROOT, "public/img/rinne/clips", o, f"{clip}.webm")
    F, fps = decode(path)
    n, h, w, _ = F.shape
    st = still_for(o, clip, w, h, assets)
    P = [pm(f) for f in F]
    mask = st[..., 3] > 200
    # 帧间运动量（预乘 RGB 平均绝对差）
    d = np.array([np.abs(P[i + 1] - P[i]).mean() for i in range(n - 1)])
    mid = d[2:-2] if n > 6 else d
    med = float(np.median(mid)) + 1e-6
    jump = float(mid.max() / med)  # 最大一跳是中位数的几倍
    # 加速度突变：相邻帧差的差
    acc = float(np.abs(np.diff(mid)).max() / med) if len(mid) > 2 else 0
    frozen = int((mid < med * 0.08).sum())  # 中段完全不动的帧（卡住）
    seam0 = float(np.abs(P[0] - pm(st)).mean())
    seam1 = float(np.abs(P[-1] - pm(st)).mean())
    # alpha 面积变化、新破洞
    area = np.array([(f[..., 3] > 128).sum() for f in F], np.float64)
    area_dev = float(np.abs(area / area[0] - 1).max())
    h0 = holes(st[..., 3])
    hmax = max(holes(F[i][..., 3]) for i in range(0, n, max(1, n // 10)))
    # 清晰度：中段帧 vs 静态图
    s0 = sharp(st, mask)
    idx = list(range(0, n, max(1, n // 8)))
    sr = min(sharp(F[i], mask) / s0 for i in idx)
    g0 = ghost(st)
    gmax = max(ghost(F[i]) for i in idx)
    # 和静态图的 PSNR（首帧，衡量压缩失真）
    mse = float(((P[0] - pm(st)) ** 2).mean())
    psnr = 10 * np.log10(255 ** 2 / max(mse, 1e-6))
    return dict(o=o, clip=clip, n=n, fps=round(fps, 2), w=w, h=h, jump=round(jump, 2), acc=round(acc, 2), frozen=frozen,
                seam0=round(seam0, 2), seam1=round(seam1, 2), area=round(area_dev, 4), holes0=h0, holes=hmax,
                sharp=round(sr, 3), ghost0=round(g0, 3), ghost=round(gmax, 3), psnr=round(psnr, 1), kb=os.path.getsize(path) // 1024), F


def sheet(o, rows, out):
    tiles = []
    for clip, F in rows:
        n = len(F)
        pick = [int(round(x * (n - 1))) for x in (0, 0.2, 0.35, 0.5, 0.65, 0.8)]
        row = []
        for i in pick:
            f = F[i].astype(np.float32)
            a = f[..., 3:4] / 255
            bg = np.empty_like(f[..., :3]); bg[:] = (15, 14, 26)
            c = f[..., :3] * a + bg * (1 - a)
            c = cv2.resize(c.astype(np.uint8), (round(c.shape[1] * 430 / c.shape[0]), 430), interpolation=cv2.INTER_AREA)
            row.append(c)
        H = 430
        W = max(r.shape[1] for r in row)
        row = [np.pad(r, ((0, 0), (0, W - r.shape[1]), (0, 0)), constant_values=15) for r in row]
        r = np.concatenate(row, 1)
        cv2.putText(r, clip, (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 220), 1)
        tiles.append(r)
    W = max(t.shape[1] for t in tiles)
    tiles = [np.pad(t, ((0, 4), (0, W - t.shape[1]), (0, 0)), constant_values=40) for t in tiles]
    cv2.imwrite(out, cv2.cvtColor(np.concatenate(tiles, 0), cv2.COLOR_RGB2BGR))


def main():
    args = sys.argv[1:]
    sd = None
    if "--sheet" in args:
        i = args.index("--sheet"); sd = args[i + 1]; del args[i:i + 2]
        os.makedirs(sd, exist_ok=True)
    clips = None
    if "--clips" in args:
        i = args.index("--clips"); clips = args[i + 1].split(","); del args[i:i + 2]
    assets = json.load(open(os.path.join(ROOT, "lib", "rinne-assets.json")))
    outfits = args or ["suit", "gown", "summer", "home", "trench", "qipao", "bridal", "sport", "winter"]
    keys = None
    for o in outfits:
        rows = []
        for clip in (clips or CLIP_MOOD):
            r, F = analyze(o, clip, assets)
            if keys is None:
                keys = list(r); print("\t".join(keys), flush=True)
            print("\t".join(str(r[k]) for k in keys), flush=True)
            rows.append((clip, F))
        if sd:
            sheet(o, rows, os.path.join(sd, f"{o}.jpg"))


if __name__ == "__main__":
    main()
