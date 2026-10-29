import "server-only";

export interface SSEEvent {
  event?: string;
  data: string;
}

/** 逐条解析 SSE（兼容 \r\n、多行 data） */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let event: string | undefined;
  let data: string[] = [];
  const flush = function* () {
    if (data.length) {
      yield { event, data: data.join("\n") };
    }
    event = undefined;
    data = [];
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.search(/\r?\n/)) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(buf[idx] === "\r" ? idx + 2 : idx + 1);
        if (line === "") {
          yield* flush();
          continue;
        }
        if (line.startsWith(":")) continue;
        const c = line.indexOf(":");
        const field = c < 0 ? line : line.slice(0, c);
        let val = c < 0 ? "" : line.slice(c + 1);
        if (val.startsWith(" ")) val = val.slice(1);
        if (field === "event") event = val;
        else if (field === "data") data.push(val);
      }
    }
    buf += dec.decode();
    if (buf.trim()) {
      for (const line of buf.split(/\r?\n/)) {
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        else if (line.startsWith("event:")) event = line.slice(6).trim();
      }
    }
    yield* flush();
  } finally {
    reader.releaseLock();
  }
}

export function sseLine(data: unknown, event?: string): string {
  const d = typeof data === "string" ? data : JSON.stringify(data);
  return (event ? `event: ${event}\n` : "") + `data: ${d}\n\n`;
}

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/** 把异步生成器变成字节流。客户端断开时 cancel 会传到生成器 */
export function streamFrom(gen: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) controller.close();
        else controller.enqueue(enc.encode(value));
      } catch (e) {
        controller.error(e);
      }
    },
    async cancel() {
      await gen.return(undefined);
    },
  });
}
