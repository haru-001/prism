# Prism · 棱镜

把 OpenAI、Claude、Gemini 和各种 OpenAI 兼容中转站汇到一个地址上的自用 AI 网关，自带聊天和生图页面。有一位偶像少女「棱音」陪你配置和使用。可以一键部署到 Vercel。

- **一个地址、一个令牌**：对外同时提供 OpenAI、Claude、Gemini 三种格式的接口，任意格式都能调用任意渠道的模型，自动互转，支持流式。同一家的请求原样转发。
- **线路切换**：同一个模型挂在多条线路上时按优先级走，失败自动换下一条；连续 3 次超时自动停用，棱音会提醒你。
- **聊天与生图**：流式回答、Markdown 与代码高亮、附图识别、`/图` 快捷生图、参考图、图库。
- **安全**：访问密码登录；上游 Key 用 AES-256-GCM 加密存在服务端，页面和接口都不会返回明文。
- **管理**：按天的用量和花费统计；可以分权限的多个令牌（限模型、限额度、限期）；日志详情和一键重放；加密备份与恢复。
- **聊天增强**：提示词预设、最多 4 个模型并排回答、识图提醒、导出 Markdown / JSON。
- **国内能直接用**：页面不加载任何外部域名的资源，图片也都经本站地址转发；上游 AI 接口由服务端去请求。见「国内访问」。
- **数据库看得见**：设置页能看到免费 MySQL 用了多少、各部分占多少，并按类型清理旧数据；快满时棱音会提醒；数据库被 Aiven 关机时，页面会告诉你怎么叫醒它。

---

## 一、一键部署到 Vercel

全程大约 10 分钟，不需要写代码。

### 1. 在 Aiven 上开一个免费 MySQL

Vercel 的服务器不能长期保存文件，渠道、对话、设置、日志都存在数据库里。Prism 用的是 Aiven 的免费 MySQL，不用绑信用卡。

1. 打开 <https://console.aiven.io>，注册并登录。
2. 点 **Create service**，服务类型选 **MySQL**。
3. 套餐选 **Free**（免费档）。免费档不能自己挑云厂商和机房，用 Aiven 分配的就行。服务名随意，比如 `prism-db`。
4. 点创建，等状态从 **Rebuilding** 变成 **Running**，一般几分钟。
5. 进入这个服务的 **Overview（概览）** 页，找到 **Connection information**：
   - **Service URI**：一串 `mysql://avnadmin:密码@mysql-xxxx.aivencloud.com:端口/defaultdb?ssl-mode=REQUIRED`，点旁边的复制按钮，整串复制下来，等会儿填进 `DATABASE_URL`。
   - **CA certificate**：点 **Show** 或下载，得到 `ca.pem`，内容是一段 `-----BEGIN CERTIFICATE-----` 开头、`-----END CERTIFICATE-----` 结尾的文字，等会儿整段填进 `DATABASE_CA_CERT`。
6. 记一下这台服务所在的云厂商和区域，第 4 步会用到。怎么查见下面「速度优化和区域设置」。

不用手动建表，Prism 第一次连上时会自动建好 6 张表（`prism_kv`、`prism_hash`、`prism_list`、`prism_files`、`prism_usage`、`prism_logd`），都带主键，符合 Aiven 的要求。从旧版升级上来的库，缺的表也会在第一次连上时自动补上，已有数据不受影响。

### 2. 把代码放到 GitHub

1. 在 GitHub 新建一个**私有**仓库，比如 `prism`。
2. 解压本压缩包，在解压出的目录里执行：

   ```bash
   git init
   git add .
   git commit -m "Prism"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/prism.git
   git push -u origin main
   ```

   不想用命令行的话，也可以在 GitHub 网页上「Add file → Upload files」把解压后的文件拖进去。

已经部署过旧版的话，直接把新代码推到原来的仓库，然后跳到第 3 步改环境变量。

### 3. 在 Vercel 导入并填环境变量

1. 打开 <https://vercel.com/new>，用 GitHub 登录，选中刚才的仓库，点 **Import**。（旧项目：打开项目 **Settings → Environment Variables**。）
2. Framework Preset 会自动识别成 **Next.js**，构建命令保持默认。
3. 在 **Environment Variables** 里添加：

   | 名称 | 值 |
   | --- | --- |
   | `PRISM_SECRET` | 一串 32 位以上的随机字符，可以用 `openssl rand -base64 32` 生成。旧项目沿用原来的值，**不要改** |
   | `DATABASE_URL` | 第 1 步复制的 Service URI，整串原样粘贴 |
   | `DATABASE_CA_CERT` | 第 1 步的 CA 证书，整段粘贴，包括 BEGIN 和 END 两行 |

   想用环境变量管理访问密码的话，再加一个 `ACCESS_PASSWORD`；不加也行，首次打开网站时棱音会带你设。

   CA 证书粘贴后换行丢了也没关系，Prism 会自动整理。实在粘不进去，可以先转成一行 base64 再填：macOS 用 `base64 -i ca.pem`，Linux 用 `base64 -w0 ca.pem`。
