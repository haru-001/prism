import { preload } from "react-dom";
import { getLibManifest } from "@/lib/server/promptlib";
import { PromptLibrary } from "@/components/prompts/PromptLibrary";

export const metadata = { title: "提示词 · Prism" };

export default async function PromptsPage() {
  // 清单随页面一起下发（不用再请求一次）；首屏索引和页面同时开始下载
  const manifest = await getLibManifest();
  preload(manifest.sx.url + "index.json.gz", { as: "fetch", crossOrigin: "anonymous" });
  return <PromptLibrary manifest={manifest} />;
}
