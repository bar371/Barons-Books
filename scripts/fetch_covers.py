#!/usr/bin/env python3
"""Download cover art into site/covers/ and cache the mapping in data/covers.json.

Order of attempts per book:
  1. Goodreads book page (og:image) -> the exact edition you read   [read books only]
  2. Open Library by ISBN13
  3. Open Library title/author search
Books that already have a cached cover are skipped, so re-runs are cheap.
Usage: python scripts/fetch_covers.py [id1,id2,...]   (ids given are re-fetched even if cached)
Needs Pillow (pip install pillow). Goodreads placeholders, tiny or oddly shaped images are rejected.
"""
import io, json, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from build_graph import load_read_books, load_curation, ROOT

UA = {"User-Agent": "Mozilla/5.0 (Barons-Books cover fetcher)"}
COVERS = ROOT / "site" / "covers"
CACHE = ROOT / "data" / "covers.json"


def get(url, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        data = r.read()
    return data if binary else data.decode("utf8", "replace")


def valid_image(b):
    """Real, decodable, portrait-ish and big enough. Rejects Goodreads' logo placeholder, thumbnails, box sets' wide art."""
    if not b or len(b) < 4000:
        return False
    try:
        im = Image.open(io.BytesIO(b)); im.load()
    except Exception:
        return False
    w, h = im.size
    return w >= 150 and h >= 220 and 1.15 <= h / w <= 1.9


def save_cover(raw, path):
    """Store at most 360px wide (the page never draws larger) as optimized JPEG: keeps the site light."""
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    if im.width > 360:
        im = im.resize((360, round(im.height * 360 / im.width)), Image.LANCZOS)
    im.save(path, "JPEG", quality=86, optimize=True, progressive=True)


def try_urls(urls):
    for u in urls:
        try:
            b = get(u, binary=True)
        except Exception:
            continue
        if valid_image(b):
            return b
    return None


def from_goodreads(book_id):
    html = get(f"https://www.goodreads.com/book/show/{book_id}")
    m = re.search(r'property="og:image"\s+content="([^"]+)"', html) or         re.search(r'content="([^"]+)"\s+property="og:image"', html)
    if not m:
        return None
    return try_urls([re.sub(r"\._S[XY]\d+_", "", m.group(1))])


def ol_search(title, author):
    """Pool results from a structured title+author query and a free-text one; drop study guides and omnibus/box sets."""
    clean = re.sub(r"\s*\(.*?\)\s*", " ", title).strip()
    queries = [{"title": t, "author": author} for t in dict.fromkeys([clean, clean.split(":")[-1].strip()])]
    queries.append({"q": f"{clean} {author.split()[-1]}"})
    out, seen = [], set()
    for extra in queries:
        q = urllib.parse.urlencode({**extra, "fields": "key,title,cover_i,isbn", "limit": 8})
        for d in json.loads(get(f"https://openlibrary.org/search.json?{q}")).get("docs", []):
            if d["key"] in seen or re.search(r"study guide|summary|analysis|companion|collection|graphic canon|/", d.get("title", ""), re.I):
                continue
            seen.add(d["key"]); out.append(d)
    return out


def from_openlibrary(isbn, title, author):
    """ISBN first, then every English edition of the matching work, then the work's default cover."""
    if isbn:
        b = try_urls([f"https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg?default=false"])
        if b:
            return b
    docs = ol_search(title, author)
    for d in docs[:2]:
        try:
            eds = json.loads(get(f"https://openlibrary.org{d['key']}/editions.json?limit=100")).get("entries", [])
        except Exception:
            continue
        for e in eds:
            if e.get("covers") and any(l.get("key") == "/languages/eng" for l in e.get("languages", [])):
                b = try_urls([f"https://covers.openlibrary.org/b/id/{c}-L.jpg?default=false" for c in e["covers"][:1] if c > 0])
                if b:
                    return b
    eng = [i for d in docs[:3] for i in d.get("isbn", []) if i.startswith(("9780", "9781"))][:25]  # 978-0/-1 = English-language publishers
    b = try_urls([f"https://covers.openlibrary.org/b/isbn/{i}-L.jpg?default=false" for i in eng])
    if b:
        return b
    return try_urls([f"https://covers.openlibrary.org/b/id/{d['cover_i']}-L.jpg?default=false" for d in docs if d.get("cover_i")])


def from_google_books(title, author):
    clean = re.sub(r"\s*\(.*?\)\s*", " ", title).strip()
    q = urllib.parse.urlencode({"q": f'intitle:"{clean}" inauthor:"{author}"', "langRestrict": "en", "maxResults": 6})
    for attempt in range(3):
        try:
            items = json.loads(get(f"https://www.googleapis.com/books/v1/volumes?{q}")).get("items", [])
            break
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(8 * (attempt + 1))  # rate-limited: back off and retry
    else:
        return None
    for it in items:
        vid = it["id"]
        b = try_urls([f"https://books.google.com/books/content?id={vid}&printsec=frontcover&img=1&zoom=3&source=gbs_api"])
        if b:
            return b
    return None


def main():
    COVERS.mkdir(parents=True, exist_ok=True)
    cache = json.loads(CACHE.read_text("utf8")) if CACHE.exists() else {}
    cur = load_curation()
    items = [(b["id"], b["title"], b["author"], b.get("isbn13"), True) for b in load_read_books()]
    items += [(r["id"], r["title"], r["author"], r.get("isbn13"), False) for r in cur.get("recommendations", [])]
    redo = set(sys.argv[1].split(",")) if len(sys.argv) > 1 else set()
    ov_path = ROOT / "data" / "cover_overrides.json"
    overrides = json.loads(ov_path.read_text("utf8")) if ov_path.exists() else {}
    for id_, title, author, isbn, is_read in items:
        if id_ in overrides and overrides[id_] is None:  # deliberately no art
            (COVERS / f"{id_}.jpg").unlink(missing_ok=True); cache[id_] = None; continue
        if cache.get(id_) and id_ not in redo and id_ not in overrides:
            continue
        if id_ in overrides and not (cache.get(id_) and (COVERS / f"{id_}.jpg").exists() and id_ not in redo):
            img = try_urls([overrides[id_]])
            if img:
                save_cover(img, COVERS / f"{id_}.jpg"); cache[id_] = f"covers/{id_}.jpg"; print(f"pin  {id_}  {title}")
                CACHE.write_text(json.dumps(cache, indent=1), "utf8"); continue
            print(f"  override for {id_} failed, falling back")
        elif id_ in overrides:
            continue
        img = None
        try:
            if is_read and str(id_).isdigit():
                img = from_goodreads(id_)
                if not valid_image(img):
                    img = None
        except Exception as e:
            print(f"  goodreads miss {id_}: {e}")
        for name, fn in (("openlibrary", lambda: from_openlibrary(isbn, title, author)), ("googlebooks", lambda: from_google_books(title, author))):
            if img:
                break
            try:
                img = fn()
            except Exception as e:
                print(f"  {name} miss {id_}: {e}")
        if valid_image(img):
            save_cover(img, COVERS / f"{id_}.jpg")
            cache[id_] = f"covers/{id_}.jpg"
            print(f"ok   {id_}  {title}")
        else:
            cache[id_] = None
            print(f"MISS {id_}  {title}")
        CACHE.write_text(json.dumps(cache, indent=1), "utf8")
        time.sleep(0.6)


if __name__ == "__main__":
    main()
