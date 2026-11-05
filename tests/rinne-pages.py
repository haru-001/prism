# 各功能页页首的棱音截图（前提：先跑 ui-test.py，库里有渠道、请求记录）
# 用法：python tests/rinne-pages.py [outfit ...]
import os
import sys
from playwright.sync_api import sync_playwright

APP = "http://127.0.0.1:3100"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots", "pages")
os.makedirs(OUT, exist_ok=True)
outfits = sys.argv[1:] or ["suit", "winter"]
errors = []
heads = {}

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, vp in [("desk", {"width": 1440, "height": 900}), ("mob", {"width": 390, "height": 844})]:
        ctx = b.new_context(viewport=vp, device_scale_factor=2)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(APP + "/login")
        page.fill("#pw", "ui-pass-1234")
        page.click("button:has-text('登录')")
        page.wait_for_url(APP + "/")
        for o in outfits:
            r = page.request.put(APP + "/api/settings", data={"rinneOutfit": o, "rinneAuto": False})
            assert r.ok, r.status
            for pg in ["channels", "usage", "tokens", "logs", "settings", "gallery"]:
                page.goto(f"{APP}/{pg}")
                page.wait_for_timeout(900)
                el = page.locator("[data-testid=rinne-page-head]")
                heads[(name, o, pg)] = el.count()
                page.screenshot(path=f"{OUT}/{name}-{o}-{pg}.png")
        ctx.close()
    b.close()
print("pageerror:", errors)
for k, v in heads.items():
    if not v:
        print("没有页首像：", k)
