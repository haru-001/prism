"""Build every Rinne image the app uses, for all six outfits.

Steps per outfit x mood
  1. stage canvas: person segmented (rembg u2net_human_seg), background evened out to
     #d8d8da (the backdrop around her is corrected toward the stage colour, so no halo),
     everything farther than 28px from her flattened to #d8d8da.
  2. one canvas per mood, shared by all outfits: same aspect ratio and the same link
     anchor, so changing outfit never moves the layout. The confirmed suit stage images
     and the anchors from the confirmed design define the canvas; other outfits are
     scaled to the same body height and shifted so their hand/prop sits on the anchor.
  3. exports (WebP): stage 1x/2x (h 440 / 880), mini 1x/2x (h 150 / 300),
     avatar 1x/2x (64 / 128), wardrobe thumb 1x/2x (120x160 / 240x320).
     File names carry an 8-char content hash. A manifest (JSON) lists them.

Usage: python3 build_rinne.py OUT_PUBLIC_DIR MANIFEST_JSON [--outfits suit,gown,...]
"""
import hashlib
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.environ.get('RINNE_SRC', '/home/sprite/prism_img')  # 原图目录（prism_img）
STAGE = (0xD8, 0xD8, 0xDA)
MOODS = ['welcome', 'guide', 'thinking', 'success', 'error', 'imaging', 'waiting']
OUTFITS = ['suit', 'gown', 'summer', 'home', 'trench', 'qipao']
# confirmed design: per mood aspect ratio and link anchor of the suit stage image
SUIT = {
    'welcome': (0.3846, 0.1386, 0.2395),
    'guide': (0.4751, 0.0626, 0.2441),
    'thinking': (0.3511, 0.1421, 0.3082),
    'success': (0.3601, 0.1189, 0.2920),
    'error': (0.3505, 0.0848, 0.2133),
    'imaging': (0.3319, 0.0895, 0.3362),
    'waiting': (0.3599, 0.0998, 0.3257),
}
RING = 28
MARGIN = 26  # min px between body and canvas edge (canvas px, canvas height 1144)
CH = 1144
SIZES = {'stage': (440, 880), 'mini': (150, 300)}
AVATAR = (64, 128)
THUMB = ((120, 160), (240, 320))

_sess = None


def seg(im):
    global _sess
    from rembg import new_session, remove
    if _sess is None:
        _sess = new_session('u2net_human_seg')
    soft = np.asarray(remove(im, session=_sess, only_mask=True)).astype(np.float32) / 255
    m = soft > 0.43
    lab, n = ndimage.label(m)
    if n > 1:
        sizes = ndimage.sum(m, lab, range(1, n + 1))
        keep = [i + 1 for i, s in enumerate(sizes) if s >= max(sizes) * 0.04]
        m = np.isin(lab, keep)
    m = ndimage.binary_fill_holes(m)
    soft = np.where(ndimage.binary_dilation(m, iterations=3), soft, 0)
    return m, soft


def even_background(im, m, soft):
    """shift the backdrop toward the stage colour; leave the person's pixels alone"""
    a = np.asarray(im).astype(np.float32)
    bgmask = ~ndimage.binary_dilation(m, iterations=40)
    w = bgmask.astype(np.float32)
    field = np.zeros_like(a)
    ws = cv2.GaussianBlur(w, (0, 0), 40)
    for c in range(3):
        field[..., c] = cv2.GaussianBlur(a[..., c] * w, (0, 0), 40) / np.maximum(ws, 1e-3)
    corr = np.array(STAGE, np.float32) - field
    person = cv2.GaussianBlur(np.maximum(soft, m.astype(np.float32) * 0.0), (0, 0), 1.5)
    out = a + corr * (1 - person)[..., None]
    keep = ndimage.binary_dilation(m, iterations=RING).astype(np.float32)
    keep = cv2.GaussianBlur(keep, (0, 0), 6)[..., None]
    out = out * keep + np.array(STAGE, np.float32) * (1 - keep)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def extremity(m, y_center, half):
    """outermost point on the image-left side within +-half rows of y_center (the hand / prop)"""
    rows = [y for y in range(max(0, int(y_center - half)), min(m.shape[0], int(y_center + half))) if m[y].any()]
    lx = {y: np.where(m[y])[0].min() for y in rows}
    x0 = min(lx.values())
    near = [y for y in rows if lx[y] <= x0 + 6]
    return int(x0), int(np.median(near))


def wire_clear(m, Ax, Ay, gap=9):
    """True when no body pixel sits left of the wire end on the wire's rows"""
    for y in range(int(Ay) - 3, int(Ay) + 4):
        if 0 <= y < m.shape[0] and m[y].any() and np.where(m[y])[0].min() < Ax - gap + 1:
            return False
    return True


def suit_canvas(mood):
    """suit stage image (confirmed) and its mask"""
    im = Image.open(os.path.join(ROOT, 'stage', f'suit_{mood}_stage.jpg')).convert('RGB')
    m, _ = seg(im)
    return im, m


