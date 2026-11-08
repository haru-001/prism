import { guard } from "@/lib/server/auth";
import { readJSON } from "@/lib/server/api";
import { withDb } from "@/lib/server/dbguard";
import { getVideoConfig, recordTest, toPublicVideo, videoKey } from "@/lib/server/video/config";
import { hfWhoami, viewParameters } from "@/lib/server/video/hfmcp";
import { zhipuTest } from "@/lib/server/video/zhipu";
import { classify } from "@/lib/server/video/tasks";
import { isSpaceName, isToolName } from "@/lib/video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 测试连接（都不消耗生成额度）：
 * - { provider: "hf" }：MCP 调 hf_whoami，看令牌认不认、是哪个账号
 * - { provider: "zhipu" }：查一个不存在的任务，Key 不对会是 401
 * - { provider: "hf", space, tool? }：view_parameters 读自填 Space 的参数表，确认它开了 MCP、有哪些参数
 */
async function POSTHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const b = await readJSON<{ provider?: string; space?: string; tool?: string }>(req);
  const provider = b?.provider === "zhipu" ? "zhipu" : b?.provider === "hf" ? "hf" : null;
  if (!provider) return Response.json({ error: "服务不对" }, { status: 400 });
  const key = await videoKey(provider);
  if (!key) return Response.json({ ok: false, message: "还没有添加 Key（或者 PRISM_SECRET 换过，旧 Key 解不开了），请重新添加。" });
  const started = Date.now();
  if (provider === "hf" && b?.space != null) {
    if (!isSpaceName(b.space)) return Response.json({ ok: false, message: "Space 名称格式不对，应为 owner/name，比如 Lightricks/ltx-video-distilled" });
    if (b.tool && !isToolName(b.tool)) return Response.json({ ok: false, message: "工具名只能有字母、数字和下划线" });
    try {
      const v = await viewParameters(key, b.space, b.tool || undefined);
      const names = v.params.map((p) => p.name + (p.file ? "（图片）" : ""));
      return Response.json({ ok: true, tool: v.tool, params: v.params.map((p) => p.name), message: `可以用：工具 ${v.tool}，参数 ${names.join("、") || "（无）"}` });
    } catch (e) {
      const tools = (e as { tools?: string[] }).tools;
      const err = classify(e, "hf");
      return Response.json({ ok: false, tools, message: tools?.length ? `${err.message}\n这个 Space 里的工具：${tools.join("、")}` : err.message });
    }
  }
  try {
    let message: string;
    if (provider === "hf") {
      const w = await hfWhoami(key);
      message = `连接正常：账号 ${w.name}${w.pro ? "（PRO，每天约 40 分钟 GPU）" : "（免费账号，每天约 5 分钟 GPU）"}${w.role ? `，令牌类型 ${w.role}` : ""} · ${Date.now() - started}ms`;
    } else {
      message = `${await zhipuTest(key)} · ${Date.now() - started}ms`;
    }
    const cfg = await recordTest(provider, true, message);
    return Response.json({ ok: true, message, config: toPublicVideo(cfg) });
  } catch (e) {
    const err = classify(e, provider);
    const cfg = await recordTest(provider, false, err.title + "：" + err.message);
    return Response.json({ ok: false, kind: err.kind, message: err.title + "：" + err.message, config: toPublicVideo(cfg ?? (await getVideoConfig())) });
  }
}

export const POST = withDb(POSTHandler);
