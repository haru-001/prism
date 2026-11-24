/** 提示词库：服务端下发的清单、首屏索引和用户自己的提示词（浏览器、服务端共用的类型） */

export interface LibManifest {
  /** 缓存版本（数据文件地址里已经带了版本号） */
  v: string;
  sx: {
    /** 数据文件前缀：url + "index.json.gz" / "p0.json.gz" / "py.json.gz" */
    url: string;
    ver: string;
    date?: string;
    count: number;
    chunks: number;
    chunk: number;
    py: boolean;
    source: "bundled" | "synced";
    syncedAt?: string;
  };
  r18: { url: string; ver: string; count: number; chunks: number; chunk: number; clothZh: Record<string, string> };
  as: { url: string; ver: string; count: number };
  /** 封面经本站转发（缩略图）：img + 路径 + ?w=360 */
  img: string;
  /** 图床原地址（设置里选「直连图床」时用） */
  imgRemote: string;
}

/** 首屏索引：rows 的列见 cols（id, title, sub, img, likes, nImg, tags, ratio） */
export interface SxIndex {
  cols: string[];
  majors: [string, string | null][];
  subs: [string, number][];
  nsfwMajors: number[];
  nsfwSubs?: number[];
  hot: string[];
  chunk: number;
  rows: [number, string, number, string, number, number, string, string][];
}

/** 正文分块里的一条：[提示词, 图片路径[]] */
export type SxBody = [string, string[]];

/** R18 英文精选：[英文, 裸露 0/1/2, 比例, 男, 女, 服装[], 哈希] */
export type R18Row = [string, number, string, number, number, string[], string];
/** 亚洲写真精选范例：[英文, 裸露, 比例, 标题, 中文, 分类, 哈希] */
export type AsRow = [string, number, string, string, string, string, string];

/** 用户自己写的提示词（存在服务端，跨设备同步） */
export interface UserPrompt {
  id: string;
  title: string;
  prompt: string;
  /** 自定义分类，空 = 未分类 */
  category?: string;
  /** 建议比例，如 2:3 */
  ratio?: string;
  /** 用这条画过的图（第一张作封面） */
  cover?: string;
  createdAt: number;
  updatedAt: number;
}

/** 收藏 / 最近使用：key 形如 sx:123、my:abc、r18:hash、as:hash；text 是填好变量后的提示词 */
export interface SavedPrompt {
  key: string;
  src: "sx" | "my" | "r18" | "as";
  title: string;
  text: string;
  img?: string;
  ratio?: string;
  time: number;
}

export interface PromptDoc {
  items: UserPrompt[];
  favs: SavedPrompt[];
}
