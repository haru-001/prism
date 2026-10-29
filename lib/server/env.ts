import "server-only";

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const env = {
  accessPassword: process.env.ACCESS_PASSWORD || "",
  apiToken: process.env.PRISM_API_TOKEN || "",
  secret: process.env.PRISM_SECRET || "",
  // Aiven for MySQL 的 Service URI：mysql://avnadmin:密码@主机:端口/defaultdb?ssl-mode=REQUIRED
  databaseUrl: (process.env.DATABASE_URL || process.env.MYSQL_URL || "").trim(),
  // Aiven 控制台里下载的 CA 证书（整段 PEM 或其 base64）；本地也可以用 DATABASE_CA_FILE 指向文件
  databaseCa: process.env.DATABASE_CA_CERT || "",
  databaseCaFile: process.env.DATABASE_CA_FILE || "",
  dbPoolSize: Math.min(10, num(process.env.DB_POOL_SIZE, 3)),
  // 没接 Blob、图片存进 MySQL 时：单张上限（KB）和总量上限（MB），超出总量就删最早的
  imageMaxKB: num(process.env.DB_IMAGE_MAX_KB, 800),
  imagesMaxMB: num(process.env.DB_IMAGES_MAX_MB, 300),
  blobToken: process.env.BLOB_READ_WRITE_TOKEN || "",
  blobAccess: (process.env.BLOB_ACCESS === "private" ? "private" : "public") as "public" | "private",
  isVercel: !!process.env.VERCEL,
  isProd: process.env.NODE_ENV === "production",
};

/** 部署前置条件检查：缺什么就在页面上提示 */
export function setupProblems(): string[] {
  const p: string[] = [];
  if (env.isVercel && !env.secret) p.push("PRISM_SECRET");
  if (env.isVercel && !env.databaseUrl) p.push("DATABASE");
  return p;
}

export function secretOrDev(): string {
  if (env.secret) return env.secret;
  // 本地开发兜底。部署到 Vercel 时 setupProblems() 会拦住
  return "prism-dev-secret-change-me";
}
