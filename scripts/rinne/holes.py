import glob,numpy as np,sys
from PIL import Image
from scipy import ndimage
def find(a, maxs=80, lum=70):
    tr=a[...,3]<128
    lab,n=ndimage.label(tr)
    border=set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])))
    sizes=ndimage.sum(tr,lab,range(1,n+1))
    out=[]
    for i,s in enumerate(sizes):
        k=i+1
        if k in border or s>maxs: continue
        h=lab==k
        ring=ndimage.binary_dilation(h,iterations=2)&~h&(a[...,3]>200)
        if ring.sum()==0: continue
        L=a[...,:3][ring].mean()
        if L<lum: out.append((k,int(s),round(float(L))))
    return lab,out
def fill(a, lab, holes):
    a=a.copy()
    mask=np.zeros(a.shape[:2],bool)
    for k,_,_ in holes: mask|=lab==k
    grow=ndimage.binary_dilation(mask,iterations=1)
    # fill colors from nearest opaque pixels
    src=(a[...,3]>200)&~mask
    idx=ndimage.distance_transform_edt(~src,return_distances=False,return_indices=True)
    rgb=a[...,:3][idx[0],idx[1]]
    a[...,:3][grow]=rgb[grow]
    # alpha: opaque inside holes, keep max on soft edge
    a[...,3][mask]=255
    soft=grow&~mask
    a[...,3][soft]=np.maximum(a[...,3][soft],255)
    return a
if __name__=="__main__":
    tot=0
    for f in sorted(glob.glob('public/img/rinne/*/*-2x.*.webp')):
        if 'avatar' in f or 'page-' in f: continue
        a=np.array(Image.open(f).convert('RGBA'))
        lab,h=find(a)
        if h: print(f.split('rinne/')[1],h); tot+=len(h)
    print(tot)
