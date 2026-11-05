# 国内访问和数据库功能的界面测试
# 1. 无头浏览器拦下所有非本站请求：每个页面都不应该请求外部域名；页面 HTML 和接口 JSON 里也不应该有浏览器要直接加载的外部资源。
#    旧 Blob 直链、上游临时链接、模型回答里的 Markdown 外链图片都经本站加载，而且真的显示出来。
# 2. 设置页的「数据库容量」：统计、清理预览、确认删除。
# 3. 容量超过提醒线时页面顶部的提醒，点「知道了」后不再出现。
# 4. 数据库连不上时的「数据库睡着了」页面。
# 需要：清空的测试库；用 PRISM_TEST_BLOB_ORIGIN / PRISM_ALLOW_PRIVATE_IMAGE_FETCH 启动的 next start（3100）和 mock（9100）。
# 另外会自己起 3102（连不上的库）和 3105（提醒线 10%、额度 1MB）两个实例，跑完关掉。
import os, re, json, time, signal, subprocess, urllib.request
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

APP = "http://127.0.0.1:3100"
MOCK = os.environ.get("MOCK", "http://127.0.0.1:9100")
OK_HOSTS = {"127.0.0.1:3100", "127.0.0.1:3102", "127.0.0.1:3105"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tests", "shots")
os.makedirs(SHOTS, exist_ok=True)

passed = failed = 0
failures = []


def check(name, cond, info=None):
    global passed, failed
    if cond:
        passed += 1
        print("  ✓", name)
    else:
        failed += 1
        failures.append(name)
        print("  ✗", name, (json.dumps(info, ensure_ascii=False)[:600] if info is not None else ""))


procs = []


def start_next(port, env):
    e = dict(os.environ)
    e.update(env)
    p = subprocess.Popen(["npx", "next", "start", "-p", str(port)], env=e, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, preexec_fn=os.setsid, cwd=ROOT)
    procs.append(p)
    for _ in range(60):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/login", timeout=2)
            break
        except Exception as ex:
            if hasattr(ex, "code"):
                break
            time.sleep(0.5)
    return f"http://127.0.0.1:{port}"


def stop_all():
    for p in procs:
        try:
            os.killpg(p.pid, signal.SIGTERM)
        except Exception:
            pass


# 浏览器要加载的外部资源：img/script/link/source/iframe/video/audio 的 src/href/srcset，以及 CSS 里的 url(...)
RES_TAG = re.compile(r"<(img|script|link|source|iframe|video|audio|embed|object)\b[^>]*?\s(src|href|srcset|data)=[\"']([^\"']+)", re.I)
CSS_URL = re.compile(r"url\(\s*[\"']?(https?:)?//", re.I)


def external_in_html(html):
    bad = []
    for tag, attr, val in RES_TAG.findall(html):
        for v in val.split(","):
            v = v.strip().split(" ")[0]
            if v.startswith("//") or (v.startswith("http") and urlparse(v).netloc not in OK_HOSTS):
                bad.append(f"<{tag} {attr}={v}>")
    if CSS_URL.search(html):
        bad.append("css url(http...)")
    return bad


def image_fields(obj, out):
    if isinstance(obj, list):
        for x in obj:
            image_fields(x, out)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k == "images" and isinstance(v, list):
                out += [x for x in v if isinstance(x, str)]
            elif k in ("url", "src", "thumb") and isinstance(v, str):
                out.append(v)
            else:
                image_fields(v, out)
    return out


def is_local(u):
    return u.startswith("/") or u.startswith("data:") or u.startswith("blob:") or urlparse(u).netloc in OK_HOSTS


def imgs(pg):
    return pg.evaluate("""() => [...document.querySelectorAll('main img')].map(i => ({src: i.getAttribute('src') || '', ok: i.complete && i.naturalWidth > 0}))""")


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 860})
    blocked = []  # 被拦下的外部请求
    leaks = []  # HTML / JSON 里发现的外部资源
    scanned = {"html": 0, "json": 0}

    def route(r):
        u = urlparse(r.request.url)
        if u.scheme in ("http", "https", "ws", "wss") and u.netloc not in OK_HOSTS:
            blocked.append(r.request.url)
            return r.abort()
        return r.continue_()

    def on_response(resp):
        try:
            if urlparse(resp.url).netloc not in OK_HOSTS:
                return
            ct = resp.headers.get("content-type", "")
            if "text/html" in ct or "text/x-component" in ct:
                bad = external_in_html(resp.text())
                scanned["html"] += 1
                if bad:
                    leaks.append({"url": resp.url, "bad": bad[:5]})
            elif "application/json" in ct:
                data = resp.json()
                scanned["json"] += 1
                bad = [x for x in image_fields(data, []) if not is_local(x)]
                if bad:
                    leaks.append({"url": resp.url, "bad": bad[:5]})
        except Exception:
            pass

    ctx.route("**/*", route)
    ctx.on("response", on_response)
    page = ctx.new_page()
    req = ctx.request

    print("\n[0] 准备数据")
    r = req.post(APP + "/api/auth/setup", data={"password": "test1234"})
    check("设密码并登录", r.ok, r.status)
    for base, models, name in [(f"{MOCK}/oaurl", ["dall-e-3"], "临时链接上游"), (f"{MOCK}/oa", ["gpt-4o-mini", "gpt-4o"], "模拟 OpenAI")]:
        c = req.post(APP + "/api/channels", data={"type": "openai", "baseUrl": base, "key": "sk-x", "name": name}).json()["channel"]
        req.patch(APP + f"/api/channels/{c['id']}", data={"models": models})
    req.put(APP + "/api/onboarding", data={"completed": True})
    r = req.post(APP + "/api/images", data={"model": "dall-e-3", "prompt": "界面测试生图", "n": 2})
    check("生图（上游给临时链接）", r.ok and len(r.json().get("images", [])) == 2, r.text()[:200])
    for i in range(3):
        req.post(APP + "/api/chat", data={"model": "gpt-4o-mini", "messages": [{"role": "user", "content": f"你好{i}"}]})
    now = int(time.time() * 1000)
    conv = {
        "title": "旧图片和外链",
        "createdAt": now,
        "messages": [
            {"id": "u1", "role": "user", "text": "看看这张旧图", "images": ["https://abcd1234.public.blob.vercel-storage.com/prism/images/old1.png"], "createdAt": now},
            {"id": "a1", "role": "assistant", "mode": "image", "text": "", "images": [f"{MOCK}/tmpimg/legacy-upstream.png?se=1&sig=2"], "model": "dall-e-3", "createdAt": now},
            {"id": "a2", "role": "assistant", "text": f"回答里的图：\n\n![外链图]({MOCK}/tmpimg/md.png)\n\n![真外网图](https://images.example.com/cat.png)", "model": "gpt-4o-mini", "createdAt": now},
        ],
    }
    r = req.put(APP + "/api/conversations/cnui1", data=conv)
    check("写入带旧链接的对话", r.ok, r.status)

    print("\n[1] 拦截所有非本站请求，逐页检查")
    for path in ["/", "/c/cnui1", "/gallery", "/channels", "/tokens", "/logs", "/usage", "/settings", "/no-such-page"]:
        before = len(blocked)
        page.goto(APP + path)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(600)
        srcs = page.evaluate("""() => [...document.querySelectorAll('img, source, script[src], link[href], iframe, video, audio')].map(e => e.currentSrc || e.src || e.href || '').filter(Boolean)""")
        ext_src = [s for s in srcs if not is_local(s)]
        css_ext = page.evaluate("""() => { const out = []; for (const s of document.styleSheets) { try { for (const r of s.cssRules) { const m = r.cssText.match(/url\\(\\s*["']?(https?:)?\\/\\/[^)]+/g); if (m) out.push(...m); } } catch (e) { out.push('读不到的样式表 ' + s.href); } } return out; }""")
        check(f"{path}：没有请求任何外部域名", len(blocked) == before, blocked[before:])
        check(f"{path}：页面元素和样式里没有外部资源地址", not ext_src and not css_ext, {"src": ext_src, "css": css_ext})
        if path == "/c/cnui1":
            page.screenshot(path=os.path.join(SHOTS, "cn-chat-legacy.png"), full_page=True)
            info = imgs(page)
            bp = [i for i in info if "/api/files/bp/" in i["src"]]
            up = [i for i in info if i["src"].startswith("/api/files/ext") and "legacy-upstream" in i["src"]]
            md = [i for i in info if i["src"].startswith("/api/files/ext") and "md.png" in i["src"]]
            far = [i for i in info if "images.example.com" in i["src"]]
            check("旧 Blob 直链：经本站加载并显示出来", bool(bp) and all(i["ok"] for i in bp), info)
            check("上游临时链接：经本站加载并显示出来", bool(up) and all(i["ok"] for i in up), info)
            check("Markdown 外链图片：经本站转发并显示出来", bool(md) and all(i["ok"] for i in md), info)
            check("连不上的外网图片也只走本站转发，浏览器不直连", bool(far) and all(i["src"].startswith("/api/files/ext?u=") for i in far), info)
        if path == "/gallery":
            info = imgs(page)
            check("图库里的图都是本站地址并显示出来", len(info) >= 2 and all(i["src"].startswith("/api/files/") and i["ok"] for i in info), info)

    anon = b.new_context()
    anon.route("**/*", route)
    ap = anon.new_page()
    before = len(blocked)
    ap.goto(APP + "/login")
    ap.wait_for_load_state("networkidle")
    check("/login（未登录）：没有请求任何外部域名", len(blocked) == before and ap.locator("input[type=password]").count() == 1, blocked[before:])
    anon.close()

    before = len(blocked)
    page.goto(APP + "/")
    page.wait_for_load_state("networkidle")
    box = page.locator("textarea").first
    box.fill("/图 一只猫")
    box.press("Enter")
    page.wait_for_timeout(2500)
    page.wait_for_load_state("networkidle")
    info = imgs(page)
    gen = [i for i in info if i["src"].startswith("/api/files/")]
    check("聊天页 /图：生成的图是本站地址并显示出来", bool(gen) and all(i["ok"] for i in gen), info)
    check("聊天页 /图：没有请求外部域名", len(blocked) == before, blocked[before:])

    check("整个过程里没有任何外部请求被拦下", not blocked, blocked)
    check(f"扫描了 {scanned['html']} 个 HTML / RSC 和 {scanned['json']} 个 JSON 响应：没有外部资源地址", not leaks and scanned["html"] >= 5 and scanned["json"] >= 5, leaks)

    print("\n[2] 设置页：数据库容量")
    page.goto(APP + "/settings#db")
    panel = page.get_by_test_id("db-panel")
    panel.wait_for(timeout=15000)
    used = page.get_by_test_id("db-used").inner_text()
    check("显示已用 / 总额度和百分比", "GB" in used and "%" in used, used)
    cats = page.get_by_test_id("db-categories").inner_text()
    check("分成图片、会话、请求日志、用量统计、其他", all(x in cats for x in ["图片", "会话", "请求日志", "用量统计", "其他"]), cats)
    check("没超过 80% 时不提醒", page.get_by_test_id("db-quota-notice").count() == 0, None)
    logs_before = len(req.get(APP + "/api/logs").json().get("logs", []))
    page.get_by_test_id("db-clean-types").get_by_role("button", name="请求日志").click()
    page.get_by_test_id("db-clean-ages").get_by_role("button", name="全部").click()
    page.get_by_test_id("db-clean-preview").click()
    dlg = page.get_by_test_id("db-clean-confirm")
    dlg.wait_for(timeout=10000)
    txt = dlg.inner_text()
    check("预览：列出会删多少条、多大", logs_before > 0 and f"{logs_before}" in txt and "条日志" in txt and "找不回来" in txt, {"txt": txt, "logs": logs_before})
    check("预览不删数据", len(req.get(APP + "/api/logs").json().get("logs", [])) == logs_before, None)
    page.screenshot(path=os.path.join(SHOTS, "cn-db-clean-confirm.png"))
    page.get_by_test_id("db-clean-apply").click()
    page.get_by_text("清理好啦").first.wait_for(timeout=15000)
    check("确认后提示「清理好啦」，弹窗关闭", dlg.count() == 0, None)
    left = req.get(APP + "/api/logs").json().get("logs", [])
    check("日志真的删掉了", len(left) == 0, len(left))
    check("左栏里有那段对话", page.locator("aside").get_by_text("旧图片和外链").count() >= 1, None)
    page.get_by_test_id("db-clean-types").get_by_role("button", name="会话").click()
    page.get_by_test_id("db-clean-ages").get_by_role("button", name="全部").click()
    page.get_by_test_id("db-clean-preview").click()
    page.get_by_test_id("db-clean-apply").click()
    page.get_by_text("清理好啦").first.wait_for(timeout=15000)
    page.wait_for_timeout(1500)
    check("清理会话后左栏立刻更新", page.locator("aside").get_by_text("旧图片和外链").count() == 0, None)

    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(APP + "/settings#db")
    page.get_by_test_id("db-panel").wait_for(timeout=15000)
    page.get_by_test_id("db-panel").scroll_into_view_if_needed()
    ov = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    page.screenshot(path=os.path.join(SHOTS, "cn-db-panel-mobile.png"))
    check("手机尺寸：容量面板没有横向溢出", ov <= 1, ov)
    page.set_viewport_size({"width": 1280, "height": 860})

    print("\n[3] 容量超过提醒线")
    W = start_next(3105, {"DB_WARN_PERCENT": "10", "DB_QUOTA_MB": "1"})
    wctx = b.new_context(viewport={"width": 1280, "height": 860})
    wctx.route("**/*", route)
    wp = wctx.new_page()
    check("用同一个密码登录这个实例", wctx.request.post(W + "/api/auth/login", data={"password": "test1234"}).ok, None)
    wctx.request.get(W + "/api/db/usage")  # 量一次，写进快照
    wp.goto(W + "/")
    note = wp.get_by_test_id("db-quota-notice")
    try:
        note.wait_for(timeout=10000)
    except Exception:
        pass
    check("页面顶部出现棱音的容量提醒", note.count() == 1 and "数据库已经用了" in note.inner_text(), note.inner_text() if note.count() else None)
    wp.screenshot(path=os.path.join(SHOTS, "cn-db-quota-notice.png"))
    if note.count():
        note.get_by_role("link", name="去清理").click()
        wp.wait_for_url("**/settings#db", timeout=10000)
        wp.get_by_test_id("db-panel").wait_for(timeout=10000)
        check("点「去清理」跳到容量面板，并标出快满", "快满啦" in wp.get_by_test_id("db-panel").inner_text(), wp.get_by_test_id("db-panel").inner_text()[:200])
        wp.goto(W + "/")
        note.wait_for(timeout=10000)
        note.get_by_role("button", name="知道了").click()
        check("点「知道了」后提醒消失", note.count() == 0, None)
        wp.reload()
        wp.wait_for_load_state("networkidle")
        wp.wait_for_timeout(500)
        check("刷新后 24 小时内不再提醒", note.count() == 0, None)
    wctx.close()

    print("\n[4] 数据库连不上")
    D = start_next(3102, {"DATABASE_URL": "mysql://avnadmin:x@127.0.0.1:3399/defaultdb?ssl-mode=REQUIRED"})
    dctx = b.new_context(viewport={"width": 1280, "height": 860})
    dctx.add_cookies([{"name": c["name"], "value": c["value"], "url": D} for c in ctx.cookies()])
    dctx.route("**/*", route)
    dp = dctx.new_page()
    before = len(blocked)
    for path in ["/", "/settings", "/login"]:
        dp.goto(D + path)
        dp.wait_for_load_state("networkidle")
        t = dp.inner_text("body")
        check(f"{path}：显示「数据库睡着了」和 Power on 步骤", "数据库睡着了" in t and "Power on service" in t and "Overview" in t, t[:300])
    check("有重试按钮和 Aiven 控制台链接", dp.get_by_role("button").count() >= 1 and dp.locator("a[href*='console.aiven.io']").count() >= 1, dp.inner_text("body")[:300])
    dp.screenshot(path=os.path.join(SHOTS, "cn-db-sleeping.png"))
    check("休眠页没有请求外部域名（Aiven 只是普通链接）", len(blocked) == before, blocked[before:])
    dctx.close()
    b.close()

stop_all()
print(f"\n结果：{passed} 通过，{failed} 失败")
if failed:
    print("失败项：\n - " + "\n - ".join(failures))
    raise SystemExit(1)
