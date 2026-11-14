"""Bridge between the Supabase libraries and the Claude picks routine (see ROUTINE.md).

  python scripts/cloud_sync.py pull [--all]          who needs picks -> data/cloud/todo.json + one snapshot per library
  python scripts/cloud_sync.py push <slug> [--games] validate the picks file, add covers, save to Supabase
  python scripts/cloud_sync.py fail <slug> [--games] mark that person's running request as failed

Two kinds of library: books (snapshot data/cloud/<slug>.json, picks <slug>.picks.json) and board games
(<slug>.games.json, picks <slug>.games.picks.json). Each todo entry says which kind and which files.

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
         "games": {"edits": "game_edits", "picks": "game_picks", "ext": ".games"}}
GAME_FIELDS = ("author", "year", "players", "playtime", "weight", "series")  # details Claude may fill in for a game


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
    if kind == "games":
        t = json.loads((ROOT / "site" / "games" / "taxonomy.json").read_text("utf8"))
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
        if kind == "games":
            for f in GAME_FIELDS:
                if p.get(f) not in (None, "") and b.get(f) in (None, ""):
                    b[f] = p[f]
    more = ("players", "playtime", "weight", "plays", "note", "expansion", "owned") if kind == "games" else ()  # a note is the owner's own comment
    row = lambda b, *extra: {k: b.get(k) for k in ("id", "title", "author", "genres", "series", *more, *extra) if b.get(k) not in (None, [], "")}
    reading = [b for b in queue if b.get("shelf") == "reading"]
    to_read = [b for b in queue if b.get("shelf") != "reading"]
    snap = {
        "slug": prof["slug"], "name": prof["display_name"], "kind": kind,
        "taxonomy": taxonomy(ov, pk, kind),
        "read": [row(b, "rating", "year") for b in books],
        "reading": [row(b, *(("year",) if kind == "games" else ())) for b in reading],
        "toRead": [row(b, *(("year",) if kind == "games" else ())) for b in to_read],
        "needGenres": [b["id"] for b in allb if not b.get("genres")],
        "needFit": [b["id"] for b in to_read if b.get("fit") is None and not (b.get("parts") or {}).get("taste")],
        "fixedRecs": [f'{r["title"]} — {r["author"]}' for r in d.get("recs", [])],  # Baron's hand-curated list
        "currentPicks": {k: pk.get(k) for k in ("newGenres", "books", "recs") if pk.get(k)},
    }
    if kind == "games":  # games added by name (or with thin Wikidata entries) need their details filled in
        snap["needDetails"] = [b["id"] for b in allb if any(b.get(f) in (None, "", []) for f in ("author", "year", "players", "playtime"))]
    return snap


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
            if not (everyone or asked or changed):
                continue
            snap = snapshot(prof, e.get("data") or {}, (pk or {}).get("data") or {}, kind)
            snap_file = f'{prof["slug"]}{T["ext"]}.json'
            (OUT / snap_file).write_text(json.dumps(snap, ensure_ascii=False, indent=1), "utf8")
            item = {"slug": prof["slug"], "name": prof["display_name"], "kind": kind, "requested": bool(asked),
                    "snapshot": f"data/cloud/{snap_file}", "write": f'data/cloud/{prof["slug"]}{T["ext"]}.picks.json',
                    "push": f'python3 scripts/cloud_sync.py push {prof["slug"]}' + (" --games" if kind == "games" else ""),
                    "read": len(snap["read"]), "needGenres": len(snap["needGenres"]), "needFit": len(snap["needFit"]),
                    "currentRecs": len(snap["currentPicks"].get("recs") or [])}
            if kind == "games":
                item["needDetails"] = len(snap["needDetails"])
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


def wd_game(title):
    """Wikipedia + Wikidata lookup for a board game (same source as the site's add dialog): photo, BGG id, players, time."""
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
                                    "srsearch": f'{title} hastemplate:"Infobox game"'})
        hits = get(f"https://en.wikipedia.org/w/api.php?{q}")["query"]["search"]
        if not hits or key(hits[0]["title"].replace(" (board game)", "")) != key(title):
            return {}
        # the article's infobox image is usually the official box cover (Wikipedia hosts it under fair use: pilicense=any)
        q = urllib.parse.urlencode({"format": "json", "action": "query", "prop": "pageprops|pageimages", "piprop": "thumbnail|name",
                                    "pithumbsize": 500, "pilicense": "any", "ppprop": "wikibase_item", "titles": hits[0]["title"]})
        page = next(iter(get(f"https://en.wikipedia.org/w/api.php?{q}")["query"]["pages"].values()))
        qid = page.get("pageprops", {}).get("wikibase_item")
        src = (page.get("thumbnail") or {}).get("source") or ""
        box = "/wikipedia/en/" in src or re.search(r"box|cover|logo", page.get("pageimage") or "", re.I)
        out = {"cover": re.sub(r"\?utm_.*$", "", src) if src and box else None}
        if qid:
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
    warn = []
    ids = {b["id"] for b in snap["read"] + snap["reading"] + snap["toRead"]}
    read_ids = {b["id"] for b in snap["read"]}
    books = dict(snap["currentPicks"].get("books") or {})
    for i, b in (out.get("books") or {}).items():
        if i not in ids:
            warn.append(f"book {i}: not in the library"); continue
        gs = [g for g in b.get("genres", []) if g in subs]
        if b.get("genres") and not gs:
            warn.append(f"book {i}: unknown genres {b['genres']}")
        e = {"genres": gs} if gs else {}
        if b.get("blurb"): e["blurb"] = str(b["blurb"])[:300]
        if isinstance(b.get("fit"), (int, float)): e["fit"] = max(0, min(100, int(b["fit"])))
        if kind == "games":
            e.update(game_details(b))
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
        if kind == "games":
            rec.update(game_details(r))
            # picture lookups are best effort (the site also finds box covers itself): stop after ~2 minutes so the save always happens
            late = time.monotonic() - t0 > 120
            look = {} if late or (prev.get("cover") and prev.get("bggId")) else wd_game(r["title"])
            rec["cover"] = prev.get("cover") or look.get("cover")
            rec["bggId"] = prev.get("bggId") or look.get("bggId")
            for f in ("players", "playtime"):
                rec[f] = rec.get(f) or look.get(f)
        else:
            rec["cover"] = prev.get("cover") or r.get("cover") or ol_cover(r["title"], r["author"])
        recs.append(rec)
    data = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "newGenres": new, "books": books, "recs": recs}
    uid = uid_of(slug)
    api(f'/{T["picks"]}?on_conflict=user_id', "POST", {"user_id": uid, "data": data, "updated_at": data["updated"]},
        "resolution=merge-duplicates,return=minimal")
    api(f"/refresh_requests?user_id=eq.{uid}&kind=eq.{kind}&status=eq.running", "PATCH", {"status": "done"}, "return=minimal")
    print(f"{slug} ({kind}): saved {len(recs)} picks ({sum(1 for r in recs if r.get('cover'))} with pictures), "
          f"{len(books)} {'game' if kind == 'games' else 'book'} notes, {len(new)} new {'categories' if kind == 'games' else 'genres'}")
    for w in warn:
        print("  skipped " + w)


def game_details(b):
    """Designer / year / players / play time / weight / family Claude gives for a game, sanity-checked."""
    e = {}
    if isinstance(b.get("author"), str) and b["author"].strip(): e["author"] = b["author"].strip()[:80]
    if isinstance(b.get("series"), str) and b["series"].strip(): e["series"] = b["series"].strip()[:80]
    if isinstance(b.get("year"), int) and 1800 <= b["year"] <= 2100: e["year"] = b["year"]
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
    kind = "games" if "--games" in a else "books"
    a = [x for x in a if x != "--games"]
    if a[:1] == ["pull"]:
        pull("--all" in a)
    elif a[:1] == ["push"] and len(a) == 2:
        push(a[1], kind)
    elif a[:1] == ["fail"] and len(a) == 2:
        fail(a[1], kind)
    else:
        sys.exit(__doc__)
