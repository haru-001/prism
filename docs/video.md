# 视频生成使用说明

Prism 的聊天页可以直接生成短视频：文生视频、图生视频、首尾帧（给开头和结尾两张图，补出中间的动作）。接了两类服务，都有免费额度，Key 都由你在 **设置 → 视频服务** 里自己添加：

| 服务 | 费用 | 支持的模式 | 速度（粗估，含排队） | 限制 |
| --- | --- | --- | --- | --- |
| **Hugging Face 官方 MCP**（调用开了 MCP 的 ZeroGPU Space） | 免费账号每天约 5 分钟 GPU，PRO 约 40 分钟 | 文生视频 / 图生视频 / 首尾帧 | LTX-Video 几十秒；Wan 2.2 一到两分钟 | 时长 2–8 秒（看 Space）；额度按账号每天计；单次最多等 280 秒 |
| **智谱 BigModel CogVideoX-Flash** | 官方价格表标注「免费」 | 文生视频 / 图生视频（一张图） | 一般一两分钟（异步，排队时会更久） | 不支持首尾帧；时长由智谱决定；并发数看账号等级 |

官方文档：

- Hugging Face MCP 服务：<https://huggingface.co/docs/hub/hf-mcp-server>
- ZeroGPU 额度：<https://huggingface.co/docs/hub/spaces-zerogpu>（「Usage Tiers」一节）
- 访问令牌：<https://huggingface.co/docs/hub/security-tokens>
- 智谱 CogVideoX-Flash：<https://docs.bigmodel.cn/cn/guide/models/free/cogvideox-flash>
- 智谱视频生成接口：<https://docs.bigmodel.cn/api-reference/模型-api/视频生成异步>，查询结果：<https://docs.bigmodel.cn/api-reference/模型-api/查询异步结果>
- 智谱价格表（CogVideoX-Flash 标注免费）：<https://docs.bigmodel.cn/cn/guide/start/pricing>

---

## 一、三分钟上手

1. 打开 **设置 → 视频服务**，添加一个 Key（Hugging Face 令牌或智谱 API Key，两个都加也可以）。
2. 点 **测试连接**。看到「连接正常：账号 xxx」（Hugging Face）或「连接正常，Key 有效」（智谱）就通了。测试不消耗生成额度。
3. 回到聊天页，输入框上方的 **对话 / 生图 / 视频** 切到 **视频**：
   - 选 **文生视频 / 图生视频 / 首尾帧**；
   - 选服务（默认用设置里选的），Hugging Face 还可以选时长（2–8 秒，看 Space 上限）；文生视频可以选横屏、竖屏、方形；
   - 图生视频点「参考图」放一张图，首尾帧放「首帧」「尾帧」两张；
   - 写描述，发送。也可以直接输入 `/视频 描述`。
4. 等待时棱音会告诉你进度：提交 → 排队 → 生成中（显示已用时间和预计时间）→ 转存 → 完成。一般一两分钟出片。
5. 期间可以离开页面或关掉浏览器，生成完会自动存进对话和图库，回来就能看到。

生成好的图片下面也有 **做成视频** 按钮，一键把它当首帧切到图生视频。

## 二、Hugging Face 令牌怎么创建

1. 登录 <https://huggingface.co>（没有账号先注册并验证邮箱）。
2. 打开 <https://huggingface.co/settings/tokens>，点 **Create new token**。
3. **Token type 选 Read**，名字随意（比如 `prism`），点创建。
   - 只读就够了：Prism 只是用你的身份调用公开的 Space，不需要写权限。官方文档对 Read 令牌的说明里也写了可以用于推理。
   - 也可以用 **Fine-grained** 令牌，但**不需要**勾选「Make calls to Inference Providers」——那是付费的 Inference Providers 推理服务的权限，调用 Space 用不到。Fine-grained 令牌具体要勾哪些最少权限，我们没有逐项验证过，不确定时用 Read 最省事。
4. 复制 `hf_` 开头的令牌，粘到 **设置 → 视频服务 → Hugging Face 令牌**，保存。令牌只显示一次，丢了删掉重建即可。

令牌的作用是让 GPU 用量记在你自己的账号上。ZeroGPU 的额度按账号算，带令牌时用你账号的额度（免费账号每天约 5 分钟），不带令牌时按匿名用户算（每天约 2 分钟，而且排队优先级低），所以 Prism 要求先添加令牌。

### 预设的 Space

