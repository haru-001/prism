import { after } from "next/server";
import { guard } from "@/lib/server/auth";
import { readJSON } from "@/lib/server/api";
import { withDb } from "@/lib/server/dbguard";
import { BadRequest, createTask, toView, type SubmitBody } from "@/lib/server/video/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Hugging Face 的 MCP 调用是一次同步长调用，放在这个接口的 after() 里跑，响应先返回任务 id。
 * after() 受这里的 maxDuration 约束：300 秒是 Vercel Hobby（免费）套餐的上限（Pro 默认也是 300）。
 * 任务自己只用 280 秒，留出转存视频的时间；超了按「超时」失败。
 */
export const maxDuration = 300;

async function POSTHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const b = await readJSON<SubmitBody>(req);
  if (!b) return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  try {
    const { task, run } = await createTask(b);
    if (run) after(run);
    return Response.json({ task: toView(task) });
  } catch (e) {
    if (e instanceof BadRequest) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

export const POST = withDb(POSTHandler);
