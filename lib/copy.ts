/**
 * 棱音的全部台词都在这里，想改口吻直接改这个文件。
 * {name} 会被替换成设置里的称呼（默认「你」）。
 */
export const PERSONA_NAME = "棱音";

export const copy = {
  persona: {
    tagline: "Prism 的看板偶像，为{name}的每一次灵感应援",
    traits: ["元气", "贴心", "靠谱", "爱应援"],
    hello: "欢迎来到 Prism！我是棱音，线路和模型交给我，{name}只管尽情创作～",
  },

  login: {
    title: "欢迎回来",
    say: "输入访问密码，我们继续今天的演出～",
    wrong: "密码不对哦，再试一次？",
    locked: "尝试太多次啦，先歇 10 分钟再来吧。",
  },

  onboarding: {
    step1Title: "欢迎来到 Prism",
    step1Say: "我是棱音！先设一个访问密码，这个舞台只属于{name}。",
    step1EnvSay: "我是棱音！访问密码已经在环境变量里设好啦，这一步可以直接跳过。",
    step1DoneSay: "访问密码已经设好啦，我们直接下一步～",
    step2Title: "接入第一条线路",
    step2Say: "选一家供应商，填上地址和 Key，剩下的交给我。",
    tipV1: "结尾带不带 /v1 都行，我会自动补齐。",
    tipKey: "Key 加密存在服务端，浏览器里拿不到。",
    tipAzure: "Azure 的模型名填「部署名」，取不到列表时可以手动添加。",
    step3Title: "挑选要用的模型",
    step3Say: "取回 {count} 个模型，连接正常 · {ms}ms。常用的我先帮{name}勾好啦！",
    step3Empty: "连上了，但上游没返回模型列表。可以在下面手动添加模型名。",
    step3Fail: "模型列表没取到：{msg}。可以返回检查地址和 Key，或者手动添加模型名。",
    finish: "完成，去聊天",
    addMore: "再加一条线路",
    skip: "先跳过，稍后在渠道页添加",
  },

  chat: {
    emptyTitle: "准备就绪！今天想创作点什么？",
    emptyNoChannel: "还没有线路哦，先去接一条吧，我在渠道页等{name}～",
    placeholder: "发消息，或输入 /图 直接生图…",
    placeholderImage: "描述你想要的画面，可以拖一张参考图进来…",
    hint: "Enter 发送 · Shift+Enter 换行",
    introTip: "① 换模型 点顶部 · ② 切生图 用这个开关 · ③ 快捷生图 输入 /图",
    gotIt: "知道了",
    imageStart: "画笔交给 {model} 啦，十几秒就好～",
    firstImageTip: "画笔准备好啦，十几秒就好，画完自动收进图库～",
    failover: "{from} 那边有点卡，我已经切到备用线路 {to} 啦，演出继续！",
    autoDisabled: "{channel} 连续 {n} 次超时，我先让它下场休息，请求会转到别的线路。",
    noModel: "先在顶部选一个模型吧～",
    healthStart: "收到！我挨个给线路测个速…",
    healthDone: "体检完成：{ok} 条正常，{bad} 条有问题。{detail}",
    healthNone: "还没有线路可以体检哦，先去渠道页接一条吧。",
    stopped: "已停止生成",
  },

  suggestions: [
    { title: "帮我写段代码", kind: "chat", prompt: "用 TypeScript 写一个带重试和超时的 fetch 封装函数，并解释关键细节。" },
    { title: "画一张海报", kind: "image", prompt: "一只在霓虹雨夜里的橘猫，电影海报风，细节丰富" },
    { title: "看看这张图", kind: "vision", prompt: "" },
    { title: "体检所有线路", kind: "health", prompt: "" },
  ],

  errors: {
    401: "上游说 401，可能是 Key 过期或填错了。我带{name}去渠道页看看好不好？",
    403: "上游说 403，这个 Key 可能没有权限用这个模型。去渠道页检查一下？",
    404: "上游找不到这个模型（404）。可能模型名不对，或者渠道地址少了一截。",
    429: "上游限流了（429），可能是额度用完或请求太快。稍等一下，或者给这个模型加一条备用线路。",
    400: "上游说请求不合规矩（400）：{msg}",
    500: "上游自己出问题了（{status}），稍后再试试，或者换一条线路。",
    timeout: "等了太久上游都没回应，线路可能堵了。可以去渠道页测一下。",
    network: "连不上上游：{msg}。检查一下渠道地址对不对？",
    noChannel: "没有线路提供「{model}」，去渠道页启用它或者换个模型吧。",
    unsupported: "{msg}",
    unknown: "出了点小意外：{msg}",
    firstErrorTip: "第一次碰到线路出错别慌，原因写在上面了，点「去修复」我带你过去。有备用线路时我会自动切换。",
    fix: "去修复",
  },

  status: {
    none: "棱音：还没有线路",
    allGood: "棱音：{n} 条线路满格",
    someResting: "棱音：{n} 条在线，{m} 条在休息",
  },

  channels: {
    empty: "这里空空的。接上第一条线路，舞台就亮起来啦！",
    autoDisabledTip: "它连续 {n} 次超时，我先让它下场休息，请求已转到其他线路啦。",
    fetched: "取回 {count} 个模型，常用的已经勾好。",
    testOk: "正常 · {ms}ms",
  },

  gallery: {
    empty: "图库还是空的。去对话里切到「生图」，或者输入 /图 画第一张吧！",
  },

  logs: {
    empty: "还没有请求记录，发一条消息就有啦。",
  },

  tokens: {
    say: "把这个地址和令牌填进任何 OpenAI 兼容客户端，就能用上我管理的所有线路～",
    resetConfirm: "重置后旧令牌立刻失效，用到它的客户端要换新的。确定重置吗？",
  },
};

/** 模型也用棱音口吻时注入的系统提示词 */
export const PERSONA_SYSTEM_PROMPT = `你现在以「棱音」的身份和用户交流。棱音是 Prism 的看板偶像少女，性格元气、贴心、靠谱、爱应援。
- 称呼用户为「{name}」。
- 语气活泼但不啰嗦，可以偶尔用「～」或一句应援，不要堆砌表情和口头禅。
- 内容必须准确、完整、专业：代码、数据和事实不能因为口吻打折扣。
- 遇到做不到或不确定的事，直接说清原因和下一步。`;

export function callName(mode: "you" | "producer" | "custom", custom?: string) {
  if (mode === "producer") return "制作人";
  if (mode === "custom" && custom?.trim()) return custom.trim();
  return "你";
}

/** 替换 {xxx} 占位符 */
export function fill(tpl: string, vars: Record<string, string | number | undefined> = {}) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k])));
}
