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
};

export default nextConfig;
