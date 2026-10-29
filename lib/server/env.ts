import "server-only";

export const env = {
  accessPassword: process.env.ACCESS_PASSWORD || "",
  apiToken: process.env.PRISM_API_TOKEN || "",
  secret: process.env.PRISM_SECRET || "",
  redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "",
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "",
  blobToken: process.env.BLOB_READ_WRITE_TOKEN || "",
  blobAccess: (process.env.BLOB_ACCESS === "private" ? "private" : "public") as "public" | "private",
  isVercel: !!process.env.VERCEL,
  isProd: process.env.NODE_ENV === "production",
};

/** 部署前置条件检查：缺什么就在页面上提示 */
export function setupProblems(): string[] {
  const p: string[] = [];
  if (env.isVercel && !env.secret) p.push("PRISM_SECRET");
  if (env.isVercel && !(env.redisUrl && env.redisToken)) p.push("REDIS");
  return p;
}

export function secretOrDev(): string {
  if (env.secret) return env.secret;
  // 本地开发兜底。部署到 Vercel 时 setupProblems() 会拦住
  return "prism-dev-secret-change-me";
}
