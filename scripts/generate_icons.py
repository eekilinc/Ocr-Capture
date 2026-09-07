import os
from PIL import Image

src_path = r"C:\Users\Ekrem\.gemini\antigravity-ide\brain\3a47d7dd-3054-40ad-8ca6-c6190a293827\ocr_app_icon_1788817735706.jpg"
public_dir = r"d:\Denemeler\tauri\ocr-capture\public"
icons_dir = r"d:\Denemeler\tauri\ocr-capture\src-tauri\icons"

img = Image.open(src_path).convert("RGBA")

# 1. public/app-icon.png
app_icon_512 = img.resize((512, 512), Image.Resampling.LANCZOS)
app_icon_512.save(os.path.join(public_dir, "app-icon.png"), "PNG")
print("Saved public/app-icon.png")

# 2. src-tauri/icons/icon.png
app_icon_512.save(os.path.join(icons_dir, "icon.png"), "PNG")

# Specific sizes
sizes = {
    "32x32.png": (32, 32),
    "128x128.png": (128, 128),
    "128x128@2x.png": (256, 256),
    "Square30x30Logo.png": (30, 30),
    "Square44x44Logo.png": (44, 44),
    "Square71x71Logo.png": (71, 71),
    "Square89x89Logo.png": (89, 89),
    "Square107x107Logo.png": (107, 107),
    "Square142x142Logo.png": (142, 142),
    "Square150x150Logo.png": (150, 150),
    "Square284x284Logo.png": (284, 284),
    "Square310x310Logo.png": (310, 310),
    "StoreLogo.png": (50, 50),
}

for filename, size in sizes.items():
    resized = img.resize(size, Image.Resampling.LANCZOS)
    resized.save(os.path.join(icons_dir, filename), "PNG")
    print(f"Saved {filename}")

# 3. icon.ico with multiple resolutions
ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
img.save(os.path.join(icons_dir, "icon.ico"), format="ICO", sizes=ico_sizes)
print("Saved icon.ico with multi-sizes")
