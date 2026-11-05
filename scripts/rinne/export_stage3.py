"""Export the stage3 set (8 outfits x 7 moods, each image its own pose, canvas and link anchor)
to public/img/rinne/ and lib/rinne-assets.json.

Input: prism_img/stage3/{outfit}_{mood}_stage.jpg + stage3/meta.json (made by build_stage3.py),
       (the suit set too, built from prism_img/suit_{mood}.jpg with the confirmed link anchors).
All canvases are 1144 px high with the standing body at the same size (head top ~y31, feet ~y1112),
so every file of one size tier shows the same body height.

One pipeline for every image (same sizes, same resampling, same codec settings):
  - stage   430 / 860 px high (largest display is 430 px)  WebP q80 + AVIF q55
  - mini    100 / 250 px high (toast 96 / 84, banner 84 / 64)  WebP q80 + AVIF q55
  - avatar  64 / 128 px                                    WebP q80
  - thumb   120x160 / 240x320 (wardrobe, welcome pose)       WebP q80
  Resampling is Lanczos from the 1144 px canvas. No EXIF / ICC / XMP is written.
  Sharpness is evened out: the face's Laplacian variance (face crop scaled to 128 px, measured on
  the encoded 860 px WebP, same as the check script) must land in [SHARP_TARGET, SOFT_CAP].
  Images below get the smallest unsharp mask (same radius for all, strength in steps) that reaches
  the floor; images above get the smallest Gaussian softening that brings them under the cap.
  Both filters act only inside the face (feathered ellipse, at least 4 px inside the silhouette):
  the outline against the stage (hair, face edge, hands, clothes) is never sharpened or blurred,
  so there is no white halo and no soft edge.
  The filter is applied to the 1144 px canvas before resizing, so every tier of that image gets it.
  Floor shadows cut by the canvas edge are faded out over the last 40 px so they do not end in a line.
File names carry an 8-char content hash, so they can be cached forever.

Usage: python3 scripts/rinne/export_stage3.py /home/sprite/prism_img public/img lib/rinne-assets.json
"""
import hashlib
import io
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import cv2
import numpy as np
from PIL import Image, ImageFilter

MOODS = ['welcome', 'guide', 'thinking', 'success', 'error', 'imaging', 'waiting']
OUTFITS = ['suit', 'gown', 'summer', 'home', 'trench', 'qipao', 'bridal', 'sport']
STAGE = np.array([0xD8, 0xD8, 0xDA])
CANVAS_H = 1144
STAGE_H = (430, 860)
MINI_H = (100, 250)
AVATAR = (64, 128)
THUMB = ((120, 160), (240, 320))
WEBP_Q = 80
AVIF_Q = 55
SHARP_TARGET = 200
SOFT_CAP = 300
SHARP_RADIUS = 1.4
SHARP_STEPS = [15, 30, 45, 60, 75, 90, 110, 130, 150, 175, 200, 230, 260]
SOFT_STEPS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 1.0, 1.2, 1.4]


def clean(img):
    """A fresh RGB image with no metadata attached."""
    out = Image.frombytes('RGB', img.size, img.convert('RGB').tobytes())
    return out


def encode(img, fmt):
    b = io.BytesIO()
    if fmt == 'webp':
        clean(img).save(b, 'WEBP', quality=WEBP_Q, method=6, exif=b'', icc_profile=None)
    else:
        clean(img).save(b, 'AVIF', quality=AVIF_Q, speed=4, subsampling='4:2:0')
    return b.getvalue()


def write(out_dir, rel, data, ext):
    h = hashlib.sha256(data).hexdigest()[:8]
    p = os.path.join(out_dir, f'{rel}.{h}.{ext}')
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'wb') as f:
        f.write(data)
    return h, len(data)


def rh(img, h):
    return img.resize((max(1, round(img.width * h / img.height)), h), Image.LANCZOS)


def mask(img):
    a = np.asarray(img).astype(int)
    m = np.abs(a - STAGE).sum(axis=2) > 24
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)) > 0
    return m


_cas = None


def detect_face(g, top, ph, min_size):
    global _cas
    if _cas is None:
        d = cv2.data.haarcascades
        _cas = [cv2.CascadeClassifier(d + n) for n in ('haarcascade_frontalface_default.xml',
                                                       'haarcascade_frontalface_alt2.xml', 'haarcascade_profileface.xml')]
    reg = g[top: top + int(ph * 0.4)]
    best = None
    for c in _cas:
        for flip in (False, True):
            r = cv2.flip(reg, 1) if flip else reg
            for (x, y, w, h) in c.detectMultiScale(r, 1.05, 4, minSize=(min_size, min_size)):
                if flip:
                    x = reg.shape[1] - x - w
                if best is None or w * h > best[2] * best[3]:
                    best = (int(x), int(y + top), int(w), int(h))
    return best


def face_box(img, m):
    g = cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2GRAY)
    ys, xs = np.where(m)
    top, ph = ys.min(), ys.max() - ys.min()
    best = detect_face(g, top, ph, 40)
    if best:
        x, y, w, h = best
        return x + w / 2, y + h / 2, w * 2.0, True, best
    band = m[top: top + int(ph * 0.1)]
    cols = np.where(band.any(axis=0))[0]
    return cols.mean(), top + ph * 0.075, ph * 0.17, False, None