4. 点 **Deploy**。旧项目改完变量后，到 **Deployments** 对最新一次部署点 **⋯ → Redeploy**。

旧项目里那些 `KV_REST_API_*` / `UPSTASH_REDIS_REST_*` 变量新版已经不用了，迁移完数据（见下面「从旧版 Upstash 迁移数据」）就可以删掉，也可以在 Storage 里断开 Upstash。

没填 `DATABASE_URL` 时，网站只显示一页配置提示，不会进入登录页。

### 4. 把 Vercel 函数放到离数据库近的区域（推荐）

每次请求 Prism 都要读写数据库，函数和数据库离得越远，每一步越慢。Vercel 新项目的函数默认跑在美国东部 Washington, D.C.（`iad1`），而 Aiven 免费档分给你的机房可能在别处。具体怎么查、怎么改，见下面「速度优化和区域设置」。

### 5. 接上 Vercel Blob（可选）

Blob 用来存生成的图片和聊天里上传的图片。不接也能用：图片会压缩后存进 MySQL，并且有总量上限，超出后自动删最早的图（见下面「图片存在哪里」）。图片多、想长期保留的话建议接 Blob。

1. 在 Vercel 项目的 **Storage** 里点 **Create Database**，选 **Blob**。
2. 连接到本项目，Vercel 会自动添加 `BLOB_READ_WRITE_TOKEN`。
3. 再 Redeploy 一次。

Blob 存储选 Public 或 Private 都可以。不管哪种，浏览器都只访问本站的 `/api/files/...` 地址，由 Prism 的服务端去读 Blob 再转发，页面上不会出现 `*.public.blob.vercel-storage.com` 这样的 Blob 直链（国内不挂代理通常连不上它）。如果你的 Blob 是 Private，可以加一个环境变量 `BLOB_ACCESS=private` 省掉一次失败重试。

#### 图片存在哪里

| 情况 | 存在哪 | 说明 |
| --- | --- | --- |
| 接了 Blob | Vercel Blob | 原图保存，没有总量上限（受 Blob 套餐限制） |
| 没接 Blob | MySQL 的 `prism_files` 表 | 超过 200KB 的 PNG / JPG / WebP 转成 WebP（质量 85，长边最多 2048 像素）；还超过 `DB_IMAGE_MAX_KB`（默认 800KB）就继续缩小。GIF 原样保存。所有图片加起来超过 `DB_IMAGES_MAX_MB`（默认 300MB）时，从最早的开始删，删到上限的九成 |

免费 MySQL 只有 1GB 空间，对话、日志、索引也要占地方，所以图片默认最多用 300MB，按一张 200–800KB 算能留几百到一千多张。被清理掉的图会从图库里消失，旧对话里的那张图会显示不出来。想多留一些可以调大 `DB_IMAGES_MAX_MB`，但别超过 600。

### 6. 打开网站，跟着棱音完成引导

打开 Vercel 给你的域名（`https://xxx.vercel.app`），会自动进入四步引导：

1. **设访问密码**：已经在环境变量里设了 `ACCESS_PASSWORD` 的话直接跳过。
2. **选供应商**：OpenAI / Claude / Gemini / OpenAI 兼容（Azure OpenAI 收在「展开更多」里），填 Base URL 和 Key。Base URL 结尾带不带 `/v1` 都行，会自动补齐，输入框下方会显示实际请求的地址。
3. **获取模型**：自动拉取模型列表，常用模型已经勾好，也可以手动加模型名。可以继续添加更多渠道。
4. **进入聊天页**：棱音会用 ① ② ③ 标出选模型、切换生图、发消息的位置。

引导进度存在服务端，换设备登录不会重复出现。想再看一遍，到 **设置 → 重新看引导**（不会删掉已有渠道）。

### 速度优化和区域设置

Prism 已经做过一轮速度优化，自己不用做什么：

- **首屏**：服务端把启动配置直接随页面发下去，左栏会话列表不等数据库，读完随同一个响应补上。
- **切换对话**：鼠标移到左栏的对话上就开始预取，打开过的对话会缓存。
- **写库放到后台**：请求日志、日志详情、用量统计和渠道状态都在响应发出之后再写，不占请求时间。
- **渠道操作**：增删改、启停先改界面再等服务端确认；「全部测速」只在最后刷新一次。
- **图片**：有缩略图，浏览器和 CDN 缓存一年。
- **Markdown**：渲染模块按需加载，流式输出时只重新解析最后一段，长回答不会越打越卡。
- **内存缓存**：渠道、设置、预设这类很少改的数据，每个函数实例会在内存里缓存一会儿（默认 30 秒，`PRISM_CACHE_TTL` 可调）。Vercel 同时开了好几个实例时，别的实例最多晚这么久才看到你的修改；登录态、令牌、找不到模型这类关键判断对不上时会直接读库确认，聊天页的预设也会在后台再读一次最新的。

