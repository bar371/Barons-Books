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


def load_books(shelves=("read",)):
    path, _ = source_csv()
    books = []
    with open(path, newline="", encoding="utf8") as f:
        for r in csv.DictReader(f):
            shelf = r.get("Exclusive Shelf") or "read"
            if shelf not in shelves:
                continue
            title, series, no = split_series(clean(r["Title"]))
            rating = int(float(r.get("My Rating") or 0))
            books.append({
                "shelf": shelf, "id": r["Book Id"], "title": title, "author": clean(r["Author"]),
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


def load_read_books():
    return load_books(("read",))


def load_queue_books():
    """To-read + currently-reading, minus anything already read under another edition."""
    read = {(b["title"].lower(), b["author"].lower()) for b in load_read_books()}
    return [b for b in load_books(("currently-reading", "to-read")) if (b["title"].lower(), b["author"].lower()) not in read]


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

    out_queue = []
    for b in load_queue_books():
        c = cur.get("books", {}).get(b["id"], {})
        genres = [g for g in c.get("genres", []) if g in sub_to_macro]
        if not genres:
            uncategorized.append(f'{b["id"]}  {b["title"]} — {b["author"]} (queue)')
        out_queue.append({**{k: v for k, v in b.items() if k not in ("isbn13", "rating", "avg", "dateRead")},
                          "shelf": "reading" if b["shelf"] == "currently-reading" else "to-read",
                          "genres": genres, "blurb": c.get("blurb"), "cover": covers.get(b["id"])})

    ids = {b["id"] for b in out_books}
    out_recs = []
    for r in cur.get("recommendations", []):
        because = [x for x in r.get("because", []) if x in ids]
        genres = [g for g in r.get("genres", []) if g in sub_to_macro]
        if not because or not genres:
            print(f'skip rec {r.get("title")}: needs valid genres and "because" ids', file=sys.stderr)
            continue
        # Match score = 60% taste fit (Claude's call) + 30% how highly you rated the books behind it
        # + 10% how many of your books point to it.
        stars = [b["rating"] for b in out_books if b["id"] in because and b.get("rating")]
        taste = r.get("fit", 70)
        ratings = round(sum(stars) / len(stars) / 5 * 100) if stars else 70
        links = round(min(len(because), 3) / 3 * 100)
        out_recs.append({"id": r["id"], "title": r["title"], "author": r["author"], "year": r.get("year"),
                         "genres": genres, "reason": r.get("reason"), "because": because,
                         "cover": covers.get(r["id"]),
                         "score": round(0.6 * taste + 0.3 * ratings + 0.1 * links),
                         "parts": {"taste": taste, "ratings": ratings, "links": links,
                                   "avgStars": round(sum(stars) / len(stars), 1) if stars else None}})
    out_recs.sort(key=lambda x: (-x["score"], -x["parts"]["taste"], x["title"]))
    for i, x in enumerate(out_recs, 1):
        x["rank"] = i

    # count usage so colours go to the biggest macro genres first
    usage = {m: 0 for m in tree}
    for x in out_books + out_recs + out_queue:
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
            n = sum(1 for x in out_books + out_recs + out_queue if s in x["genres"])
            if n:
                genres.append({"id": s, "name": s, "parent": m, "color": color, "count": n})

    atl_p = ROOT / "data" / "atlas.json"
    atlas = json.loads(atl_p.read_text("utf8")) if atl_p.exists() else None
    if atlas:
        for x in out_books + out_recs + out_queue:
            if x["id"] in atlas["cells"]:
                x["atlas"] = atlas["cells"][x["id"]]

    path, is_real = source_csv()
    data = {"meta": {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                     "source": path.name, "sample": not is_real,
                     "read": len(out_books), "recommended": len(out_recs), "queued": len(out_queue)},
            "genres": genres, "books": out_books, "recs": out_recs, "queue": out_queue,
            "atlas": {k: atlas[k] for k in ("src", "cw", "ch", "w", "h")} if atlas else None}
    dest = ROOT / "site" / "data.json"
    dest.parent.mkdir(exist_ok=True)
    dest.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), "utf8")
    print(f"wrote {dest.relative_to(ROOT)}: {len(out_books)} read, {len(out_queue)} queued, {len(out_recs)} recommended, {len(genres)} genres")
    if uncategorized:
        print(f"\n{len(uncategorized)} read books have no genres in curation.json:")
        print("\n".join("  " + u for u in uncategorized))


if __name__ == "__main__":
    main()
