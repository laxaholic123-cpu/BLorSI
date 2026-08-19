"""Fit board geometry by optimisation instead of by hand.

RESULT: FAILED. Third distinct attempt at automatic geometry, third failure.

Scores a candidate alignment by how well the tiles it samples explain a legal
board — Hungarian cost against the known component counts, plus a reward for
exactly one blank tile. The idea is sound and the score does separate, but a
five-parameter random search lands in bad local minima: across all five
full-board photos the fitted lattice drifted off the board entirely.

Fixing it would need multi-start, coarse-to-fine search, or an edge-based
initial estimate. Recorded rather than pursued, because it is now clear that
geometry is the hard part of this problem and the app does not have to solve it:
a capture guide supplies geometry by construction. The user aims the camera, and
the alignment is known before a pixel is read.

Previous attempts, both also recorded:
  tools/detect_probe.py     radial profile of a colour-segmented land mask
  tools/hex_detect_probe.py per-hex colour blobs

Run:  python tools/register.py
"""

import sys; sys.path.insert(0,'tools')
import numpy as np
from PIL import Image
from fit_probe import CAN, CORNERS, homography, apply_h
from method_bench import to_lab, hungarian, NAMES, R, COUNTS

W3=np.array([0.4,1.0,1.0])
wts=np.array([COUNTS[n] for n in NAMES],float); wts/=wts.sum()
refMu=(R*wts[:,None]).sum(0); refSd=np.sqrt((wts[:,None]*(R-refMu)**2).sum(0))
zR=(R-refMu)/np.maximum(refSd,1e-6)
ROUGH={'lumber':1.0,'brick':0.85,'ore':0.6,'grain':0.35,'wool':0.3,'desert':0.0}
rp=np.array([ROUGH[n] for n in NAMES]); zRp=(rp-rp.mean())/rp.std()

def corners_from(cx,cy,sx,sy,rot):
    """Corner-tile centres for a board at this position, scale and rotation."""
    ct,st=np.cos(rot),np.sin(rot)
    out=[]
    for i in CORNERS:
        x,y=CAN[i]
        out.append((cx + sx*(x*ct - y*st), cy + sy*(x*st + y*ct)))
    return out

def sample(a, lum, Hm):
    H_,W_=a.shape[:2]
    labs=[]; texs=[]; ink=[]; faces=[]
    for i in range(19):
        pts=[CAN[i]+rr*np.array([np.cos(np.radians(t)),np.sin(np.radians(t))])
             for rr in (0.50,0.62,0.74,0.86) for t in np.arange(0,360,12)]
        xy=apply_h(Hm,np.array(pts)); cols=[]; lv=[]
        for x,y in xy:
            xi,yi=int(round(x)),int(round(y))
            if 0<=xi<W_ and 0<=yi<H_: cols.append(a[yi,xi]); lv.append(lum[yi,xi])
        if len(cols)<20: return None
        labs.append(np.median(to_lab(np.array(cols)),0))
        lv=np.array(lv); texs.append(float(np.percentile(lv,80)-np.percentile(lv,20)))
        tp=[CAN[i]+rr*np.array([np.cos(np.radians(t)),np.sin(np.radians(t))])
            for rr in np.arange(0,0.40,0.04) for t in np.linspace(0,360,max(8,int(rr*60)),endpoint=False)]
        txy=apply_h(Hm,np.array(tp)); tl=[]
        for x,y in txy:
            xi,yi=int(round(x)),int(round(y))
            if 0<=xi<W_ and 0<=yi<H_: tl.append(lum[yi,xi])
        if len(tl)<12: return None
        tl=np.array(tl); ink.append(float(np.percentile(tl,90)-np.percentile(tl,10)))
        faces.append(float(np.mean(tl[tl>=np.percentile(tl,75)])))
    return np.array(labs), np.array(texs), np.array(ink), np.array(faces)

def costs_and_score(s):
    labs,texs,ink,faces = s
    has = ink>=0.20
    if has.sum()>=6:
        P=np.array([[CAN[i][0],CAN[i][1],faces[i]] for i in range(19) if has[i]])
        A=np.c_[P[:,0],P[:,1],np.ones(len(P))]
        co,*_=np.linalg.lstsq(A,P[:,2],rcond=None)
        loc=np.array([co[0]*CAN[i][0]+co[1]*CAN[i][1]+co[2] for i in range(19)])
        labs=labs.copy(); labs[:,0]=labs[:,0]*np.clip(loc.mean()/np.maximum(loc,1e-6),0.625,1.6)
    z=(labs-labs.mean(0))/np.maximum(labs.std(0),1e-6)
    zT=(texs-texs.mean())/max(texs.std(),1e-6)
    C6=np.array([[np.sqrt((((z[i]-zR[k])*W3)**2).sum()) + 0.7*abs(zT[i]-zRp[k])
                  for k in range(6)] for i in range(19)])
    slots=[]
    for n in NAMES: slots += [n]*COUNTS[n]
    C=np.zeros((19,19))
    for i in range(19):
        for j,sn in enumerate(slots):
            c=C6[i][NAMES.index(sn)]
            if sn=='desert': c += 8.0 if has[i] else -8.0
            elif not has[i]: c += 8.0
            C[i][j]=c
    asg=hungarian(C)
    total=sum(C[i][asg[i]] for i in range(19))
    # a real board has exactly one blank tile; penalise anything else
    total += 3.0*abs((~has).sum()-1)
    return [slots[j] for j in asg], total

def register(path, seed_bbox, maxdim=760, iters=900, rng=None):
    rng = rng or np.random.default_rng(0)
    im=Image.open(path).convert("RGB"); im.thumbnail((maxdim,maxdim))
    a=np.asarray(im).astype(np.float32)/255.0
    lum=0.2126*a[...,0]+0.7152*a[...,1]+0.0722*a[...,2]
    sc=maxdim/452.0
    x0,y0,x1,y1=[v*sc for v in seed_bbox]
    p=np.array([(x0+x1)/2,(y0+y1)/2,(x1-x0)/2/4.46,(y1-y0)/2/4.0,0.0])
    step=np.array([14.0,14.0,4.0,4.0,0.10])
    best=None; bestScore=1e18
    for _ in range(iters):
        cand=p+rng.normal(0,1,5)*step
        Hm=homography(CAN[CORNERS], np.array(corners_from(*cand),float))
        s=sample(a,lum,Hm)
        if s is None: continue
        pred,sc_=costs_and_score(s)
        if sc_<bestScore: bestScore, best, p = sc_, (pred,cand,Hm), cand
        step*=0.997
    return best, bestScore, a, im
