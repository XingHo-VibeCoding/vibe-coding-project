"""Stage 9（纯重构）的「外观没变」物证：逐像素比对两组截图。

用法：
  python tmp/pixel-diff.py <旧目录> <新目录> [--tol 0]
  默认 tol=0：要求完全一致（同一台 Chrome、同一 viewport、同一时间参数，理论上应当 0 差异）。
  差异超过阈值的图会列出「不同像素数 / 最大通道差 / 范围」，并 exit 1。

为什么需要它：Stage 9 只搬 markup、不改样式，DOM 断言看不见「间距差 1px」这类漂移；
而截图比对能看见。前提是两组图用同一脚本、同一 viewport、同一 `?t=` 时间参数拍。
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops

args = [a for a in sys.argv[1:] if not a.startswith('--')]
tol = 0
for a in sys.argv[1:]:
    if a.startswith('--tol'):
        tol = int(a.split('=')[1]) if '=' in a else 0
if len(args) < 2:
    print(__doc__)
    sys.exit(2)
old_dir, new_dir = Path(args[0]), Path(args[1])

names = sorted(p.name for p in old_dir.glob('*.png'))
if not names:
    print(f'旧目录没有 PNG：{old_dir}')
    sys.exit(2)

bad = 0
missing = 0
same = 0
for name in names:
    a, b = old_dir / name, new_dir / name
    if not b.exists():
        print(f'MISS 新目录缺 {name}')
        missing += 1
        continue
    ia, ib = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    if ia.size != ib.size:
        print(f'DIFF {name}: 尺寸不同 {ia.size} → {ib.size}')
        bad += 1
        continue
    diff = ImageChops.difference(ia, ib)
    bbox = diff.getbbox()
    if bbox is None:
        print(f'OK   {name}')
        same += 1
        continue
    hist = diff.convert('L').histogram()
    npx = sum(hist[tol + 1:]) if tol else sum(hist[1:])
    peak = max(i for i, c in enumerate(hist) if c) if any(hist) else 0
    print(f'DIFF {name}: {npx} 个像素不同 / 最大通道差 {peak} / 区域 {bbox}')
    bad += 1

print(f'\n一致 {same} 张；不同 {bad} 张；新目录缺 {missing} 张（旧目录共 {len(names)} 张）')
sys.exit(1 if (bad or missing) else 0)