def place(src_im, src_m, s, tx, ty, W, H):
    """scale by s and move by (tx, ty) into a W x H stage-coloured canvas"""
    M = np.array([[s, 0, tx], [0, s, ty]], np.float32)
    a = cv2.warpAffine(np.asarray(src_im), M, (W, H), flags=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC,
                       borderMode=cv2.BORDER_CONSTANT, borderValue=STAGE)
    mm = cv2.warpAffine(src_m.astype(np.uint8) * 255, M, (W, H), flags=cv2.INTER_LINEAR) > 127
    return Image.fromarray(a), mm


def build_mood(mood, outfits, log):
    ar, hx, hy = SUIT[mood]
    sim, sm = suit_canvas(mood)
    sw, sh = sim.size
    ys, xs = np.where(sm)
    s_top, s_bot = ys.min(), ys.max()
    s_ph = s_bot - s_top
    Ax, Ay = hx * sw, hy * sh
    rel = (Ay - s_top) / s_ph  # anchor height as a fraction of the body height
    half = 0.07 * s_ph
    # the suit's body edge on the wire's rows: every outfit puts its hand / prop edge here
    Ls = min(np.where(sm[y])[0].min() for y in range(int(Ay) - 3, int(Ay) + 4) if sm[y].any())
    items = {'suit': (sim, sm, 1.0, 0.0, 0.0, Ls, Ay)}
    for o in outfits:
        if o == 'suit':
            continue
        p = os.path.join(ROOT, 'wardrobe_src', f'{o}_{mood}.jpg')
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert('RGB')
        m, soft = seg(im)
        ev = even_background(im, m, soft)
        ys, xs = np.where(m)
        top, bot, left, right = ys.min(), ys.max(), xs.min(), xs.max()
        ph = bot - top
        s = s_ph / ph
        ty = s_top - s * top  # natural placement: same body height and head line as the suit
        # rows of the hand / prop on the image-left side, near the wire's row
        yA = (Ay - ty) / s
        ex, ey = extremity(m, yA, 0.07 * ph)
        rows = [y for y in range(int(ey - 0.08 * ph), int(ey + 0.08 * ph)) if 0 <= y < m.shape[0] and m[y].any()
                and np.where(m[y])[0].min() <= ex + 12]
        lo, hi = min(rows) + 5, max(rows) - 5
        if not (lo <= yA <= hi):
            target = min(max(yA, lo), hi) if lo <= hi else ey
            ty = Ay - s * target  # move her so the wire lands on the hand / prop
            yA = target
            lim_top = (Ay - MARGIN) / max(1, yA - top)
            lim_bot = (sh - MARGIN - Ay) / max(1, bot - yA)
            if min(lim_top, lim_bot) < s:
                if min(lim_top, lim_bot) >= 0.95 * s:
                    s = min(lim_top, lim_bot)
                    ty = Ay - s * yA
                else:
                    # moving her would shrink her too much: keep the natural placement, the wire
                    # then meets the edge of her arm / body on that row
                    s = s_ph / ph
                    ty = s_top - s * top
                    yA = (Ay - ty) / s
                    log.append(f'{o}/{mood}: wire meets body edge, not the prop')
        lx = min(np.where(m[y])[0].min() for y in range(int(yA) - 3, int(yA) + 4) if m[y].any())
        tx = Ls - s * lx
        ax, ay = lx, yA
        items[o] = (ev, m, s, tx, ty, ax, ay)
        log.append(f'{o}/{mood}: body {ph}px scale {s:.3f} shown {s*ph:.0f}px top {s*top+ty:.0f} wire row src {ay:.0f}')
    # canvas width: wide enough for every outfit (pad left if something reaches past it)
    pad_l, need_r = 0.0, sw
    for o, (im, m, s, tx, ty, ax, ay) in items.items():
        ys, xs = np.where(m)
        l = s * xs.min() + tx
        r = s * xs.max() + tx
        if o == 'suit':
            l, r = xs.min(), xs.max()
            pad_l = max(pad_l, 0)
        else:
            pad_l = max(pad_l, MARGIN - l)
        need_r = max(need_r, r + MARGIN)
    pad_l = int(np.ceil(max(0, pad_l)))
    W = int(np.ceil(need_r + pad_l))
    H = sh
    out = {}
    for o, (im, m, s, tx, ty, ax, ay) in items.items():
        if o == 'suit':
            canvas, cm = place(im, m, 1.0, pad_l, 0, W, H)
        else:
            canvas, cm = place(im, m, s, tx + pad_l, ty, W, H)
        out[o] = (canvas, cm)
    meta = {'ar': round(W / H, 4), 'hx': round((Ax + pad_l) / W, 4), 'hy': round(Ay / H, 4)}
    for o, (canvas, cm) in out.items():
        if not wire_clear(cm, Ax + pad_l, Ay):
            log.append(f'WIRE BLOCKED {o}/{mood}')
    return out, meta


