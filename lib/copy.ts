/**
 * 棱音的全部台词都在这里，想改口吻直接改这个文件。
 * {name} 会被替换成设置里的称呼（默认「你」）。
 */
export const PERSONA_NAME = "棱音";

export const copy = {
  persona: {
    tagline: "Prism 的专属秘书，替{name}打理线路、模型和账本",
    traits: ["干练", "可靠", "细致", "有分寸"],
    hello: "欢迎回到 Prism。我是棱音，线路和模型由我打理，{name}专心做事就好。",
  },

  login: {
    title: "欢迎回来",
    say: "请输入访问密码，今天的工作我已经准备好了。",
    wrong: "密码不对，请再核对一次。",
    locked: "尝试次数过多，已暂时锁定 10 分钟，请稍后再试。",
  },

  onboarding: {
    step1Title: "欢迎来到 Prism",
    step1Say: "我是棱音，接下来由我协助{name}完成设置。第一步，设一个访问密码。",
    step1EnvSay: "我是棱音。访问密码已在环境变量里设好，这一步可以跳过。",
    step1DoneSay: "访问密码已设好，我们进入下一步。",
    step2Title: "接入第一条线路",
    step2Say: "请选择供应商，填写地址和 Key，其余的我来处理。",
    tipV1: "结尾带不带 /v1 都可以，我会自动补齐。",
    tipKey: "Key 加密保存在服务端，浏览器读取不到。",
    tipAzure: "Azure 的模型名填「部署名」，取不到列表时可以手动添加。",
    step3Title: "挑选要用的模型",
    step3Say: "已取回 {count} 个模型，连接正常 · {ms}ms。常用的几个我已经替{name}勾选好了。",
    step3Empty: "连上了，但上游没返回模型列表。可以在下面手动添加模型名。",
    step3Fail: "模型列表没取到：{msg}。可以返回检查地址和 Key，或者手动添加模型名。",
    finish: "完成，去聊天",
    addMore: "再加一条线路",
    skip: "先跳过，稍后在渠道页添加",
  },

  chat: {
    emptyTitle: "一切就绪。今天要处理什么？",
    emptyNoChannel: "目前还没有可用线路，请先到渠道页接入一条，我在那边等{name}。",
    placeholder: "发消息，或输入 /图 直接生图…",
    placeholderImage: "描述你想要的画面，可以拖一张参考图进来…",
    hint: "Enter 发送 · Shift+Enter 换行",
    presetPick: "用预设开场：",
    noVision: "提醒一下：{model} 没有「识图」标签，可能看不到这张图。",
    compareHint: "选中的回答会作为后续对话的上下文，其余只留作对比。",
    introTip: "① 换模型 点顶部 · ② 切生图 用这个开关 · ③ 快捷生图 输入 /图",
    gotIt: "知道了",
    imageStart: "已交给 {model} 出图，大约十几秒。",
    firstImageTip: "出图大约需要十几秒，完成后会自动归档到图库。",
    failover: "{from} 响应异常，我已切换到备用线路 {to}，不影响继续使用。",
    autoDisabled: "{channel} 连续 {n} 次超时，我已暂停它，请求会转到其他线路。",
    noModel: "请先在顶部选择一个模型。",
    healthStart: "收到，我逐条测一下线路…",
    healthDone: "体检完成：{ok} 条正常，{bad} 条有问题。{detail}",
    healthNone: "目前没有可检测的线路，请先到渠道页接入一条。",
    stopped: "已停止生成",
  },

  suggestions: [
    { title: "帮我写段代码", kind: "chat", prompt: "用 TypeScript 写一个带重试和超时的 fetch 封装函数，并解释关键细节。" },
    { title: "画一张海报", kind: "image", prompt: "一只在霓虹雨夜里的橘猫，电影海报风，细节丰富" },
    { title: "看看这张图", kind: "vision", prompt: "" },
    { title: "体检所有线路", kind: "health", prompt: "" },
  ],

  errors: {
    401: "上游返回 401，Key 可能已过期或填写有误。我带{name}去渠道页核对一下。",
    403: "上游返回 403，这个 Key 可能没有该模型的权限，建议到渠道页检查。",
    404: "上游找不到这个模型（404）。可能是模型名不对，或渠道地址不完整。",
    429: "上游限流（429），可能是额度用完或请求过快。请稍后重试，或给这个模型加一条备用线路。",
    400: "上游认为请求不合规（400）：{msg}",
    500: "上游服务出错（{status}），建议稍后重试或换一条线路。",
    timeout: "上游长时间没有响应，线路可能拥堵，可以到渠道页测一下。",
    network: "无法连接上游：{msg}。请核对渠道地址。",
    noChannel: "没有线路提供「{model}」，请到渠道页启用，或换一个模型。",
    unsupported: "{msg}",
    unknown: "出现了意外情况：{msg}",
    firstErrorTip: "原因已经写在上面，点「去修复」我带{name}过去处理。有备用线路时，我会自动切换。",
    fix: "去修复",
  },

  status: {
    none: "棱音：还没有线路",
    allGood: "棱音：{n} 条线路满格",
    someResting: "棱音：{n} 条在线，{m} 条在休息",
  },

  channels: {
    empty: "还没有线路。接入第一条后，就可以开始工作了。",
    autoDisabledTip: "它连续 {n} 次超时，我已暂停它，请求已转到其他线路。",
    fetched: "取回 {count} 个模型，常用的已经勾好。",
    testOk: "正常 · {ms}ms",
  },

  gallery: {
    empty: "图库还是空的。在对话里切到「生图」，或输入 /图 生成第一张。",
  },

  logs: {
    empty: "还没有请求记录，发出第一条消息后会在这里出现。",
  },

  tokens: {
    say: "把这个地址和令牌填进任何 OpenAI 兼容客户端，即可使用我管理的全部线路。",
    resetConfirm: "重置后旧令牌立刻失效，用到它的客户端要换新的。确定重置吗？",
    multiSay: "每个客户端发一个单独的令牌，就能分别限定能用的模型、额度和过期时间；超出限制时会按客户端用的接口格式返回清楚的错误。默认令牌不受限制。",
    deleteConfirm: "删除「{name}」后，用它的客户端会立刻无法访问。确定删除吗？",
    resetUsageConfirm: "把「{name}」的已用额度清零？历史用量在统计页还能看到。",
    costHint: "金额按「用量」页里填的模型单价估算；没填单价的模型不计费，只按 token 额度才能限住它们。",
  },
  usage: {
    say: "这是各条线路的用量账本。花费按下方填写的单价估算，与上游账单可能略有出入。",
    empty: "这段时间还没有请求记录。",
    unpriced: "这些模型还没填单价，花费按 0 算：",
  },
  backup: {
    say: "备份文件用你设置的密码加密，其中的上游 Key 也保持加密。恢复前我会先列出将被覆盖的内容，确认后才执行。",
    secretWarn: "这些渠道的 Key 用当前的 PRISM_SECRET 解不开（多半是换过 PRISM_SECRET），恢复后要重新填 Key：",
  },

};

/** 模型也用棱音口吻时注入的系统提示词 */
export const PERSONA_SYSTEM_PROMPT = `你现在以「棱音」的身份和用户交流。棱音是 Prism 的专属秘书，干练、可靠、细致、有分寸。
- 称呼用户为「{name}」。
- 语气简洁利落、礼貌克制：先给结论，再给必要的细节和下一步；不用「～」、表情和口头禅，不卖萌。
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
