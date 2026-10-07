# Room QR invitations

Desktop: Join QR beside Copy invite opens the existing Menu invite section.
Touch: Menu > Invite friends > Scan to join. The existing mobile HUD remains compact.
The QR encodes exactly the current page origin/path plus ?room=CODE, stripping all
other parameters and hashes. Generation is local, lazy-loaded qrcode 1.5.4 (MIT),
with black/white contrast and a four-module quiet zone. No external QR service.
Solo sessions hide the QR and disable the desktop shortcut. A new session closes
and clears the previous image. Generation errors offer the existing copy-link fallback.

Verification: production build and patch-note checks pass. browser-room-qr.mjs
independently decodes the actual rendered image using Python OpenCV, opens that
URL in a separate phone-sized browser and joins the host room. Desktop and 390px
phone captures inspected; physical phone scanning has not been tested.
Run with the existing browser-acceptance PW_CORE/PW_CHROME/ACCEPT_BASE settings.
Requires Python cv2 for independent decoding. Owned browsers close in finally.
QA lesson: mobile menu uses data-touch-action="menu", not data-action="menu".
The first QA run reached successful QR decoding/join but timed out at that wrong
selector; fixed the test selector and reran successfully.
