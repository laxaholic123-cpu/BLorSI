"""The seven captures, their corner-hex centres, and the board they all show.

Every capture is the SAME physical board, so one truth array serves all of them.
Corners are the centres of hexes 0, 2, 18, 16 (TL TR BR BL) in normalised image
space, read off a 5% grid overlay and then CHECKED by rendering all 19 crops —
a stale corner set silently puts every crop on bare tile, which once produced a
confident 3/18 measured against tiles that held no tokens at all.

CROP PADDING is why it matters here. The crop was sized at exactly
TOKEN_RADIUS * scale with no margin, so a token sitting off-centre on its tile
was clipped by the crop boundary before anything downstream ran — 8 of 18 on
the reference capture, and the clipped edge is also where the tile crescent
that wrecks thresholding comes from.
"""

TRUTH = [4, 11, 6, 5, 10, 11, 12, 4, 5, None, 8, 10, 2, 9, 3, 3, 6, 8, 9]

#: Enough margin that an off-centre token is still whole inside the crop.
CROP_PADDING = 1.45

SHOTS = {
 '10b3b22d': ('tools/captures/10b3b22d-c658-44e2-9fb6-5d7d88648dbc.jpg',
   [(0.388,0.335),(0.634,0.335),(0.629,0.655),(0.370,0.655)]),
 '1d41f580': ('tools/captures/1d41f580-d734-458d-ac1d-1ea3665b61f3.jpg',
   [(0.393,0.335),(0.630,0.335),(0.626,0.642),(0.370,0.642)]),
 '1d6634b3': ('tools/captures/1d6634b3-61da-4a06-abdf-cdb4b2e0ec24.jpg',
   [(0.412,0.363),(0.632,0.363),(0.632,0.651),(0.393,0.651)]),
 '668f66fa': ('tools/captures/668f66fa-336e-4750-b8b5-7a8ca72d02c4.jpg',
   [(0.36033829841462417,0.3151133873349144),(0.6301235448161349,0.31775884961325024),
    (0.6458563277912783,0.662966817220052),(0.37439455060886506,0.6641293310740636)]),
 '6c385815': ('tools/captures/6c385815-c438-4f9e-8be5-10f704bab41b.jpg',
   [(0.368,0.321),(0.626,0.324),(0.610,0.653),(0.351,0.647)]),
 'PXL2040':  ('tools/captures/PXL_20260822_204040222.jpg',
   [(0.346,0.318),(0.629,0.318),(0.637,0.690),(0.337,0.690)]),
 'a56c00ec': ('tools/captures/a56c00ec-cb8c-4353-b5b4-3ac2f5572b4a.jpg',
   [(0.343,0.326),(0.589,0.312),(0.600,0.639),(0.354,0.647)]),
}


#: A capture the reader does BADLY on, kept deliberately as a regression case.
#:
#: Dimmer and warmer than the seven above, and every RED token (the two 6s and
#: the two 8s, hexes 2/10/16/17) reads as nothing at all. The sampled disc
#: overruns the face onto the tile, mid-green tile comes in under the Otsu cut
#: and forms a crescent of "ink", the digit touches the crescent, and the merged
#: blob reaches the disc boundary and is rejected.
#:
#: In the game this was captured from, that made the deck solver guess between
#: two 6s and two 8s with no evidence, and it got two of the four wrong — which
#: the player reported as "it mixed up 6 and 8". It was not a misread. Nothing
#: was read at all.
#:
#: NOT in the bundled library on purpose: it is the held-out test. Anything
#: claiming to fix red-token sampling has to move `HARD_CASE` without moving
#: precision on SHOTS.
HARD_CASE = ('tools/captures/956aea63-2b6f-43d3-9791-60535028ca65.jpg',
   [(0.374,0.320),(0.629,0.316),(0.629,0.654),(0.362,0.658)])


#: A real device run, with the corners the PLAYER marked in the app's own UI.
#:
#: The most valuable capture in the set, because it settles a question the
#: hand-marked ones could not: whether the red-token failure was real or an
#: artifact of my by-eye corner estimates. It is real. Run through the shipped
#: reader these corners reproduce the device result exactly — 15 of 18 sampled,
#: all 15 correct and accepted, hexes 10/16/17 declined.
#:
#: What happened in the game: those three declined, the deck solver placed the
#: remaining {6, 8, 8} across them, and swapped hexes 10 and 16. All three were
#: flagged low confidence, so the player was pointed at the two wrong ones —
#: which is the confidence fix working as designed on real hardware.
DEVICE_RUN = ('tools/captures/05a0df0c-740a-4189-903a-c731c4939180.jpg',
   [(0.3718845199367447, 0.3147354295518663),
    (0.6657661412209779, 0.2969728064158606),
    (0.6601292996088799, 0.6844223700629339),
    (0.35632224933923157, 0.6901777188740078)])


#: A SECOND physical arrangement of the same set — the first time the tokens
#: have been photographed anywhere other than one fixed layout.
#:
#: Its truth was never entered by hand. It was read off the crops and then
#: VALIDATED against the token bag: exactly one 2, one 12 and two of everything
#: else, which it matches exactly. A misread would almost certainly break that,
#: so the bag is a free check on any board whose numbers are all recovered.
#:
#: Ground truth is a DIAGNOSTIC feature. Real players never set it, so anything
#: that depends on it is a measurement tool, not a product path.
BOARD_B = ('tools/captures/ed077f23-a9a3-4cd9-8d45-11f83544a907.jpg',
   [(0.3553182772855668, 0.2984845164465526),
    (0.6707862025652187, 0.2894142562624008),
    (0.6547219258332814, 0.7083182392423114),
    (0.35381221866711116, 0.6841307576497395)])
TRUTH_B = [6, 6, 11, 10, 5, 4, 12, 8, 5, None, 11, 8, 9, 10, 4, 2, 3, 9, 3]
