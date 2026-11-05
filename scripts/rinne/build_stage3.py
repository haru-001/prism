"""Stage canvases for the re-posed outfits (stage3): every outfit x mood gets its own pose,
so every image has its own canvas width and link anchor.

Per image (src: stage3/src/{outfit}_{mood}.jpg, 896x1200 light-gray studio shot)
  1. segment the person + held props (rembg u2net_human_seg), even the backdrop out to #d8d8da
     (person pixels untouched, everything 28px+ away from her flattened), same as build_rinne.py
  2. scale: every canvas is CH=1144 high and the body is shown at the same size as the confirmed
     suit set. Standing poses: body height -> 1081px (the suit's). Seated poses (and poses with a
     prop above the head): scaled by face size instead, calibrated on the same outfit's standing
     shots, so her head and body keep one size when she sits down. Feet / seat on one baseline
     (y = 1112), 32px floor margin like the suit set.
  3. canvas width = figure width + 34px each side (each image its own aspect ratio)
  4. link anchor: the hand (skin blob, face excluded) farthest to the image-left in the upper body;
     the anchor is the outermost body/prop pixel on those rows, so the wire coming from the left
     never crosses her.

Usage: python3 build_stage3.py   (writes stage3/{outfit}_{mood}_stage.jpg and stage3/meta.json)
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_rinne import seg, STAGE  # noqa: E402
from subject import subject, even_background2  # noqa: E402

ROOT = os.environ.get('RINNE_SRC', '/home/sprite/prism_img')  # 原图目录（prism_img）
S3 = os.path.join(ROOT, 'stage3')
MOODS = ['welcome', 'guide', 'thinking', 'success', 'error', 'imaging', 'waiting']
OUTFITS = ['suit', 'gown', 'summer', 'home', 'trench', 'qipao', 'bridal', 'sport']
CH = 1144
TARGET_PH = 1081
BASE = 1112
SIDE = 48     # 左右余白（1144 高画布里的像素）
TOPMIN = 28   # 头顶 / 举起的道具到画布上边至少留这么多
BOTMIN = 18   # 道具 / 家具到画布下边至少留这么多（脚底基线仍是 BASE）
EDGE_FADE = 40
# poses scaled by face size (sitting, or a prop reaching above the head)
FACE_SCALED = {'home_welcome', 'home_thinking', 'home_success', 'home_error', 'home_imaging',
               'qipao_thinking', 'trench_waiting', 'summer_waiting', 'sport_waiting', 'sport_success'}
# 抛在空中、和她不相连的道具（婚纱「完成」的捧花）：按身高缩放时会超出画布上边，就把它在原图里
# 往下挪到画布里（只挪这块道具的像素，人物不动），不再为了它把整个人缩小
AIRBORNE = {'bridal_success'}
# 职业装确认过的连接点（原图像素，从旧舞台图换算回来）
SUIT_ANCHOR = {'welcome': (285.0, 330.8), 'guide': (154.0, 335.8), 'thinking': (318.0, 411.4),
               'success': (318.0, 390.5), 'error': (281.0, 300.0), 'imaging': (318.0, 440.9),
               'waiting': (303.0, 429.6)}
SEATED = {'home_welcome', 'home_thinking', 'home_success', 'home_error', 'home_imaging', 'qipao_thinking',
          'summer_waiting', 'sport_waiting'}
# suit set (confirmed, unchanged): ar, hx, hy of stage/suit_{mood}_stage.jpg
SUIT = {
    'welcome': (0.3846, 0.1386, 0.2395), 'guide': (0.4751, 0.0626, 0.2441),
    'thinking': (0.3511, 0.1421, 0.3082), 'success': (0.3601, 0.1189, 0.2920),
    'error': (0.3505, 0.0848, 0.2133), 'imaging': (0.3319, 0.0895, 0.3362),
    'waiting': (0.3599, 0.0998, 0.3257),
}

_cas = None


def face(im, m):
    """largest face (frontal / alt2 / profile, both directions) in the top 35% of the figure"""
    global _cas
    if _cas is None:
        d = cv2.data.haarcascades
        _cas = [cv2.CascadeClassifier(d + n) for n in
                ('haarcascade_frontalface_default.xml', 'haarcascade_frontalface_alt2.xml', 'haarcascade_profileface.xml')]
    g = cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2GRAY)
    ys, xs = np.where(m)
    top, ph = ys.min(), ys.max() - ys.min()
    reg = g[top: top + int(ph * 0.35)]
    W = reg.shape[1]
    best = None
    for c in _cas:
        for flip in (False, True):
            r = cv2.flip(reg, 1) if flip else reg
            for (x, y, w, h) in c.detectMultiScale(r, 1.05, 4, minSize=(40, 40)):
                if flip:
                    x = W - x - w
                if best is None or w * h > best[2] * best[3]:
                    best = (int(x), int(y + top), int(w), int(h))
    return best


def skin(a):
    ycc = cv2.cvtColor(a, cv2.COLOR_RGB2YCrCb)
    y, cr, cb = ycc[..., 0], ycc[..., 1], ycc[..., 2]
    return (cr > 136) & (cr < 175) & (cb > 85) & (cb < 128) & (y > 70)


def anchor(a, m, fbox, full=None):
    """(x, y, how) in source pixels. rows from her leftmost hand (person mask m); the x end is the
    leftmost point of the whole subject in those rows (her hand or the prop in it), so the wire
    never runs into a prop"""
    ys, xs = np.where(m)
    top, bot = ys.min(), ys.max()
    ph = bot - top
    sk = skin(a) & ndimage.binary_erosion(m, iterations=2)
    if fbox:
        x, y, w, h = fbox
        # face, plus neck below it
        sk[max(0, y - h // 2): y + int(h * 1.9), max(0, x - w // 3): x + w + w // 3] = False
    else:
        sk[top: top + int(ph * 0.17)] = False
    sk[int(top + ph * 0.78):] = False  # feet / ankles
    sk = ndimage.binary_opening(sk, iterations=2)
    lab, n = ndimage.label(sk)
    blobs = []
    for i in range(1, n + 1):
        yy, xx = np.where(lab == i)
        if len(yy) < 250:
            continue
        blobs.append((xx.min(), yy.min(), yy.max(), len(yy), xx.mean(), yy.mean()))
    how = 'hand'
    if blobs:
        b = min(blobs, key=lambda t: t[4])  # leftmost hand by centre
        y0, y1 = b[1], b[2]
    else:
        how = 'band'
        y0, y1 = int(top + ph * 0.15), int(top + ph * 0.45)
    mm = m if full is None else full
    rows = [y for y in range(y0, y1 + 1) if mm[y].any()]
    lx = {y: np.where(mm[y])[0].min() for y in rows}
    x0 = min(lx.values())
    near = [y for y in rows if lx[y] <= x0 + 6]
    return int(x0), int(np.median(near)), how


def move_airborne(im, m, soft, mh, target_ph):
    """move subject parts that are not connected to her and stick out above the canvas down (and, if they
    would then touch her, sideways) so that they fit under TOPMIN at the standard body scale"""
    a = np.asarray(im).astype(np.float32)
    hys, _ = np.where(mh)
    htop, hbot = hys.min(), hys.max()
    s = target_ph / (hbot - htop)
    limit = hbot - (BASE - TOPMIN) / s  # source y that lands on TOPMIN
    lab, n = ndimage.label(m)
    mains = set(np.unique(lab[mh]).tolist()) - {0}
    air = np.zeros_like(m)
    for i in range(1, n + 1):
        if i not in mains:
            yy, _x = np.where(lab == i)
            if yy.min() < limit:
                air |= lab == i
    if not air.any():
        return im, m, soft, None
    ays, axs = np.where(air)
    dy = int(np.ceil(limit - ays.min())) + 4
    body = ndimage.binary_dilation(mh | (m & ~air), iterations=14)
    best = None
    for dx in [0] + [d for k in range(10, 400, 10) for d in (-k, k)]:
        sh = np.zeros_like(air)
        ys2, xs2 = ays + dy, axs + dx
        if xs2.min() < 0 or xs2.max() >= m.shape[1] or ys2.max() >= m.shape[0]:
            continue
        sh[ys2, xs2] = True
        if not (sh & body).any():
            best = dx
            break
    if best is None:
        return im, m, soft, None
    dx = best
    from subject import backdrop_field
    field = backdrop_field(a, ndimage.binary_dilation(m, iterations=40))
    region = ndimage.binary_dilation(air, iterations=6)
    alpha = np.clip(cv2.GaussianBlur(air.astype(np.float32), (0, 0), 1.0) * 1.0, 0, 1)
    alpha[air] = 1
    out = a.copy()
    out[region] = field[region]  # take it away
    M = np.float32([[1, 0, dx], [0, 1, dy]])
    H, W = m.shape
    pa = cv2.warpAffine(a, M, (W, H), borderMode=cv2.BORDER_REPLICATE)
    al = cv2.warpAffine(alpha * region, M, (W, H))
    out = out * (1 - al[..., None]) + pa * al[..., None]  # and put it back lower
    air2 = cv2.warpAffine(air.astype(np.uint8), M, (W, H)) > 0
    m2 = (m & ~air) | air2
    soft2 = np.where(air, 0, soft)
    soft2 = np.maximum(soft2, air2.astype(np.float32))
    return Image.fromarray(np.clip(out, 0, 255).round().astype(np.uint8)), m2, soft2, [int(dx), int(dy)]


def src_path(o, mood):
    return os.path.join(ROOT, f'suit_{mood}.jpg') if o == 'suit' else os.path.join(S3, 'src', f'{o}_{mood}.jpg')


def build_one(o, mood, cal):
    im = Image.open(src_path(o, mood)).convert('RGB')
    a = np.asarray(im)
    m, soft, mh, touched, shadow = subject(im)
    key = f'{o}_{mood}'
    moved = None
    if key in AIRBORNE:
        im, m, soft, moved = move_airborne(im, m, soft, mh, TARGET_PH)
        a = np.asarray(im)
    ev = even_background2(im, m, soft, mh, touched, shadow)
    hys, _hx = np.where(mh)
    htop, hbot = hys.min(), hys.max()
    ph = hbot - htop
    ys, xs = np.where(m)
    top, bot, left, right = ys.min(), ys.max(), xs.min(), xs.max()
    fb = face(im, mh)
    if key in FACE_SCALED and fb and o in cal:
        s = cal[o] / fb[3]
        how_s = 'face'
    else:
        s = TARGET_PH / ph
        how_s = 'height'
    # 头顶或举起的道具离上边至少 TOPMIN（基线固定时，只能缩小一点）
    s_top = (BASE - TOPMIN) / max(1, hbot - top)
    capped = s > s_top
    s = min(s, s_top)
    ax, ay, how_a = anchor(a, mh, fb, m)
    if o == 'suit' and mood in SUIT_ANCHOR:
        # 职业装的连接点是确认过的：高度沿用原来的位置（换算到原图坐标），横向贴到这一行人物（含道具）最左边
        ax, ay = SUIT_ANCHOR[mood]
        row = m[int(ay) - 3:int(ay) + 4]
        if row.any():
            ax = float(np.where(row.any(axis=0))[0].min())
        how_a = 'confirmed'
    ty = BASE - s * hbot
    # 坐垫、裙摆这类比脚底还低的东西：整体上移，不裁掉（碰到原图边框的家具已经在原图里淡出）
    low = bot if not touched['bottom'] else hbot
    if s * low + ty > CH - BOTMIN:
        ty = CH - BOTMIN - s * low
    W = int(round((right - left) * s + 2 * SIDE))
    tx = SIDE - s * left
    M = np.array([[s, 0, tx], [0, s, ty]], np.float32)
    out = cv2.warpAffine(np.asarray(ev), M, (W, CH), flags=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC,
                         borderMode=cv2.BORDER_CONSTANT, borderValue=STAGE)
    cm = cv2.warpAffine(m.astype(np.uint8) * 255, M, (W, CH), flags=cv2.INTER_LINEAR) > 127
    chm = cv2.warpAffine(mh.astype(np.uint8) * 255, M, (W, CH), flags=cv2.INTER_LINEAR) > 127
    # 画布边上：只有人物框外的家具 / 地面才会淡入舞台色，人物本身不动
    yy, xx = np.mgrid[0:CH, 0:W].astype(np.float32)
    dist = np.minimum.reduce([yy, CH - 1 - yy, xx, W - 1 - xx])
    wgt = np.clip(dist / EDGE_FADE, 0, 1)
    wgt = np.maximum(wgt, ndimage.binary_dilation(chm, iterations=6).astype(np.float32))
    o_f = out.astype(np.float32)
    out = (o_f * wgt[..., None] + np.array(STAGE, np.float32) * (1 - wgt[..., None])).round().astype(np.uint8)
    Ax, Ay = s * ax + tx, s * ay + ty
    cys, cxs = np.where(cm)
    hys2, hxs2 = np.where(chm)
    info = {
        'w': W, 'h': CH, 'ar': round(W / CH, 4),
        'hx': round(Ax / W, 4), 'hy': round(Ay / CH, 4),
        'bbox': [int(cxs.min()), int(cys.min()), int(cxs.max()), int(cys.max())],
        'person_bbox': [int(hxs2.min()), int(hys2.min()), int(hxs2.max()), int(hys2.max())],
        'body_h': int(hys2.max() - hys2.min()),
        'pose': 'seated' if key in SEATED else ('jump' if key == 'sport_success' else 'standing'),
        'scale_by': how_s + ('+top_cap' if capped else ''), 'anchor_by': how_a, 'scale': round(float(s), 4),
        'face_h': int(round(fb[3] * s)) if fb else None,
        'src_touch': [k for k, v in touched.items() if v],
        'props_px': int((m & ~ndimage.binary_dilation(mh, iterations=3)).sum()),
        'moved_prop': moved,
    }
    # 人物（含手里的道具）离四边的余白；家具碰到原图边框的那一侧在画布上是淡出的，不算
    pm = cm & ~(cm & ~ndimage.binary_dilation(chm, iterations=3) & (wgt < 1))
    pys, pxs = np.where(pm)
    info['margins'] = [int(pxs.min()), int(pys.min()), int(W - 1 - pxs.max()), int(CH - 1 - pys.max())]
    info['clear_edges'] = bool(min(info['margins']) >= 16)
    blocked = False
    for y in range(int(Ay) - 3, int(Ay) + 4):
        if cm[y].any() and np.where(cm[y])[0].min() < Ax - 8:
            blocked = True
    info['wire_clear'] = not blocked
    return Image.fromarray(out), info, cm


def main():
    faces = {}
    # calibration: face height a standing shot of each outfit gets at the standard body height
    cal = {}
    only = sys.argv[1:]
    need = {k.split('_')[0] for k in only} if only else set(OUTFITS)
    for o in OUTFITS:
        if o not in need:
            continue
        vals = []
        for mood in MOODS:
            if f'{o}_{mood}' in FACE_SCALED:
                continue
            im = Image.open(src_path(o, mood)).convert('RGB')
            m, _ = seg(im)
            ys, _x = np.where(m)
            fb = face(im, m)
            if fb:
                vals.append(fb[3] * TARGET_PH / (ys.max() - ys.min()))
        if vals:
            cal[o] = float(np.median(vals))
        faces[o] = [round(v, 1) for v in vals]
    print('face calibration', {k: round(v, 1) for k, v in cal.items()}, faces)
    meta = {'_about': {
        'canvas_h': CH, 'baseline_y': BASE, 'standing_body_h': TARGET_PH,
        'note': 'per outfit and mood: w/h canvas px, ar = w/h, hx/hy = link anchor as a fraction of the canvas '
                '(the wire comes from the left and ends here), bbox = figure box in canvas px. '
                'suit is built from prism_img/suit_{mood}.jpg with the same pipeline as the other outfits.'}}
    os.makedirs(os.path.join(S3, 'mask'), exist_ok=True)
    old = json.load(open(os.path.join(S3, 'meta.json'))) if only and os.path.exists(os.path.join(S3, 'meta.json')) else {}
    for o in OUTFITS:
        meta[o] = old.get(o, {})
        for mood in MOODS:
            key = f'{o}_{mood}'
            if only and key not in only:
                continue
            img, info, cm = build_one(o, mood, cal)
            img.save(os.path.join(S3, f'{key}_stage.jpg'), quality=95)
            Image.fromarray(cm.astype(np.uint8) * 255).save(os.path.join(S3, 'mask', f'{key}.png'))
            meta[o][mood] = info
            flags = [k for k in ('clear_edges', 'wire_clear') if not info[k]]
            print(f"{key}: {info['w']}x{info['h']} ar={info['ar']} anchor=({info['hx']},{info['hy']}) "
                  f"body_h={info['body_h']} face_h={info['face_h']} {info['pose']} by {info['scale_by']}/{info['anchor_by']} "
                  f"margins={info['margins']} touch={info['src_touch']} props={info['props_px']} "
                  f"{'PROBLEM ' + ','.join(flags) if flags else 'ok'}")
    json.dump(meta, open(os.path.join(S3, 'meta.json'), 'w'), indent=1, ensure_ascii=False)


if __name__ == '__main__':
    main()
