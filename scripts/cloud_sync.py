"""Bridge between the Supabase libraries and the Claude picks routine (see ROUTINE.md).

  python scripts/cloud_sync.py pull [--all]          who needs picks -> data/cloud/todo.json + one snapshot per library
  python scripts/cloud_sync.py push <slug> [--games|--videogames] validate the picks file, add covers, save to Supabase
  python scripts/cloud_sync.py covers <slug> [--videogames]  games: the next few games to find a cover picture for (worklist)
  python scripts/cloud_sync.py cover <slug> <key> <picture-url> [--videogames]       record the picture found for a game
  python scripts/cloud_sync.py cover <slug> <key> none <page-url>... [--videogames]  record that the pages searched had none
  python scripts/cloud_sync.py fail <slug> [--games|--videogames] mark that person's running request as failed
  python scripts/cloud_sync.py og <page-url>...      candidate box pictures on each web page, saved to data/cloud/covers/

Three kinds of library: books (snapshot data/cloud/<slug>.json, picks <slug>.picks.json), board games
(<slug>.games.json, picks <slug>.games.picks.json) and video games (<slug>.videogames.json,
<slug>.videogames.picks.json). Each todo entry says which kind, which files and the exact push command.

Needs the Supabase *secret* key: either in the SUPABASE_SECRET_KEY environment variable, or attached by the
cloud environment's network proxy to requests for the Supabase host. Never commit it.
pull without --all picks people who pressed "Update my picks now" or edited their library since their last
picks; --all (the monthly run) refreshes every approved person.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
URL = "https://vimynskvwneemuqplujf.supabase.co"
OUT = ROOT / "data" / "cloud"
# per kind: Supabase tables and the file-name part (books keep their original names)
KINDS = {"books": {"edits": "edits", "picks": "picks", "ext": ""},
         "games": {"edits": "game_edits", "picks": "game_picks", "ext": ".games"},
         "videogames": {"edits": "videogame_edits", "picks": "videogame_picks", "ext": ".videogames"}}
GAMES = ("games", "videogames")  # the kinds that share the game machinery (details to fill in, cover search)
FLAG = {"books": "", "games": " --games", "videogames": " --videogames"}
GAME_FIELDS = {"games": ("author", "year", "players", "playtime", "weight", "series"),  # details Claude may fill in for a game
               "videogames": ("author", "year", "series", "platforms")}
# what marks a kind's articles on Wikipedia, and the title suffix to ignore
WIKI = {"games": ("Infobox game", r" \((board |card )?game\)$"), "videogames": ("Infobox video game", r" \((\d{4} )?video game\)$")}


def api(path, method="GET", body=None, prefer=None):
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    k = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if k:
        h["apikey"] = k
        if k.startswith("eyJ"):  # legacy service_role JWT
            h["Authorization"] = "Bearer " + k
    if prefer:
        h["Prefer"] = prefer
    req = urllib.request.Request(URL + "/rest/v1" + path, method=method, headers=h,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        sys.exit(f"Supabase {method} {path.split('?')[0]} failed: HTTP {e.code} {e.read().decode()[:300]}")
    except (urllib.error.URLError, OSError) as e:
        sys.exit(f"Can't reach Supabase ({getattr(e, 'reason', e)}). If this is a cloud run, the environment's network "
                 f"access must allow {URL.split('//')[1]} (Full access works). Stop here and report it.")


def key(t):
    return str(t or "").lower().split(" (")[0].strip()


def when(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def base_library(slug, kind="books"):
    """The built part of a library: Baron's books come from the Goodreads export, everything else starts empty."""
    if kind != "books":
        return {"books": [], "queue": [], "recs": []}
    if slug != "baron":
        p = ROOT / "site" / "libraries" / f"{slug}.json"
        return json.loads(p.read_text("utf8")) if p.exists() else {"books": [], "queue": [], "recs": []}
    p = ROOT / "site" / "data.json"
    if not p.exists():
        subprocess.run([sys.executable, str(ROOT / "scripts" / "build_graph.py")], check=True, stdout=subprocess.DEVNULL)
    return json.loads(p.read_text("utf8"))


