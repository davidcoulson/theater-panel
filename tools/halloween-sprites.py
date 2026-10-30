#!/usr/bin/env python3
"""Slice a 3x2 sprite sheet (frames on pure black) into a horizontal strip with real alpha, so the
panel needs no blend modes: alpha = brightness, colour un-premultiplied.
usage: halloween-sprites.py <sheet.png> <out-strip.png> [frame-width] [align]
align pins every frame's solid body to frame 0's bottom and centre, for things that must not bounce (the pumpkin)"""
import sys
from PIL import Image, ImageChops

def unpremultiply(p, a):
    return (*(min(255, c * 255 // a) for c in p), a) if a else (0, 0, 0, 0)


src, out = sys.argv[1], sys.argv[2]
fw = int(sys.argv[3]) if len(sys.argv) > 3 else 280
align = len(sys.argv) > 4 and sys.argv[4] == 'align'
im = Image.open(src).convert('RGB')
W, H = im.size
cw, ch = W // 3, H // 2
fh = round(fw * ch / cw)
strip = Image.new('RGBA', (fw * 6, fh))
ref = None
for i in range(6):
    cell = im.crop(((i % 3) * cw, (i // 3) * ch, (i % 3 + 1) * cw, (i // 3 + 1) * ch)).resize((fw, fh), Image.LANCZOS)
    r, g, b = cell.split()
    alpha = ImageChops.lighter(ImageChops.lighter(r, g), b).point(lambda v: max(0, min(255, round((v - 10) * 255 / 245))))
    out_px = [unpremultiply(p, a) for p, a in zip(cell.getdata(), alpha.getdata())]
    frame = Image.new('RGBA', (fw, fh)); frame.putdata(out_px)
    dx = dy = 0
    if align:
        # solid rows only (a speck or spark does not count): the body's bottom edge and horizontal centre
        solid = alpha.point(lambda v: 255 if v > 100 else 0)
        rows = [y for y in range(fh) if solid.crop((0, y, fw, y + 1)).histogram()[255] >= 20]
        cols = [x for x in range(fw) if solid.crop((x, 0, x + 1, fh)).histogram()[255] >= 20]
        here = ((cols[0] + cols[-1]) // 2, rows[-1])
        ref = ref or here
        dx, dy = ref[0] - here[0], ref[1] - here[1]
    strip.paste(frame, (i * fw + dx, dy))
strip.save(out, optimize=True)
print(out, strip.size)
