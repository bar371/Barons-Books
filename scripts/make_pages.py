"""Write the per-library pages and icons, so each library can be its own home-screen shortcut.

  python scripts/make_pages.py            pages + manifests (run after editing site/index.html)
  python scripts/make_pages.py --icons    also redraw the icons (needs Chrome and Pillow)

site/index.html is the books page and the only one edited by hand. This script copies it to
site/boardgames.html and site/videogames.html with that library's title, icon and app manifest, and marks the
library on <html data-kind="...">, which site/kind.js reads. A browser picks a shortcut's name and icon from the
page as it is served, before any script runs: that is why these are real pages and not just ?kind= links
(those still work).
"""
import json, subprocess, sys, tempfile
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
KINDS = {
    "books": {"page": "index.html", "start": "./", "name": "Baron's Library", "short": "Library", "bg": "#070a14",
              "title": "Baron's Library · a book constellation",
              "desc": "An interactive map of the books I've read, the genres they belong to, and what to read next."},
    "games": {"page": "boardgames.html", "start": "./boardgames.html", "name": "Baron's Board Games", "short": "Board Games", "bg": "#120c08",
              "title": "Baron's Board Games · a board game constellation",
              "desc": "An interactive map of my board games, the categories they belong to, and what to play next."},
    "videogames": {"page": "videogames.html", "start": "./videogames.html", "name": "Baron's Video Games", "short": "Video Games", "bg": "#07051a",
                   "title": "Baron's Video Games · a video game constellation",
                   "desc": "An interactive map of the video games I've played, their genres, and what to play next."},
}

# ---- icons: one drawing per library on a 512 grid; the art stays inside the middle 60% so round masks don't clip it ----
ART = {
    "books": """<defs><radialGradient id="g" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="#1a2547"/><stop offset="1" stop-color="#070a14"/></radialGradient></defs>
<rect width="512" height="512" rx="{rx}" fill="url(#g)"/>
<circle cx="112" cy="120" r="5" fill="#dfe6ff" opacity=".7"/><circle cx="408" cy="150" r="4" fill="#dfe6ff" opacity=".6"/><circle cx="392" cy="396" r="5" fill="#dfe6ff" opacity=".5"/><circle cx="96" cy="372" r="3.5" fill="#dfe6ff" opacity=".6"/>
<path d="M256 108l41 106 113 8-88 72 30 111-96-63-96 63 30-111-88-72 113-8z" fill="#ffd43b"/>""",
    "games": """<defs><radialGradient id="g" cx="50%" cy="40%" r="80%"><stop offset="0" stop-color="#3a2717"/><stop offset="1" stop-color="#120c08"/></radialGradient>
<linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4c56a"/><stop offset="1" stop-color="#c98a2b"/></linearGradient></defs>
<rect width="512" height="512" rx="{rx}" fill="url(#g)"/>
<path d="M256 100l135 78v156l-135 78-135-78V178z" fill="url(#h)"/>
<path d="M256 130l109 63v126l-109 63-109-63V193z" fill="none" stroke="#7a4d12" stroke-width="7" opacity=".55"/>
<circle cx="204" cy="212" r="24" fill="#2b1a0b"/><circle cx="256" cy="256" r="24" fill="#2b1a0b"/><circle cx="308" cy="300" r="24" fill="#2b1a0b"/>""",
    "videogames": """<defs><radialGradient id="g" cx="50%" cy="38%" r="80%"><stop offset="0" stop-color="#241a5e"/><stop offset="1" stop-color="#07051a"/></radialGradient>
<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<rect width="512" height="512" rx="{rx}" fill="url(#g)"/>
<g stroke="#ff3ddc" stroke-width="3" opacity=".35"><path d="M0 400h512M0 440h512M0 484h512M256 372L96 512M256 372l160 140M256 372l-40 140M256 372l40 140M256 372L-40 512M256 372l296 140"/></g>
<g filter="url(#glow)"><rect x="106" y="176" width="300" height="168" rx="62" fill="#120c36" stroke="#3df0ff" stroke-width="14"/>
<path d="M172 260h64M204 228v64" stroke="#3df0ff" stroke-width="20" stroke-linecap="round"/>
<circle cx="304" cy="278" r="18" fill="#ff3ddc"/><circle cx="346" cy="242" r="18" fill="#3df0ff"/></g>""",
}
svg = lambda kind, rx: f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{ART[kind].format(rx=rx)}</svg>\n'


