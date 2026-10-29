import { handleImages, preflight } from "@/lib/server/relay/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 生图慢，单独调大函数最长执行时间（Hobby 开启 Fluid Compute 时上限 300 秒）
export const maxDuration = 300;

export const POST = handleImages;
export const OPTIONS = preflight;
