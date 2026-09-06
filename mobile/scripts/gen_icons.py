#!/usr/bin/env python3
"""Generate app icon and splash screen assets for UIUC Bustle.

Mark: a bold, simplified front-facing bus in Illini orange with a white
windshield band, riding a subtle upward route line, on a full-bleed Illini
navy ground. No wordmark — icons render at ~60px.

Outputs (all supersampled 4x then LANCZOS-downscaled):
  assets/icon.png           1024x1024 full-bleed navy, mark at full scale
  assets/adaptive-icon.png  1024x1024, mark inside the 66% Android safe zone
  assets/splash.png         1284x2778 navy ground, centered mark + route flourish
  assets/favicon.png        48x48
"""
import os
from PIL import Image, ImageDraw

NAVY = (19, 41, 75, 255)         # #13294B
NAVY_LIGHT = (29, 61, 111, 255)  # #1D3D6F
ORANGE = (232, 74, 39, 255)      # #E84A27
ORANGE_BRIGHT = (255, 107, 61, 255)  # #FF6B3D
WHITE = (255, 255, 255, 255)
SS = 4  # supersample factor

ASSETS_DIR = os.path.join(os.path.dirname(__file__), "..", "assets")
os.makedirs(ASSETS_DIR, exist_ok=True)


def rr(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_route_line(draw, canvas, cx, cy, scale, alpha=70, dy=0):
    """Subtle upward route line sweeping behind/under the bus."""
    color = (255, 255, 255, alpha)
    w = int(28 * scale)
    # Rising polyline: left-low to right-high, passing under the bus
    pts = [
        (cx - 460 * scale, cy + dy + 430 * scale),
        (cx - 180 * scale, cy + dy + 430 * scale),
        (cx + 40 * scale, cy + dy + 300 * scale),
        (cx + 460 * scale, cy + dy + 300 * scale),
    ]
    draw.line(pts, fill=color, width=w, joint="curve")
    # Stop dots along the line
    for px, py in (pts[0], pts[-1]):
        r = int(34 * scale)
        draw.ellipse([px - r, py - r, px + r, py + r], fill=(255, 255, 255, min(alpha + 40, 255)))


def draw_bus_mark(draw, cx, cy, scale):
    """Bold simplified front-facing bus. `scale` = 1.0 fills ~62% of a 1024 canvas.
    All coordinates are supersampled-canvas pixels centered on (cx, cy)."""
    def S(v):
        return int(v * scale)

    # Body: tall rounded square
    bw, bh = S(560), S(600)
    x0, y0 = cx - bw // 2, cy - bh // 2
    x1, y1 = x0 + bw, y0 + bh
    rr(draw, [x0, y0, x1, y1], S(120), ORANGE)

    # Roof marker lights strip
    rr(draw, [cx - S(150), y0 - S(36), cx + S(150), y0 + S(30)], S(30), ORANGE)

    # Windshield band: wide white rounded rect in the upper body
    wx0, wy0 = x0 + S(64), y0 + S(88)
    wx1, wy1 = x1 - S(64), y0 + S(280)
    rr(draw, [wx0, wy0, wx1, wy1], S(56), WHITE)

    # Destination sign: navy slit inside windshield top (adds signage character)
    rr(draw, [cx - S(140), wy0 + S(28), cx + S(140), wy0 + S(76)], S(22), NAVY)

    # Headlights: two white rounded squares low on the body
    hl = S(96)
    hy0 = y1 - S(190)
    rr(draw, [x0 + S(70), hy0, x0 + S(70) + hl, hy0 + hl], S(30), WHITE)
    rr(draw, [x1 - S(70) - hl, hy0, x1 - S(70), hy0 + hl], S(30), WHITE)

    # Bumper: darker orange bar
    rr(draw, [x0 + S(40), y1 - S(64), x1 - S(40), y1 + S(6)], S(28), (199, 59, 29, 255))

    # Wheels: navy stubs peeking below the body
    wr = S(64)
    wy = y1 - S(8)
    for wx in (x0 + S(120), x1 - S(120)):
        draw.rounded_rectangle([wx - wr, wy, wx + wr, wy + S(72)], radius=S(30), fill=NAVY)

    # Mirrors: small orange nubs
    my = wy0 + S(40)
    rr(draw, [x0 - S(44), my, x0 + S(8), my + S(64)], S(20), ORANGE)
    rr(draw, [x1 - S(8), my, x1 + S(44), my + S(64)], S(20), ORANGE)


def compose_icon(size, mark_scale_of_canvas):
    """Render navy ground + route line + bus mark at `size`, supersampled."""
    big = size * SS
    img = Image.new("RGBA", (big, big), NAVY)
    draw = ImageDraw.Draw(img)
    cx = cy = big // 2
    # mark_scale: bus body ~560px wide at scale 1 on a 1024*SS canvas
    scale = (big / (1024 * SS)) * mark_scale_of_canvas * SS
    draw_route_line(draw, img, cx, cy, scale * 0.9, alpha=60)
    draw_bus_mark(draw, cx, cy - int(30 * scale), scale)
    return img.resize((size, size), Image.LANCZOS).convert("RGB")


def gen_icon():
    img = compose_icon(1024, 1.12)
    img.save(os.path.join(ASSETS_DIR, "icon.png"))
    print("icon.png", img.size)


def gen_adaptive_icon():
    # Mark constrained to the 66% central safe zone
    img = compose_icon(1024, 1.12 * 0.66)
    img.save(os.path.join(ASSETS_DIR, "adaptive-icon.png"))
    print("adaptive-icon.png", img.size)


def gen_favicon():
    img = compose_icon(48, 1.2)
    img.save(os.path.join(ASSETS_DIR, "favicon.png"))
    print("favicon.png", img.size)


def gen_splash():
    W, H = 1284, 2778
    big_w, big_h = W * SS, H * SS
    img = Image.new("RGBA", (big_w, big_h), NAVY)
    draw = ImageDraw.Draw(img)
    cx, cy = big_w // 2, int(big_h * 0.46)

    # Faint oversized route-line flourish sweeping the lower third
    flourish_w = int(20 * SS)
    fy = int(big_h * 0.72)
    pts = [
        (-flourish_w, fy + 260 * SS),
        (int(big_w * 0.3), fy + 260 * SS),
        (int(big_w * 0.55), fy),
        (big_w + flourish_w, fy),
    ]
    draw.line(pts, fill=(232, 74, 39, 110), width=flourish_w, joint="curve")
    for px, py in ((int(big_w * 0.3), fy + 260 * SS), (int(big_w * 0.55), fy)):
        r = 26 * SS
        draw.ellipse([px - r, py - r, px + r, py + r], fill=(255, 107, 61, 160))

    # Centered mark (bus + its own subtle route line), ~46% of width
    scale = (big_w * 0.46) / 560.0
    draw_route_line(draw, img, cx, cy, scale * 0.85, alpha=50, dy=int(150 * scale))
    draw_bus_mark(draw, cx, cy, scale)

    out = img.resize((W, H), Image.LANCZOS).convert("RGB")
    out.save(os.path.join(ASSETS_DIR, "splash.png"))
    print("splash.png", out.size)


if __name__ == "__main__":
    gen_icon()
    gen_adaptive_icon()
    gen_favicon()
    gen_splash()
    print("All assets regenerated in", os.path.abspath(ASSETS_DIR))
