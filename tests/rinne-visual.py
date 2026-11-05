# 棱音透明立绘的目视检查：需要先跑完 ui-test.py（密码 ui-pass-1234、已有渠道），服务在 3100
import os, json
from playwright.sync_api import sync_playwright

APP = "http://127.0.0.1:3100"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots", "rinne")
os.makedirs(OUT, exist_ok=True)
errors = []


def login(page):
    page.goto(APP + "/login")
    page.fill("#pw", "ui-pass-1234")
    page.click("button:has-text('登录')")
    page.wait_for_url(APP + "/")
    page.wait_for_timeout(800)


with sync_playwright() as p:
    b = p.chromium.launch()
    for name, vp in [("desk", {"width": 1440, "height": 900}), ("mob", {"width": 390, "height": 844})]:
        ctx = b.new_context(viewport=vp, locale="zh-CN", device_scale_factor=2 if name == "mob" else 1)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(APP + "/login")
        page.wait_for_timeout(1200)
        page.screenshot(path=f"{OUT}/{name}-login.png")
        login(page)
        page.goto(APP + "/?new=1")
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{OUT}/{name}-empty.png")
        # 思考中：让 /api/chat 一直挂着
        page.route("**/api/chat", lambda route: None)
        page.locator("textarea").first.fill("看看思考中的样子")
        page.locator("textarea").first.press("Enter")
        page.wait_for_selector("[data-testid=thinking-scene]", timeout=8000)
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{OUT}/{name}-thinking.png")
        page.unroute("**/api/chat")
        # 报错
        page.goto(APP + "/?new=2")
        page.wait_for_timeout(800)
        page.route("**/api/chat", lambda route: route.fulfill(status=502, content_type="application/json", body=json.dumps({"error": "上游 502：模拟故障"})))
        page.locator("textarea").first.fill("看看报错的样子")
        page.locator("textarea").first.press("Enter")
        page.wait_for_selector("[data-testid=error-scene]", timeout=8000)
        page.wait_for_timeout(1200)
        page.screenshot(path=f"{OUT}/{name}-error.png")
        page.unroute("**/api/chat")
        # 生图返回空：应显示「没有返回图片」卡片
        page.route("**/api/images", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"images": [], "channel": "mock", "latencyMs": 5})))
        page.locator("textarea").first.fill("/图 一只猫")
        page.locator("textarea").first.press("Enter")
        page.wait_for_timeout(1500)
        print(name, "image-empty 卡片：", page.locator("[data-testid=image-empty]").count())
        page.unroute("**/api/images")
        # toast（半身）
        page.evaluate("navigator.clipboard && 0")
        page.goto(APP + "/settings")
        page.wait_for_timeout(1000)
        page.screenshot(path=f"{OUT}/{name}-settings.png", full_page=False)
        # 深色主题下的空对话
        page.emulate_media(color_scheme="dark")
        page.evaluate("document.documentElement.classList.add('dark'); document.documentElement.dataset.theme='dark'")
        page.goto(APP + "/?new=3")
        page.wait_for_timeout(1500)
        page.evaluate("document.documentElement.classList.add('dark'); document.documentElement.dataset.theme='dark'")
        page.wait_for_timeout(300)
        page.screenshot(path=f"{OUT}/{name}-empty-dark.png")
        ctx.close()
    b.close()
print("pageerror:", errors)
