# 立绘透明化（2026-11-05）

- 所有舞台图（430 / 860）和小立绘（100 / 250）现在都是带 alpha 的 WebP + AVIF，由 `scripts/rinne/make_alpha.py` 从原 RGB 图抠出。
- 抠图：isnet-general-use ∪ u2net_human_seg 软掩膜 → 轮廓两侧 2px 闭式抠图 → estimate_foreground_ml 去灰边 → 预乘 alpha 下 Lanczos 缩放。
- 原图里的地面阴影已去掉，界面里用 CSS 椭圆软影 + drop-shadow 代替。
- `lib/rinne-assets.json` 每条新增 `alpha: 1` 和 `ty`（头顶高度比例，半身裁切用）。
- 头像（avatar）、衣柜缩略图（wardrobe）仍是灰底不透明图：它们本来就放在圆形 / 卡片里。

## 需要重画的图（源图里道具已被抹进灰底，抠不回来）
| 图 | 问题 |
|---|---|
| trench/waiting | 透明伞只剩几道痕迹 |
| qipao/guide | 团扇只剩零星碎点 |

重画时请直接出透明 PNG（或纯色绿幕），道具不要贴画布边，地面阴影单独一层或不要。


## 2026-11-05 重画：夏装、运动装、晚会礼服
- 夏装（露腰背心、高腰牛仔短裤）、运动装（运动背心、紧身短裤）、晚会礼服（午夜蓝挂脖露背长裙）三套共 21 张已重画，原来的动作含义不变。
- 接入脚本：`scripts/rinne/add_outfits.py`。抠图后，人物高度和头顶、脚底位置对齐旧图的同一状态；运动装「成功」旧图是跳起来的，改按 welcome 的身高对齐。脚本同时重算 `ar`、`hx`/`hy`、`ty`、`bx`，并按头部位置裁出头像。
- 坐着的道具（夏装的保温箱、运动装的跳箱）用和纯色灰底的差异补抠，取凸包填实，边缘干净。
- 接入后再跑 `make_alpha.py`（从母版编码 WebP / AVIF）和 `make_alpha_small.py`（衣柜缩略图）。
