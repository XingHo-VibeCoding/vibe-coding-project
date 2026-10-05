# 临时：把两张图的同一横带裁出来上下拼一张，方便肉眼比
import sys
from PIL import Image

a, b, box = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3:7]]
box_t = tuple(box)
ia, ib = Image.open(a).convert('RGB').crop(box_t), Image.open(b).convert('RGB').crop(box_t)
w, h = ia.size
out = Image.new('RGB', (w, h * 2 + 6), (255, 0, 255))
out.paste(ia, (0, 0))
out.paste(ib, (0, h + 6))
dst = sys.argv[7]
out.save(dst)
print(f'cropped {box} from both -> {dst} ({w}x{h * 2 + 6})')
