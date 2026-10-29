# Prism · 棱镜

把 OpenAI、Claude、Gemini 和各种 OpenAI 兼容中转站汇到一个地址上的自用 AI 网关，自带聊天和生图页面。有一位偶像少女「棱音」陪你配置和使用。可以一键部署到 Vercel。

- **一个地址、一个令牌**：对外同时提供 OpenAI、Claude、Gemini 三种格式的接口，任意格式都能调用任意渠道的模型，自动互转，支持流式。同一家的请求原样转发。
- **线路切换**：同一个模型挂在多条线路上时按优先级走，失败自动换下一条；连续 3 次超时自动停用，棱音会提醒你。
- **聊天与生图**：流式回答、Markdown 与代码高亮、附图识别、`/图` 快捷生图、参考图、图库。
- **安全**：访问密码登录；上游 Key 用 AES-256-GCM 加密存在服务端，页面和接口都不会返回明文。

---

## 一、一键部署到 Vercel

全程大约 5 分钟，不需要写代码。

### 1. 把代码放到 GitHub

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

### 2. 在 Vercel 导入

1. 打开 <https://vercel.com/new>，用 GitHub 登录，选中刚才的仓库，点 **Import**。
2. Framework Preset 会自动识别成 **Next.js**，构建命令保持默认。
3. 展开 **Environment Variables**，至少添加：

   | 名称 | 值 |
   | --- | --- |
   | `PRISM_SECRET` | 一串 32 位以上的随机字符，可以用 `openssl rand -base64 32` 生成 |

   想用环境变量管理访问密码的话，再加一个 `ACCESS_PASSWORD`；不加也行，首次打开网站时棱音会带你设。
4. 点 **Deploy**。

### 3. 接上 Upstash Redis（必须）

Vercel 的服务器不能长期保存文件，渠道、对话、设置都存在 Redis 里。没接 Redis 时，网站会显示一页配置提示，不会进入登录页。

1. 在 Vercel 项目里打开 **Storage** 标签，点 **Create Database**（或 **Connect Database**）。
2. 在 Marketplace 里选 **Upstash → Redis**，按提示创建。免费额度自用足够；区域建议选离你的 Vercel 函数区域近的。
3. 连接到本项目时勾上 Production、Preview、Development。Vercel 会自动添加 `KV_REST_API_URL` / `KV_REST_API_TOKEN`（或 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`），Prism 两套名字都认。
4. 回到 **Deployments**，对最新一次部署点 **⋯ → Redeploy**，让新变量生效。

也可以直接在 <https://console.upstash.com> 建 Redis 数据库，把页面上的 REST URL 和 REST Token 手动填成 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN`。

### 4. 接上 Vercel Blob（推荐）

Blob 用来存生成的图片和聊天里上传的图片。不接也能用，图片会以 base64 存进 Redis，但会很快吃掉 Redis 的免费空间。

1. 同样在 **Storage** 里点 **Create Database**，选 **Blob**。
2. 连接到本项目，Vercel 会自动添加 `BLOB_READ_WRITE_TOKEN`。
3. 再 Redeploy 一次。

Blob 存储选 Public 或 Private 都可以：Public 时图片直接用 Blob 地址；Private 时由 Prism 登录后代为读取。如果你的 Blob 是 Private，可以加一个环境变量 `BLOB_ACCESS=private` 省掉一次失败重试。

### 5. 打开网站，跟着棱音完成引导

打开 Vercel 给你的域名（`https://xxx.vercel.app`），会自动进入四步引导：

1. **设访问密码**：已经在环境变量里设了 `ACCESS_PASSWORD` 的话直接跳过。
2. **选供应商**：OpenAI / Claude / Gemini / OpenAI 兼容（Azure OpenAI 收在「展开更多」里），填 Base URL 和 Key。Base URL 结尾带不带 `/v1` 都行，会自动补齐，输入框下方会显示实际请求的地址。
3. **获取模型**：自动拉取模型列表，常用模型已经勾好，也可以手动加模型名。可以继续添加更多渠道。
4. **进入聊天页**：棱音会用 ① ② ③ 标出选模型、切换生图、发消息的位置。