def taxonomy(ov, pk, kind="books"):
    if kind in GAMES:
        t = json.loads((ROOT / "site" / kind / "taxonomy.json").read_text("utf8"))
        tree = {g["name"]: list(g["subs"]) for g in t["groups"]}
    else:
        cur = json.loads((ROOT / "data" / "curation.json").read_text("utf8"))
        tree = {m: list(s) for m, s in cur["genres"].items()}
    names = {s for subs in tree.values() for s in subs}
    for g in (pk.get("newGenres") or []) + (ov.get("genres") or []):
        if not g.get("parent"):
            tree.setdefault(g["id"], [])
        elif g["id"] not in names:
            tree.setdefault(g["parent"], []).append(g["id"])
            names.add(g["id"])
    return tree


def snapshot(prof, ov, pk, kind="books"):
    """Mirror of site/edit.js apply(): the library exactly as its owner sees it."""
    d = base_library(prof["slug"], kind)
    books, queue = list(d.get("books", [])), list(d.get("queue", []))
    gone = {b.get("replaces") for b in ov.get("books", []) if b.get("replaces")}
    books = [b for b in books if b["id"] not in gone]
    queue = [b for b in queue if b["id"] not in gone]
    for b in ov.get("books", []):
        (books if b.get("shelf") == "read" else queue).append({**b, "shelf": b.get("shelf") or "to-read"})
    allb = books + queue
    for i, gs in (ov.get("assign") or {}).items():
        for b in allb:
            if b["id"] == i:
                b["genres"] = gs
    for i, r in (ov.get("ratings") or {}).items():
        for b in books:
            if b["id"] == i:
                b["rating"] = r or None
    pb = pk.get("books") or {}
    for b in allb:
        p = pb.get(b["id"]) or {}
        if not b.get("genres") and p.get("genres"):
            b["genres"] = p["genres"]
        if p.get("fit") is not None:
            b["fit"] = p["fit"]
        if kind in GAMES:
            for f in GAME_FIELDS[kind]:
                if p.get(f) not in (None, "") and b.get(f) in (None, ""):
                    b[f] = p[f]
            if p.get("cover") and (not b.get("cover") or is_photo(b["cover"])):
                b["cover"] = p["cover"]
    more = {"games": ("players", "playtime", "weight", "plays", "note", "expansion", "owned"),  # a note is the owner's own comment
            "videogames": ("platforms", "seriesNo", "note")}.get(kind, ())
    row = lambda b, *extra: {k: b.get(k) for k in ("id", "title", "author", "genres", "series", *more, *extra) if b.get(k) not in (None, [], "")}
    reading = [b for b in queue if b.get("shelf") == "reading"]
    to_read = [b for b in queue if b.get("shelf") != "reading"]
    snap = {
        "slug": prof["slug"], "name": prof["display_name"], "kind": kind,
        "taxonomy": taxonomy(ov, pk, kind),
        "read": [row(b, "rating", "year") for b in books],
        "reading": [row(b, *(("year",) if kind in GAMES else ())) for b in reading],
        "toRead": [row(b, *(("year",) if kind in GAMES else ())) for b in to_read],
        "needGenres": [b["id"] for b in allb if not b.get("genres")],
        "needFit": [b["id"] for b in to_read if b.get("fit") is None and not (b.get("parts") or {}).get("taste")],
        "fixedRecs": [f'{r["title"]} — {r["author"]}' for r in d.get("recs", [])],  # Baron's hand-curated list
        "currentPicks": {k: pk.get(k) for k in ("newGenres", "books", "recs") if pk.get(k)},
    }
    if kind in GAMES:  # games added by name (or with thin Wikidata entries) need their details filled in
        must = ("author", "year", "players", "playtime") if kind == "games" else ("author", "year")
        snap["needDetails"] = [b["id"] for b in allb if any(b.get(f) in (None, "", []) for f in must)]
        # box pictures still to look for on the web: each game is searched once (coverSearched remembers them)
        tried = set(pk.get("coverSearched") or [])
        snap["coverSearched"] = sorted(tried)
        snap["needCover"] = [b["id"] for b in allb if (not b.get("cover") or is_photo(b["cover"])) and b["id"] not in tried]
        snap["recsNeedCover"] = [r["title"] for r in pk.get("recs") or [] if not r.get("cover") and "rec:" + key(r["title"]) not in tried]
    return snap


