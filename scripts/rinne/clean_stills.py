#!/usr/bin/env python3
"""
清理棱音立绘的抠像瑕疵（只处理舞台档 430 / 860 的 webp + avif），并更新 lib/rinne-assets.json 里的文件哈希：
- holes.py：头发、衣服里被误抠掉的小透明洞（四周是深色/实心才补，头纱镂空、指缝不动）
- defringe.py：轮廓上灰白色的背景残留（深色模式下显出白边），只动低饱和偏亮的像素，金边、饰品高光保留
处理过的条目会写上 "clean": 1，重复运行会跳过。处理完记得重跑 make_motion_clip.py，让短视频和立绘一致。

用法：python3 scripts/rinne/clean_stills.py
"""
import glob, hashlib, io, json, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from holes import find, fill
from defringe import defringe

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
R = os.path.join(ROOT, "public/img/rinne")
NO_HOLE_FILL = {("winter", "success")}  # 这张的小洞是指缝


def main():
    p = os.path.join(ROOT, "lib", "rinne-assets.json")
    A = json.load(open(p))
    n = 0
    for o, moods in A["outfits"].items():
        for m, meta in moods.items():
            if not isinstance(meta, dict) or "f" not in meta or meta.get("clean"):
                continue
            src = f"{R}/{o}/{m}-2x.{meta['f'][1]}.webp"
            if not os.path.exists(src):
                continue
            a = np.array(Image.open(src).convert("RGBA"))
            if (o, m) not in NO_HOLE_FILL:
                lab, h = find(a)
                if h:
                    a = fill(a, lab, h)
            big = Image.fromarray(defringe(a))
            one = Image.open(f"{R}/{o}/{m}.{meta['f'][0]}.webp")
            small = big.resize(one.size, Image.LANCZOS)
            for idx, im in enumerate([small, big]):
                suf = "-2x" if idx else ""
                for kind, key, q in [("webp", "f", A["tiers"]["webp_q"]), ("avif", "a", A["tiers"]["avif_q"])]:
                    buf = io.BytesIO()
                    im.save(buf, kind.upper(), quality=q, **({"method": 6} if kind == "webp" else {}))
                    data = buf.getvalue()
                    hsh = hashlib.md5(data).hexdigest()[:8]
                    old = f"{R}/{o}/{m}{suf}.{meta[key][idx]}.{kind}"
                    if os.path.exists(old):
                        os.remove(old)
                    open(f"{R}/{o}/{m}{suf}.{hsh}.{kind}", "wb").write(data)
                    meta[key][idx] = hsh
            meta["clean"] = 1
            n += 1
            print(o, m, flush=True)
    json.dump(A, open(p, "w"), ensure_ascii=False, separators=(",", ":"))
    print("done", n)


if __name__ == "__main__":
    main()
