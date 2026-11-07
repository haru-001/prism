# 棱音第三轮目视检查：消息旁状态头像、输入框探头、侧边栏小立绘卡片、短视频、深色底边缘。
# 先跑 ui-test.py（密码 ui-pass-1234、已有渠道），服务在 3100
import os, json, glob
from playwright.sync_api import sync_playwright

APP = "http://127.0.0.1:3100"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots", "rinne3")
os.makedirs(OUT, exist_ok=True)
errors = []
IMG = "/img/rinne/wardrobe/" + os.path.basename(sorted(glob.glob(os.path.join(os.path.dirname(__file__), "..", "public/img/rinne/wardrobe/summer-2x.*.webp")))[0])


def login(page):
    page.goto(APP + "/login")
    page.fill("#pw", "ui-pass-1234")
    page.click("button:has-text('登录')")
    page.wait_for_url(APP + "/")
    page.wait_for_timeout(800)


with sync_playwright() as p:
    b = p.chromium.launch()
    for name, scheme in [("light", "light"), ("dark", "dark")]:
        ctx = b.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN", color_scheme=scheme)
        ctx.add_init_script("window.__RINNE_PEEK_MS = 1500")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(APP + "/login")
        page.wait_for_timeout(900)
        print(name, "登录页视频：", page.locator("video[data-rinne-clip]").count())
        page.screenshot(path=f"{OUT}/{name}-login.png")
        login(page)
        page.goto(APP + "/?new=1")
        page.wait_for_timeout(2500)
        print(name, "侧边栏卡片：", page.locator("[data-testid=rinne-side-card]").count(), "探头：", page.locator("[data-testid=rinne-peek]").count())
        page.screenshot(path=f"{OUT}/{name}-empty-peek.png")
        # 正常回复 → 欢迎小头像
        page.locator("textarea").first.fill("你好，简单介绍一下你自己")
        page.locator("textarea").first.press("Enter")
        page.wait_for_timeout(3000)
        # 生图完成 → 成功头像 + 短片
        page.route("**/api/images", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"images": [IMG], "channel": "mock", "latencyMs": 5})))
        page.locator("textarea").first.fill("/图 一只猫")
        page.locator("textarea").first.press("Enter")
        page.wait_for_timeout(2500)
        print(name, "生图完成短片：", page.locator("[data-testid=image-done-scene]").count(), "头像状态：", page.eval_on_selector_all("[data-testid=msg-rinne]", "els => els.map(e => e.dataset.mood)"))
        page.unroute("**/api/images")
        page.screenshot(path=f"{OUT}/{name}-chat.png")
        for pg in ["channels", "usage"]:
            page.goto(f"{APP}/{pg}")
            page.wait_for_timeout(1500)
            page.screenshot(path=f"{OUT}/{name}-{pg}.png")
        ctx.close()
    b.close()
print("页面错误：", errors)