def is_photo(u):  # Wikimedia Commons pictures are mostly gameplay photos, not the box
    return bool(re.search(r"commons\.wikimedia\.org/wiki/Special:FilePath|/wikipedia/commons/", u or ""))


UA = {"User-Agent": "Mozilla/5.0 (compatible; library-picks/1.0; +https://github.com/bar371/Barons-Books)"}
BANNED = re.compile(r"boardgamegeek\.com|geekdo|bgg\.cc", re.I)  # BGG's terms: art only through their API (token pending)


def img_ok(u):
    """Is u a public https picture that loads without cookies? (what the site's <img> needs)"""
    if not isinstance(u, str) or not u.startswith("https://") or BANNED.search(u) or len(u) > 1000:
        return False
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={**UA, "Range": "bytes=0-4095"}), timeout=10) as r:
            return r.status in (200, 206) and r.headers.get("Content-Type", "").startswith("image/")
    except Exception:
        return False


def check_imgs(urls):
    from concurrent.futures import ThreadPoolExecutor
    urls = sorted({u for u in urls if u})
    with ThreadPoolExecutor(12) as ex:
        return dict(zip(urls, ex.map(img_ok, urls)))


def og(pages):
    """Candidate box pictures from each web page (og:image first, then large product images). Each one that loads is
    saved under data/cloud/covers/ so it can be looked at before use."""
    from concurrent.futures import ThreadPoolExecutor
    (OUT / "covers").mkdir(parents=True, exist_ok=True)
    def one(n, p):
        if BANNED.search(p):
            return p, "BoardGameGeek pages are off limits"
        try:
            html = urllib.request.urlopen(urllib.request.Request(p, headers=UA), timeout=12).read(1_500_000).decode("utf8", "replace")
        except Exception as e:
            return p, f"page failed: {e}"
        found = []
        for m in re.finditer(r"<meta[^>]+>", html, re.I):
            t = m.group(0)
            if re.search(r"""(property|name)=["'](og:image(:secure_url)?|twitter:image)["']""", t, re.I):
                c = re.search(r"""content=["']([^"']+)""", t, re.I)
                if c: found.append(c.group(1))
        found += re.findall(r"""(?:src|data-src|href)=["']([^"' ]+\.(?:jpe?g|png|webp)(?:\?[^"' ]*)?)["']""", html, re.I)
        out, seen = [], set()
        for u in found:
            u = urllib.parse.urljoin(p, u.replace("&amp;", "&"))
            if u.startswith("http://"): u = "https://" + u[7:]
            if u in seen or re.search(r"logo|favicon|icon|banner|placeholder|avatar|sprite|flag|payment", u, re.I): continue
            seen.add(u)
            if not img_ok(u): continue
            f = OUT / "covers" / f"{n}-{len(out)}{os.path.splitext(urllib.parse.urlparse(u).path)[1][:5] or '.img'}"
            try:
                f.write_bytes(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=12).read(4_000_000))
                out.append({"url": u, "file": f.relative_to(ROOT).as_posix()})
            except Exception:
                continue
            if len(out) >= 5: break
        return p, out or "no usable picture on that page"
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda a: one(*a), enumerate(pages)))
    print(json.dumps(dict(res), indent=1))


