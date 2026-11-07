import numpy as np
from scipy import ndimage
def headtop(alpha, k=0.065):
    """忽略举过头顶的手臂和手找头顶：按人物高度缩到 400 高，用直径约 6.5% 高度的圆做开运算，
    细的手臂、手指被去掉，头和躯干留下；开运算后最上面一行就是头顶（再往原图回溯到连通的最高点）。"""
    m=alpha>128
    ys=np.where(m.any(1))[0]; y0,y1=ys[0],ys[-1]+1
    s=400/(y1-y0)
    small=ndimage.zoom(m[y0:y1].astype(np.float32), s, order=1)>0.5
    r=max(2,int(400*k/2))
    yy,xx=np.mgrid[-r:r+1,-r:r+1]; disk=xx**2+yy**2<=r*r
    op=ndimage.binary_opening(small, structure=disk)
    lab,n=ndimage.label(op)
    if n==0: return y0,y1,None
    sizes=ndimage.sum(op,lab,range(1,n+1)); big=lab==(np.argmax(sizes)+1)
    t=np.where(big.any(1))[0][0]
    cols=np.where(big[t])[0]; cx=int(cols.mean()/s)
    ty=y0+int(t/s)
    # 回溯：同一列附近往上直到透明
    band=m[:, max(0,cx-20):cx+20]
    while ty>0 and band[ty-1].any(): ty-=1
    return ty,y1,cx
