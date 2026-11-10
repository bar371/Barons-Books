#!/usr/bin/env python3
"""Check every book in site/data.json has a usable cover, and render labelled contact sheets
so the art can be eyeballed.   python scripts/verify_covers.py [outdir]

Hard failures (exit 1): missing file, undecodable image, tiny image, odd aspect ratio, or a
duplicate image used for two different books.
"""
import hashlib, json, sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "_sheets"
    out.mkdir(parents=True, exist_ok=True)
    d = json.loads((SITE / "data.json").read_text("utf8"))
    items = [(b, "read") for b in d["books"]] + [(q, "queue") for q in d.get("queue", [])] + [(r, "rec") for r in d["recs"]]
    ov = ROOT / "data" / "cover_overrides.json"
    blank = {k for k, v in (json.loads(ov.read_text("utf8")) if ov.exists() else {}).items() if v is None}
    problems, seen, ok, notes = [], {}, [], []
    for b, kind in items:
        tag = f'{kind:4} {b["id"]:>12}  {b["title"][:48]}'
        if not b.get("cover") and b["id"] in blank:
            notes.append(f"placeholder (intentional): {b['title']}"); continue
        if not b.get("cover"):
            problems.append(f"NO COVER   {tag}"); continue
        f = SITE / b["cover"]
        if not f.exists():
            problems.append(f"MISSING    {tag}"); continue
        try:
            im = Image.open(f); im.load()
        except Exception as e:
            problems.append(f"UNDECODABLE {tag}: {e}"); continue
        w, h = im.size
        if w < 150 or h < 220:
            problems.append(f"TOO SMALL  {tag} {w}x{h}")
        elif not 1.15 <= h / w <= 1.9:
            problems.append(f"ODD RATIO  {tag} {w}x{h}")
        digest = hashlib.md5(f.read_bytes()).hexdigest()
        if digest in seen:
            problems.append(f"DUPLICATE  {tag} == {seen[digest]}")
        seen[digest] = b["title"]
        ok.append((b, kind, im.convert("RGB")))

    # contact sheets: 10 per row, 3 rows per sheet
    cw, ch, lab = 150, 225, 34
    per_row, rows = 8, 3
    for si in range(0, len(ok), per_row * rows):
        chunk = ok[si:si + per_row * rows]
        sheet = Image.new("RGB", (per_row * cw, rows * (ch + lab)), (18, 20, 32))
        dr = ImageDraw.Draw(sheet)
        for i, (b, kind, im) in enumerate(chunk):
            x, y = (i % per_row) * cw, (i // per_row) * (ch + lab)
            sheet.paste(im.resize((cw - 6, ch - 4)), (x + 3, y + 2))
            dr.text((x + 4, y + ch), ("* " if kind == "rec" else "") + b["title"][:26], fill=(235, 235, 245))
            dr.text((x + 4, y + ch + 12), b["author"][:26], fill=(150, 160, 185))
        p = out / f"sheet-{si // (per_row * rows) + 1:02d}.png"
        sheet.save(p)
    print(f"{len(ok)}/{len(items)} covers OK; sheets in {out}")
    for n in notes:
        print("  note:", n)
    if problems:
        print(f"\n{len(problems)} PROBLEMS:"); print("\n".join(problems)); sys.exit(1)


if __name__ == "__main__":
    main()
