"""程序核对：八套 × 7 状态，并行。路径、尺寸比例、人物框和连接点、身高脚底、脸部清晰度、元数据。"""
import json,os,sys,glob,numpy as np,cv2
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import export_stage3 as X  # 脸部检测和清晰度用和导出脚本同一套函数，结果才对得上
from PIL import Image
from concurrent.futures import ProcessPoolExecutor
P=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..')); R=os.environ.get('PRISM_IMG','/home/sprite/prism_img')
O=['suit','gown','summer','home','trench','qipao','bridal','sport'];M=['welcome','guide','thinking','success','error','imaging','waiting']
S=np.array([0xD8,0xD8,0xDA])
man=json.load(open(f'{P}/lib/rinne-assets.json')); meta=json.load(open(f'{R}/stage3/meta.json'))
T=man['tiers']
REP={(r['o'],r['mo']):r['face_box_860'] for r in json.load(open(f'{R}/stage3/export_report.json')) if r.get('face_box_860')}
SUF=['','-2x','-sm','-sm-2x','-avatar','-avatar-2x']
def chunks(path):
    b=open(path,'rb').read(); out=[]; i=12
    while i+8<=len(b):
        t=b[i:i+4].decode('latin1'); n=int.from_bytes(b[i+4:i+8],'little'); out.append(t); i+=8+n+(n&1)
    return out
def fmask(a,thr=45):
    # 阈值 45：浅灰舞台上的人物；底部贴边的灰色地面阴影导出时已淡出
    d=np.abs(a.astype(int)-S).sum(2)
    return cv2.morphologyEx((d>thr).astype(np.uint8),cv2.MORPH_OPEN,np.ones((3,3),np.uint8))>0
def face(g,top,ph):
    d=cv2.data.haarcascades;best=None;reg=g[top:top+int(ph*0.4)]
    for n in ('haarcascade_frontalface_default.xml','haarcascade_frontalface_alt2.xml','haarcascade_profileface.xml'):
        c=cv2.CascadeClassifier(d+n)
        for fl in (0,1):
            r=cv2.flip(reg,1) if fl else reg
            for (x,y,w,h) in c.detectMultiScale(r,1.05,4,minSize=(32,32)):
                if fl:x=reg.shape[1]-x-w
                if best is None or w*h>best[2]*best[3]:best=(int(x),int(y+top),int(w),int(h))
    return best
