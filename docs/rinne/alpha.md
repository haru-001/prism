# 立绘透明化（2026-11-05）

- 所有舞台图（430 / 860）和小立绘（100 / 250）现在都是带 alpha 的 WebP + AVIF，由 `scripts/rinne/make_alpha.py` 从原 RGB 图抠出。
- 抠图：isnet-general-use ∪ u2net_human_seg 软掩膜 → 轮廓两侧 2px 闭式抠图 → estimate_foreground_ml 去灰边 → 预乘 alpha 下 Lanczos 缩放。
- 原图里的地面阴影已去掉，界面里用 CSS 椭圆软影 + drop-shadow 代替。
- `lib/rinne-assets.json` 每条新增 `alpha: 1` 和 `ty`（头顶高度比例，半身裁切用）。
- 头像（avatar）、衣柜缩略图（wardrobe）仍是灰底不透明图：它们本来就放在圆形 / 卡片里。

## 需要重画的图（源图里道具已被抹进灰底，抠不回来）
| 图 | 问题 |
|---|---|
| summer/waiting | 坐着的白色保温箱丢了，看起来坐在空中 |
| sport/waiting | 坐着的台阶丢了，看起来坐在空中 |
| trench/waiting | 透明伞只剩几道痕迹 |
| qipao/guide | 团扇只剩零星碎点 |

重画时请直接出透明 PNG（或纯色绿幕），道具不要贴画布边，地面阴影单独一层或不要。