def face_lap(img, box):
    """Laplacian variance of the face crop scaled to 128x128 (box in the coordinates of img)."""
    x, y, w, h = box
    g = cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2GRAY)
    crop = g[max(0, y): y + h, max(0, x): x + w]
    crop = cv2.resize(crop, (128, 128), interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(crop, cv2.CV_64F).var())


def face_weight(img, box, kind='sharp'):
    """Where the sharpen / soften filter may act: an ellipse inside the face (box in img coordinates),
    feathered, and never closer than 4 px to the silhouette. The outline of face, hair, hands and
    clothes against the stage is never filtered, so no white halo / glow and no blurred edges."""
    H, W = img.height, img.width
    w = np.zeros((H, W), np.float32)
    if box is None:
        return w
    x, y, bw, bh = box
    # 锐化只在脸的内部（五官），柔化可以盖住整张脸（模糊不会产生白边），两者都不碰轮廓
    rx, ry = (0.36, 0.40) if kind == 'sharp' else (0.52, 0.56)
    cv2.ellipse(w, (int(x + bw / 2), int(y + bh * 0.52)), (int(bw * rx), int(bh * ry)), 0, 0, 360, 1.0, -1)
    w = cv2.GaussianBlur(w, (0, 0), max(2.0, bw * 0.04))
    inner = cv2.erode(mask(img).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(np.float32)
    return np.clip(w * inner, 0, 1)


def filtered(img, f, box=None):
    """box: face box in img coordinates. The filter is blended in only through face_weight."""
    kind, v = f
    if kind == 'none':
        return img
    if kind == 'sharp':
        g = img.filter(ImageFilter.UnsharpMask(radius=SHARP_RADIUS, percent=v, threshold=2))
    elif kind == 'soft':
        g = img.filter(ImageFilter.GaussianBlur(v))
    else:
        return img
    wgt = face_weight(img, box, kind)[..., None]
    a, b = np.asarray(img).astype(np.float32), np.asarray(g).astype(np.float32)
    return Image.fromarray((a * (1 - wgt) + b * wgt).round().astype(np.uint8))
    return img


def lap_860(img, box):
    """Face Laplacian variance on the 860 px tier after WebP encoding (what the browser shows).
    box is in 860-tier coordinates."""
    b = encode(rh(img, STAGE_H[1]), 'webp')
    return face_lap(Image.open(io.BytesIO(b)).convert('RGB'), box)


def fade_edge_shadow(img):
    """Grey floor shadow that runs into the left / right canvas edge: blend it into the stage colour
    over the last 40 px. Only neutral grey pixels in the bottom 12 % are touched."""
    a = np.asarray(img).astype(np.float32)
    H, W = a.shape[:2]
    y0 = int(H * 0.88)
    reg = a[y0:]
    neutral = (reg.max(axis=2) - reg.min(axis=2) < 12) & (reg.mean(axis=2) > 140) & (reg.mean(axis=2) < 214)
    xs = np.arange(W)
    dist = np.minimum(xs, W - 1 - xs).astype(np.float32)
    w = np.clip(1 - dist / 40, 0, 1)[None, :] * neutral
    w = w * ~cv2.dilate(mask(img).astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)[y0:]  # 只动人物外面
    if not w.any():
        return img
    reg += (STAGE[None, None, :] - reg) * w[..., None]
    a[y0:] = reg
    return Image.fromarray(a.round().astype(np.uint8))


def pad_crop(img, box):
    x0, y0, x1, y1 = [int(v) for v in box]
    out = Image.new('RGB', (x1 - x0, y1 - y0), tuple(int(v) for v in STAGE))
    out.paste(img, (-x0, -y0))
    return out


def load(src_root, o, mo):
    # 八套（含职业装）现在都由 build_stage3.py 用同一条流程出到 stage3/
    p = os.path.join(src_root, 'stage3', f'{o}_{mo}_stage.jpg')
    img = clean(Image.open(p))
    if img.height != CANVAS_H:  # suit canvases are 1142..1145: pad / crop the bottom to 1144
        c = Image.new('RGB', (img.width, CANVAS_H), tuple(int(v) for v in STAGE))
        c.paste(img, (0, 0))
        img = c
    return img


def job(args):
    src_root, rinne, o, mo = args
    img = fade_edge_shadow(load(src_root, o, mo))
    m = mask(img)
    cx, cy, side, found, fbox = face_box(img, m)
    # sharpness: face box found on the 860 px tier (same detector settings as the check script)
    flt, lap0, lap1 = ('none', 0), None, None
    t = rh(img, STAGE_H[1])
    mt = mask(t)
    ys, _ = np.where(mt)
    b = detect_face(cv2.cvtColor(np.asarray(t), cv2.COLOR_RGB2GRAY), ys.min(), ys.max() - ys.min(), 32)
    kk = img.height / t.height
    bfull = tuple(v * kk for v in b) if b else None
    if b:
        lap0 = lap1 = lap_860(img, b)
        if lap0 < SHARP_TARGET:
            for p in SHARP_STEPS:
                flt, lap1 = ('sharp', p), lap_860(filtered(img, ('sharp', p), bfull), b)
                if lap1 >= SHARP_TARGET:
                    break
        elif lap0 > SOFT_CAP:
            for r in SOFT_STEPS:
                flt, lap1 = ('soft', r), lap_860(filtered(img, ('soft', r), bfull), b)
                if lap1 <= SOFT_CAP:
                    break
    src = filtered(img, flt, bfull)
    # 头部中心：优先用 860 档上找到的脸框（和核对脚本同一个），找不到再用整图上的脸框 / 头顶那一段
    bx = (b[0] + b[2] / 2) / t.width if b else cx / img.width
    res = {'o': o, 'mo': mo, 'ar': round(img.width / img.height, 4), 'bx': round(bx, 4), 'f': [], 'a': [], 'bytes': {},
           'filter': list(flt), 'lap_before': lap0, 'lap_after': lap1, 'face': found, 'face_box_860': list(b) if b else None}
    tot = res['bytes']

    def add(key, n):
        tot[key] = tot.get(key, 0) + n

    for tier, hs, suf in (('stage', STAGE_H, ''), ('mini', MINI_H, '-sm')):
        for i, h in enumerate(hs):
            im = rh(src, h)
            rel = f'{o}/{mo}{suf}{"-2x" if i else ""}'
            hh, n = write(rinne, rel, encode(im, 'webp'), 'webp')
            res['f'].append(hh)
            add(f'{tier}_webp', n)
            ha, na = write(rinne, rel, encode(im, 'avif'), 'avif')
            res['a'].append(ha)
            add(f'{tier}_avif', na)
    av = pad_crop(src, (cx - side / 2, cy - side * 0.45, cx + side / 2, cy + side * 0.55))
    for i, s in enumerate(AVATAR):
        hh, n = write(rinne, f'{o}/{mo}-avatar{"-2x" if i else ""}', encode(av.resize((s, s), Image.LANCZOS), 'webp'), 'webp')
        res['f'].append(hh)
        add('avatar', n)
    if mo == 'welcome':
        ys, xs = np.where(m)
        cxm = (xs.min() + xs.max()) / 2
        # 3:4 缩略图：宽度至少容下整个人物（含道具）加两边余白，不够宽就整体加高，不裁人物
        Wt = max(img.height * 3 / 4, (xs.max() - xs.min()) + 2 * 40)
        Ht = Wt * 4 / 3
        th = pad_crop(src, (cxm - Wt / 2, img.height - Ht, cxm + Wt / 2, img.height))
        res['thumb'] = []
        for i, sz in enumerate(THUMB):
            hh, n = write(rinne, f'wardrobe/{o}{"-2x" if i else ""}', encode(th.resize(sz, Image.LANCZOS), 'webp'), 'webp')
            res['thumb'].append(hh)
            add('thumb', n)
    return res


def main():
    src_root, out_img, manifest_path = sys.argv[1:4]
    meta = json.load(open(os.path.join(src_root, 'stage3', 'meta.json')))
    rinne = os.path.join(out_img, 'rinne')
    for root, _, files in os.walk(rinne):
        for f in files:
            os.remove(os.path.join(root, f))
    jobs = [(src_root, rinne, o, mo) for o in OUTFITS for mo in MOODS]
    with ProcessPoolExecutor(min(8, os.cpu_count() or 2)) as ex:
        results = list(ex.map(job, jobs))
    man = {'tiers': {'stage': list(STAGE_H), 'mini': list(MINI_H), 'avatar': list(AVATAR), 'thumb': [list(t) for t in THUMB],
                     'webp_q': WEBP_Q, 'avif_q': AVIF_Q},
           'outfits': {o: {} for o in OUTFITS}, 'bytes': {}}
    tot = {}
    log = []
    for r in results:
        o, mo = r['o'], r['mo']
        e = meta[o][mo]
        # bx：头部中心的横向位置（占图宽的比例），舞台用它让换装时头部不左右跳
        man['outfits'][o][mo] = {'ar': r['ar'], 'hx': e['hx'], 'hy': e['hy'], 'bx': r['bx'], 'f': r['f'], 'a': r['a']}
        if 'thumb' in r:
            man['outfits'][o]['thumb'] = r['thumb']
        for k, v in r['bytes'].items():
            tot[k] = tot.get(k, 0) + v
        if not r['face']:
            log.append(f'{o}/{mo}: no face found, avatar from the head band, sharpness not measured')
        elif r['filter'][0] != 'none':
            log.append(f'{o}/{mo}: {r["filter"][0]} {r["filter"][1]}  face lap {r["lap_before"]:.0f} -> {r["lap_after"]:.0f}')
    man['bytes'] = tot
    json.dump(man, open(manifest_path, 'w'), indent=1, ensure_ascii=False)
    json.dump(results, open(os.path.join(src_root, 'stage3', 'export_report.json'), 'w'), indent=1)
    print('\n'.join(log))
    print(tot, sum(tot.values()))


if __name__ == '__main__':
    main()
