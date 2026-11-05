// ===== 渠道 =====
export type ChannelType = "openai" | "claude" | "gemini" | "azure" | "compatible";
export type Cap = "chat" | "vision" | "image";

export interface ChannelStatus {
  ok: boolean;
  latencyMs?: number;
  message?: string;
  at: number;
}

/** 存在数据库里的渠道（keyEnc 为加密后的 Key，绝不下发到浏览器） */
export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  baseUrl: string; // 用户填写的原始地址
  keyEnc: string;
  keyHint: string; // 形如 sk-••••a91
  allModels: string[]; // 上游拉回来的全部模型
  models: string[]; // 已启用的模型
  mapping: Record<string, string>; // 别名 -> 上游模型名
  caps: Record<string, Cap[]>; // 手动指定的能力标签
  priority: number; // 数字越小越优先
  enabled: boolean;
  autoDisabled?: boolean;
  disabledReason?: string;
  timeoutStreak: number; // 连续超时次数
  timeoutMs: number; // 等待上游响应头的超时
  apiVersion?: string; // Azure 用
  status?: ChannelStatus;
  createdAt: number;
  updatedAt: number;
}

/** 下发给浏览器的渠道视图 */
export type PublicChannel = Omit<Channel, "keyEnc"> & { endpoint: string };

// ===== 内部统一格式 =====
export type IPart =
  | { type: "text"; text: string }
  | { type: "image"; url?: string; data?: string; mime?: string };

export interface IMessage {
  role: "user" | "assistant";
  content: IPart[];
}

export interface IChatRequest {
  model: string;
  system?: string;
  messages: IMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string[];
  stream: boolean;
}

export interface IUsage {
  input: number;
  output: number;
}

export type IChatEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "usage"; usage: IUsage }
  | { type: "finish"; reason: string };

export interface IImageRequest {
  model: string;
  prompt: string;
  n: number;
  size?: string; // 1024x1024 / 1024x1536 / 1536x1024 / auto
  quality?: "low" | "medium" | "high";
  refs?: { data: string; mime: string }[];
}

export interface IImageResult {
  b64?: string;
  url?: string;
  mime?: string;
  revisedPrompt?: string;
}

// ===== 对话 =====
export interface MsgError {
  title: string;
  message: string;
  status?: number;
  fix?: "channels" | "settings";
}

export interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "notice";
  text: string;
  images?: string[];
  mode?: "chat" | "image";
  model?: string;
  channel?: string;
  reasoning?: string;
  usage?: IUsage;
  latencyMs?: number;
  error?: MsgError;
  imageMeta?: { prompt: string; size?: string; n?: number; quality?: string; refs?: string[] };
  pending?: boolean;
  /** 并排对比：同一组回答的组号；alt=true 的回答不进入后续上下文 */
  group?: string;
  alt?: boolean;
  createdAt: number;
}

export interface ConversationMeta {
  id: string;
  title: string;
  hasImage: boolean;
  model?: string;
  updatedAt: number;
  createdAt: number;
}

export interface Conversation extends ConversationMeta {
  system?: string;
  temperature?: number;
  messages: ChatMsg[];
}

// ===== 图库 / 日志 / 设置 =====
export interface GalleryItem {
  id: string;
  url: string;
  prompt: string;
  model: string;
  size?: string;
  convId?: string;
  createdAt: number;
}

export interface LogEntry {
  id: string;
  at: number;
  source: "ui" | "openai" | "claude" | "gemini" | "image" | "ui-image";
  model: string;
  upstreamModel?: string;
  channel?: string;
  ok: boolean;
  status?: number;
  latencyMs: number;
  ttfbMs?: number;
  inTokens?: number;
  outTokens?: number;
  stream?: boolean;
  attempts: number;
  error?: string;
  /** 用的哪个令牌（网页聊天是 web） */
  tokenId?: string;
  tokenName?: string;
  /** 有没有存请求/响应详情 */
  detail?: boolean;
  /** 这条是重放哪条日志产生的 */
  replayOf?: string;
}

/** 日志详情：完整的请求和响应（Key 和敏感头已打码，大内容已截断） */
export interface LogDetail {
  id: string;
  at: number;
  request: { method: string; path: string; headers: Record<string, string>; body: string };
  response: { status: number; headers: Record<string, string>; body: string };
  /** 请求体被截断过（或图片被替换成了占位）时不能原样重放 */
  truncated: boolean;
  replayOf?: string;
}

/** API 令牌 */
export interface TokenRecord {
  id: string;
  name: string;
  key: string;
  enabled: boolean;
  /** 能用的模型；空 = 不限。支持末尾 * 通配，如 gpt-4o* */
  models?: string[];
  /** 额度上限：按 token 总量或估算金额；不填 = 不限 */
  quota?: { kind: "tokens" | "cost"; limit: number };
  /** 过期时间（毫秒时间戳）；不填 = 永不过期 */
  expiresAt?: number;
  createdAt: number;
}
export type PublicToken = Omit<TokenRecord, "key"> & { key: string; used?: { tokens: number; cost: number } };

/** 模型单价：每百万 token 的价格，按模型名匹配（支持末尾 * 通配） */
export interface PriceRule {
  pattern: string;
  input: number;
  output: number;
  /** 每次请求固定价（生图模型常用） */
  perRequest?: number;
}
export interface Pricing {
  currency: string;
  rules: PriceRule[];
}

/** 提示词预设 */
export interface Preset {
  id: string;
  name: string;
  system: string;
  temperature?: number;
}

export interface Settings {
  callMode: "you" | "producer" | "custom";
  customName: string;
  personaInModel: boolean;
  defaultModel?: string;
  defaultImageModel?: string;
  defaultSystem: string;
  temperature: number;
  /** 棱音的服装（衣柜里九套之一） */
  rinneOutfit?: "suit" | "gown" | "summer" | "home" | "trench" | "qipao" | "bridal" | "sport" | "winter";
  /** 按时间、季节自动换装（衣柜里选的那套作为工作日白天的默认） */
  rinneAuto?: boolean;
  /** 换装动效：跟随系统 / 开 / 关 */
  rinneMotion?: "system" | "on" | "off";
  /** 是否在界面里显示棱音的立绘 */
  rinneShow?: boolean;
}

export interface Onboarding {
  completed: boolean;
  seenTips: string[];
}

export interface ModelOption {
  id: string; // 对外暴露的模型名（可能是别名）
  upstream: string;
  caps: Cap[];
}

export interface ModelGroup {
  channelId: string;
  channelName: string;
  type: ChannelType;
  disabled: boolean;
  reason?: string;
  models: ModelOption[];
}
