# 新服装（夏装、运动装、礼服）在各场景的截图。前提同 rinne-visual.py（先跑 ui-test.py）
import os
from playwright.sync_api import sync_playwright

APP = "http://127.0.0.1:3100"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots", "rinne")
os.makedirs(OUT, exist_ok=True)
errors = []

with sync_playwright() as p:
    b = p.chromium.launch()
    import sys
    for o in (sys.argv[1:] or ["summer", "sport", "gown"]):
        for name, vp in [("desk", {"width": 1440, "height": 900}), ("mob", {"width": 390, "height": 844})]:
            ctx = b.new_context(viewport=vp, device_scale_factor=2)
            ctx.add_cookies([{"name": "prism_rinne", "value": f"{o}|on|1", "url": APP}])
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(APP + "/login")
            page.wait_for_timeout(900)
            page.screenshot(path=f"{OUT}/{name}-{o}-login.png")
            page.fill("#pw", "ui-pass-1234")
            page.click("button:has-text('登录')")
            page.wait_for_url(APP + "/")
            page.goto(APP + "/?new=9")
            page.wait_for_timeout(1200)
            page.screenshot(path=f"{OUT}/{name}-{o}-empty.png")
            ctx.close()
    b.close()
print("pageerror:", errors)