def pull(everyone):
    OUT.mkdir(parents=True, exist_ok=True)
    approved = [r["user_id"] for r in api("/approved_users?select=user_id")]
    if not approved:
        sys.exit("No approved users visible: the Supabase secret key is not reaching Supabase (see ROUTINE.md).")
    profiles = {p["id"]: p for p in api("/profiles?select=id,slug,display_name,is_public")}
    queued = api("/refresh_requests?status=eq.queued&select=id,user_id,kind")
    todo = []
    for kind, T in KINDS.items():
        edits = {e["user_id"]: e for e in api(f'/{T["edits"]}?select=user_id,data,updated_at')}
        picks = {p["user_id"]: p for p in api(f'/{T["picks"]}?select=user_id,data,updated_at')}
        for uid in approved:
            prof = profiles.get(uid)
            if not prof:
                continue
            asked = [q["id"] for q in queued if q["user_id"] == uid and (q.get("kind") or "books") == kind]
            e, pk = edits.get(uid) or {}, picks.get(uid)
            if kind != "books" and not (e.get("data") or {}).get("books"):
                if asked:  # asked for game picks with an empty game shelf: nothing to base them on
                    api(f"/refresh_requests?id=in.({','.join(map(str, asked))})", "PATCH", {"status": "done", "note": "empty library"}, "return=minimal")
                continue
            changed = not pk or (e.get("updated_at") and when(e["updated_at"]) > when(pk["updated_at"]))
            snap = snapshot(prof, e.get("data") or {}, (pk or {}).get("data") or {}, kind)
            covers_due = kind in GAMES and bool(snap["needCover"] or snap["recsNeedCover"])  # games never searched for a box picture yet
            if not (everyone or asked or changed or covers_due):
                continue
            snap_file = f'{prof["slug"]}{T["ext"]}.json'
            (OUT / snap_file).write_text(json.dumps(snap, ensure_ascii=False, indent=1), "utf8")
            item = {"slug": prof["slug"], "name": prof["display_name"], "kind": kind, "requested": bool(asked),
                    "snapshot": f"data/cloud/{snap_file}", "write": f'data/cloud/{prof["slug"]}{T["ext"]}.picks.json',
                    "push": f'python3 scripts/cloud_sync.py push {prof["slug"]}' + FLAG[kind],
                    "read": len(snap["read"]), "needGenres": len(snap["needGenres"]), "needFit": len(snap["needFit"]),
                    "currentRecs": len(snap["currentPicks"].get("recs") or [])}
            if kind in GAMES:
                item["needDetails"] = len(snap["needDetails"])
                item["needCover"] = len(snap["needCover"]) + len(snap["recsNeedCover"])
            todo.append(item)
            if asked:
                api(f"/refresh_requests?id=in.({','.join(map(str, asked))})", "PATCH", {"status": "running"}, "return=minimal")
    (OUT / "todo.json").write_text(json.dumps(todo, indent=1), "utf8")
    print(json.dumps(todo, indent=1) if todo else "Nothing to do: no requests and no library changes since the last picks.")


def ol_cover(title, author):
    q = urllib.parse.urlencode({"title": title, "author": author, "fields": "cover_i,isbn", "limit": 3})
    try:
        req = urllib.request.Request(f"https://openlibrary.org/search.json?{q}", headers={"User-Agent": "library-picks/1.0"})
        with urllib.request.urlopen(req, timeout=12) as r:
            for doc in json.loads(r.read()).get("docs", []):
                if doc.get("cover_i"):
                    return f'https://covers.openlibrary.org/b/id/{doc["cover_i"]}-L.jpg'
    except Exception:
        pass
    return None


