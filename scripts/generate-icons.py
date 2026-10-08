"""Generates PWA icons, maskable icons, Apple touch icon, favicon and iOS splash screens.
Run: python3 scripts/generate-icons.py   (requires Pillow)"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "public")
BRAND = (37, 99, 235)      # #2563eb  theme color
BG = (15, 23, 42)          # #0f172a  background/splash color
WHITE = (255, 255, 255)

def font(size):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "C:/Windows/Fonts/arialbd.ttf"]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default(size)

def draw_p(img, box_size, center, scale):
    d = ImageDraw.Draw(img)
    f = font(int(box_size * scale))
    d.text(center, "P", font=f, fill=WHITE, anchor="mm")

def icon_any(size):
    """Rounded-square icon with transparent corners (purpose: any)."""
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=BRAND)
    draw_p(img, s, (s / 2, s / 2 + s * 0.02), 0.62)
    return img.resize((size, size), Image.LANCZOS)

def icon_maskable(size):
    """Full-bleed square; glyph kept inside the 80% safe zone (purpose: maskable)."""
    s = size * 4
    img = Image.new("RGBA", (s, s), BRAND + (255,))
    draw_p(img, s, (s / 2, s / 2 + s * 0.015), 0.42)
    return img.resize((size, size), Image.LANCZOS)

def apple_touch(size=180):
    """iOS applies its own mask, so use an opaque full-bleed square."""
    s = size * 4
    img = Image.new("RGB", (s, s), BRAND)
    draw_p(img, s, (s / 2, s / 2 + s * 0.02), 0.6)
    return img.resize((size, size), Image.LANCZOS)

# Portrait iOS splash sizes: (css width, css height, device pixel ratio)
SPLASH = [
    (320, 568, 2), (375, 667, 2), (414, 736, 3), (375, 812, 3), (414, 896, 2),
    (414, 896, 3), (390, 844, 3), (428, 926, 3), (393, 852, 3), (430, 932, 3),
    (402, 874, 3), (440, 956, 3), (768, 1024, 2), (834, 1194, 2), (1024, 1366, 2),
]

def splash(w, h, r):
    W, H = w * r, h * r
    img = Image.new("RGB", (W, H), BG)
    ic = icon_any(int(min(W, H) * 0.28))
    img.paste(ic, ((W - ic.width) // 2, (H - ic.height) // 2 - int(H * 0.03)), ic)
    d = ImageDraw.Draw(img)
    d.text((W / 2, H / 2 + ic.height * 0.62), "Parking App", font=font(int(min(W, H) * 0.06)), fill=WHITE, anchor="mm")
    return img

if __name__ == "__main__":
    os.makedirs(os.path.join(OUT, "icons"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "splash"), exist_ok=True)
    for f in os.listdir(os.path.join(OUT, "icons")):
        os.remove(os.path.join(OUT, "icons", f))
    for sz in (72, 96, 128, 144, 152, 192, 384, 512):
        icon_any(sz).save(os.path.join(OUT, "icons", f"icon-{sz}x{sz}.png"), optimize=True)
    for sz in (192, 512):
        icon_maskable(sz).save(os.path.join(OUT, "icons", f"maskable-{sz}x{sz}.png"), optimize=True)
    apple_touch().save(os.path.join(OUT, "icons", "apple-touch-icon.png"), optimize=True)
    icon_any(64).save(os.path.join(OUT, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    for f in os.listdir(os.path.join(OUT, "splash")):
        os.remove(os.path.join(OUT, "splash", f))
    for w, h, r in SPLASH:
        splash(w, h, r).save(os.path.join(OUT, "splash", f"splash-{w*r}x{h*r}.png"), optimize=True)
    print("icons + splash screens generated")