剩下最影响速度的是**函数和数据库之间的距离**：同一个请求要读写几次数据库，每次都要跨一趟。这一步要你自己设置。

**第一步：查 Aiven 的机房在哪**

1. 打开 <https://console.aiven.io>，进入你的 MySQL 服务。
2. 在服务的 **Overview（概览）** 页上能看到这台服务所在的云厂商和区域，Aiven 用「厂商-区域」的写法，比如 `do-nyc`（DigitalOcean 纽约）、`aws-eu-central-1`（AWS 法兰克福）、`google-europe-west1`（Google 比利时）、`do-sgp`（DigitalOcean 新加坡）。
3. 实在找不到的话，也可以从 Service URI 里取出主机名（`mysql-xxxx.aivencloud.com`），在电脑上运行 `nslookup mysql-xxxx.aivencloud.com` 得到 IP，再到任意 IP 归属地查询网站查它在哪个城市。

免费档的区域是 Aiven 分配的，不能自己选，Aiven 也可能调整。以后收到 Aiven 迁移区域的通知，记得回来重新对一下。

**第二步：把 Vercel 函数区域改到附近**

1. 打开 Vercel 上的 Prism 项目，点左侧的 **Settings**。
2. 在左边选 **Functions**。
3. 展开 **Function Regions**，选一个离第一步查到的城市最近的机房，保存。Hobby（免费）套餐只能选一个区域，选一个就够了。
4. 到 **Deployments** 里对最新的部署点 **Redeploy**，新区域才会生效。

常见的对应关系：

| Aiven 区域在 | 选这个 Vercel 区域 |
| --- | --- |
| 美国东部（纽约、弗吉尼亚等） | Washington, D.C. `iad1` |
| 美国西部 | San Francisco `sfo1` 或 Portland `pdx1` |
| 德国、荷兰、比利时 | Frankfurt `fra1` |
| 英国 | London `lhr1` |
| 法国 | Paris `cdg1` |
| 新加坡 | Singapore `sin1` |
| 日本 | Tokyo `hnd1` |

也可以不在网页上改，在项目根目录新建一个 `vercel.json`，写上 `{ "regions": ["fra1"] }`（换成你要的区域代码），推送后生效。网页设置和 `vercel.json` 只用一种就行。

**改完怎么确认**：随便聊几句，到「请求日志」看耗时，或者打开左栏会话、图库，感觉一下是不是比以前快。函数和数据库在同一地区时，数据库往返通常很快；隔着大洋时每次往返都要多花不少时间。

### 国内访问

#### Prism 已经做了什么

- **页面不加载外部资源**：字体用系统自带的（苹方、微软雅黑等），图标、头像、插画都在站内（`public/img`），没有用 Google Fonts、jsdelivr、unpkg、cdnjs 这类外部 CDN。
- **图片都走本站地址**：浏览器看到的图片地址一律是 `/api/files/...`，由服务端去读 MySQL、Vercel Blob 或外部链接，再转发给浏览器。包括：
  - 存在 Vercel Blob 里的图（Public、Private 都一样）
  - 上游生图返回的临时链接：服务端会立刻下载存好，下载失败重试一次，还不行就给一个经本站转发的地址
  - 模型回答里 Markdown 的外链图片
  - 旧数据里已经存成 Blob 直链或上游链接的图：读取时自动换成本站地址，不用迁移
- **上游 AI 接口由服务端请求**：调用 OpenAI、Claude、Gemini 或中转站的是部署在 Vercel 上的函数，不是你的浏览器，所以不受你本地网络的影响。你的电脑只需要能打开 Prism 自己的域名。
- **图片地址带签名**：每个 `/api/files/...` 地址都带一个用 `PRISM_SECRET` 算的签名 `s=`。带签名的地址谁拿到都能打开，浏览器和 Vercel CDN 缓存一年（API 客户端拿到的图片 url、导出的 Markdown 用的就是它）；去掉签名的地址必须登录后才能打开，而且只让浏览器自己缓存。真正的 Blob 地址不会出现在页面和接口返回里。
- **外链转发有防护**：转发外部图片时不允许访问内网和保留地址（重定向的每一跳都检查），只接受图片，最大 20MB，20 秒超时。

每个外部域名在哪里用到、现在怎么处理的，见 [`docs/external-domains.md`](docs/external-domains.md)（外部域名核对清单）。

#### 绑定自己的域名（建议）