def wd_game(title, kind="games", year=None):
    """Wikipedia + Wikidata lookup for a game (same source as the site's add dialog): cover; for board games also BGG id, players, time."""
    template, strip = WIKI[kind]
    ua = {"User-Agent": "library-picks/1.0 (https://github.com/bar371/Barons-Books)"}

    def get(u):  # Wikimedia rate-limits bursts (HTTP 429): go gently and retry
        for wait in (0.3, 3, 8):
            time.sleep(wait)
            try:
                return json.loads(urllib.request.urlopen(urllib.request.Request(u, headers=ua), timeout=12).read())
            except urllib.error.HTTPError as e:
                if e.code != 429:
                    raise
        raise RuntimeError("rate-limited by Wikimedia")
    try:
        q = urllib.parse.urlencode({"format": "json", "action": "query", "list": "search", "srlimit": 1,
                                    "srsearch": f'{title}{" " + str(year) if year and kind == "videogames" else ""} hastemplate:"{template}"'})
        hits = get(f"https://en.wikipedia.org/w/api.php?{q}")["query"]["search"]
        if not hits or key(re.sub(strip, "", hits[0]["title"])) != key(title):
            return {}
        # the article's infobox image is usually the official box cover (Wikipedia hosts it under fair use: pilicense=any)
        q = urllib.parse.urlencode({"format": "json", "action": "query", "prop": "pageprops|pageimages", "piprop": "thumbnail|name",
                                    "pithumbsize": 500, "pilicense": "any", "ppprop": "wikibase_item", "titles": hits[0]["title"]})
        page = next(iter(get(f"https://en.wikipedia.org/w/api.php?{q}")["query"]["pages"].values()))
        qid = page.get("pageprops", {}).get("wikibase_item")
        src = (page.get("thumbnail") or {}).get("source") or ""
        box = "/wikipedia/en/" in src or re.search(r"box|cover|logo", page.get("pageimage") or "", re.I)
        out = {"cover": re.sub(r"\?utm_.*$", "", src) if src and box else None}
        if qid and kind == "games":
            c = get(f"https://www.wikidata.org/w/api.php?format=json&action=wbgetentities&props=claims&ids={qid}")["entities"][qid]["claims"]
            v = lambda p: ((c.get(p) or [{}])[0].get("mainsnak", {}).get("datavalue") or {}).get("value")
            amt = lambda p: round(float(v(p)["amount"])) if isinstance(v(p), dict) and v(p).get("amount") else None
            if not out["cover"] and v("P18") and re.search(r"box|cover", v("P18"), re.I):  # Commons pictures are mostly gameplay photos
                out["cover"] = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(v("P18")) + "?width=500"
            out["bggId"] = v("P2339")
            lo, hi = amt("P1872"), amt("P1873")
            out["players"] = [lo, hi or lo] if lo else None
            out["playtime"] = amt("P2047")
        return {k: x for k, x in out.items() if x}
    except Exception as e:
        print(f"  (picture lookup for {title} failed: {e})", file=sys.stderr)
        return {}


def uid_of(slug):
    rows = api(f"/profiles?slug=eq.{urllib.parse.quote(slug)}&select=id")
    if not rows:
        sys.exit(f"no library called {slug}")
    return rows[0]["id"]


