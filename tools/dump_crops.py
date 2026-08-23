"""Dump every token crop as raw RGB, so the TypeScript can be run on them.

The port has to be checked against the same photos the Python was measured on.
Anything else — synthetic buffers, spot checks — would leave open the one
question that matters: does the shipped code reproduce the measurement, or did
something drift in translation?

Raw RGB rather than PNG so the Node side needs no image decoder.
Writes tools/crops.bin (gitignored) and tools/crops.json.
"""
import json
import sys

sys.path.insert(0, 'tools')
import numpy as np
from PIL import Image

import digit_match_probe as D
from board_shots import SHOTS, TRUTH, CROP_PADDING
from fit_probe import CAN, CORNERS, homography, apply_h

blobs = []
meta = []
offset = 0
for name, (photo, corners) in SHOTS.items():
    im = Image.open(photo).convert('RGB')
    a = np.asarray(im)
    H_, W_ = a.shape[:2]
    Hm = homography(CAN[CORNERS], np.array([(x * W_, y * H_) for x, y in corners], float))
    A = apply_h(Hm, np.array([CAN[7]]))[0]
    B = apply_h(Hm, np.array([CAN[11]]))[0]
    scale = np.hypot(*(B - A)) / (CAN[11][0] - CAN[7][0])
    rad = D.TOKEN_RADIUS * scale * CROP_PADDING
    size = int(round(rad * 2))
    for i in range(19):
        if TRUTH[i] is None:
            continue
        ce = apply_h(Hm, np.array([CAN[i]]))[0]
        left, top = int(round(ce[0] - rad)), int(round(ce[1] - rad))
        if left < 0 or top < 0 or left + size > W_ or top + size > H_:
            continue
        crop = np.ascontiguousarray(a[top:top + size, left:left + size], dtype=np.uint8)
        blobs.append(crop.tobytes())
        meta.append({'photo': name, 'hex': i, 'value': TRUTH[i],
                     'size': size, 'offset': offset})
        offset += crop.nbytes

with open('tools/crops.bin', 'wb') as f:
    for b in blobs:
        f.write(b)
json.dump(meta, open('tools/crops.json', 'w'), indent=0)
print(f'{len(meta)} crops, {offset/1e6:.1f} MB')
