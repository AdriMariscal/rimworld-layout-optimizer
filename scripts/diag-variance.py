"""
Mide varianza in-browser: ejecuta Optimize N veces y reporta hard unsat,
soft satisfied y energía. App debe estar corriendo en :5173.
"""
from playwright.sync_api import sync_playwright
import time
import sys
import io
import statistics

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

N = 5
if len(sys.argv) > 1:
    N = int(sys.argv[1])

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()
    page.on("dialog", lambda d: d.accept())

    results = []
    for run in range(N):
        # Fresh page each run so RNG/state is independent.
        page.goto("http://localhost:5173")
        page.wait_for_load_state("networkidle")
        page.wait_for_selector("h1", timeout=10000)
        page.evaluate("localStorage.clear()")
        page.reload()
        page.wait_for_load_state("networkidle")

        print(f"\n=== RUN {run + 1}/{N} ===", flush=True)
        start = time.time()
        page.get_by_role("button", name="Optimize", exact=True).click(no_wait_after=True)
        while time.time() - start < 60:
            try:
                text = page.locator("button").filter(has_text="Optimiz").first.inner_text(timeout=2000)
                if text.strip() == "Optimize":
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        elapsed = time.time() - start

        snap = page.evaluate("""() => {
          const raw = localStorage.getItem('rimworld-layout-optimizer:layout');
          if (!raw) return null;
          return JSON.parse(raw);
        }""")
        # Read adjacency summary line.
        try:
            adj = page.locator("text=/satisfechos/").first.inner_text()
        except Exception:
            adj = "?"
        results.append({"run": run + 1, "elapsed": elapsed, "snap": adj})
        print(f"  {adj}  ({elapsed:.1f}s)", flush=True)

    browser.close()

print("\n=== SUMMARY ===")
for r in results:
    print(f"run {r['run']}: {r['snap']}  ({r['elapsed']:.1f}s)")
times = [r['elapsed'] for r in results]
print(f"\nTime: min={min(times):.1f}s max={max(times):.1f}s mean={statistics.mean(times):.1f}s")
