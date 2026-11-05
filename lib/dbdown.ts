/** 数据库连不上的几种情况，服务端和浏览器共用（不含界面，放这里让页面不用为它加载提示组件） */
export type DbDownKind = "down" | "busy" | "config";

/** 服务端渲染出错时，错误摘要 digest 形如 PRISM_DB_DOWN，用它判断是不是数据库的问题 */
export function kindFromDigest(digest?: string): DbDownKind | null {
  if (!digest?.startsWith("PRISM_DB_")) return null;
  const k = digest.slice("PRISM_DB_".length).toLowerCase();
  return k === "busy" || k === "config" ? k : "down";
}
