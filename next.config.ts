import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // 数据库驱动和图片压缩库按原样从 node_modules 加载，不经过打包
  serverExternalPackages: ["mysql2", "sharp"],
  poweredByHeader: false,
  // R18 提示词库不放 public（要登录才能读），由 /api/prompt-lib 从这里读出；部署到 Vercel 时要把它打进函数包
  outputFileTracingIncludes: {
    "/api/prompt-lib/[...path]": ["./data/prompt-lib/**/*"],
  },
  // 棱音立绘文件名带内容哈希，内容变了文件名就变，可以让浏览器缓存一年、不再回源确认
  async headers() {
    return [
      {
        source: "/img/rinne/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // 内置提示词库：目录名就是数据版本号，内容不会变
      {
        source: "/prompt-lib/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
