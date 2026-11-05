/**
 * 浏览器里的图片只访问本站：外链（http/https）一律改成经本站转发的 /api/files/ext?u=...（登录后可用）。
 * 服务端给的地址已经都是本站的，这里兼顾模型回答里的 Markdown 图片和万一漏改的旧数据。
 */
export function imgSrc(u: string): string {
  if (typeof u !== "string" || !/^https?:\/\//i.test(u)) return u;
  if (typeof window !== "undefined") {
    try {
      const x = new URL(u);
      if (x.origin === window.location.origin) return x.pathname + x.search;
    } catch {
      return u;
    }
  }
  return `/api/files/ext?u=${encodeURIComponent(u)}`;
}

/** 站内图片走缩略图（小图省流量），点开或下载仍是原图；data: 图片原样显示 */
export function thumbOf(u: string, w: 256 | 512 | 1024) {
  const s = imgSrc(u);
  return s.startsWith("/api/files/") ? `${s}${s.includes("?") ? "&" : "?"}w=${w}` : s;
}