def push(slug, kind="books"):
    T = KINDS[kind]
    t0 = time.monotonic()
    snap = json.loads((OUT / f'{slug}{T["ext"]}.json').read_text("utf8"))
    out = json.loads((OUT / f'{slug}{T["ext"]}.picks.json').read_text("utf8"))
    tree = snap["taxonomy"]
    new = []
    for g in out.get("newGenres") or []:
        name, parent = str(g.get("name", "")).strip(), g.get("parent")
        if name and parent in tree and name not in {s for v in tree.values() for s in v}:
            tree[parent].append(name)
            new.append({"id": name, "name": name, "parent": parent})
    subs = {s for v in tree.values() for s in v}
    old_new = (snap["currentPicks"].get("newGenres") or [])
    new = old_new + [g for g in new if g["id"] not in {x["id"] for x in old_new}]
    warn, notes = [], []
    ids = {b["id"] for b in snap["read"] + snap["reading"] + snap["toRead"]}
    read_ids = {b["id"] for b in snap["read"]}
    books = dict(snap["currentPicks"].get("books") or {})
    ok = check_imgs([b.get("cover") for b in (out.get("books") or {}).values()] + [r.get("cover") for r in out.get("recs") or []]) if kind in GAMES else {}
    for i, b in (out.get("books") or {}).items():
        if i not in ids:
            warn.append(f"book {i}: not in the library"); continue
        gs = [g for g in b.get("genres", []) if g in subs]
        if b.get("genres") and not gs:
            warn.append(f"book {i}: unknown genres {b['genres']}")
        e = {"genres": gs} if gs else {}
        if b.get("blurb"): e["blurb"] = str(b["blurb"])[:300]
        if isinstance(b.get("fit"), (int, float)): e["fit"] = max(0, min(100, int(b["fit"])))
        if kind in GAMES:
            e.update(game_details(b, kind))
            if b.get("cover"):
                if ok.get(b["cover"]): e["cover"] = b["cover"]
                else: notes.append(f"game {i}: cover doesn't load or isn't allowed, left out: {b['cover'][:100]}")
        if e: books[i] = {**books.get(i, {}), **e}
    owned = {key(b["title"]) for b in snap["read"] + snap["reading"] + snap["toRead"]}
    fixed = {key(t.split(" — ")[0]) for t in snap["fixedRecs"]}
    recs, seen = [], set()
    for r in out.get("recs") or []:
        k = key(r.get("title"))
        because = [x for x in r.get("because", []) if x in read_ids]
        gs = [g for g in r.get("genres", []) if g in subs]
        why = None if k and r.get("author") else "needs title and author"
        why = why or ("already in the library" if k in owned else "already one of the curated picks" if k in fixed else "duplicate" if k in seen else None)
        why = why or (None if because else "no valid 'because' ids") or (None if gs else f"unknown genres {r.get('genres')}")
        if why:
            warn.append(f"rec {r.get('title')}: {why}"); continue
        seen.add(k)
        prev = next((x for x in snap["currentPicks"].get("recs") or [] if key(x["title"]) == k), {})
        rec = {"id": prev.get("id") or "pk-" + re.sub(r"[^a-z0-9]+", "-", k).strip("-")[:60],
               "title": r["title"], "author": r["author"], "year": r.get("year"), "genres": gs, "because": because,
               "reason": r.get("reason"), "fit": max(0, min(100, int(r.get("fit", 70))))}
        if kind in GAMES:
            rec.update(game_details(r, kind))
        if kind == "videogames" and isinstance(r.get("holdsUp"), (int, float)):  # how well it holds up today (see ROUTINE.md 2c)
            rec["holdsUp"] = max(0, min(100, int(r["holdsUp"])))
            # picture lookups are best effort (the site also finds box covers itself): stop after ~2 minutes so the save always happens
            late = time.monotonic() - t0 > 120
            look = {} if late or (prev.get("cover") and (prev.get("bggId") or kind != "games")) else wd_game(r["title"], kind, r.get("year"))
            web = r.get("cover") if ok.get(r.get("cover")) else None
            if r.get("cover") and not web: notes.append(f"rec {r['title']}: cover doesn't load or isn't allowed, left out (the pick is kept)")
            rec["cover"] = web or prev.get("cover") or look.get("cover")
            if kind == "games":
                rec["bggId"] = prev.get("bggId") or look.get("bggId")
                for f in ("players", "playtime"):
                    rec[f] = rec.get(f) or look.get(f)
        else:
            rec["cover"] = prev.get("cover") or r.get("cover") or ol_cover(r["title"], r["author"])
        recs.append(rec)
    data = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "newGenres": new, "books": books, "recs": recs}
    if kind in GAMES:  # the web cover search (see `covers`): apply what was found, remember what was searched
        wl = worklist_load(slug, kind)
        for k, u in wl["found"].items():
            if k.startswith("rec:"):
                for r in recs:
                    if "rec:" + key(r["title"]) == k: r["cover"] = u
            elif k in ids:
                books[k] = {**books.get(k, {}), "cover": u}
        data["coverSearched"] = sorted(set(snap.get("coverSearched") or []) | set(wl["found"]) | set(wl["none"]))
    uid = uid_of(slug)
    api(f'/{T["picks"]}?on_conflict=user_id', "POST", {"user_id": uid, "data": data, "updated_at": data["updated"]},
        "resolution=merge-duplicates,return=minimal")
    api(f"/refresh_requests?user_id=eq.{uid}&kind=eq.{kind}&status=eq.running", "PATCH", {"status": "done"}, "return=minimal")
    print(f"{slug} ({kind}): saved {len(recs)} picks ({sum(1 for r in recs if r.get('cover'))} with pictures), "
          f"{len(books)} {'game' if kind in GAMES else 'book'} notes, {len(new)} new {'categories' if kind == 'games' else 'genres'}")
    for w in warn:
        print("  skipped " + w)
    for n in notes:
        print("  note: " + n)
    if kind in GAMES:
        left = worklist_pending(slug, snap, recs, books, kind)
        if left:
            print(f"\nNEXT STEP, required: {len(left)} games still need a cover picture search. Run: python3 scripts/cloud_sync.py covers {slug}{FLAG[kind] if kind != 'games' else ''}"
                  f"\nand keep going until it says ALL DONE, then run this push again.")
        else:
            print(f"covers: all searched ({len(wl['found'])} found on the web this run, {len(wl['none'])} with none)")


