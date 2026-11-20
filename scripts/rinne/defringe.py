import numpy as np
from scipy import ndimage
def defringe(a, choke=24, rad=3, thr=14):
    """a: HxWx4 uint8 straight alpha。去掉抠像残留的浅色描边：
    1) 轮廓上 2px 内的实心像素若比更里面明显亮，换成里面的颜色
    2) 轮廓外的半透明像素颜色换成最近实心像素颜色，并轻微收紧 alpha（只动轮廓附近，不碰头纱这类大面积半透明）"""
    a=a.astype(np.float32)
    al=a[...,3]
    solid=al>=245
    if solid.sum()==0: return a.astype(np.uint8)
    out=a.copy()
    lum=lambda x:x.mean(-1)
    # 背景残留是灰白色：只处理低饱和、偏亮的像素，金边、饰品这类有颜色的高光不动
    rgb=a[...,:3]
    pale=((rgb.max(-1)-rgb.min(-1))<38)&(lum(rgb)>140)
    deep=ndimage.binary_erosion(solid,iterations=3)
    if deep.sum():
        _,di=ndimage.distance_transform_edt(~deep,return_indices=True)
        dcol=a[...,:3][di[0],di[1]]
        ring=solid&~ndimage.binary_erosion(solid,iterations=2)
        fix=ring&pale&(lum(a[...,:3])>lum(dcol)+thr)
        out[...,:3][fix]=dcol[fix]*0.85+a[...,:3][fix]*0.15
    dist,idx=ndimage.distance_transform_edt(~solid,return_indices=True)
    inner=out[...,:3][idx[0],idx[1]]
    edge=(al>0)&(~solid)&(dist<=rad)
    bright=edge&pale&(lum(a[...,:3])>lum(inner)+thr)
    w=np.clip(1.15-al/255,0,1)[...,None]
    rep=out[...,:3]*(1-w)+inner*w
    out[...,:3][bright]=rep[bright]
    na=al.copy()
    na[edge]=np.clip((al[edge]-choke)*255/(255-choke),0,255)
    out[...,3]=na
    return np.clip(out+0.5,0,255).astype(np.uint8)
