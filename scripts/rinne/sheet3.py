"""Contact sheets for stage3: one sheet per outfit (7 moods in a row) and the 8 x 7 overview.
Purple dot + short wire = link anchor from stage3/meta.json (suit: stage/ + SUIT values)."""
import json
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = '/home/sprite/prism_img'
S3 = os.path.join(ROOT, 'stage3')
MOODS = ['welcome', 'guide', 'thinking', 'success', 'error', 'imaging', 'waiting']
MOOD_ZH = {'welcome': '欢迎', 'guide': '引导', 'thinking': '思考', 'success': '完成', 'error': '报错',
           'imaging': '生图', 'waiting': '休眠'}
OUTFITS = [('suit', '干练职业装'), ('gown', '晚会礼服'), ('summer', '清爽夏季'), ('home', '居家睡衣'),
           ('trench', '秋日风衣'), ('qipao', '新中式'), ('bridal', '婚纱'), ('sport', '运动套装')]
FONT = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
PURPLE = (124, 92, 255)
meta = json.load(open(os.path.join(S3, 'meta.json')))


def src(o, m):
    if o == 'suit':
        return os.path.join(ROOT, 'stage', f'suit_{m}_stage.jpg')
    return os.path.join(S3, f'{o}_{m}_stage.jpg')


def cell(o, m, H):
    im = Image.open(src(o, m)).convert('RGB')
    s = H / im.height
    im = im.resize((max(1, round(im.width * s)), H), Image.LANCZOS)
    e = meta[o][m]
    x, y = e['hx'] * im.width, e['hy'] * H
    d = ImageDraw.Draw(im)
    d.line([(max(0, x - 40), y), (x, y)], fill=PURPLE, width=max(2, H // 200))
    r = max(4, H // 90)
    d.ellipse([x - r, y - r, x + r, y + r], fill=PURPLE, outline='white', width=2)
    return im


def row(o, H, label_mood=True):
    cells = [cell(o, m, H) for m in MOODS]
    f = ImageFont.truetype(FONT, max(16, H // 22))
    gap = H // 30
    lh = int(H * 0.08) if label_mood else 0
    W = sum(c.width for c in cells) + gap * 8
    out = Image.new('RGB', (W, H + lh + gap * 2), (246, 246, 248))
    d = ImageDraw.Draw(out)
    x = gap
    for m, c in zip(MOODS, cells):
        out.paste(c, (x, gap))
        if label_mood:
            t = MOOD_ZH[m]
            tw = d.textlength(t, font=f)
            d.text((x + (c.width - tw) / 2, gap + H + 6), t, fill=(40, 40, 50), font=f)
        x += c.width + gap
    return out


def outfit_sheet(o, name):
    r = row(o, 760)
    f = ImageFont.truetype(FONT, 44)
    out = Image.new('RGB', (r.width, r.height + 80), (246, 246, 248))
    ImageDraw.Draw(out).text((30, 18), f'棱音 · {name} · 7 个状态（紫点为界面连线指向的位置）', fill=(30, 30, 40), font=f)
    out.paste(r, (0, 80))
    p = os.path.join(S3, f'sheet_{o}.jpg')
    out.save(p, quality=88)
    return p


def overview():
    H = 420
    rows = [row(o, H, label_mood=False) for o, _ in OUTFITS]
    LW = 190
    f = ImageFont.truetype(FONT, 30)
    fh = ImageFont.truetype(FONT, 26)
    W = LW + max(r.width for r in rows)
    top = 70
    out = Image.new('RGB', (W, top + sum(r.height for r in rows)), (246, 246, 248))
    d = ImageDraw.Draw(out)
    d.text((20, 18), '棱音衣柜 · 八套服装 × 7 个状态：' + ' / '.join(MOOD_ZH[m] for m in MOODS) + '（从左到右）',
           fill=(30, 30, 40), font=fh)
    y = top
    for (o, name), r in zip(OUTFITS, rows):
        out.paste(r, (LW, y))
        d.text((20, y + r.height // 2 - 16), name, fill=(30, 30, 40), font=f)
        y += r.height
    p = '/home/sprite/rinne_wardrobe_overview_v3.jpg'
    out.save(p, quality=86)
    print(p, out.size)


if __name__ == '__main__':
    for o, n in OUTFITS[1:]:
        print(outfit_sheet(o, n))
    overview()
