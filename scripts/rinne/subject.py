"""Subject mask for the stage canvases: the person AND everything she holds, wears or sits on.

Why: the old pipeline kept only what rembg's u2net_human_seg calls "person" and flattened everything
more than 28 px away from it into the stage colour. That model does not see props, so a wine glass,
a bouquet in the air, a selfie stick, a phone held out at arm's length, the top of a transparent
umbrella, a desk or a cushion were faded out or cut in half ("not fully shown").

Now the subject is the union of
  1. u2net_human_seg (the person; still used for scale, feet baseline and face),
  2. isnet-general-use (salient objects: props, furniture),
  3. anything that differs clearly from the smooth studio backdrop and touches 1./2. or lies close to
     her (thin or transparent parts both models miss), floor shadows excluded.
The backdrop is then evened out exactly like before (build_rinne.even_background), but around this
larger mask, so the person and her props keep their own pixels, sharp and fully opaque. Only parts
of furniture that run into the source frame are faded into the stage, and only outside the person.
"""
import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

from build_rinne import seg, STAGE, RING  # noqa: F401

_isnet = None
FRAME_FADE = 60  # px in the 896x1200 source


def isnet(im):
    global _isnet
    from rembg import new_session, remove
    if _isnet is None:
        _isnet = new_session('isnet-general-use')
    return np.asarray(remove(im, session=_isnet, only_mask=True)).astype(np.float32) / 255


def backdrop_field(a, exclude, sigma=40):
    w = (~exclude).astype(np.float32)
    ws = cv2.GaussianBlur(w, (0, 0), sigma)
    f = np.zeros_like(a)
    for c in range(3):
        f[..., c] = cv2.GaussianBlur(a[..., c] * w, (0, 0), sigma) / np.maximum(ws, 1e-3)
    return f


def subject(im):
    """returns m (subject, bool), soft (0..1), mh (person only, bool), touched {side: bool}, shadow (bool)"""
    a = np.asarray(im).astype(np.float32)
    H, W = a.shape[:2]
    mh, soft_h = seg(im)
    ai = isnet(im)
    mi = ai > 0.5
    union0 = mh | mi
    field = backdrop_field(a, ndimage.binary_dilation(union0, iterations=40))
    d = np.abs(a - field).sum(axis=2)
    content = cv2.morphologyEx((d > 36).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
    ys, _ = np.where(mh)
    top, bot = ys.min(), ys.max()
    ph = bot - top
    chroma = a.max(axis=2) - a.min(axis=2)
    darker = (field.mean(axis=2) - a.mean(axis=2)) > 0
    rows = np.arange(H)[:, None]
    shadow = content & (chroma < 18) & darker & (rows > bot - 0.12 * ph) & ~mi & ~mh
    cand = union0 | (content & ~shadow)
    cand = ndimage.binary_closing(cand, iterations=2) | union0
    lab, n = ndimage.label(cand)
    near = ndimage.binary_dilation(mh, iterations=150)
    keep = np.zeros(n + 1, bool)
    sizes = ndimage.sum(np.ones_like(cand), lab, range(n + 1))
    hit = ndimage.maximum(near.astype(np.uint8), lab, range(n + 1))
    for i in range(1, n + 1):
        keep[i] = sizes[i] >= 120 and (hit[i] > 0 or sizes[i] >= 2500)
    m = keep[lab]
    m = ndimage.binary_fill_holes(m) | mh
    extra = m & ~ndimage.binary_dilation(mh, iterations=3)
    soft = np.maximum(soft_h, np.where(m, np.maximum(ai, extra.astype(np.float32)), 0))
    soft = np.where(ndimage.binary_dilation(m, iterations=3), soft, 0)
    soft[m] = 1.0  # inside the subject nothing is blended with the backdrop
    touched = {'top': bool(m[:2].any()), 'bottom': bool(m[-2:].any()), 'left': bool(m[:, :2].any()),
               'right': bool(m[:, -2:].any())}
    return m, soft, mh, touched, shadow & ndimage.binary_dilation(mh, iterations=160)


def frame_fade_weight(shape, touched, mh, fade=FRAME_FADE):
    """1 everywhere except non-person pixels near a source edge the subject runs into"""
    H, W = shape
    wgt = np.ones((H, W), np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    dist = {'top': yy, 'bottom': H - 1 - yy, 'left': xx, 'right': W - 1 - xx}
    for side, t in touched.items():
        if t:
            wgt = np.minimum(wgt, np.clip(dist[side] / fade, 0, 1))
    person = cv2.GaussianBlur(ndimage.binary_dilation(mh, iterations=12).astype(np.float32), (0, 0), 4)
    return np.maximum(wgt, np.clip(person, 0, 1))


def even_background2(im, m, soft, mh, touched, shadow):
    """backdrop -> stage colour around the subject; subject pixels untouched. The contact shadow on the
    floor is kept (colour-corrected) instead of being cut off 28 px from her feet."""
    a = np.asarray(im).astype(np.float32)
    field = backdrop_field(a, ndimage.binary_dilation(m, iterations=40))
    corr = np.array(STAGE, np.float32) - field
    person = np.clip(cv2.GaussianBlur(soft, (0, 0), 1.0), 0, 1)
    person[m] = 1.0
    out = a + corr * (1 - person)[..., None]
    keep = ndimage.binary_dilation(m, iterations=RING) | shadow
    keep = cv2.GaussianBlur(keep.astype(np.float32), (0, 0), 8)
    keep = np.maximum(keep, m.astype(np.float32))
    keep = keep * frame_fade_weight(m.shape, touched, mh)
    out = out * keep[..., None] + np.array(STAGE, np.float32) * (1 - keep[..., None])
    return Image.fromarray(np.clip(out, 0, 255).round().astype(np.uint8))
