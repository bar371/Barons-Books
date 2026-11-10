#!/usr/bin/env python3
"""Merge your Goodreads export + curated genres/recommendations + cached covers
into site/data.json, which the static page renders.

    python scripts/build_graph.py

Inputs
  data/library.csv                    sanitized Goodreads export (scripts/sanitize_export.py); falls back to
                                      the raw export, then data/sample_library.csv
  data/curation.json                  genre tree, per-book genres, recommendations (written by Claude)
  data/covers.json                    id -> local cover path (written by fetch_covers.py)
"""
import csv, json, re, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PALETTE = ["#ff6b6b", "#ffa94d", "#ffd43b", "#8ce99a", "#38d9a9", "#66d9e8",
           "#74a8ff", "#b197fc", "#f783ac", "#e599f7", "#a9e34b", "#ced4da"]


def source_csv():
    for name in ("library.csv", "goodreads_library_export.csv"):  # library.csv = sanitized copy (committed)
        if (ROOT / "data" / name).exists():
            return ROOT / "data" / name, True
    return ROOT / "data" / "sample_library.csv", False


def unq(v):  # Goodreads wraps ISBNs like ="978..."
    return re.sub(r'^="?|"$', "", (v or "").strip())


def clean(v):
    return re.sub(r"\s+", " ", (v or "").replace("�", "'")).strip()


def split_series(title):
    """'Thud! (Discworld, #34; City Watch, #7)' -> ('Thud!', 'Discworld', 34.0)"""
    m = re.match(r"^(.*?)\s*\(([^()]*#[\d.]+[^()]*)\)\s*$", title)
    if m:
        first = m.group(2).split(";")[0]
        n = re.match(r"^(.*?),?\s*#([\d.]+)", first)
        if n:
            return m.group(1).strip(), n.group(1).strip(), float(n.group(2))
    return title.strip(), None, None


def load_read_books():
    path, _ = source_csv()
    books = []
    with open(path, newline="", encoding="utf8") as f:
        for r in csv.DictReader(f):
            if (r.get("Exclusive Shelf") or "read") != "read":
                continue
            title, series, no = split_series(clean(r["Title"]))
            rating = int(float(r.get("My Rating") or 0))
            books.append({
                "id": r["Book Id"], "title": title, "author": clean(r["Author"]),
                "series": series, "seriesNo": no,
                "isbn13": unq(r.get("ISBN13")) or None,
                "rating": rating or None,
                "avg": float(r.get("Average Rating") or 0) or None,
                "pages": int(r.get("Number of Pages") or 0) or None,
                "year": int(r.get("Original Publication Year") or r.get("Year Published") or 0) or None,
                "dateRead": (r.get("Date Read") or "").replace("/", "-") or None,
            })
    names = {b["series"] for b in books if b["series"]}  # 'Demon Cycle' vs 'The Demon Cycle'
    for b in books:
        if b["series"] and "The " + b["series"] in names:
            b["series"] = "The " + b["series"]
    seen, uniq = set(), []  # Goodreads lists some books under two editions
    for b in books:
        key = (b["title"].lower(), b["author"].lower(), b["seriesNo"])
        if key not in seen:
            seen.add(key); uniq.append(b)
    books = uniq
    return books


def load_curation():
    p = ROOT / "data" / "curation.json"
    return json.loads(p.read_text("utf8")) if p.exists() else {"genres": {}, "books": {}, "recommendations": []}


def main():
    books = load_read_books()
    cur = load_curation()
    covers = json.loads((ROOT / "data" / "covers.json").read_text("utf8")) if (ROOT / "data" / "covers.json").exists() else {}
    tree = cur.get("genres", {})
    sub_to_macro = {s: m for m, subs in tree.items() for s in subs}

    uncategorized = []
    out_books = []
    for b in books:
        c = cur.get("books", {}).get(b["id"], {})
        genres = [g for g in c.get("genres", []) if g in sub_to_macro]
        if not genres:
            uncategorized.append(f'{b["id"]}  {b["title"]} — {b["author"]}')
        out_books.append({**{k: v for k, v in b.items() if k != "isbn13"},
                          "genres": genres, "blurb": c.get("blurb"),
                          "cover": covers.get(b["id"])})

    ids = {b["id"] for b in out_books}
    out_recs = []
    for r in cur.get("recommendations", []):
        because = [x for x in r.get("because", []) if x in ids]
        genres = [g for g in r.get("genres", []) if g in sub_to_macro]
        if not because or not genres:
            print(f'skip rec {r.get("title")}: needs valid genres and "because" ids', file=sys.stderr)
            continue
        out_recs.append({"id": r["id"], "title": r["title"], "author": r["author"], "year": r.get("year"),
                         "genres": genres, "reason": r.get("reason"), "because": because,
                         "cover": covers.get(r["id"])})

    # count usage so colours go to the biggest macro genres first
    usage = {m: 0 for m in tree}
    for x in out_books + out_recs:
        for g in x["genres"]:
            usage[sub_to_macro[g]] += 1
    order = sorted(tree, key=lambda m: -usage[m])
    genres = []
    for i, m in enumerate(order):
        if not usage[m]:
            continue
        color = PALETTE[i % len(PALETTE)]
        genres.append({"id": m, "name": m, "parent": None, "color": color, "count": usage[m]})
        for s in tree[m]:
            n = sum(1 for x in out_books + out_recs if s in x["genres"])
            if n:
                genres.append({"id": s, "name": s, "parent": m, "color": color, "count": n})

    path, is_real = source_csv()
    data = {"meta": {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                     "source": path.name, "sample": not is_real,
                     "read": len(out_books), "recommended": len(out_recs)},
            "genres": genres, "books": out_books, "recs": out_recs}
    dest = ROOT / "site" / "data.json"
    dest.parent.mkdir(exist_ok=True)
    dest.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), "utf8")
    print(f"wrote {dest.relative_to(ROOT)}: {len(out_books)} read, {len(out_recs)} recommended, {len(genres)} genres")
    if uncategorized:
        print(f"\n{len(uncategorized)} read books have no genres in curation.json:")
        print("\n".join("  " + u for u in uncategorized))


if __name__ == "__main__":
    main()