Vercel 默认给的 `*.vercel.app` 域名在国内能不能稳定访问，我们没有实测，建议绑一个自己的域名。下面以子域名 `prism.example.com` 为例（换成你自己的）：

1. 打开 Vercel 上的 Prism 项目，进入 **Settings → Domains**，点 **Add Domain**，输入 `prism.example.com` 并保存。
2. Vercel 会在这个域名下面显示要添加的 DNS 记录：
   - **子域名**（如 `prism.example.com`）：加一条 **CNAME** 记录。主机记录填 `prism`，记录值填 Vercel 显示的值。每个项目的值都不一样，形如 `d1d4fc829fe7bc7c.vercel-dns-017.com`，请以页面上显示的为准，直接复制。
   - **根域名**（如 `example.com`）：加一条 **A** 记录，主机记录填 `@`，记录值同样复制 Vercel 页面上显示的。添加根域名时 Vercel 会建议同时加上 `www`。
   - 如果 Vercel 提示要验证域名归属，再按页面上的值在 `_vercel` 下加一条 **TXT** 记录。
3. 到你的域名服务商（阿里云、腾讯云 DNSPod、Cloudflare 等）的 DNS 解析页面添加上面的记录。同一个主机名下不要同时留着别的 A、AAAA 或 CNAME 记录，否则会冲突。只改这一条记录就行，不需要把整个域名的 DNS 搬到 Vercel。
4. 等几分钟到几小时 DNS 生效，回到 **Settings → Domains**，看到域名状态变成配置正确、证书签发好后，就可以用 `https://prism.example.com` 打开了。
5. 在客户端里把 Base URL 换成新域名（`https://prism.example.com/v1` 等），令牌不用变。

Vercel 的官方说明：<https://vercel.com/docs/domains/working-with-domains/add-a-domain>

#### 还要注意

- **登录 Aiven、Vercel 控制台**：这两个控制台本身是外部网站，你在浏览器里打开它们时需要它们能访问。Prism 的页面上只有「数据库睡着了」提示里的 Aiven 控制台链接，是你点了才会打开的。
- **渠道的 Base URL 链接**：渠道页上的 Base URL 是超链接，点了会在新标签页直接打开上游地址，这一步是你的浏览器在访问，和 Prism 本身能不能用无关。
- **模型回答里的普通链接**：回答里的文字链接点了才会打开，打不打得开取决于对方网站。

### 从旧版 Upstash 迁移数据

以前用 Upstash Redis（Vercel KV）部署过、里面有渠道和对话的话，可以用自带的脚本一次搬进 MySQL。登录密码、渠道和加密的上游 Key、对话、图库、请求日志、设置、引导进度、访问令牌都会搬过去。在你自己的电脑上操作，需要 Node.js 20 或更新版本：

