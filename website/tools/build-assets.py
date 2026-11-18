"""Builds the website's local assets from the app project. Run from the repo root:

    python website/tools/build-assets.py

Needs Pillow, fontTools and brotli (pip install pillow fonttools brotli).

- Fonts: Inter (400/500/600/700) and Barlow Condensed (700, 800 italic) from the app's @expo-google-fonts packages,
  subset to Latin and saved as WOFF2. Both are SIL Open Font License 1.1 with no Reserved Font Names, so subsetting
  and self-hosting are allowed; the license texts are copied next to the files.
- Screens: crops of real app screenshots, sample goals only (the site captions say so), no wallet address.
  Anything that shows an amount comes from the mainnet store screenshot build (2026-10-18, design/store-shots-2026-10-18,
  EXPO_PUBLIC_LOCKIN_SAMPLES=store), so it reads SKR within the 100-10,000 range; the two crops without an amount are
  still from release 1668a31.
- Icons: favicon PNG and apple-touch icon from the app icon.
"""

from pathlib import Path
import shutil

from fontTools import subset
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "website"
FONTS_IN = ROOT / "seeker-app" / "node_modules" / "@expo-google-fonts"
FONTS_OUT = SITE / "assets" / "fonts"
IMG_OUT = SITE / "assets" / "img"
SHOTS = ROOT / "design" / "release-1668a31"
# Mainnet store screenshot build with sample goals: amounts in SKR. Crop boxes from the card bounds in the .xml dumps there.
MAINNET = ROOT / "design" / "store-shots-2026-10-18"

FONTS = {
    "inter-400.woff2": FONTS_IN / "inter/400Regular/Inter_400Regular.ttf",
    "inter-500.woff2": FONTS_IN / "inter/500Medium/Inter_500Medium.ttf",
    "inter-600.woff2": FONTS_IN / "inter/600SemiBold/Inter_600SemiBold.ttf",
    "inter-700.woff2": FONTS_IN / "inter/700Bold/Inter_700Bold.ttf",
    "barlow-condensed-700.woff2": FONTS_IN / "barlow-condensed/700Bold/BarlowCondensed_700Bold.ttf",
    "barlow-condensed-800-italic.woff2": FONTS_IN
    / "barlow-condensed/800ExtraBold_Italic/BarlowCondensed_800ExtraBold_Italic.ttf",
}
# Basic Latin, Latin-1, typographic quotes and dashes, bullet, ellipsis, arrows, ≈ and ≤.
UNICODES = "U+0020-007E,U+00A0-00FF,U+2010-2027,U+2032-2033,U+2190-2193,U+2248,U+2264-2265"

# (output name, source screenshot, crop box in screenshot pixels (1080 x 2400), output width)
CROPS = [
    ("app-steps-goal.webp", MAINNET / "02-steps.png", (0, 0, 1080, 2400), 720),
    ("frag-steps-today.webp", MAINNET / "02-steps.png", (54, 486, 1026, 1032), 720),
    ("frag-day-track.webp", MAINNET / "02-steps.png", (54, 1174, 1026, 1488), 720),
    ("frag-check-in.webp", "chain-01-goals-top.png", (54, 984, 1026, 1176), 720),
    ("frag-ready-to-return.webp", MAINNET / "05-return.png", (54, 1215, 1026, 1893), 720),
    # The same amount (200 SKR) in both states, as the site's caption says.
    ("frag-transfer-pending.webp", MAINNET / "site-s03-transfer-pending.png", (54, 1215, 1026, 1477), 720),
    ("frag-forfeited.webp", MAINNET / "site-s04-forfeited.png", (54, 1215, 1026, 1477), 720),
    ("frag-method-check-in.webp", "app-03b-new-goal-self-check-in.png", (54, 388, 1026, 746), 720),
]


def build_fonts():
    FONTS_OUT.mkdir(parents=True, exist_ok=True)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]  # keep tabular numbers, kerning, ligatures
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    for out, src in FONTS.items():
        font = subset.load_font(str(src), opts)
        s = subset.Subsetter(opts)
        s.populate(unicodes=subset.parse_unicodes(UNICODES))
        s.subset(font)
        subset.save_font(font, str(FONTS_OUT / out), opts)
        print(f"font  {out}  {(FONTS_OUT / out).stat().st_size // 1024} KB")
    shutil.copy(FONTS_IN / "inter" / "LICENSE_FONT", FONTS_OUT / "LICENSE-Inter.txt")
    shutil.copy(FONTS_IN / "barlow-condensed" / "LICENSE_FONT", FONTS_OUT / "LICENSE-BarlowCondensed.txt")


def build_images():
    IMG_OUT.mkdir(parents=True, exist_ok=True)
    for out, src, box, width in CROPS:
        img = Image.open(src if isinstance(src, Path) else SHOTS / src).convert("RGB").crop(box)
        height = round(img.height * width / img.width)
        img = img.resize((width, height), Image.LANCZOS)
        img.save(IMG_OUT / out, "WEBP", quality=90, method=6)
        print(f"image {out}  {width}x{height}  {(IMG_OUT / out).stat().st_size // 1024} KB")


def build_icons():
    icon = Image.open(ROOT / "seeker-app" / "assets" / "images" / "icon.png").convert("RGBA")
    icon.resize((180, 180), Image.LANCZOS).save(IMG_OUT / "apple-touch-icon.png", optimize=True)
    icon.resize((32, 32), Image.LANCZOS).save(SITE / "favicon-32.png", optimize=True)
    print("icons apple-touch-icon.png, favicon-32.png")


if __name__ == "__main__":
    build_fonts()
    build_images()
    build_icons()
