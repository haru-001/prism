# 浏览器里的速度：首屏 JS 体积、页面可用时间。前提和 bench.mjs 一样（先跑过 bench.mjs setup）。
# 用法：python3 tests/bench-ui.py [输出.json]
import os, json, sys, time, statistics
from playwright.sync_api import sync_playwright

APP = "http://127.0.0.1:3100"
PW = "bench1234"
RUNS = 5
state = json.load(open("/tmp/prism-bench-state.json"))
CONV = state["convId"]

JS_SUM = """() => {
  const r = performance.getEntriesByType('resource');
  const js = r.filter(e => e.initiatorType === 'script' || e.name.endsWith('.js'));
  const img = r.filter(e => e.initiatorType === 'img' || /\\.(jpg|png|webp|svg)(\\?|$)/.test(e.name));
  const css = r.filter(e => e.name.endsWith('.css'));
  const sum = (a, k) => a.reduce((s, e) => s + (e[k] || 0), 0);
  return { jsFiles: js.length, jsGzip: sum(js, 'encodedBodySize'), jsRaw: sum(js, 'decodedBodySize'),
           imgBytes: sum(img, 'encodedBodySize'), cssGzip: sum(css, 'encodedBodySize'),
           html: performance.getEntriesByType('navigation')[0]?.encodedBodySize || 0 };
}"""


def med(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs)) if xs else None


def new_page(b):
    ctx = b.new_context(viewport={"width": 1280, "height": 860}, locale="zh-CN")
    r = ctx.request.post(APP + "/api/auth/login", data={"password": PW})
    assert r.status == 200, r.text()
    return ctx, ctx.new_page()


results = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    # 热身：让服务端编译和连接池就绪
    ctx, page = new_page(b)
    for path in ["/", f"/c/{CONV}", "/channels", "/gallery", "/logs"]:
        page.goto(APP + path)
        page.wait_for_load_state("networkidle")
    ctx.close()

    rows = {k: [] for k in ["home_list", "home_ready", "conv_msgs", "conv_code", "nav_channels", "nav_gallery_img", "nav_logs", "nav_conv"]}
    sizes = {}
    for i in range(RUNS):
        ctx, page = new_page(b)
        # 1) 首页：从导航开始到会话列表和模型选择器都就绪
        t0 = time.perf_counter()
        page.goto(APP + "/", wait_until="commit")
        page.wait_for_selector("aside a[href^='/c/bench']", state="visible")
        rows["home_list"].append((time.perf_counter() - t0) * 1000)
        page.wait_for_selector("text=gpt-4o", state="visible")
        rows["home_ready"].append((time.perf_counter() - t0) * 1000)
        page.wait_for_load_state("networkidle")
        if i == 0:
            sizes["home"] = page.evaluate(JS_SUM)
        # 2) 客户端切到渠道页
        t0 = time.perf_counter()
        page.click("aside a[href='/channels']")
        page.wait_for_selector("text=模拟 OpenAI", state="visible")
        rows["nav_channels"].append((time.perf_counter() - t0) * 1000)
        # 3) 切到图库，等第一张图加载完
        t0 = time.perf_counter()
        page.click("aside a[href='/gallery']")
        page.wait_for_function("() => [...document.querySelectorAll('main img')].some(i => i.complete && i.naturalWidth > 0)")
        rows["nav_gallery_img"].append((time.perf_counter() - t0) * 1000)
        # 4) 切到日志
        t0 = time.perf_counter()
        page.click("aside a[href='/logs']")
        page.wait_for_selector("text=gpt-4o >> nth=0", state="visible")
        page.wait_for_function("() => document.querySelectorAll('main li, main tr, main [data-log]').length > 3 || document.body.innerText.includes('模拟 OpenAI')")
        rows["nav_logs"].append((time.perf_counter() - t0) * 1000)
        # 5) 从左栏点开一个对话
        t0 = time.perf_counter()
        page.click(f"aside a[href='/c/{CONV}']")
        page.wait_for_selector("pre code", state="visible")
        rows["nav_conv"].append((time.perf_counter() - t0) * 1000)
        ctx.close()

        # 6) 直接打开对话页（冷缓存）：消息出现、代码高亮完成
        ctx, page = new_page(b)
        t0 = time.perf_counter()
        page.goto(APP + f"/c/{CONV}", wait_until="commit")
        page.wait_for_selector("text=怎么写一个快速排序 >> nth=0", state="visible")
        rows["conv_msgs"].append((time.perf_counter() - t0) * 1000)
        page.wait_for_selector("pre code.hljs, pre code [class^='hljs-']", state="attached")
        rows["conv_code"].append((time.perf_counter() - t0) * 1000)
        page.wait_for_load_state("networkidle")
        if i == 0:
            sizes["conv"] = page.evaluate(JS_SUM)
        ctx.close()

    # 登录页（未登录）
    ctx = b.new_context()
    page = ctx.new_page()
    page.goto(APP + "/login")
    page.wait_for_load_state("networkidle")
    sizes["login"] = page.evaluate(JS_SUM)
    ctx.close()
    b.close()

labels = {
    "home_list": "打开首页 → 会话列表出现",
    "home_ready": "打开首页 → 模型选择器就绪",
    "conv_msgs": "打开对话页 → 消息出现",
    "conv_code": "打开对话页 → 代码高亮完成",
    "nav_channels": "切到渠道页 → 渠道出现",
    "nav_gallery_img": "切到图库 → 第一张图加载完",
    "nav_logs": "切到日志页 → 日志出现",
    "nav_conv": "左栏点开对话 → 代码块出现",
}
for k, v in rows.items():
    results[k] = med(v)
    print(f"{labels[k]:<28} {results[k]} ms")
for k, s in sizes.items():
    print(f"{k}: JS {s['jsFiles']} 个文件, gzip {s['jsGzip']/1024:.0f} KB, 解压 {s['jsRaw']/1024:.0f} KB, 图片 {s['imgBytes']/1024:.0f} KB, CSS {s['cssGzip']/1024:.0f} KB, HTML {s['html']/1024:.0f} KB")
results["sizes"] = sizes
if len(sys.argv) > 1:
    json.dump(results, open(sys.argv[1], "w"), ensure_ascii=False, indent=2)
