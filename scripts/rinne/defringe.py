"""去白边：按已知灰底做颜色去污染，再把 alpha 向内收 1px 并轻羽化。
用法：python defringe.py in.png out.png [bg_r bg_g bg_b]"""
import sys, numpy as np
from PIL import Image, ImageFilter
def defringe(im, bg=(210,211,213)):
    a = np.asarray(im.split()[3]).astype(np.float32)/255
    # 收边：最小值滤波 3x3 后与原 alpha 取均值 → 约 1px 内收
    er = np.asarray(im.split()[3].filter(ImageFilter.MinFilter(3))).astype(np.float32)/255
    a2 = np.minimum(a, er*0.65 + a*0.35)
    a2 = np.asarray(Image.fromarray((a2*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))).astype(np.float32)/255
    a2 = np.minimum(a2, a)
    rgb = np.asarray(im.convert('RGB')).astype(np.float32)
    B = np.array(bg, np.float32)
    ae = np.clip(a, 0.05, 1)[...,None]
    F = (rgb - (1-ae)*B)/ae
    m = (a < 0.98)[...,None]
    rgb = np.where(m, np.clip(F,0,255), rgb)
    out = np.dstack([rgb, a2*255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')
if __name__ == '__main__':
    bg = tuple(int(x) for x in sys.argv[3:6]) if len(sys.argv) > 5 else (210,211,213)
    defringe(Image.open(sys.argv[1]).convert('RGBA'), bg).save(sys.argv[2])

def knockout(im, bg=(210,211,213), tol=16, band=40):
    """把贴着透明区、颜色接近灰底的残留块（耳后、发间漏抠的底色）清掉。"""
    from scipy import ndimage
    arr = np.asarray(im).astype(np.float32)
    a = arr[...,3]
    d = np.sqrt(((arr[...,:3]-np.array(bg,np.float32))**2).sum(-1))
    near = d < tol
    trans = a < 20
    dist = ndimage.distance_transform_edt(~trans)
    cand = near & (dist < band)
    lab, n = ndimage.label(cand | trans)
    touch = set(np.unique(lab[trans]))
    kill = cand & np.isin(lab, list(touch))
    out = arr.copy(); out[...,3][kill] = 0
    return Image.fromarray(out.astype(np.uint8), 'RGBA')
