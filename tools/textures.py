"""Regenerate the panel's room textures into web/assets/ (needs Pillow and numpy).

Colors are sampled from the theater: greige walls (plaster), chocolate accent wall and bean
bags (suede), the dark projector table (walnut), the maple cabinet (maple) and the weathered
vinyl plank floor (planks).

    python3 -m venv .venv && .venv/bin/pip install pillow numpy
    .venv/bin/python tools/textures.py
"""
import os
os.chdir(os.path.join(os.path.dirname(__file__), '..', 'web', 'assets'))
import numpy as np
from PIL import Image, ImageFilter
rng=np.random.default_rng(7)
def vnoise(h,w,scale):
    sh,sw=max(2,int(h/scale)+2),max(2,int(w/scale)+2)
    a=rng.random((sh,sw)).astype(np.float32)
    im=Image.fromarray((a*255).astype(np.uint8)).resize((w,h),Image.BICUBIC)
    return np.asarray(im,np.float32)/255
def fbm(h,w,scales,weights):
    n=sum(wt*vnoise(h,w,s) for s,wt in zip(scales,weights)); return (n-n.min())/(n.max()-n.min())
def colorize(t,c0,c1):
    c0=np.array(c0,np.float32); c1=np.array(c1,np.float32)
    return (c0+(c1-c0)*t[...,None]).clip(0,255).astype(np.uint8)
def hexc(h): return [int(h[i:i+2],16) for i in (1,3,5)]
# greige plaster wall
h,w=1080,1920
n=fbm(h,w,[400,120,30,6,2],[.35,.25,.18,.12,.10])
img=colorize(n*0.9+0.05,hexc('#C9C0B6'),hexc('#D8D0C7'))
Image.fromarray(img).save('plaster.jpg',quality=86)
# chocolate microsuede (like the accent wall + beanbags)
h,w=800,1400
n=fbm(h,w,[260,70,14,3,1.5],[.3,.25,.15,.15,.15])
# nap: directional soft light
nap=fbm(h,w,[500,200],[.7,.3])
t=0.6*n+0.4*nap
Image.fromarray(colorize(t,hexc('#2C1B12'),hexc('#46301F'))).save('suede.jpg',quality=84)

# ---- wood and floor ----
rng=np.random.default_rng(11)
def hexc(h): return np.array([int(h[i:i+2],16) for i in (1,3,5)],np.float32)
def up(a,h,w,m=Image.BICUBIC): return np.asarray(Image.fromarray((a*255).astype(np.uint8)).resize((w,h),m),np.float32)/255
def norm(a): return (a-a.min())/(a.max()-a.min()+1e-6)
def grain(h,w,vertical=True,lines=0.6):
    # long streaks: few samples along grain, many across
    if vertical:
        s1=up(rng.random((max(2,h//90),w//2)),h,w); s2=up(rng.random((max(2,h//25),w)),h,w)
        wav=up(rng.random((max(2,h//160),max(2,w//60))),h,w)
        figure=up(rng.random((max(2,h//300),max(2,w//25))),h,w)
    else:
        s1=up(rng.random((h//2,max(2,w//90))),h,w); s2=up(rng.random((h,max(2,w//25))),h,w)
        wav=up(rng.random((max(2,h//60),max(2,w//160))),h,w)
        figure=up(rng.random((max(2,h//25),max(2,w//300))),h,w)
    fine=norm(0.6*s1+0.4*s2)
    t=norm(lines*fine+0.25*figure+0.15*wav)
    return t
def col(t,c0,c1,gamma=1.0):
    t=t**gamma; return (hexc(c0)+(hexc(c1)-hexc(c0))*t[...,None]).clip(0,255).astype(np.uint8)
Image.fromarray(col(grain(1080,272),'#1E120B','#4A2D1C',1.3)).save('walnut.jpg',quality=88)
Image.fromarray(col(grain(800,1400),'#7E421A','#C4803F',0.9)).save('maple.jpg',quality=86)
# planks
h,w=240,1920; rowh=60; img=np.zeros((h,w,3),np.uint8)
tones=['#5E5751','#6F6760','#857C72','#9C9286','#ABA195','#77706A']
for r in range(h//rowh):
    x=-int(rng.integers(0,400))
    while x<w:
        L=int(rng.integers(420,760)); base=hexc(tones[int(rng.integers(0,len(tones)))])
        g=grain(rowh,L,vertical=False,lines=0.8)
        block=(base*(0.8+0.35*g[...,None])).clip(0,255)
        xa,xb=max(x,0),min(x+L,w)
        if xb>xa: img[r*rowh:(r+1)*rowh,xa:xb]=block[:,xa-x:xb-x]
        if x>0: img[r*rowh:(r+1)*rowh,x:x+2]=(48,44,40)
        x+=L
    img[r*rowh:r*rowh+2,:]=(52,48,44)
Image.fromarray(img).save('planks.jpg',quality=86)
# the nav rail: the floor's weathered grey grain as one continuous surface, no boards or seams
rng=np.random.default_rng(23)
Image.fromarray(col(grain(1080,272),'#5A534D','#9C9286',1.1)).save('planks-rail.jpg',quality=88)
print('textures written')
