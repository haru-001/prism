# 多实例场景：在实例 B（3101）的设置页加预设，再打开实例 A（3100）的聊天页。
# A 内存里的预设还是旧的（缓存 30 秒），空白页应该在后台重新读库后补上新预设。
# 前提：ui-test.py 已经跑完（密码 ui-pass-1234），3100 和 3101 两个 next start 连同一个 MySQL。
import sys
from playwright.sync_api import sync_playwright

A, B = "http://127.0.0.1:3100", "http://127.0.0.1:3101"
PW = sys.argv[1] if len(sys.argv) > 1 else "ui-pass-1234"
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page()
    page.goto(A + "/login")
    page.fill("input[type=password]", PW)
    page.keyboard.press("Enter")
    page.wait_for_url(A + "/")
    # 让 A 先把预设读进缓存
    page.goto(A + "/")
    page.wait_for_timeout(500)
    # 在 B 上新建预设（cookie 按主机名共享，不分端口）
    cur = page.request.get(B + "/api/presets").json()["presets"]
    r = page.request.put(B + "/api/presets", data={"presets": cur + [{"name": "实例B新增", "system": "来自另一个实例"}]})
    assert r.ok, r.text()
    stale = page.request.get(A + "/api/presets").json()["presets"]
    page.goto(A + "/")
    page.wait_for_selector("[data-testid=preset-row]:has-text('实例B新增')", timeout=8000)
    ok = True
    print("A 缓存里是否还是旧列表:", not any(x["name"] == "实例B新增" for x in stale))
    print("  ✓ 另一个实例加的预设，空白页在后台补上了")
    b.close()