def worklist_file(slug, kind="games"):
    return OUT / f"{slug}{'' if kind == 'games' else KINDS[kind]['ext']}.covers.json"


def worklist_load(slug, kind="games"):
    f = worklist_file(slug, kind)
    return json.loads(f.read_text("utf8")) if f.exists() else {"todo": [], "found": {}, "none": {}}


def worklist_pending(slug, snap, recs=None, books=None, kind="games"):
    """Games (library ids, 'rec:<title key>' for picks) with no box picture that nobody has searched for yet."""
    wl = worklist_load(slug, kind)
    done = set(snap.get("coverSearched") or []) | set(wl["found"]) | set(wl["none"])
    if recs is None:
        pf = OUT / f"{slug}{KINDS[kind]['ext']}.picks.json"
        recs = (json.loads(pf.read_text("utf8")).get("recs") or []) if pf.exists() else []
    prev = {key(r["title"]): r for r in snap["currentPicks"].get("recs") or []}
    books = books if books is not None else (snap["currentPicks"].get("books") or {})
    lib = {b["id"]: b for b in snap["read"] + snap["reading"] + snap["toRead"]}
    out = [{"key": i, "title": lib[i]["title"], "designer": lib[i].get("author"), "year": lib[i].get("year")}
           for i in snap.get("needCover") or [] if i in lib and i not in done and not (books.get(i) or {}).get("cover")]
    for r in recs:
        k = "rec:" + key(r["title"])
        if k not in done and not r.get("cover") and not (prev.get(key(r["title"])) or {}).get("cover"):
            out.append({"key": k, "title": r["title"], "designer": r.get("author"), "year": r.get("year")})
    return out


def covers(slug, kind="games"):
    flag = FLAG[kind] if kind != "games" else ""
    snap = json.loads((OUT / f"{slug}{KINDS[kind]['ext']}.json").read_text("utf8"))
    left = worklist_pending(slug, snap, kind=kind)
    if not left:
        print(f"ALL DONE: every game has a picture or was searched. Now run: python3 scripts/cloud_sync.py push {slug}{FLAG[kind]}")
        return
    print(f"{len(left)} games still to search. Next batch (search each, then record it with `cover`):")
    print(json.dumps(left[:6], ensure_ascii=False, indent=1))
    print(f"Record each one: python3 scripts/cloud_sync.py cover {slug} <key> <picture-url>{flag}"
          f"\n  or, if the pages you checked had no such picture: python3 scripts/cloud_sync.py cover {slug} <key> none <page-url> [<page-url> ...]{flag}"
          "\nThen run `covers` again for the next batch. Don't stop until it says ALL DONE: there is no time limit.")


