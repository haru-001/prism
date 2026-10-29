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
  // 上游 Key 只在服务端使用，这些包不打进浏览器
  serverExternalPackages: [],
  poweredByHeader: false,
};

export default nextConfig;
