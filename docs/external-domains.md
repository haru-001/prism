# 外部域名核对清单

这份清单列出 Prism 代码里出现的每一个外部域名：在哪里用到、谁去访问它、现在怎么处理。目标是：**在国内不挂代理时，只要能打开 Prism 自己的域名，页面和图片就都能正常加载。**

判断标准很简单：

- **浏览器自动加载的**（脚本、样式、字体、图片、接口请求）：必须是本站地址。这是这次改造的重点。
- **服务端访问的**（运行在 Vercel 函数里）：不受你本地网络影响，保持不变。
- **你点了才打开的链接**：不影响 Prism 本身能不能用，保持不变。
- **只是文字或占位符**：不会发出请求。

## 一、浏览器会加载的（已全部改成本站地址）

| 域名 / 来源 | 以前在哪里用到 | 现在怎么处理 | 代码位置 |
| --- | --- | --- | --- |
| `*.public.blob.vercel-storage.com`（公开 Vercel Blob） | 接了 Public Blob 时，生图和上传的图片直接用 Blob 地址显示，浏览器直连这个域名 | 浏览器只访问 `/api/files/bp/{host}/{path}?s=签名`，由服务端下载后转发。服务端只允许读 `*.public.blob.vercel-storage.com`。旧数据里的 Blob 直链在读取时自动改写（会话、图库、导出、备份、生图接口返回），不用迁移 | `lib/server/imgurl.ts`、`lib/server/files.ts`（`readBlob`）、`app/api/files/[...path]/route.ts` |
| 私有 Vercel Blob | 本来就由服务端登录后代读 | 不变，地址是 `/api/files/b/{pathname}?s=签名`，服务端用 `BLOB_READ_WRITE_TOKEN` 读 | `lib/server/files.ts`（`readBlob`） |
| 上游生图返回的临时图片链接（比如 OpenAI 生图返回的 url） | 有一处会把上游链接原样交给浏览器 | 服务端拿到链接后立刻下载存好（失败重试一次）；还不行就给 `/api/files/ext?u=原地址&s=签名`，由服务端转发。`/v1/images/generations` 返回的 url 是本站完整地址，要 `b64_json` 时照旧返回 base64 | `lib/server/files.ts`（`fetchRemoteImage`）、`lib/server/relay/inbound.ts` |
| 模型回答里 Markdown 的外链图片 `![](https://...)` | 浏览器直接加载对方域名 | 改成 `/api/files/ext?u=...`，由服务端转发。转发时不允许访问内网和保留地址（重定向每一跳都查），只接受图片，最大 20MB，20 秒超时 | `components/Markdown.tsx`、`lib/server/files.ts` |
| 字体 | 没有用外部字体 | 用系统字体（苹方、微软雅黑、Noto Sans SC 等），没有 Google Fonts，也没有 `next/font` | `app/globals.css` |
| 脚本、样式、图标库 | 没有用外部 CDN | jsdelivr、unpkg、cdnjs 都没有用到；代码高亮、Markdown、图标（lucide）都打包在站内 | `package.json` |
| 头像、插画、棱镜图标 | 在站内 | 不变，都在 `public/img`；没有配 `next/image` 的远程图片 | `public/img`、`next.config.ts` |

所有 `/api/files/...` 地址都带 `s=` 签名（用 `PRISM_SECRET` 算的 HMAC）：带签名的谁都能打开，浏览器和 Vercel CDN 缓存一年；没签名的要登录，只让浏览器自己缓存。

## 二、只有服务端访问的（不受你本地网络影响）

| 域名 | 用途 | 处理 | 代码位置 |
| --- | --- | --- | --- |
| `api.openai.com` | OpenAI 渠道的默认 Base URL | 由 Vercel 函数请求，不变 | `lib/models.ts`、`lib/server/relay/` |
| `api.anthropic.com` | Claude 渠道的默认 Base URL | 同上 | 同上 |
| `generativelanguage.googleapis.com` | Gemini 渠道的默认 Base URL | 同上 | 同上 |
| `你的资源名.openai.azure.com` | Azure OpenAI 渠道的地址模板（要换成真实资源名，不换会被拒绝保存） | 同上 | `lib/models.ts`、`app/api/channels/route.ts` |
| 你自己填的中转站地址 | OpenAI 兼容渠道 | 同上 | `lib/server/relay/` |
| `*.aivencloud.com` | Aiven MySQL（`DATABASE_URL`） | 只有服务端用 `mysql2` 连接 | `lib/server/mysql.ts` |
| Vercel Blob 接口 | 存图（`put`）、读私有 Blob（`get`） | 只有服务端通过 `@vercel/blob` 调用，浏览器不直接上传到 Blob（聊天里上传的图先发到本站 `/api/upload`） | `lib/server/files.ts` |
| `*.public.blob.vercel-storage.com` | 服务端转发公开 Blob 的图片 | 见上一节 | `lib/server/files.ts` |
| 上游临时图片链接、回答里的外链图片 | 服务端下载或转发 | 见上一节 | `lib/server/files.ts` |
| `xxx.upstash.io` | 从旧版 Upstash 迁移数据时的示例地址 | 只在你自己电脑上跑 `npm run migrate` 时访问，网站本身不再用 | `scripts/migrate-to-mysql.mjs` |

## 三、你点了才会打开的链接（保持不变）

| 链接 | 在哪里 | 说明 |
| --- | --- | --- |
| `https://console.aiven.io/` | 「数据库睡着了」提示里的按钮 | 去 Aiven 控制台开机。控制台本身是外部网站，打不开时需要你自己处理网络。`components/DbSleeping.tsx` |
| 渠道的 Base URL | 渠道页，显示成超链接，新标签页打开 | 只是方便你核对地址。`components/channels/` |
| 模型回答里的文字链接 | 聊天页 | 点了才打开，打不打得开取决于对方网站。`components/Markdown.tsx` |
| README 里的 Vercel、Aiven、Upstash 链接 | 文档 | 只在文档里，不在网站上 |

## 四、只是文字或占位符（不会发出请求）

| 内容 | 在哪里 | 说明 |
| --- | --- | --- |
| `your-relay.example.com` | 引导页和渠道编辑里 OpenAI 兼容地址的输入框占位文字 | 不会请求 |
| `www.w3.org` | `app/icon.svg` 里的 SVG 命名空间声明 | 不会请求 |
| `prism.internal` | 日志「一键重放」在服务端内部构造请求时用的假地址，直接交给本站的处理函数 | 不走网络。`lib/server/replay.ts` |

## 五、怎么验证的

- `tests/cn-ui-test.py`：用无头浏览器拦下所有非本站请求，逐页打开首页、对话页、图库、渠道、令牌、日志、用量、设置、404 和登录页，确认没有任何外部请求，页面 HTML 和接口 JSON 里也没有浏览器要直接加载的外部地址；并确认旧 Blob 直链、上游临时链接、回答里的外链图片都经本站加载并且真的显示出来。
- `tests/cn-db-test.mjs`：签名地址和登录鉴权、旧链接改写、上游临时链接转存、外链转发拦截内网地址和非图片内容。

这些测试用的是本地模拟的上游和模拟的公开 Blob，没有在国内网络下实际打开过线上站点。