1. 找到旧数据库的 REST 地址和令牌：Vercel 项目 **Settings → Environment Variables** 里的 `KV_REST_API_URL` 和 `KV_REST_API_TOKEN`（或 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`），点眼睛图标显示后复制。也可以在 <https://console.upstash.com> 打开数据库，在 REST API 一栏复制。
2. 在解压出的项目目录里执行 `npm install`，把 Aiven 的 `ca.pem` 也放进这个目录。
3. 先试读一遍，只统计不写入：

   ```bash
   UPSTASH_REDIS_REST_URL='https://xxx.upstash.io' \
   UPSTASH_REDIS_REST_TOKEN='旧令牌' \
   DATABASE_URL='mysql://avnadmin:密码@mysql-xxxx.aivencloud.com:端口/defaultdb?ssl-mode=REQUIRED' \
   DATABASE_CA_FILE=./ca.pem \
   npm run migrate -- --dry-run
   ```

   会打印读到多少个键、多少条日志、多少张图片。
4. 没问题就去掉 `--dry-run` 再跑一次，看到「迁移完成」就好了。全部写入在一个事务里，中途出错会整个回滚。
5. 确认 Vercel 里的 `PRISM_SECRET` 和以前一样（不一样的话上游 Key 解不开），填好 `DATABASE_URL` / `DATABASE_CA_CERT` 后 Redeploy，用原来的密码登录。

几点说明：

- 目标库里已经有 Prism 数据时（比如新站已经走过一遍引导），脚本会拒绝写入，免得覆盖。确定要用旧数据覆盖，加 `--overwrite`。
- 存在旧 Redis 里的图片会搬进 `prism_files` 表，图片地址不变。存在 Vercel Blob 里的图片不用搬，继续从 Blob 读，所以别删 Blob。
- 如果 Upstash 因为超额连读取也拒绝，脚本会停下并显示 Upstash 返回的错误。这时要等 Upstash 额度重置，或者临时升级一下再搬。
- 本地开发时存的 `.data/kv.json` 也能搬：`npm run migrate -- --from-file .data/kv.json`。

### 数据库容量、快满提醒和休眠提示

**数据库容量**：在 **设置 → 数据库容量** 里能看到：

- 已经用了多少、占总额度（默认 1GB，`DB_QUOTA_MB` 可调）的比例
- 按图片、会话、请求日志、用量统计、其他分开的大小和条数
- 清理旧数据：先选类型（请求日志、用量统计、图片、会话）和时间（7、30、90、180 天前，或全部），点预览会告诉你要删多少条、大约多大；确认后才真的删除。删完会整理一下表，把空间还给磁盘。删了会话，左栏马上更新。

几点说明：

- 数字来自 MySQL 的 `information_schema`，只算 Prism 所在库的表。Aiven 自己的系统表和日志也占一点，以 Aiven 控制台为准。
- 删请求日志会把对应的日志详情一起删掉；删用量统计后，用量页里那段时间的趋势和花费会跟着消失；删图片只删存在数据库里的图，存在 Vercel Blob 里的不受影响，用到这些图的对话和图库会显示不出来。删掉的数据找不回来。
- 用的是本地文件存储（没配 `DATABASE_URL`）时，这里只显示提示，不用清理。

**快满提醒**：已用空间超过额度的 80%（`DB_WARN_PERCENT` 可调）时，棱音会在页面顶部提醒你，带「去清理」按钮，点「知道了」后 24 小时内不再提醒。这个数字是页面启动时顺带读到的，服务端每 6 小时最多重新量一次，不会额外轮询数据库。

**数据库睡着了**：Aiven 免费档长期不用会被关机。连不上数据库时，页面（包括登录页和引导页）会显示棱音的「数据库睡着了」，附上叫醒的四步：

1. 打开 Aiven 控制台（console.aiven.io）并登录
2. 进入 Prism 用的项目，点左边的 Services，找到那个 MySQL 服务（状态显示 Powered off）
3. 点进服务的 Overview 页，右上角 Actions → Power on service
4. 等状态变成 Running，回来点「重试」

连接数满了时会显示「数据库有点忙」，账号、密码或证书不对时会显示「数据库连不上」并提示检查 `DATABASE_URL` 和 `DATABASE_CA_CERT`。这时：

- 站内接口返回 503 和中文说明。
- 对外接口按 OpenAI、Claude、Gemini 各自的错误格式返回 503（Gemini 格式是 `UNAVAILABLE`），并带 `Retry-After: 30`，会自动重试的客户端会稍后再试。
- 发现连不上后，15 秒内不再去连，页面能马上显示提示；第一次发现要等一次连接超时，大约 10 秒。

### Aiven 免费 MySQL 的限制

- **配置**：1 个 CPU、1GB 内存、1GB 存储空间。自用的渠道、对话和日志用不了多少，主要是图片占地方，所以默认给图片设了 300MB 上限。
- **连接数**：免费档最多 76 条连接。Prism 每个函数实例最多开 3 条，空闲 10 秒就关，自用不会碰到上限。
- **长期不用会被关机**：Aiven 会把一段时间没有使用的免费服务关机，关机前会发邮件通知。被关机后网站会打不开，报错信息里会提示「连不上 MySQL」，到 Aiven 控制台点 **Power on** 就能恢复，数据还在。不想被关机可以升级到付费的 Developer 档。
- **区域**：免费档不能选云厂商和区域，Aiven 也保留随时调整的权利。区域变了的话，记得同步调整 Vercel 的函数区域。
- **CA 证书会轮换**：Aiven 会定期更换项目的 CA 证书，换的时候会提前通知。收到通知后，把控制台里新的证书（可能是两张连在一起）重新填进 `DATABASE_CA_CERT` 并 Redeploy，不然证书校验会失败。

---

## 二、环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PRISM_SECRET` | 线上必填 | 加密上游 Key、签发登录凭证用的密钥，建议 32 位以上随机字符。**部署后不要改**，改了之后已保存的 Key 解不开，需要重新填，所有人也会被登出。 |
| `DATABASE_URL` | 线上必填 | Aiven MySQL 的 Service URI：`mysql://avnadmin:密码@主机:端口/defaultdb?ssl-mode=REQUIRED`。也认 `MYSQL_URL`。本地不填时存在 `.data/kv.json`。 |
| `DATABASE_CA_CERT` | 强烈建议 | Aiven 的 CA 证书，整段 PEM 或它的 base64。填了才会校验数据库的证书；不填时连接仍然加密，但不校验对方身份。本地开发也可以用 `DATABASE_CA_FILE=./ca.pem` 指向文件。 |
| `BLOB_READ_WRITE_TOKEN` | 可选 | Vercel Blob 令牌，存图片用。不填时图片压缩后存进 MySQL。 |
| `BLOB_ACCESS` | 可选 | `public`（默认）或 `private`，和你的 Blob 存储设置一致即可。 |
| `ACCESS_PASSWORD` | 可选 | 访问密码。设了就跳过引导第一步，设置页也不能改密码。不设时在首次引导里设，哈希后存在数据库里。 |
| `PRISM_API_TOKEN` | 可选 | 一个固定的对外接口令牌，和页面上生成的令牌同时有效；在页面上重置令牌不影响它。 |
| `DB_POOL_SIZE` | 可选 | 每个函数实例最多开几条数据库连接，默认 3，最大 10。免费 MySQL 总共只允许 76 条连接。 |
| `DB_IMAGE_MAX_KB` | 可选 | 图片存进 MySQL 时单张的目标上限，默认 800。 |
| `DB_IMAGES_MAX_MB` | 可选 | 存进 MySQL 的图片总量上限，默认 300，超出后删最早的图。 |
| `PRISM_TZ` | 可选 | 用量统计按哪个时区分天，默认 `Asia/Shanghai`。 |
| `PRISM_CACHE_TTL` | 可选 | 每个函数实例在内存里缓存渠道、设置这类数据的秒数，默认 30。填 0 就每次都读库（更慢）。 |
| `DB_QUOTA_MB` | 可选 | 数据库总额度（MB），用来算容量占比和快满提醒，默认 1024（Aiven 免费档的 1GB）。升级了 Aiven 套餐就改成新的大小。 |
| `DB_WARN_PERCENT` | 可选 | 已用空间超过百分之多少时在页面顶部提醒，默认 80，可填 1 到 99。 |

