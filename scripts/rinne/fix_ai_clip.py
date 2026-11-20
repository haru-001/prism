#!/usr/bin/env python3
"""
修 AI 生成的短视频（idle-blink / login-wave / image-done），让它和静态立绘严丝合缝：

1. 对齐 + 防抖：每帧放大到 2x 立绘尺寸（高 860），用 ECC 按胯部区域对齐到立绘，去掉 AI 视频的镜头抖动和整体漂移
2. 色差校正：在没动的像素上拟合每通道增益/偏移，让视频颜色和立绘一致
3. 只留真正在动的部分：和立绘差别明显的区域（眨眼、挥手、笑）用视频，其余像素直接用清晰的立绘；
   腰以下整体锁定为立绘（AI 视频里腿、裙摆会变形、开衩忽有忽无，就是“穿模”的来源）
4. 动作区域在时间上做平滑，避免遮罩闪烁；首尾 4 帧渐变回立绘，播放前后无跳变
5. 输出 VP9 透明 WebM，宽高与立绘一致，帧率沿用原视频

用法：python3 scripts/rinne/fix_ai_clip.py [outfit/clip ...]（不填就处理全部 27 段；原文件先备份到 scripts/rinne/.orig/）
"""
import json, os, shutil, subprocess, sys, tempfile

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from qa_clips import decode  # noqa: E402
from scipy import ndimage  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
H = 860
WAIST = 0.50  # 腰以下锁定（比动作脚本的支点略低，留出手叉腰、垂手的位置）
BAND = 0.08
CLIP_MOOD = {"idle-blink": "waiting", "login-wave": "welcome", "image-done": "success"}
OUTFITS = ["suit", "gown", "summer", "home", "trench", "qipao", "bridal", "sport", "winter"]
FADE = 4


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def load_still(o, mood, assets):
    meta = assets["outfits"][o][mood]
    im = cv2.imread(os.path.join(ROOT, "public/img/rinne", o, f"{mood}-2x.{meta['f'][1]}.webp"), cv2.IMREAD_UNCHANGED)
    im = cv2.cvtColor(im, cv2.COLOR_BGRA2RGBA).astype(np.float32)
    if im.shape[0] != H:
        im = cv2.resize(im, (round(im.shape[1] * H / im.shape[0]), H), interpolation=cv2.INTER_AREA)
    W = im.shape[1] + im.shape[1] % 2
    c = np.zeros((H, W, 4), np.float32)
    c[:, : im.shape[1]] = im
    return c


def to_pm(f):
    out = f.copy()
    out[..., :3] *= f[..., 3:4] / 255
    return out


def from_pm(p):
    a = p[..., 3:4]
    out = p.copy()
    out[..., :3] = np.where(a > 0.5, p[..., :3] * 255 / np.maximum(a, 1e-3), 0)
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def edge_clean(a, rad=4, thr=10):
    """放大后的 AI 抠像边缘：外圈 4px 内比里面亮的低饱和像素（灰白残留，深色头发外的灰圈也算）换成里面的颜色，
    再把过软的 alpha 边收紧到和立绘相近（约 1–2px）"""
    a = a.astype(np.float32)
    al = a[..., 3]
    deep = ndimage.binary_erosion(al >= 245, iterations=rad)
    if not deep.any():
        return a.astype(np.uint8)
    _, idx = ndimage.distance_transform_edt(~deep, return_indices=True)
    inner = a[..., :3][idx[0], idx[1]]
    rgb = a[..., :3]
    ring = (al > 0) & ~deep & (ndimage.distance_transform_edt(al >= 128) <= rad)
    lum = lambda x: x.mean(-1)
    sat = rgb.max(-1) - rgb.min(-1)
    fix = ring & (sat < 40) & (lum(rgb) > lum(inner) + thr)
    out = a.copy()
    out[..., :3][fix] = inner[fix]
    soft = (al > 0) & (al < 245)
    out[..., 3][soft] = np.clip((al[soft] - 70) * 255 / 175, 0, 255)
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def gray(p):
    g = 0.299 * p[..., 0] + 0.587 * p[..., 1] + 0.114 * p[..., 2] + (255 - p[..., 3]) * 0.25
    return cv2.GaussianBlur(g.astype(np.float32), (0, 0), 1.5)


def ecc(tmpl, img, warp, mode, mask):
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 80, 1e-5)
    try:
        _, w = cv2.findTransformECC(tmpl, img, warp.copy(), mode, crit, mask, 5)
        return w
    except cv2.error:
        return warp


