"""Six outfits x seven moods contact sheet, from rinne_build_preview/ (the final stage canvases).
The small dot on each figure marks the link anchor the UI wire points at."""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREV = os.path.join(ROOT, 'rinne_build_preview')
MOODS = [('welcome', '欢迎'), ('guide', '引导'), ('thinking', '思考'), ('success', '完成'),
         ('error', '报错'), ('imaging', '生图'), ('waiting', '休眠 / 等待')]
OUTFITS = [('suit', '干练职业装'), ('gown', '晚会礼服'), ('summer', '清爽夏季'), ('home', '居家睡衣'),
           ('trench', '秋日风衣'), ('qipao', '新中式')]
FONT = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'


def main(out, manifest):
    meta = json.load(open(manifest))['moods']
    CH = 520
    widths = [round(CH * meta[m]['ar']) for m, _ in MOODS]
    gap, left, top = 14, 150, 70
    W = left + sum(widths) + gap * (len(MOODS) + 1)
    H = top + (CH + gap) * len(OUTFITS) + gap + 50
    sheet = Image.new('RGB', (W, H), (246, 246, 248))
    d = ImageDraw.Draw(sheet)
    f_big = ImageFont.truetype(FONT, 30)
    f = ImageFont.truetype(FONT, 24)
    f_s = ImageFont.truetype(FONT, 18)
    x = left + gap
    for (m, label), w in zip(MOODS, widths):
        d.text((x + w / 2, top - 22), label, font=f_big, fill=(40, 40, 50), anchor='mm')
        x += w + gap
    for r, (o, oname) in enumerate(OUTFITS):
        y = top + gap + r * (CH + gap)
        d.text((left - 14, y + CH / 2), oname, font=f, fill=(40, 40, 50), anchor='rm')
        x = left + gap
        for (m, _), w in zip(MOODS, widths):
            im = Image.open(os.path.join(PREV, f'{o}_{m}.jpg')).convert('RGB').resize((w, CH), Image.LANCZOS)
            sheet.paste(im, (x, y))
            ax, ay = x + meta[m]['hx'] * w, y + meta[m]['hy'] * CH
            d.line((x + 2, ay, ax - 4, ay), fill=(124, 92, 255), width=2)
            d.ellipse((ax - 4, ay - 4, ax + 4, ay + 4), outline=(124, 92, 255), width=2)
            x += w + gap
    d.text((left + gap, H - 28), '每格是界面里用的舞台立绘（同一状态的六套共用一个画布和连接点，换装时布局不动）。紫色短线和圆点是界面连线指向的位置。',
           font=f_s, fill=(90, 90, 100), anchor='lm')
    sheet.save(out, quality=88)
    print(out, sheet.size, os.path.getsize(out))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