改完环境变量都要 Redeploy 一次才生效。

---

## 三、在客户端里使用

登录后打开左栏 **令牌与接口**，可以复制 Base URL 和令牌。下面的 `https://prism.example.com` 换成你的域名，`sk-prism-xxx` 换成你的令牌。

### OpenAI 兼容客户端

Cherry Studio、LobeChat、NextChat、ChatBox、沉浸式翻译、各种编辑器插件等：

- **API 地址 / Base URL**：`https://prism.example.com/v1`。有些客户端会自己加 `/v1`，那就填 `https://prism.example.com`。填错时一般会报 404，换另一种写法即可。
- **API Key**：你的令牌。
- **模型**：点客户端的「获取模型列表」，会列出你在渠道里勾选的所有模型和别名，包括 Claude 和 Gemini 的模型，用 OpenAI 格式就能调。

```bash
curl https://prism.example.com/v1/chat/completions \
  -H "Authorization: Bearer sk-prism-xxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-5","messages":[{"role":"user","content":"你好"}],"stream":true}'
```

Python（openai 库）：

```python
from openai import OpenAI
client = OpenAI(base_url="https://prism.example.com/v1", api_key="sk-prism-xxx")
print(client.chat.completions.create(model="gemini-2.5-flash", messages=[{"role": "user", "content": "你好"}]).choices[0].message.content)
```

### Claude 格式（Claude Code、Anthropic SDK 等）

- Base URL：`https://prism.example.com`（不加 `/v1`，SDK 会自己拼 `/v1/messages`）
- Key：你的令牌

```bash
export ANTHROPIC_BASE_URL=https://prism.example.com
export ANTHROPIC_API_KEY=sk-prism-xxx
```

### Gemini 格式

- Base URL：`https://prism.example.com`（请求路径是 `/v1beta/models/{model}:generateContent`）
- Key：你的令牌，放在 `x-goog-api-key` 请求头或 `?key=` 参数里都行

### 对外接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/chat/completions` | OpenAI 格式对话，支持流式 |
| POST | `/v1/messages` | Claude 格式对话，支持流式 |
| POST | `/v1beta/models/{model}:generateContent` | Gemini 格式对话 |
| POST | `/v1beta/models/{model}:streamGenerateContent` | Gemini 格式流式对话 |
| POST | `/v1/images/generations` | 生图（OpenAI 格式，支持 `n`（最多 4）、`size`、`quality`、`response_format`） |
| GET | `/v1/models` | 模型列表（OpenAI 格式，同时带上 Claude 客户端需要的字段，两种客户端都能读） |
| GET | `/v1beta/models` | 模型列表（Gemini 格式） |

令牌可以放在 `Authorization: Bearer`、`x-api-key`、`x-goog-api-key` 或 `?key=` 里。

---

## 四、页面说明

