import { guard } from "@/lib/server/auth";
import { syncCheck, syncRevert, syncRun } from "@/lib/server/promptlib";
import { withDb } from "@/lib/server/dbguard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 要从 GitHub 下载约 13MB 再重新生成分块，给足时间
export const maxDuration = 300;

/** 查看本地 / 上游版本 */
async function GETHandler() {
  const g = await guard();
  if (g) return g;
  return Response.json(await syncCheck(), { headers: { "Cache-Control": "no-store" } });
}

/** 同步最新数据（新数据完整生成后才切换，失败不影响现有数据） */
async function POSTHandler() {
  const g = await guard();
  if (g) return g;
  try {
    return Response.json({ ok: true, ...(await syncRun()) });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}

/** 恢复成随代码发布的内置数据 */
async function DELETEHandler() {
  const g = await guard();
  if (g) return g;
  await syncRevert();
  return Response.json({ ok: true });
}

export const GET = withDb(GETHandler);
export const POST = withDb(POSTHandler);
export const DELETE = withDb(DELETEHandler);