都在 2026 年 11 月用 MCP 的 `view_parameters` 核对过参数：

| 模式 | Space | 说明 |
| --- | --- | --- |
| 文生视频 | `Lightricks/ltx-video-distilled`（工具 `ltx_video_distilled_generate`） | Lightricks 官方的蒸馏版 LTX-Video，出片快，适合先试效果，最长 8 秒 |
| 图生视频（默认） | `zerogpu-aoti/wan2-2-fp8da-aoti-faster`（工具 `wan2_2_fp8da_aoti_faster_generate_video`） | Hugging Face ZeroGPU 团队维护的 Wan 2.2 14B + Lightning 加速，画质好、动作自然，最长 5 秒 |
| 图生视频（快） | `Lightricks/ltx-video-distilled`（工具 `ltx_video_distilled_generate_1`） | 更快、更省额度，画质略逊于 Wan |
| 首尾帧 | `mcp-tools/wan-2-2-first-last-frame`（工具 `wan_2_2_first_last_frame_generate_video`） | Wan 2.2 首尾帧插帧，最长 5 秒 |

### 用其他 Space

在 **设置 → 视频服务 → Hugging Face 每种模式用哪个 Space** 里选「自填其他 Space」，填 `owner/name`（比如 `Lightricks/ltx-video-distilled`），工具名可以不填（用第一个工具），点 **校验并使用**。

- 只支持开了 MCP 的 Space：Space 页面右上角有「Use via MCP」，或者在 <https://huggingface.co/spaces?filter=mcp-server> 里能搜到。
- 校验只读参数表（`view_parameters`），不消耗 GPU 额度。读不到时会列出这个 Space 里有哪些工具，照着填工具名再校验。
- Prism 按参数名自动对应：`prompt` 填描述，名字里带 image / frame（文件类型）的填参考图（带 end / last 的填尾帧），带 duration 的填时长，有 text-to-video / image-to-video 选项的自动选对应模式。认不出的参数用 Space 自己的默认值。
- Space 名只接受字母、数字和 `. _ -`，格式不对会被拒绝；服务端只会请求 `huggingface.co` 和 `*.hf.space`。

## 三、智谱 API Key 怎么申请

1. 打开 <https://bigmodel.cn>，用手机号注册并登录。
2. 进入 <https://bigmodel.cn/usercenter/proj-mgmt/apikeys>（个人中心 → API Keys），点 **添加新的 API Key**，复制。
3. 粘到 **设置 → 视频服务 → 智谱 API Key**，保存并测试。

CogVideoX-Flash 是免费模型，不需要充值。并发数和你在智谱的账号等级有关，可以在 <https://bigmodel.cn/usercenter/proj-mgmt/rate-limits> 查看。

## 四、免费额度说明

- **Hugging Face ZeroGPU**：按账号每天计 GPU 时长——匿名约 2 分钟、免费账号约 5 分钟、PRO 约 40 分钟；从当天第一次使用起 24 小时后重置。扣的是 Space 实际占用 GPU 的时间（不含排队），几秒的短视频大致占几十秒，所以免费账号一天能出几段，视 Space 和时长而定。额度用完时 Prism 会提示「今天的免费 GPU 额度用完了」，Space 给了恢复时间的话也会一并显示。PRO 账号额度用完后还可以用预充值的 credits 继续（按 HF 的计价）。
- **智谱 CogVideoX-Flash**：官方价格表标注免费。如果提示「账户欠费」（1113），去智谱控制台看看账户状态。

## 五、为什么国内也能用

- 调用 Hugging Face 和智谱的是部署在 Vercel 上的 **Prism 服务端**，不是你的浏览器。你的电脑只需要能打开 Prism 自己的域名。
- 生成好的视频由服务端下载、转存到本站（接了 Vercel Blob 存 Blob，没接存 MySQL），浏览器播放的是 `/api/files/…mp4?s=签名` 这样的本站地址，支持拖动进度条（Range 请求），iPhone / Safari 也能播。
- 视频太大没能转存时，会给一个经本站转发的地址 `/api/files/vext?u=原地址&s=签名`，浏览器同样只访问本站。这种链接依赖服务商的临时文件，过一段时间会失效，界面上会提醒你尽快下载。
- 服务端只会请求这几个域名：`huggingface.co`（MCP 和 Space 信息）、`*.hf.space`（上传参考图、下载视频）、`open.bigmodel.cn`（智谱接口）、`*.bigmodel.cn`（智谱的视频和封面）。下载时拦截内网和保留地址，重定向的每一跳都检查。