- **聊天**：模型选择器按渠道分组、可搜索、带「对话 / 识图 / 生图」标签；「对话 / 生图」切换，或者输入 `/图 描述` 直接生图。图片可下载、重新生成、以此继续改。
- **渠道**：添加 / 编辑 / 删除渠道；Base URL 显示成超链接（新标签页打开）；获取模型并勾选、手动调整能力标签；模型别名；优先级（数字越小越优先）；超时；测试延迟和全部测速；启用 / 停用。超时自动停用的渠道会显示提醒，重新测试通过后自动恢复。
- **令牌与接口**：Base URL 和默认令牌（可显示、复制、重置）、各类客户端的填法、全部接口、可复制的 curl 示例；下面是分权限的令牌列表，见「新功能怎么用」。
- **请求日志**：最近 500 条请求，含来源、模型、实际走的渠道、耗时与首字时间、Token 用量、切换次数、报错详情；可筛选、搜索、清空。展开一条能看详情和一键重放。
- **用量**：按天的请求数、Token 和估算花费，见「新功能怎么用」。
- **设置**：棱音对你的称呼（「你」「制作人」或自定义）、「让模型也用棱音的口吻」开关（只影响聊天页）、默认系统提示词与温度、提示词预设、主题（跟随系统 / 浅色 / 深色）、修改访问密码、备份与恢复、存储状态、重新看引导、退出登录。
- **图库**：所有生成过的图，可搜索提示词、查看大图、下载、复制提示词、回到对话、删除。

### 新功能怎么用

#### 用量和花费

左栏点 **用量**。

- 顶上切换最近 7 / 30 / 90 天，看总请求数（含失败次数）、输入和输出 Token、估算花费。
- 每日趋势图可以切换看请求数、Token 或花费，鼠标移到柱子上看当天的数字。
- 下面分别按模型、渠道、令牌列出用量，按花费从高到低排（花费一样时按 Token 数）。
- 页面最下方填**模型单价**：每百万 Token 的输入价和输出价，模型名末尾加 `*` 能匹配一系列（比如 `gpt-4o*`），从上往下取第一条匹配的。生图模型可以填「每次」的固定价。货币符号也可以改。
- 花费不存库，是按当前单价现算的：改了单价，历史花费和按金额计的令牌额度都会跟着重算。没填单价的模型，花费按 0 算，页面上会提示有几个模型没填。
- 统计按天分，时区默认北京时间，可以用环境变量 `PRISM_TZ` 改。只保留最近 400 天。

#### 分权限的令牌

在 **令牌与接口** 页下方点 **新建令牌**，可以给它设：

- **能用的模型**：每行一个模型名（也可以用逗号隔开），支持末尾 `*` 通配（比如 `gpt-4o*`）；也可以直接点下面列出的模型来勾选。不填就是不限。
- **额度**：按 Token 总数或按估算金额（金额按「用量」页的单价算）；不填就是不限。
- **过期日期**：不填就是永不过期。

建好后，可以随时停用 / 启用、换新 Key（旧 Key 立刻失效）、把已用额度清零、删除。客户端里把这个 Key 当 API Key 填就行，用法和默认令牌一样。

被限制挡下的请求，会按调用的接口格式返回对应的错误，客户端能直接显示原因：

- 令牌停用或过期：401
- 用了不允许的模型：403
- 额度用完：429（`insufficient_quota`）

默认令牌（页面上方那个）和环境变量 `PRISM_API_TOKEN` 不受任何限制。`/v1/models` 只列出这个令牌能用的模型。

#### 日志详情和一键重放

在 **请求日志** 里点开一条，能看到这次请求和响应的完整内容：

- Authorization、x-api-key、Cookie 这类请求头和请求体里的 key、token、password 字段都会打码。
- 单个字段超过 4000 字会截断，base64 图片换成占位符。请求体最多存 24KB，响应最多存 16KB。
- 和日志一样只留最近 500 条。

点 **一键重放**，会用原来的请求体在服务端再调一次同一个接口，照常走线路选择和失败切换，并新记一条日志和用量，页面上直接显示新结果。被截断过或省略过图片的请求内容已经不完整，只能看，不能重放。

#### 备份和恢复

在 **设置 → 备份与恢复**：

- **导出**：选要备份的内容（渠道、设置、令牌、会话，「设置」里包括提示词预设和模型单价），设一个至少 6 位的备份密码，点「导出加密备份」，浏览器会下载一个 `.prismbak` 文件。文件用备份密码加密（AES-256-GCM），密码丢了就打不开。
- **恢复**：选文件、填备份密码，先看预览：每一类里哪些会被覆盖、哪些是新增、哪些保持不动。勾选要恢复的部分，确认后才写入。恢复按「同一个 ID 就覆盖，其余保留」合并，备份里没有的东西不会被删掉。

备份的几个限制：

- **文件不能超过约 4.5MB**：恢复时文件要上传到 Vercel 函数，Vercel 对请求体的上限是 4.5MB，超过会被拒绝。导出时文件超过 4MB 页面会提醒你。会话多的话，建议把「会话」和其他内容分开导出成两个文件；实在太大，可以在自己电脑上本地运行 Prism，连同一个数据库来恢复。
- **不含图片文件本身**：会话里只保留图片链接。图片存在 Vercel Blob 里的，只要 Blob 还在，链接就能打开；没接 Blob、图片存在 MySQL 里的，换了数据库后这些图片会打不开。
- **上游 Key 要配同一个 `PRISM_SECRET`**：备份里的上游 Key 仍是用 `PRISM_SECRET` 加密后的样子。恢复到 `PRISM_SECRET` 不同的部署上，渠道能恢复，但 Key 解不开，需要重新填，预览时会标出来。

