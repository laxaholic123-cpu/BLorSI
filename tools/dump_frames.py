"""Dump the seven reference captures at the app's working resolution.

Input for `tools/light_read_check.mjs`, which runs the SHIPPED tile and number
reader over these frames under simulated golden light. Frames are downscaled
exactly the way `catan-capture.tsx` does it -- an integer box factor toward
TARGET_WIDTH -- because the number decode is resolution-limited and a check at
any other size would measure a different reader.

Corners are the board_shots hex-centre corners, converted to pixels of the
downscaled frame.

    python tools/dump_frames.py
"""
import json
import pathlib
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, 'tools')
from board_shots import SHOTS  # noqa: E402

TARGET_WIDTH = 2400  # catan-capture.tsx

blob = bytearray()
meta = []
for name, (path, corners) in SHOTS.items():
    im = Image.open(path).convert('RGB')
    w, h = im.size
    f = max(1, round(w / TARGET_WIDTH))
    small = im.resize((w // f, h // f), Image.BOX)
    W, H = small.size
    meta.append({
        'name': name,
        'width': W,
        'height': H,
        'offset': len(blob),
        'corners': [[c[0] * W, c[1] * H] for c in corners],
    })
    blob += np.asarray(small, dtype=np.uint8).tobytes()

pathlib.Path('tools/frames.bin').write_bytes(bytes(blob))
pathlib.Path('tools/frames.json').write_text(json.dumps(meta, indent=1))
print(f'wrote {len(meta)} frames, {len(blob) / 1e6:.0f}MB')
