// 模拟远距离数据库：在本地 MySQL 前面加一层 TCP 代理，每个方向都延迟 DELAY_MS 毫秒（往返就是 2 倍）。
// 只转发字节，SSL 握手照常走，所以握手的多次往返也会被放大，和真实的跨区域连接一样。
// 用法：DELAY_MS=40 LISTEN=3307 TARGET=127.0.0.1:3306 node tests/latency-proxy.mjs
import net from "node:net";

const DELAY = Number(process.env.DELAY_MS ?? 40);
const LISTEN = Number(process.env.LISTEN || 3307);
const [TH, TP] = (process.env.TARGET || "127.0.0.1:3306").split(":");
let conns = 0;

function pipeDelayed(from, to) {
  let last = 0;
  from.on("data", (chunk) => {
    const at = Math.max(Date.now() + DELAY, last);
    last = at;
    setTimeout(() => {
      if (!to.destroyed) to.write(chunk);
    }, at - Date.now());
  });
  from.on("end", () => setTimeout(() => to.end(), Math.max(0, last - Date.now()) + 1));
  from.on("error", () => to.destroy());
}

net
  .createServer((client) => {
    conns++;
    const server = net.connect(Number(TP), TH);
    client.setNoDelay(true);
    server.setNoDelay(true);
    // TCP 建连本身也要一个往返
    server.pause();
    client.pause();
    setTimeout(() => {
      server.resume();
      client.resume();
    }, DELAY * 2);
    pipeDelayed(client, server);
    pipeDelayed(server, client);
    client.on("close", () => server.destroy());
    server.on("close", () => client.destroy());
  })
  .listen(LISTEN, () => console.log(`latency proxy :${LISTEN} -> ${TH}:${TP}, one-way ${DELAY}ms`));

setInterval(() => {}, 1 << 30);
process.on("SIGUSR2", () => console.log("connections so far:", conns));