#### 聊天增强

- **提示词预设**：在 **设置 → 提示词预设** 里新建，填名称、系统提示词，可以带一个温度。新对话的空白页会列出预设，点一下就套用；对话中也能在输入框上方的 **系统提示词** 里套用或改本对话的提示词。
- **并排回答**：点输入框上方的 **并排**，再选最多 3 个模型，发出去后当前模型和它们会同时回答同一个问题。点某个回答下面的 **选用这个**，只有它会进入后续对话的上下文。
- **识图提醒**：附了图，但当前模型（或并排里的某个模型）没有「识图」标签时，会提示你换成能识图的模型。标签是按模型名猜的，猜错了可以在渠道编辑里手动改。
- **导出对话**：对话页右上角的导出按钮，可以导出 Markdown（`.md`）或 JSON。

棱音的台词都在 `lib/copy.ts`（数据库休眠提示、容量看板和快满提醒的台词单独放在 `lib/copy-db.ts`），人设提示词是 `lib/copy.ts` 里的 `PERSONA_SYSTEM_PROMPT`，想改口吻直接改这两个文件。

---

## 五、本地开发

需要 Node.js 20 或更新版本。

```bash
npm install
cp .env.example .env.local   # 至少填 PRISM_SECRET
npm run dev                  # http://localhost:3000
```

本地不配 `DATABASE_URL` 时数据存在 `.data/kv.json`，删掉这个文件就是全新开始。想在本地也用 MySQL，填上 `DATABASE_URL`（本地 MySQL 可以写 `mysql://root:密码@localhost:3306/prism`，不加 `ssl-mode` 就不走 SSL）。

### 测试

测试脚本和模拟上游不随发布包提供，需要时请向维护者索取完整开发包。

## 六、已知限制

- **只给自己用**：只有一个访问密码，没有多用户。可以建多个限模型、限额度的令牌分给别的工具，但花费只是按你填的单价估算，不是真实账单。令牌泄露后请尽快在「令牌与接口」里重置或停用。
- **Vercel 执行时长**：对话接口受 Vercel 函数最长执行时间限制。生图接口已设成 300 秒，超长的推理或生图仍可能被截断；具体上限以你的 Vercel 套餐为准。
- **格式互转只覆盖常用字段**：文字、图片、系统提示词、温度 / top_p / 最大长度 / 停止词、用量、流式都会转换。跨格式时，工具调用（function calling / tool use）、思考过程、结构化输出、音频等高级字段不保证可用；需要这些功能时，请用和渠道同一家的格式调用（会原样转发）。
- **失败切换只在开始输出之前**：上游已经开始流式返回后再中断的，不会换线路重试。
- **生图**：对外只提供 OpenAI 格式的 `/v1/images/generations`；上游可以是 OpenAI（及兼容接口）或 Gemini 的生图模型。不支持 `/v1/images/edits` 和视频。
- **图片地址**：页面和接口给出的图片地址都是带签名的本站地址，拿到完整地址的人不用登录也能打开（签名用 `PRISM_SECRET` 算，猜不出来）。去掉签名的地址要登录才能打开。真正的 Blob 地址不会出现在页面上，但如果你用的是 Public Blob，知道 Blob 原地址的人仍然能直接打开。
- **图片经本站转发会占用函数时间和流量**：图片由 Vercel 函数读出再发给浏览器，带签名的地址会被 Vercel CDN 缓存，同一张图之后不会重复读。
- **没接 Blob 时图片会被压缩和清理**：存进 MySQL 的大图会转成 WebP，下载到的也是 WebP；总量超过上限后最早的图会被删掉。要原图、要长期保留，请接 Blob。
- **备份**：文件超过约 4.5MB 时无法在线上恢复，备份不含图片文件本身，详见「备份和恢复」。
- **并排回答和用量**：并排时每个模型都单独计一次请求和用量。
- **免费数据库会被关机**：Aiven 免费 MySQL 长期不用会被关机，打不开网站时先去 Aiven 控制台看看，详见「Aiven 免费 MySQL 的限制」。
- **日志**：日志和日志详情都只保留最近 500 条；详情里敏感字段打码，长内容会截断。
- **模型能力标签**按模型名猜测，可能不准，可以在渠道编辑里手动切换。
- **没有在真实上游上测试过**：自带测试用的是模拟上游。各家接口的细节可能变化，遇到问题先看「请求日志」里的报错。
