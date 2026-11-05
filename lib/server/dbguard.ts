import "server-only";
import { isDbDown, type DbDownError } from "./mysql";

/** 前端识别用的错误码：收到就弹出「数据库睡着了」的提示 */
export function dbDownCode(e: DbDownError) {
  return e.kind === "config" ? "db_config" : e.kind === "busy" ? "db_busy" : "db_sleeping";
}

export function dbDownJson(e: DbDownError) {
  return Response.json(
    { error: e.message, code: dbDownCode(e), kind: e.kind },
    { status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" } },
  );
}

/** 包一层站内接口：数据库连不上时返回 503 + 中文说明，而不是 500 和原始报错 */
export function withDb<A extends unknown[]>(h: (...a: A) => Promise<Response> | Response) {
  return async (...a: A): Promise<Response> => {
    try {
      return await h(...a);
    } catch (e) {
      if (isDbDown(e)) return dbDownJson(e);
      throw e;
    }
  };
}