引导进度存在服务端，换设备登录不会重复出现。想再看一遍，到 **设置 → 重新看引导**（不会删掉已有渠道）。

### 绑定自己的域名（可选）

在 Vercel 项目 **Settings → Domains** 里添加域名，按提示在域名服务商处加 CNAME 记录。`*.vercel.app` 在部分地区访问不稳定，绑自己的域名会好很多。

---

## 二、环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PRISM_SECRET` | 线上必填 | 加密上游 Key、签发登录凭证用的密钥，建议 32 位以上随机字符。**部署后不要改**，改了之后已保存的 Key 解不开，需要重新填，所有人也会被登出。 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 线上必填 | Upstash Redis 的 REST 地址和令牌。也可以用 `KV_REST_API_URL` / `KV_REST_API_TOKEN`。本地不填时存在 `.data/kv.json`。 |
| `BLOB_READ_WRITE_TOKEN` | 推荐 | Vercel Blob 令牌，存图片用。不填时图片存进 Redis。 |
| `BLOB_ACCESS` | 可选 | `public`（默认）或 `private`，和你的 Blob 存储设置一致即可。 |
| `ACCESS_PASSWORD` | 可选 | 访问密码。设了就跳过引导第一步，设置页也不能改密码。不设时在首次引导里设，哈希后存在 Redis。 |
| `PRISM_API_TOKEN` | 可选 | 一个固定的对外接口令牌，和页面上生成的令牌同时有效；在页面上重置令牌不影响它。 |

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

本地不配 Redis 时数据存在 `.data/kv.json`，删掉这个文件就是全新开始。

### 测试

`tests/` 里有一个模拟上游和两套测试，不会请求任何真实的 AI 服务：

```bash
npm run build
rm -rf .data
PRISM_SECRET=test-secret-123 npx next start -p 3100 &   # 全新数据启动
npm run test:mock &                                     # 模拟上游，端口 9100
npm run test:api                                        # 接口测试，116 项
```

界面测试用 Playwright（Python），需要另外清空 `.data` 重启一次服务：

```bash
pip install playwright && python -m playwright install chromium
python tests/ui-test.py      # 走一遍引导和所有页面，截图存在 tests/shots/
```

---

## 六、已知限制

- **只给自己用**：只有一个访问密码和一个对外令牌，没有多用户、额度和计费。令牌泄露后请尽快在「令牌与接口」里重置。
- **Vercel 执行时长**：对话接口受 Vercel 函数最长执行时间限制。生图接口已设成 300 秒，超长的推理或生图仍可能被截断；具体上限以你的 Vercel 套餐为准。
- **格式互转只覆盖常用字段**：文字、图片、系统提示词、温度 / top_p / 最大长度 / 停止词、用量、流式都会转换。跨格式时，工具调用（function calling / tool use）、思考过程、结构化输出、音频等高级字段不保证可用；需要这些功能时，请用和渠道同一家的格式调用（会原样转发）。
- **失败切换只在开始输出之前**：上游已经开始流式返回后再中断的，不会换线路重试。
- **生图**：对外只提供 OpenAI 格式的 `/v1/images/generations`；上游可以是 OpenAI（及兼容接口）或 Gemini 的生图模型。不支持 `/v1/images/edits` 和视频。
- **图片地址**：用 Public Blob 时，生成的图片拿到地址就能打开（地址含随机串，不会被猜到）。没接 Blob 时的站内图片地址同理。介意的话请用 Private Blob。
- **日志**：只保留最近 500 条，不记录请求和回答的正文。
- **模型能力标签**按模型名猜测，可能不准，可以在渠道编辑里手动切换。
- **没有在真实上游上测试过**：自带测试用的是模拟上游。各家接口的细节可能变化，遇到问题先看「请求日志」里的报错。
