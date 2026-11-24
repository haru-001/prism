/**
 * 把本地的「水仙的AI提示词」数据编译成随代码发布的内置提示词库（public/prompt-lib/sx/<版本>/）。
 * 平时不用跑：网站里「提示词 → 数据更新」会由服务端直接从 GitHub 拉最新数据。
 * 只有想更新仓库里自带的那份数据时才用：
 *
 *   git clone https://github.com/BaYue-SYJ/shuixian-prompts /tmp/sx
 *   node --experimental-strip-types scripts/prompt-lib/build.mjs /tmp/sx/shuixian-unified/data [上游站点 list.part*.json 所在目录]
 *
 * 版本号取 /tmp/sx 的 git HEAD 前 12 位（拿不到就用内容指纹）。
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { buildSx, hashParts, sizesFromLists } from "../../lib/server/promptlib/build.ts";

const dir = process.argv[2];
const listDir = process.argv[3];
if (!dir) {
  console.error("用法：node --experimental-strip-types scripts/prompt-lib/build.mjs <shuixian-unified/data 目录> [list.part 目录]");
  process.exit(1);
}
const read = (f) => fs.readFileSync(path.join(dir, f));
const names = fs.readdirSync(dir).filter((f) => /^prompts\.part\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(12)) - parseInt(b.slice(12)));
const raws = names.map(read);
const dataHash = hashParts(raws);
let ver = "";
let date = "";
try {
  ver = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim().slice(0, 12);
  date = execSync("git log -1 --format=%cI", { cwd: dir }).toString().trim();
} catch {
  ver = dataHash.slice(0, 12);
}
const lists = listDir
  ? fs.readdirSync(listDir).filter((f) => /^list\.part\d+\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(listDir, f), "utf8")))
  : [];
const out = buildSx(
  {
    parts: raws.map((r) => JSON.parse(r.toString("utf8"))),
    categories: JSON.parse(read("categories.json").toString("utf8")),
    meta: JSON.parse(read("meta.json").toString("utf8")),
    pinyin: fs.existsSync(path.join(dir, "pinyin.json")) ? JSON.parse(read("pinyin.json").toString("utf8")) : null,
    sizes: sizesFromLists(lists),
  },
  dataHash,
);
const root = path.join(process.cwd(), "public", "prompt-lib", "sx");
fs.rmSync(root, { recursive: true, force: true });
const dst = path.join(root, ver);
fs.mkdirSync(dst, { recursive: true });
let bytes = 0;
for (const [k, buf] of Object.entries(out.files)) {
  fs.writeFileSync(path.join(dst, k + ".json.gz"), buf);
  bytes += buf.length;
}
const mf = path.join(process.cwd(), "lib", "promptlib-bundled.json");
const cur = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, "utf8")) : {};
cur.sx = { ver, date, count: out.count, chunks: out.chunks, chunk: 250, dataHash, py: !!out.files.py, builtAt: new Date().toISOString() };
fs.writeFileSync(mf, JSON.stringify(cur, null, 2) + "\n");
console.log(`完成：${out.count} 条，${out.chunks} 块，共 ${(bytes / 1048576).toFixed(2)} MB → public/prompt-lib/sx/${ver}/`);
