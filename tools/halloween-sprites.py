#!/usr/bin/env python3
"""Slice a 3x2 sprite sheet (frames on pure black) into a horizontal strip with real alpha, so the
panel needs no blend modes: alpha = brightness, colour un-premultiplied.
usage: [GRID=4x3] halloween-sprites.py <sheet.png[,sheet2.png...]> <out-strip.png> [frame-width] [align]
GRID is columns x rows per sheet (default 3x2); several sheets are joined in order into one strip;
FILL=1 plugs interior holes; ALPHA_GAIN=<x> multiplies the alpha curve; ATLAS=<n> lays the frames out n per row instead (a long strip would pass the GPU's 8192px texture limit)
align pins every frame's solid body to frame 0's bottom and centre, for things that must not bounce (the pumpkin)"""
import os, sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

def unpremultiply(p, a):
    return (*(min(255, c * 255 // a) for c in p), a) if a else (0, 0, 0, 0)


src, out = sys.argv[1], sys.argv[2]
fw = int(sys.argv[3]) if len(sys.argv) > 3 else 280
LO = int(os.environ.get('ALPHA_LO', 10))
GAIN = float(os.environ.get('ALPHA_GAIN', 1))  # >1 for art that is dark on black (the zombie): more opaque, colours darken to match
FILL = os.environ.get('FILL')  # set for the zombie
align = len(sys.argv) > 4 and sys.argv[4] == 'align'
cols_n, rows_n = map(int, os.environ.get('GRID', '3x2').split('x'))
cells = []
for path in src.split(','):
    sheet = Image.open(path).convert('RGB')
    W, H = sheet.size
    cw, ch = W // cols_n, H // rows_n
    for i in range(cols_n * rows_n):
        cells.append(sheet.crop(((i % cols_n) * cw, (i // cols_n) * ch, (i % cols_n + 1) * cw, (i // cols_n + 1) * ch)))
fh = round(fw * cells[0].height / cells[0].width)
per = int(os.environ.get('ATLAS', len(cells)))
strip = Image.new('RGBA', (fw * per, fh * -(-len(cells) // per)))
ref = None
for i, cell in enumerate(cells):
    cell = cell.resize((fw, fh), Image.LANCZOS)
    r, g, b = cell.split()
    alpha = ImageChops.lighter(ImageChops.lighter(r, g), b).point(lambda v: max(0, min(255, round((v - LO) * 255 * GAIN / 245))))
    if FILL:  # dark clothing leaves see-through patches inside the body: fill every hole the outside cannot reach
        m = alpha.point(lambda v: 255 if v > 40 else 0).filter(ImageFilter.MaxFilter(5)); m.putpixel((0, 0), 0)
        ImageDraw.floodfill(m, (0, 0), 128)
        alpha = ImageChops.lighter(alpha, m.point(lambda v: 255 if v == 0 else 0))
    out_px = [(*p, a) if GAIN != 1 else unpremultiply(p, a) for p, a in zip(cell.getdata(), alpha.getdata())]
    frame = Image.new('RGBA', (fw, fh)); frame.putdata(out_px)
    dx = dy = 0
    if align:
        # solid rows only (a speck or spark does not count): the body's bottom edge; the centre comes from
        # the lowest third, so swinging arms do not drag it around
        solid = alpha.point(lambda v: 255 if v > 100 else 0)
        rows = [y for y in range(fh) if solid.crop((0, y, fw, y + 1)).histogram()[255] >= 20]
        low = solid.crop((0, rows[-1] - fh // 3, fw, rows[-1]))
        cols = [x for x in range(fw) if low.crop((x, 0, x + 1, low.height)).histogram()[255] >= 8]
        here = ((cols[0] + cols[-1]) // 2, rows[-1])
        ref = ref or here
        dx, dy = ref[0] - here[0], ref[1] - here[1]
    strip.paste(frame, ((i % per) * fw + dx, (i // per) * fh + dy))
strip.save(out, optimize=True)
print(out, strip.size, len(cells), 'frames')
