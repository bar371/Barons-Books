#!/usr/bin/env python3
"""Pack every cover into ONE small image (site/atlas.jpg) so the page makes a single request
instead of ~250. The page draws cover thumbnails from it and fetches the full-size file only
when you zoom right in.   python scripts/make_atlas.py   (also run by fetch_covers.py)
"""
import json, sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from build_graph import ROOT, load_read_books, load_queue_books, load_curation

CW, CH, COLS = 96, 144, 18


def main():
    covers = json.loads((ROOT / "data" / "covers.json").read_text("utf8"))
    ids = [b["id"] for b in load_read_books() + load_queue_books()] + [r["id"] for r in load_curation().get("recommendations", [])]
    ids = [i for i in dict.fromkeys(ids) if covers.get(i) and (ROOT / "site" / covers[i]).exists()]
    rows = -(-len(ids) // COLS)
    sheet = Image.new("RGB", (COLS * CW, rows * CH), (20, 24, 40))
    cells = {}
    for n, i in enumerate(ids):
        im = Image.open(ROOT / "site" / covers[i]).convert("RGB").resize((CW, CH), Image.LANCZOS)
        x, y = (n % COLS) * CW, (n // COLS) * CH
        sheet.paste(im, (x, y)); cells[i] = [x, y]
    out = ROOT / "site" / "atlas.jpg"
    sheet.save(out, "JPEG", quality=74, optimize=True, progressive=True)
    (ROOT / "data" / "atlas.json").write_text(json.dumps({"src": "atlas.jpg", "cw": CW, "ch": CH, "w": sheet.width, "h": sheet.height, "cells": cells}), "utf8")
    print(f"atlas.jpg: {len(ids)} covers, {sheet.width}x{sheet.height}, {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