def fix(o, clip, assets, dry=False):
    mood = CLIP_MOOD[clip]
    path = os.path.join(ROOT, "public/img/rinne/clips", o, f"{clip}.webm")
    bak = os.path.join(ROOT, "scripts/rinne/.orig", o, f"{clip}.webm")
    if not os.path.exists(bak):
        os.makedirs(os.path.dirname(bak), exist_ok=True)
        shutil.copy2(path, bak)
    F, fps = decode(bak)
    st = load_still(o, mood, assets)
    W = st.shape[1]
    S = to_pm(st)
    gS = gray(S)
    n = len(F)
    ys = np.arange(H, dtype=np.float32)[:, None]
    # 胯部（腰上下）作为对齐基准
    hip = ((ys > 0.36 * H) & (ys < 0.66 * H) & (st[..., 3] > 200)).astype(np.uint8)
    body = (st[..., 3] > 200).astype(np.uint8)
    # 首帧整体对齐（放大后的视频 → 立绘）
    def up(f):
        s = H / f.shape[0]
        p = to_pm(f.astype(np.float32))
        p = cv2.resize(p, (round(f.shape[1] * s), H), interpolation=cv2.INTER_LANCZOS4)
        c = np.zeros((H, W, 4), np.float32)
        ww = min(W, p.shape[1])
        c[:, :ww] = p[:, :ww]
        return np.clip(c, 0, 255)
    U0 = up(F[0])
    w0 = ecc(gS, gray(U0), np.eye(2, 3, dtype=np.float32), cv2.MOTION_AFFINE, body)
    lock = smooth((ys - (WAIST * H - BAND * H / 2)) / (BAND * H))  # 1 = 锁定为立绘
    frames, masks = [], []
    prev = w0
    warps = []
    for i in range(n):
        w = ecc(gS, gray(up(F[i])), prev, cv2.MOTION_AFFINE, hip)
        # 防止跑飞：和首帧变换差太多就退回上一帧
        if np.abs(w[:, 2] - w0[:, 2]).max() > 40 or np.abs(w[:, :2] - w0[:, :2]).max() > 0.06:
            w = prev
        prev = w
        warps.append(w)
    # 对齐参数在时间上取中值再平滑：单帧对齐误差不会变成一下“抽动”
    Wp = np.stack(warps)
    Wm = np.stack([np.median(Wp[max(0, i - 3): i + 4], 0) for i in range(n)])
    Ws = np.stack([Wm[max(0, i - 2): i + 3].mean(0) for i in range(n)])
    for i in range(n):
        U = up(F[i])
        w = Ws[i].astype(np.float32)
        A = cv2.warpAffine(U, w, (W, H), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_CONSTANT)
        A = np.clip(A, 0, 255)
        # 放大后的抠像边缘会带一圈浅色残留：在 2x 尺寸上再去一次白边
        A = to_pm(edge_clean(from_pm(A)).astype(np.float32))
        # 色差：在稳定像素上拟合每通道 gain/bias（只在两者都不透明处）
        both = (A[..., 3] > 230) & (st[..., 3] > 230)
        d0 = np.abs(cv2.GaussianBlur(A, (0, 0), 2) - cv2.GaussianBlur(S, (0, 0), 2))[..., :3].max(-1)
        sel = both & (d0 < 30)
        if sel.sum() > 500:
            for c in range(3):
                x = A[..., c][sel]; y = S[..., c][sel]
                g, b = np.polyfit(x, y, 1)
                g = float(np.clip(g, 0.85, 1.15)); b = float(np.clip(b, -20, 20))
                A[..., c] = np.clip(A[..., c] * g + b * A[..., 3] / 255, 0, 255)
        D = np.abs(cv2.GaussianBlur(A, (0, 0), 2.5) - cv2.GaussianBlur(S, (0, 0), 2.5))
        d = np.maximum(D[..., :3].max(-1), D[..., 3])
        m = smooth((d - 14) / 22)
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
        frames.append(A); masks.append(m.astype(np.float32))
    # 时间上平滑遮罩（±2 帧取最大再平均），空间上外扩 + 羽化
    M = np.stack(masks)
    Mx = np.stack([M[max(0, i - 2): i + 3].max(0) for i in range(n)])
    out = []
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))
    for i in range(n):
        m = cv2.dilate(Mx[i], k)
        m = cv2.GaussianBlur(m, (0, 0), 7)
        m = np.clip(m * 1.15, 0, 1) * (1 - lock)
        env = smooth(min(i, n - 1 - i) / FADE) if FADE else 1.0
        m = (m * env)[..., None]
        P = frames[i] * m + S * (1 - m)
        f = from_pm(P)
        # 去掉和人物不相连的小碎点（AI 抠像留下的杂点）
        n_, lab, st_, _ = cv2.connectedComponentsWithStats((f[..., 3] > 20).astype(np.uint8), connectivity=8)
        if n_ > 2:
            big = 1 + int(np.argmax(st_[1:, cv2.CC_STAT_AREA]))
            for j in range(1, n_):
                if j != big and st_[j, cv2.CC_STAT_AREA] < 400:
                    f[lab == j] = 0
        out.append(f)
    # 去掉单帧抽搐：某一帧和前后都差很多、而前后两帧彼此很接近，就用前后两帧的平均代替
    for _ in range(2):
        Pm = [to_pm(f.astype(np.float32)) for f in out]
        for i in range(1, n - 1):
            a = np.abs(Pm[i] - Pm[i - 1]).mean(); b = np.abs(Pm[i + 1] - Pm[i]).mean(); c = np.abs(Pm[i + 1] - Pm[i - 1]).mean()
            if min(a, b) > 2.5 and min(a, b) > 1.8 * c:
                Pm[i] = (Pm[i - 1] + Pm[i + 1]) / 2
                out[i] = from_pm(Pm[i])
    if dry:
        return out, fps
    with tempfile.TemporaryDirectory() as td:
        for i, f in enumerate(out):
            cv2.imwrite(os.path.join(td, f"f_{i:04d}.png"), cv2.cvtColor(f, cv2.COLOR_RGBA2BGRA))
        tmp = os.path.join(td, "out.webm")
        subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-framerate", f"{fps:g}", "-i", os.path.join(td, "f_%04d.png"),
                               "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "31", "-row-mt", "1",
                               "-deadline", "good", "-cpu-used", "3", "-auto-alt-ref", "0",
                               "-metadata:s:v:0", "alpha_mode=1", tmp])
        shutil.move(tmp, path)
    print(o, clip, f"{W}x{H}", n, f"{fps:g}fps", os.path.getsize(path), flush=True)


def main():
    assets = json.load(open(os.path.join(ROOT, "lib", "rinne-assets.json")))
    todo = [a.split("/") for a in sys.argv[1:]] or [[o, c] for o in OUTFITS for c in CLIP_MOOD]
    for o, c in todo:
        fix(o, c, assets)


if __name__ == "__main__":
    main()
