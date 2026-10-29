# Prism · 棱镜

把 OpenAI、Claude、Gemini 和各种 OpenAI 兼容中转站汇到一个地址上的自用 AI 网关，自带聊天和生图页面。有一位偶像少女「棱音」陪你配置和使用。可以一键部署到 Vercel。

- **一个地址、一个令牌**：对外同时提供 OpenAI、Claude、Gemini 三种格式的接口，任意格式都能调用任意渠道的模型，自动互转，支持流式。同一家的请求原样转发。
- **线路切换**：同一个模型挂在多条线路上时按优先级走，失败自动换下一条；连续 3 次超时自动停用，棱音会提醒你。
- **聊天与生图**：流式回答、Markdown 与代码高亮、附图识别、`/图` 快捷生图、参考图、图库。
- **安全**：访问密码登录；上游 Key 用 AES-256-GCM 加密存在服务端，页面和接口都不会返回明文。

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
6. 记一下概览页上显示的云厂商和区域（比如 `do-nyc`、`google-europe-west1`），第 4 步会用到。

不用手动建表，Prism 第一次连上时会自动建好 4 张表（`prism_kv`、`prism_hash`、`prism_list`、`prism_files`），都带主键，符合 Aiven 的要求。

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

每次请求 Prism 都要读写数据库，函数和数据库离得越远，每一步越慢。在 Vercel 项目 **Settings → Functions → Function Region** 里，选一个和第 1 步记下的 Aiven 区域同一地区的机房（比如 Aiven 在美国东部，就选 Washington, D.C. `iad1`），保存后 Redeploy。

### 5. 接上 Vercel Blob（可选）

Blob 用来存生成的图片和聊天里上传的图片。不接也能用：图片会压缩后存进 MySQL，并且有总量上限，超出后自动删最早的图（见下面「图片存在哪里」）。图片多、想长期保留的话建议接 Blob。

1. 在 Vercel 项目的 **Storage** 里点 **Create Database**，选 **Blob**。
2. 连接到本项目，Vercel 会自动添加 `BLOB_READ_WRITE_TOKEN`。
3. 再 Redeploy 一次。

Blob 存储选 Public 或 Private 都可以：Public 时图片直接用 Blob 地址；Private 时由 Prism 登录后代为读取。如果你的 Blob 是 Private，可以加一个环境变量 `BLOB_ACCESS=private` 省掉一次失败重试。

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

### 绑定自己的域名（可选）

在 Vercel 项目 **Settings → Domains** 里添加域名，按提示在域名服务商处加 CNAME 记录。`*.vercel.app` 在部分地区访问不稳定，绑自己的域名会好很多。

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
- **令牌与接口**：Base URL 和令牌（可显示、复制、重置）、各类客户端的填法、全部接口、可复制的 curl 示例。
- **请求日志**：最近 500 条请求，含来源、模型、实际走的渠道、耗时与首字时间、Token 用量、切换次数、报错详情；可筛选、搜索、清空。
- **设置**：棱音对你的称呼（「你」「制作人」或自定义）、「让模型也用棱音的口吻」开关（只影响聊天页）、默认系统提示词与温度、主题（跟随系统 / 浅色 / 深色）、修改访问密码、存储状态、重新看引导、退出登录。
- **图库**：所有生成过的图，可搜索提示词、查看大图、下载、复制提示词、回到对话、删除。

棱音的所有台词都在 `lib/copy.ts`，人设提示词是其中的 `PERSONA_SYSTEM_PROMPT`，想改口吻直接改这个文件。

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

`tests/` 里有一个模拟上游和几套测试，不会请求任何真实的 AI 服务。下面用 MySQL 跑；不设 `DATABASE_URL` 就是用本地文件跑。

```bash
npm run build
export DATABASE_URL='mysql://用户:密码@localhost:3306/prism_test?ssl-mode=REQUIRED'
export DATABASE_CA_FILE=./ca.pem          # 本地 MySQL 不走 SSL 的话去掉这行和上面的 ssl-mode
export PRISM_SECRET=test-secret-123
node tests/db-reset.mjs                   # 清空测试库（会删掉 Prism 的 4 张表，别对线上库用）
npx next start -p 3100 &
npm run test:mock &                       # 模拟上游，端口 9100
npm run test:api                          # 接口测试，116 项
```

界面测试用 Playwright（Python），需要先清空测试库再重启一次服务：

```bash
pip install playwright && python -m playwright install chromium
python tests/ui-test.py      # 走一遍引导和所有页面，截图存在 tests/shots/
```

MySQL 专项测试（登录失败计数、日志只留 500 条、图片压缩和总量清理、图库隐藏已清理的图），同样先清空测试库，并用 `DB_IMAGES_MAX_MB=2` 启动服务：

```bash
DB_IMAGES_MAX_MB=2 npx next start -p 3100 &
node tests/mysql-test.mjs
```

迁移测试：对着旧版运行 `node tests/migrate-test.mjs snapshot` 记下数据，跑完迁移脚本后对着新版运行 `node tests/migrate-test.mjs verify` 逐项对比。

---

## 六、已知限制

- **只给自己用**：只有一个访问密码和一个对外令牌，没有多用户、额度和计费。令牌泄露后请尽快在「令牌与接口」里重置。
- **Vercel 执行时长**：对话接口受 Vercel 函数最长执行时间限制。生图接口已设成 300 秒，超长的推理或生图仍可能被截断；具体上限以你的 Vercel 套餐为准。
- **格式互转只覆盖常用字段**：文字、图片、系统提示词、温度 / top_p / 最大长度 / 停止词、用量、流式都会转换。跨格式时，工具调用（function calling / tool use）、思考过程、结构化输出、音频等高级字段不保证可用；需要这些功能时，请用和渠道同一家的格式调用（会原样转发）。
- **失败切换只在开始输出之前**：上游已经开始流式返回后再中断的，不会换线路重试。
- **生图**：对外只提供 OpenAI 格式的 `/v1/images/generations`；上游可以是 OpenAI（及兼容接口）或 Gemini 的生图模型。不支持 `/v1/images/edits` 和视频。
- **图片地址**：用 Public Blob 时，生成的图片拿到地址就能打开（地址含随机串，不会被猜到）。没接 Blob 时的站内图片地址同理。介意的话请用 Private Blob。
- **没接 Blob 时图片会被压缩和清理**：存进 MySQL 的大图会转成 WebP，下载到的也是 WebP；总量超过上限后最早的图会被删掉。要原图、要长期保留，请接 Blob。
- **免费数据库会被关机**：Aiven 免费 MySQL 长期不用会被关机，打不开网站时先去 Aiven 控制台看看，详见「Aiven 免费 MySQL 的限制」。
- **日志**：只保留最近 500 条，不记录请求和回答的正文。
- **模型能力标签**按模型名猜测，可能不准，可以在渠道编辑里手动切换。
- **没有在真实上游上测试过**：自带测试用的是模拟上游。各家接口的细节可能变化，遇到问题先看「请求日志」里的报错。
