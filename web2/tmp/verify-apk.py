"""APK 三方一致性验证（通用版）
用法: python verify-apk.py <apk路径> [期望版本串 vX.Y]
比对：web2/dist ↔ app/www ↔ APK 内 assets/public 的 assets js/css 逐字节 sha256
"""
import zipfile, hashlib, os, re, sys

"""用法: python web2/tmp/verify-apk.py <apk路径> [期望版本串 vX.Y]
路径按脚本位置推导（web2/tmp → 仓库根），换机器也能跑。"""
APK = sys.argv[1]
WANT = sys.argv[2] if len(sys.argv) > 2 else None
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))          # 主项目根
DIST = os.path.join(ROOT, "web2", "dist")
WWW = os.path.join(ROOT, "..", "vibe-coding-project-app", "www")

def sha(b):
    return hashlib.sha256(b).hexdigest()

z = zipfile.ZipFile(APK)
print("APK:", os.path.basename(APK), os.path.getsize(APK), "bytes")

print("\n--- APK 内 assets/public 条目 ---")
for n in z.namelist():
    if "/assets/" in n:
        print("  %-46s %8d" % (n, z.getinfo(n).file_size))

print("\n--- web2/dist ↔ APK(assets/public) ---")
ok = True
for root, _, files in os.walk(DIST):
    for f in sorted(files):
        p = os.path.join(root, f)
        rel = os.path.relpath(p, DIST).replace("\\", "/")
        inner = "assets/public/" + rel
        a = sha(open(p, "rb").read())
        if inner not in z.namelist():
            print("  ?? APK 内不存在:", inner)
            ok = False
            continue
        b = sha(z.read(inner))
        if rel == "index.html":
            print("  -- %-32s 本地=%s APK=%s（外壳注入改写，预期不同）" % (rel, a[:12], b[:12]))
            continue
        if a != b:
            ok = False
        print("  %s %-32s %s vs %s" % ("OK" if a == b else "!!", rel, a[:12], b[:12]))

print("\n--- web2/dist ↔ app/www ---")
ok2 = True
for root, _, files in os.walk(DIST):
    for f in sorted(files):
        p = os.path.join(root, f)
        rel = os.path.relpath(p, DIST).replace("\\", "/")
        q = os.path.join(WWW, rel)
        if not os.path.exists(q):
            print("  ?? www 缺少:", rel)
            ok2 = False
            continue
        same = sha(open(p, "rb").read()) == sha(open(q, "rb").read())
        if rel == "index.html":
            print("  -- %-32s %s" % (rel, "相同" if same else "不同（外壳注入）"))
            continue
        if not same:
            ok2 = False
        print("  %s %-32s" % ("OK" if same else "!!", rel))

print("\n--- APK 内 index.html 外壳注入 ---")
html = z.read("assets/public/index.html").decode("utf-8", "ignore")
print("  shell.js/shell.css 注入:", ("shell.js?v=" in html and "shell.css?v=" in html))
print("  SHELL_VER =", set(re.findall(r"shell\.(?:js|css)\?v=([0-9a-z]+)", html)))

print("\n--- APK 内 JS / CSS 特征 ---")
ok3 = True
for n in z.namelist():
    if not n.startswith("assets/public/assets/"):
        continue
    if n.endswith(".js"):
        body = z.read(n).decode("utf-8", "ignore")
        print("  JS %s 版本串=%s" % (n.split("/")[-1], sorted(set(re.findall(r"v1\.\d+", body)))))
        if WANT:
            # 界面版本串的口径是「去掉 patch 位」（vite.config.js：1.28.0 → v1.28），
            # 所以拿 v1.36.0 直接比产物里的 v1.36 会永远 False。
            # 这里按显示口径归一化，让这条真的能当闸门用（2026-10-02 修）。
            mver = re.match(r"v(\d+)\.(\d+)", WANT)
            disp = "v%s.%s" % (mver.group(1), mver.group(2)) if mver else WANT
            hit = disp in body
            if not hit:
                ok3 = False
            print("     含版本串 %s（传入 %s，按显示口径去 patch 位）: %s" % (disp, WANT, hit))
        print("     含 truncate 修复（input 类串）:", "truncate rounded-lg border border-line bg-card" in body)
        print("     含 min-w-[3rem] 修复:", "min-w-[3rem] flex-1" in body)
    if n.endswith(".css"):
        css = z.read(n).decode("utf-8", "ignore")
        for m in re.findall(r"\.wheel\[data-v-[0-9a-f]+\]\{[^}]*\}", css):
            dv = re.search(r"data-v-[0-9a-f]+", m).group(0)
            print("  CSS .wheel[%s] 有 touch-action:none=%s / 有 scroll-snap=%s"
                  % (dv, "touch-action:none" in m, "scroll-snap" in m))
        print("  CSS .truncate 定义:", bool(re.search(r"\.truncate\{[^}]*ellipsis", css)))

print("\n结论：dist vs APK =", "一致" if ok else "有差异",
      "｜ dist vs www =", "一致" if ok2 else "有差异",
      "｜ 版本串 =", "命中" if ok3 else "未命中")
sys.exit(0 if (ok and ok2 and ok3) else 1)