## 六、它是怎么跑的（给想改代码的人）

Vercel 函数有最长执行时间（Hobby 套餐 300 秒，Pro 默认也是 300 秒，最多可调到 800 秒），所以视频做成「提交 → 拿任务 id → 前端轮询」：

- `POST /api/video`：校验参数，建一个任务（存在数据库的 `prism:vtask:{id}`，3 天后过期），立刻返回任务 id。
  - Hugging Face：MCP 调用是一次同步长调用，放在这个接口的 `after()` 里继续跑（接口 `maxDuration = 300`）。任务给自己留 280 秒：先把参考图上传到 Space（`/gradio_api/upload`），再通过 `https://huggingface.co/mcp?mix=dynamic_space` 调 `dynamic_space` 工具的 `invoke`，带 `progressToken` 让服务端用 SSE 推排队和进度。CloudFront 偶尔对长调用提前返回 504，时间够的话自动重试一次。
  - 智谱：提交很快，直接在这个请求里交给智谱，拿回智谱的任务 id。
- `GET /api/video/{id}`：前端每 2.5–4 秒问一次。智谱的任务在这里顺便去问一次智谱（最多 2.5 秒一次），成功就下载视频和封面转存。Hugging Face 的任务超过 320 秒还没结果，说明那次函数已经被掐断，按超时处理。
- 完成或失败时，结果同时写回对话里那条消息、图库和请求日志（来源「聊天页视频」）。
- 视频大小上限：接 Blob 时 20MB，存 MySQL 时 15MB（`prism_files.data` 是 MEDIUMBLOB）。存进 MySQL 的视频和图片共用 `DB_IMAGES_MAX_MB` 的总量上限，超出后从最早的开始清理。

相关代码：`lib/video.ts`（预设和类型）、`lib/server/video/`（MCP 客户端、智谱、任务）、`app/api/video/`（接口）、`components/chat/VideoMessage.tsx`（聊天里的视频消息）、`components/VideoPanel.tsx`（设置面板）、`lib/rinne-lines.ts`（棱音的视频台词）。

## 七、常见报错和处理

| 提示 | 原因 | 怎么办 |
| --- | --- | --- |
| 还没添加 Key | 选的服务没有 Key | 设置 → 视频服务 里添加 |
| 今天的免费 GPU 额度用完了 | HF 账号当天的 ZeroGPU 额度不够这次生成 | 缩短时长、换智谱，或等额度重置（第一次使用 24 小时后）；常用可以考虑 HF PRO |
| 生成超时 | Space 排队太久，超过了 Vercel 函数 300 秒的上限 | 把时长调到 2–3 秒，换「LTX-Video」这类快的 Space，或错开高峰再试 |
| 令牌无效 / API Key 无效 | Key 过期、被删除、复制少了字符；或者换过 `PRISM_SECRET`，旧 Key 解不开 | 重新添加后点「测试连接」 |
| Space 不可用 / 找不到 Space | Space 名写错、私有、在出错状态或被作者改了参数 | 换回预设的 Space，或稍后再试；自填的 Space 先点「校验并使用」 |
| 请求太频繁 / 请求太多了 | HF 限流，或智谱并发数满了（1302 / 1305） | 稍等再试 |
| 内容没有通过审核（智谱 1301） | 描述或参考图可能有敏感内容 | 换个说法 |
| 这段视频没能转存 | 视频超过大小上限，或从服务商下载失败 | 播放的是临时链接，尽快点「下载」保存；接上 Vercel Blob 可以放宽到 20MB |
| 任务不见了 | 任务记录只保留 3 天，或数据库被清理过 | 重新生成 |

## 八、已知限制

- 生成时长受 Space 本身限制（预设里最长 5–8 秒），也受 Vercel 300 秒执行时长的限制，太长的视频可能等不到。
- 公共 Space 是社区维护的，参数和可用性可能随时变化；预设失效时可以在设置里换成别的 Space。
- 视频提交后不能中途取消：服务商那边已经开始算了，结果出来照样会存进对话和图库。
- 对外的 OpenAI 兼容接口（`/v1/...`）没有提供视频接口，视频只能在聊天页里生成。
- 备份文件里不含视频服务的 Key（换部署后需要重新添加），也不含视频文件本身，只保留链接。