def face_box(im, m):
    g = cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2GRAY)
    ys, xs = np.where(m)
    top, ph = ys.min(), ys.max() - ys.min()
    region = g[top: top + int(ph * 0.22)]
    cas = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    faces = cas.detectMultiScale(region, 1.08, 5, minSize=(int(ph * 0.05), int(ph * 0.05)))
    if len(faces):
        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        cx, cy, side = x + w / 2, top + y + h / 2, w * 2.0
        found = True
    else:
        band = m[top: top + int(ph * 0.1)]
        cols = np.where(band.any(axis=0))[0]
        cx, cy, side = cols.mean(), top + ph * 0.075, ph * 0.17
        found = False
    return cx, cy, side, found


def save_webp(img, path, q):
    img.save(path, 'WEBP', quality=q, method=6)


def hashed(out_dir, rel_noext, img, q):
    tmp = os.path.join(out_dir, rel_noext + '.tmp.webp')
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    save_webp(img, tmp, q)
    h = hashlib.sha256(open(tmp, 'rb').read()).hexdigest()[:8]
    final = os.path.join(out_dir, f'{rel_noext}.{h}.webp')
    os.replace(tmp, final)
    return '/img/' + os.path.relpath(final, os.path.dirname(out_dir)).replace(os.sep, '/'), os.path.getsize(final)


def resize_h(img, h):
    w = max(1, round(img.width * h / img.height))
    return img.resize((w, h), Image.LANCZOS)


def main():
    out_dir = sys.argv[1]  # .../public/img
    manifest_path = sys.argv[2]
    outfits = OUTFITS
    if '--outfits' in sys.argv:
        outfits = sys.argv[sys.argv.index('--outfits') + 1].split(',')
    rinne_dir = os.path.join(out_dir, 'rinne')
    os.makedirs(rinne_dir, exist_ok=True)
    for root, _, files in os.walk(rinne_dir):
        for f in files:
            os.remove(os.path.join(root, f))
    preview_dir = os.path.join(ROOT, 'rinne_build_preview')
    os.makedirs(preview_dir, exist_ok=True)
    manifest = {'moods': {}, 'outfits': {o: {'moods': {}} for o in outfits}, 'bytes': {}}
    log = []
    total = {'stage1x': 0, 'stage2x': 0, 'mini': 0, 'avatar': 0, 'thumb': 0}
    for mood in MOODS:
        canv, meta = build_mood(mood, outfits, log)
        manifest['moods'][mood] = meta
        for o, (img, cm) in canv.items():
            img.save(os.path.join(preview_dir, f'{o}_{mood}.jpg'), quality=90)
            e = {}
            u1, b1 = hashed(rinne_dir, f'{o}/{mood}', resize_h(img, SIZES['stage'][0]), 84)
            u2, b2 = hashed(rinne_dir, f'{o}/{mood}-2x', resize_h(img, SIZES['stage'][1]), 82)
            e['stage'] = [u1, u2]
            total['stage1x'] += b1
            total['stage2x'] += b2
            m1, c1 = hashed(rinne_dir, f'{o}/{mood}-sm', resize_h(img, SIZES['mini'][0]), 86)
            m2, c2 = hashed(rinne_dir, f'{o}/{mood}-sm-2x', resize_h(img, SIZES['mini'][1]), 84)
            e['mini'] = [m1, m2]
            total['mini'] += c1 + c2
            cx, cy, side, found = face_box(img, cm)
            box = (int(cx - side / 2), int(cy - side * 0.45), int(cx + side / 2), int(cy + side * 0.55))
            av = img.crop(box)
            a1, d1 = hashed(rinne_dir, f'{o}/{mood}-avatar', av.resize(AVATAR[0:1] * 2, Image.LANCZOS), 86)
            a2, d2 = hashed(rinne_dir, f'{o}/{mood}-avatar-2x', av.resize(AVATAR[1:2] * 2, Image.LANCZOS), 86)
            e['avatar'] = [a1, a2]
            total['avatar'] += d1 + d2
            if not found:
                log.append(f'{o}/{mood}: no face detected, avatar from head band')
            manifest['outfits'][o]['moods'][mood] = e
            if mood == 'welcome':
                # wardrobe thumbnail: whole figure, 3:4, centred on the body
                ys, xs = np.where(cm)
                cxm = (xs.min() + xs.max()) / 2
                Ht = img.height
                Wt = Ht * 3 / 4
                th = Image.new('RGB', (int(Wt), Ht), STAGE)
                th.paste(img, (int(Wt / 2 - cxm), 0))
                t1, f1 = hashed(rinne_dir, f'wardrobe/{o}', th.resize(THUMB[0], Image.LANCZOS), 80)
                t2, f2 = hashed(rinne_dir, f'wardrobe/{o}-2x', th.resize(THUMB[1], Image.LANCZOS), 78)
                manifest['outfits'][o]['thumb'] = [t1, t2]
                total['thumb'] += f1 + f2
    manifest['bytes'] = total
    json.dump(manifest, open(manifest_path, 'w'), indent=1, ensure_ascii=False)
    print('\n'.join(log))
    print(json.dumps(manifest['moods'], indent=0))
    print(total, sum(total.values()))


if __name__ == '__main__':
    main()
