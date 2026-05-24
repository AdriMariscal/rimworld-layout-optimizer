"""
Smoke test del nuevo app: navega, carga preset, optimiza, lee energía y
links satisfechos. App debe estar corriendo en :5173.
"""
from playwright.sync_api import sync_playwright
import time
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

console = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()
    page.on("console", lambda m: console.append(f"[{m.type}] {m.text}"))
    page.on("dialog", lambda d: d.accept())

    page.goto("http://localhost:5173")
    page.wait_for_load_state("networkidle")
    page.wait_for_selector("h1", timeout=10000)

    print("=== Loaded ===")
    page.screenshot(path="C:/tmp/v2-01-initial.png", full_page=True)

    # First load → preset already populated. Click Optimize.
    print("Clicking Optimize...")
    page.get_by_role("button", name="Optimize", exact=True).click(no_wait_after=True)

    print("Waiting for optimize to finish...")
    start = time.time()
    while time.time() - start < 120:
        try:
            text = page.locator("button").filter(has_text="Optimiz").first.inner_text(timeout=2000)
            if text.strip() == "Optimize":
                break
        except Exception:
            pass
        page.wait_for_timeout(1000)
    elapsed = time.time() - start
    print(f"Optimize done in {elapsed:.1f}s")

    page.screenshot(path="C:/tmp/v2-02-optimized.png", full_page=True)

    # Read state
    state = page.evaluate("""() => {
      const raw = localStorage.getItem('rimworld-layout-optimizer:layout');
      if (!raw) return null;
      return JSON.parse(raw);
    }""")
    if not state:
      print("No state in localStorage")
    else:
      cells = state['cells']
      total = sum(1 for row in cells for c in row if c.get('roomId'))
      print(f"Grid: {state['size']}x{state['size']}, assigned cells: {total}")

    # Read energy text from UI
    energy_text = page.locator("text=/Energía:/").first.inner_text()
    print(f"Energy line: {energy_text}")

    # Read adjacency report
    try:
      report = page.locator("text=/satisfechos/").first.inner_text()
      print(f"Adjacency: {report}")
    except Exception as e:
      print(f"(no adjacency text: {e})")

    print("\n--- Console (last 15) ---")
    for line in console[-15:]:
      print(line)

    browser.close()

print("\nScreenshots at C:/tmp/v2-0{1,2}-*.png")