def icons():
    from PIL import Image
    chrome = next(p for p in (r"C:\Program Files\Google\Chrome\Application\chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium") if Path(p).exists())
    (SITE / "icons").mkdir(exist_ok=True)
    for kind in KINDS:
        (SITE / "icons" / f"{kind}.svg").write_text(svg(kind, 112), "utf8")  # browser tab: rounded corners
        with tempfile.TemporaryDirectory() as tmp:  # app icons: full square, the phone rounds it itself
            page = Path(tmp) / "i.html"
            page.write_text(f'<body style="margin:0;background:{KINDS[kind]["bg"]}">{svg(kind, 0).replace("<svg ", "<svg width=512 height=512 style=display:block ")}', "utf8")
            big = SITE / "icons" / f"{kind}-512.png"
            subprocess.run([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--user-data-dir={tmp}/p", "--window-size=512,512",
                            "--force-device-scale-factor=1", f"--screenshot={big}", page.as_uri()], check=True, capture_output=True)
        im = Image.open(big).convert("RGB").crop((0, 0, 512, 512))
        im.save(big, optimize=True)
        for n in (192, 180):
            im.resize((n, n), Image.LANCZOS).save(SITE / "icons" / f"{kind}-{n}.png", optimize=True)
        print("icons:", kind)


def pages():
    src = (SITE / "index.html").read_text("utf8")
    b = KINDS["books"]
    for need in ('<html lang="en" data-theme="dark">', f'<title>{b["title"]}</title>', f'content="{b["desc"]}"', 'content="#070a14"',
                 "icons/books.svg", "icons/books-180.png", "books.webmanifest", f'content="{b["name"]}"'):
        if need not in src:
            sys.exit(f"index.html no longer contains: {need}")
    for kind, k in KINDS.items():
        (SITE / f"{kind}.webmanifest").write_text(json.dumps({
            "name": k["name"], "short_name": k["short"], "description": k["desc"], "id": k["start"], "start_url": k["start"], "scope": "./",
            "display": "standalone", "background_color": k["bg"], "theme_color": k["bg"],
            "icons": [{"src": f"icons/{kind}-192.png", "sizes": "192x192", "type": "image/png"},
                      {"src": f"icons/{kind}-512.png", "sizes": "512x512", "type": "image/png"},
                      {"src": f"icons/{kind}-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]}, indent=1) + "\n", "utf8")
        if kind == "books":
            continue
        out = (src.replace('<html lang="en" data-theme="dark">', f'<html lang="en" data-theme="dark" data-kind="{kind}">\n<!-- generated from index.html by scripts/make_pages.py: edit that file, then run the script -->')
               .replace(f'<title>{b["title"]}</title>', f'<title>{k["title"]}</title>').replace(f'content="{b["desc"]}"', f'content="{k["desc"]}"')
               .replace('content="#070a14"', f'content="{k["bg"]}"').replace("icons/books.svg", f"icons/{kind}.svg").replace("icons/books-180.png", f"icons/{kind}-180.png")
               .replace("books.webmanifest", f"{kind}.webmanifest").replace(f'content="{b["name"]}"', f'content="{k["name"]}"'))
        (SITE / k["page"]).write_text(out, "utf8", newline="\n")
        print("page:", k["page"])


if __name__ == "__main__":
    if "--icons" in sys.argv:
        icons()
    pages()
