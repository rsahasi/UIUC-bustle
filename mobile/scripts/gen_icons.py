#!/usr/bin/env python3
"""Generate app icon and splash screen assets for UIUC Bustle."""
import math
import os
from PIL import Image, ImageDraw, ImageFont

NAVY = (19, 41, 75)       # #13294B
ORANGE = (232, 74, 39)    # #E84A27
WHITE = (255, 255, 255)
LIGHT_NAVY = (25, 55, 105)  # lighter navy for gradient effect

ASSETS_DIR = os.path.join(os.path.dirname(__file__), "..", "assets")
os.makedirs(ASSETS_DIR, exist_ok=True)


def draw_bus(draw, cx, cy, size, color):
    """Draw a simple stylized bus outline."""
    w = size
    h = int(size * 0.55)
    x0 = cx - w // 2
    y0 = cy - h // 2
    x1 = cx + w // 2
    y1 = cy + h // 2

    # Body
    r = int(size * 0.08)
    draw.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=color)

    # Roof detail
    roof_h = int(h * 0.12)
    draw.rounded_rectangle([x0 + int(w*0.08), y0 - roof_h, x1 - int(w*0.08), y0 + r], radius=r//2, fill=color)

    # Windows — 3 side windows
    ww = int(w * 0.16)
    wh = int(h * 0.28)
    wy0 = y0 + int(h * 0.18)
    wy1 = wy0 + wh
    gap = int(w * 0.04)
    win_color = NAVY if color == WHITE else WHITE
    win_start = x0 + int(w * 0.12)
    for i in range(3):
        wx0 = win_start + i * (ww + gap)
        wx1 = wx0 + ww
        draw.rounded_rectangle([wx0, wy0, wx1, wy1], radius=2, fill=win_color)

    # Front window (windshield)
    fw = int(w * 0.14)
    fh = int(h * 0.3)
    fx0 = x1 - int(w*0.2)
    fx1 = fx0 + fw
    fy0 = y0 + int(h * 0.12)
    fy1 = fy0 + fh
    draw.rounded_rectangle([fx0, fy0, fx1, fy1], radius=2, fill=win_color)

    # Wheels
    wheel_r = int(h * 0.18)
    wheel_y = y1 + wheel_r // 2
    wheel_color = NAVY if color == WHITE else (40, 40, 40)
    rim_color = (180, 180, 180) if color == WHITE else WHITE
    for wx in [x0 + int(w * 0.22), x1 - int(w * 0.22)]:
        draw.ellipse([wx - wheel_r, wheel_y - wheel_r, wx + wheel_r, wheel_y + wheel_r], fill=wheel_color)
        draw.ellipse([wx - wheel_r//2, wheel_y - wheel_r//2, wx + wheel_r//2, wheel_y + wheel_r//2], fill=rim_color)


def make_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background — navy with subtle gradient via two rectangles
    draw.rectangle([0, 0, size, size], fill=NAVY)

    # Subtle top gradient overlay (lighter navy at top)
    for y in range(size // 3):
        alpha = int(30 * (1 - y / (size / 3)))
        r = min(255, NAVY[0] + 15)
        g = min(255, NAVY[1] + 18)
        b = min(255, NAVY[2] + 35)
        draw.line([0, y, size, y], fill=(r, g, b, alpha))

    # Orange accent circle behind bus
    cx, cy = size // 2, int(size * 0.46)
    circle_r = int(size * 0.35)
    draw.ellipse(
        [cx - circle_r, cy - circle_r, cx + circle_r, cy + circle_r],
        fill=(*ORANGE, 35)
    )
    circle_r2 = int(size * 0.28)
    draw.ellipse(
        [cx - circle_r2, cy - circle_r2, cx + circle_r2, cy + circle_r2],
        fill=(*ORANGE, 25)
    )

    # Bus
    bus_size = int(size * 0.52)
    draw_bus(draw, cx, cy, bus_size, WHITE)

    # "BUSTLE" text below bus
    text = "BUSTLE"
    font_size = max(int(size * 0.09), 12)
    try:
        # Try system fonts
        for font_path in [
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/Arial.ttf",
            "/Library/Fonts/Arial Bold.ttf",
        ]:
            if os.path.exists(font_path):
                font = ImageFont.truetype(font_path, font_size)
                break
        else:
            font = ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (size - tw) // 2
    ty = int(size * 0.75)
    # Orange dot accent
    dot_r = int(size * 0.025)
    draw.ellipse([cx - dot_r, ty + th + dot_r, cx + dot_r, ty + th + dot_r * 3], fill=ORANGE)
    draw.text((tx, ty), text, font=font, fill=WHITE)

    # Letter spacing simulation — just draw centered
    return img


def make_splash(width, height):
    img = Image.new("RGB", (width, height), NAVY)
    draw = ImageDraw.Draw(img)

    # Subtle gradient
    for y in range(height // 2):
        alpha_factor = 1 - y / (height / 2)
        r = min(255, NAVY[0] + int(12 * alpha_factor))
        g = min(255, NAVY[1] + int(15 * alpha_factor))
        b = min(255, NAVY[2] + int(30 * alpha_factor))
        draw.line([0, y, width, y], fill=(r, g, b))

    cx, cy = width // 2, height // 2

    # Orange glow circles
    for radius, alpha in [(int(width * 0.25), 20), (int(width * 0.18), 30)]:
        overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        odraw = ImageDraw.Draw(overlay)
        odraw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=(*ORANGE, alpha))
        img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
        draw = ImageDraw.Draw(img)

    # Bus
    bus_size = int(min(width, height) * 0.32)
    draw_bus(draw, cx, cy - int(height * 0.04), bus_size, WHITE)

    # App name
    font_size = max(int(min(width, height) * 0.07), 20)
    try:
        for font_path in [
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/Arial.ttf",
        ]:
            if os.path.exists(font_path):
                font = ImageFont.truetype(font_path, font_size)
                break
        else:
            font = ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

    name = "BUSTLE"
    bbox = draw.textbbox((0, 0), name, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(((width - tw) // 2, cy + int(height * 0.22)), name, font=font, fill=WHITE)

    return img


if __name__ == "__main__":
    print("Generating app icons...")

    # Main icon 1024x1024
    icon = make_icon(1024)
    icon.save(os.path.join(ASSETS_DIR, "icon.png"), "PNG")
    print("  ✓ icon.png (1024x1024)")

    # Adaptive icon (same, no bg) for Android — same design
    icon.save(os.path.join(ASSETS_DIR, "adaptive-icon.png"), "PNG")
    print("  ✓ adaptive-icon.png (1024x1024)")

    # Favicon 48x48
    favicon = make_icon(48)
    favicon.save(os.path.join(ASSETS_DIR, "favicon.png"), "PNG")
    print("  ✓ favicon.png (48x48)")

    # Splash screen 1284x2778 (iPhone 14 Pro Max)
    splash = make_splash(1284, 2778)
    splash.save(os.path.join(ASSETS_DIR, "splash.png"), "PNG")
    print("  ✓ splash.png (1284x2778)")

    print("\nAll assets generated in mobile/assets/")