def cover(slug, k, args, kind="games"):
    wl = worklist_load(slug, kind)
    if args[:1] == ["none"]:
        pages = [a for a in args[1:] if a.startswith("http")]
        if not pages:
            sys.exit("Give the page urls you checked: cover <slug> <key> none <page-url> [<page-url> ...]")
        wl["none"][k] = pages; wl["found"].pop(k, None)
    elif len(args) == 1 and img_ok(args[0]):
        wl["found"][k] = args[0]; wl["none"].pop(k, None)
    else:
        sys.exit("That picture doesn't load, isn't https, or is from BoardGameGeek: pick another one.")
    worklist_file(slug, kind).write_text(json.dumps(wl, ensure_ascii=False, indent=1), "utf8")
    print(f"recorded {k}: {'none' if k in wl['none'] else wl['found'][k]}")


def game_details(b, kind="games"):
    """Designer / year / players / play time / weight / family (video games: studio / year / series / platforms)
    Claude gives for a game, sanity-checked."""
    e = {}
    if kind == "videogames":
        pl = b.get("platforms")
        if isinstance(pl, list) and pl and all(isinstance(x, str) and x.strip() for x in pl): e["platforms"] = [x.strip()[:40] for x in pl[:8]]
    if isinstance(b.get("author"), str) and b["author"].strip(): e["author"] = b["author"].strip()[:80]
    if isinstance(b.get("series"), str) and b["series"].strip(): e["series"] = b["series"].strip()[:80]
    if isinstance(b.get("year"), int) and 1800 <= b["year"] <= 2100: e["year"] = b["year"]
    if kind != "games":
        return e
    p = b.get("players")
    if isinstance(p, list) and p and all(isinstance(x, int) and 1 <= x <= 100 for x in p[:2]):
        e["players"] = [p[0], p[1] if len(p) > 1 else p[0]]
    if isinstance(b.get("playtime"), (int, float)) and 1 <= b["playtime"] <= 2000: e["playtime"] = int(b["playtime"])
    if isinstance(b.get("weight"), (int, float)) and 1 <= b["weight"] <= 5: e["weight"] = round(float(b["weight"]), 1)
    return e


def fail(slug, kind="books"):
    api(f"/refresh_requests?user_id=eq.{uid_of(slug)}&kind=eq.{kind}&status=eq.running", "PATCH", {"status": "failed"}, "return=minimal")
    print(f"{slug} ({kind}): marked failed")


if __name__ == "__main__":
    a = sys.argv[1:]
    kind = "videogames" if "--videogames" in a else "games" if "--games" in a else "books"
    a = [x for x in a if x not in ("--games", "--videogames")]
    gkind = kind if kind in GAMES else "games"  # covers / cover are game commands: plain means board games
    if a[:1] == ["pull"]:
        pull("--all" in a)
    elif a[:1] == ["push"] and len(a[1:]) in (1, 2) and a[2:] in ([], ["--covers-done"]):
        push(a[1], kind)
    elif a[:1] == ["covers"] and len(a) == 2:
        covers(a[1], gkind)
    elif a[:1] == ["cover"] and len(a) >= 4:
        cover(a[1], a[2], a[3:], gkind)
    elif a[:1] == ["og"] and len(a) > 1:
        og(a[1:])
    elif a[:1] == ["fail"] and len(a) == 2:
        fail(a[1], kind)
    else:
        sys.exit(__doc__)