def one(a):
    o,mo=a; e=man['outfits'][o][mo]; errs=[]; r={'o':o,'m':mo}
    files=[f'{P}/public/img/rinne/{o}/{mo}{s}.{h}.webp' for s,h in zip(SUF,e['f'])]+[f'{P}/public/img/rinne/{o}/{mo}{s}.{h}.avif' for s,h in zip(SUF[:4],e['a'])]
    for f in files:
        if not os.path.exists(f): errs.append('缺文件 '+f)
    if errs: r['errs']=errs; return r
    exp=[T['stage'][0],T['stage'][1],T['mini'][0],T['mini'][1]]
    for i,f in enumerate(files):
        im=Image.open(f)
        if i in (4,5):
            s=T['avatar'][i-4]
            if im.size!=(s,s): errs.append(f'头像尺寸 {im.size}')
        else:
            h=exp[i%6 if i<6 else i-6]
            # 宽度四舍五入允许差 1px
            if im.height!=h or abs(im.width-h*e['ar'])>1: errs.append(f'{os.path.basename(f)} 尺寸 {im.size} 应为 {round(h*e["ar"])}x{h}')
        if f.endswith('.webp'):
            c=chunks(f)
            if any(x in c for x in ('EXIF','ICCP','XMP ')): errs.append('含元数据 '+f)
    # meta vs manifest
    mm=meta[o][mo] if o!='suit' else None
    if mm:
        if abs(mm['w']/mm['h']-e['ar'])>0.0006: errs.append(f'meta 比例 {mm["w"]/mm["h"]:.4f} ≠ {e["ar"]}')
        if (mm['hx'],mm['hy'])!=(e['hx'],e['hy']): errs.append('连接点和 meta 不一致')
    # 2x 舞台图：身高、脚底、连接点、清晰度
    a=np.asarray(Image.open(files[1]).convert('RGB')); H,W=a.shape[:2]
    mk=fmask(a); rows=np.where(mk.sum(1)>2)[0]; cols=np.where(mk.sum(0)>2)[0]
    top,bot=int(rows.min()),int(rows.max())
    r.update(w=W,h=H,top=top,bot=bot,bh=bot-top,left=int(cols.min()),right=int(cols.max()))
    if top<4 or bot>H-4 or cols.min()<2 or cols.max()>W-3: errs.append(f'人物贴边 top{top} bot{bot} l{cols.min()} r{cols.max()} W{W}')
    ax,ay=e['hx']*W,e['hy']*H
    ys,xs=np.where(mk); d=np.sqrt((xs-ax)**2+(ys-ay)**2).min()
    r['anchor_gap']=round(float(d),1)
    # 连线从左边水平进来到连接点：这段上不能压到人物
    yy=int(round(ay)); seg=mk[max(0,yy-1):yy+2,:max(0,int(ax)-12)]  # 连线停在手前 9px（lg 档 2x 文件里 18px），末端圆点半径 3px
    r['wire_hits']=int(seg.sum())
    if d>14: errs.append(f'连接点离人物 {d:.0f}px')
    if seg.sum()>0: errs.append(f'连线压到人物 {seg.sum()}px')
    g=cv2.cvtColor(a,cv2.COLOR_RGB2GRAY); m2=X.mask(Image.fromarray(a)); yy2,_=np.where(m2)
    # 脸框用导出脚本在未处理的 860 图上找到的那个，前后量的是同一块脸
    f=REP.get((o,mo)) or X.detect_face(g,yy2.min(),yy2.max()-yy2.min(),32)
    if f:
        x,y,w,h=f
        r['lap']=round(X.face_lap(Image.fromarray(a),f),1); r['face_w']=w; r['face_box']=list(f)
        r['lap_avif']=round(X.face_lap(Image.open(files[7]).convert('RGB'),f),1)
    r['errs']=errs; return r
if __name__=='__main__':
    with ProcessPoolExecutor(8) as ex: res=list(ex.map(one,[(o,m) for o in O for m in M]))
    # 孤儿文件
    refs=set()
    for o in O:
        for mo in M:
            e=man['outfits'][o][mo]
            refs|={f'{o}/{mo}{s}.{h}.webp' for s,h in zip(SUF,e['f'])}|{f'{o}/{mo}{s}.{h}.avif' for s,h in zip(SUF[:4],e['a'])}
        t=man['outfits'][o]['thumb']; refs|={f'wardrobe/{o}.{t[0]}.webp',f'wardrobe/{o}-2x.{t[1]}.webp'}
        for i,(w,h) in enumerate(T['thumb']):
            im=Image.open(f'{P}/public/img/rinne/wardrobe/{o}{"-2x" if i else ""}.{t[i]}.webp')
            if im.size!=(w,h): print('缩略图尺寸错',o,im.size)
    allf={os.path.relpath(p,f'{P}/public/img/rinne') for p in glob.glob(f'{P}/public/img/rinne/**/*.*',recursive=True)}
    print('引用文件',len(refs),'实际文件',len(allf),'缺',len(refs-allf),'多余',len(allf-refs))
    json.dump(res,open(os.path.join(R,'stage3','check_report.json'),'w'),ensure_ascii=False,indent=0)
    bad=[r for r in res if r['errs']]
    for r in bad: print('✗',r['o'],r['m'],r['errs'])
    print('有问题的图',len(bad),'/',len(res))
    # 同一状态八套之间：站姿的头顶、脚底
    for mo in M:
        rs=[r for r in res if r['m']==mo]
        print(mo,'头顶',[r['top'] for r in rs],'脚底',[r['bot'] for r in rs])
    laps=[r['lap'] for r in res if r.get('lap')]
    print('脸部拉普拉斯方差 中位',np.median(laps),'范围',min(laps),max(laps),'无脸',[f"{r['o']}/{r['m']}" for r in res if not r.get('lap')])
    med=np.median(laps)
    print('偏离中位数超 ±40%:',[(r['o'],r['m'],r['lap']) for r in res if r.get('lap') and abs(r['lap']/med-1)>0.4])
