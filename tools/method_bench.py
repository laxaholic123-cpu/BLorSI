"""Compare recognition strategies on a hand-marked reference board."""
import sys; sys.path.insert(0,'tools')
import numpy as np
from PIL import Image
from fit_probe import CAN, CORNERS, homography, apply_h

REF={'grain':(61.5,4.6,46.2),'wool':(53.2,-25.6,38.6),'lumber':(37.7,-7.1,16.4),
     'brick':(36.8,15.4,23.2),'ore':(60.3,-0.5,0.1),'desert':(72.3,-2.2,25.8)}
NAMES=list(REF); R=np.array([REF[n] for n in NAMES])
COUNTS={'grain':4,'wool':4,'lumber':4,'brick':3,'ore':3,'desert':1}
TRUTH=['brick','grain','ore','lumber','ore','wool','lumber','wool','grain','desert',
       'grain','wool','lumber','brick','wool','lumber','ore','grain','brick']

def to_lab(rgb):
    a=rgb.astype(np.float64); a=np.where(a<=0.04045,a/12.92,((a+0.055)/1.055)**2.4)
    M=np.array([[0.4124,0.3576,0.1805],[0.2126,0.7152,0.0722],[0.0193,0.1192,0.9505]])
    xyz=(a@M.T)/np.array([0.95047,1.0,1.08883]); e,k=216/24389,24389/27
    f=np.where(xyz>e,np.cbrt(xyz),(k*xyz+16)/116)
    return np.stack([116*f[...,1]-16,500*(f[...,0]-f[...,1]),200*(f[...,1]-f[...,2])],-1)

def hungarian(C):
    n,m=C.shape; INF=float('inf')
    u=[0]*(n+1); v=[0]*(m+1); p=[0]*(m+1); way=[0]*(m+1)
    for i in range(1,n+1):
        p[0]=i; j0=0; minv=[INF]*(m+1); used=[False]*(m+1)
        while True:
            used[j0]=True; i0=p[j0]; delta=INF; j1=0
            for j in range(1,m+1):
                if used[j]: continue
                cur=C[i0-1][j-1]-u[i0]-v[j]
                if cur<minv[j]: minv[j]=cur; way[j]=j0
                if minv[j]<delta: delta=minv[j]; j1=j
            for j in range(0,m+1):
                if used[j]: u[p[j]]+=delta; v[j]-=delta
                else: minv[j]-=delta
            j0=j1
            if p[j0]==0: break
        while True:
            j1=way[j0]; p[j0]=p[j1]; j0=j1
            if j0==0: break
    a=[-1]*n
    for j in range(1,m+1):
        if p[j]>0: a[p[j]-1]=j-1
    return a

def load(path, corners600, maxdim=900):
    im=Image.open(path).convert("RGB"); im.thumbnail((maxdim,maxdim))
    a=np.asarray(im).astype(np.float32)/255.0
    sc=maxdim/600.0
    Hm=homography(CAN[CORNERS], np.array([(x*sc,y*sc) for x,y in corners600],float))
    return a, Hm

def features(a, Hm):
    H_,W_=a.shape[:2]
    lum=0.2126*a[...,0]+0.7152*a[...,1]+0.0722*a[...,2]
    labs=[]; texs=[]; tokens=[]
    for i in range(19):
        pts=[CAN[i]+rr*np.array([np.cos(np.radians(t)),np.sin(np.radians(t))])
             for rr in (0.50,0.62,0.74,0.86) for t in np.arange(0,360,10)]
        xy=apply_h(Hm,np.array(pts))
        cols=[]; lums=[]
        for x,y in xy:
            xi,yi=int(round(x)),int(round(y))
            if 0<=xi<W_ and 0<=yi<H_: cols.append(a[yi,xi]); lums.append(lum[yi,xi])
        lab=to_lab(np.array(cols)); labs.append(np.median(lab,0))
        lv=np.array(lums); texs.append(float(np.percentile(lv,80)-np.percentile(lv,20)))
        # token face: bright pixels inside the token disc = the cream
        tp=[CAN[i]+rr*np.array([np.cos(np.radians(t)),np.sin(np.radians(t))])
            for rr in np.arange(0,0.40,0.03) for t in np.linspace(0,360,max(8,int(rr*70)),endpoint=False)]
        txy=apply_h(Hm,np.array(tp))
        tc=[a[int(round(y)),int(round(x))] for x,y in txy
            if 0<=int(round(x))<W_ and 0<=int(round(y))<H_]
        tl=to_lab(np.array(tc)); tlum=0.2126*np.array(tc)[:,0]+0.7152*np.array(tc)[:,1]+0.0722*np.array(tc)[:,2]
        rng=float(np.percentile(tlum,90)-np.percentile(tlum,10))
        bright=tl[tlum>=np.percentile(tlum,75)]
        tokens.append((rng, np.median(bright,0) if len(bright) else None))
    return np.array(labs), np.array(texs), tokens

def solve(cost19x6, ink, tokenW=8.0):
    slots=[]
    for n in NAMES: slots += [n]*COUNTS[n]
    C=np.zeros((19,19))
    for i in range(19):
        has = ink[i] >= 0.20
        for j,s in enumerate(slots):
            c=cost19x6[i][NAMES.index(s)]
            if s=='desert': c += tokenW if has else -tokenW
            elif not has: c += tokenW
            C[i][j]=c
    return [slots[j] for j in hungarian(C)]

def score(pred): return sum(p==t for p,t in zip(pred,TRUTH))
