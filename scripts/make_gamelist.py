"""Turn a plain list of video games into a list file the app can import (Add a game -> Import).

  python scripts/make_gamelist.py <list.txt> <out.json>

One game per line, fields separated by "|" (only the title is required):

  title | year | stars 1-5 (halves allowed: 4.5) | shelf | genres | series | number in series | your own note

  The Witcher 3: Wild Hunt | 2015 | 5 | played | Action RPG; Open world | The Witcher | 3
  Hades II | | | backlog | Roguelike

shelf: played (default), playing, backlog. genres: names from site/videogames/taxonomy.json, ";" between them,
the main one first. Lines starting with # are skipped.

Each game is looked up on English Wikipedia (articles with a video game infobox) for its cover, and on Wikidata
for studio, platforms, series and first release year. Anything not found is still written, just with fewer
details; the report at the end says which lines to check.
"""
import json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (compatible; library-map-gamelist/1.0; +https://github.com/bar371/Barons-Books)"
WP = "https://en.wikipedia.org/w/api.php?format=json&action=query"
WD = "https://www.wikidata.org/w/api.php?format=json&action=wbgetentities"
STRIP = re.compile(r"\s*\((\d{4} )?video game\)$")
SHELF = {"played": "read", "read": "read", "": "read", "playing": "reading", "reading": "reading", "backlog": "to-read", "to-read": "to-read", "want": "to-read"}


def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf8"))
        except Exception as e:  # Wikimedia asks busy clients to slow down (429)
            if i == tries - 1:
                raise
            time.sleep(2 + 4 * i)


def key(s):
    return re.sub(r"[^a-z0-9]", "", STRIP.sub("", s.lower()))


def ids(claims, p):
    return [x["mainsnak"]["datavalue"]["value"]["id"] for x in claims.get(p, []) if x.get("mainsnak", {}).get("datavalue")]


def first_year(claims):
    ys = []
    for x in claims.get("P577", []):
        t = x.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("time", "")
        if re.match(r"\+\d{4}", t):
            ys.append(int(t[1:5]))
    return min(ys) if ys else None


def main(src, out):
    tax = json.loads((ROOT / "site" / "videogames" / "taxonomy.json").read_text("utf8"))
    known = {s for g in tax["groups"] for s in g["subs"]}
    rows, notes = [], []
    for n, line in enumerate(Path(src).read_text("utf8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        f = [x.strip() for x in line.split("|")] + [""] * 8
        genres = [g.strip() for g in f[4].split(";") if g.strip()]
        for g in genres:
            if g not in known:
                notes.append(f"line {n}: unknown genre '{g}' ({f[0]})")
        rows.append({"line": n, "title": f[0], "year": int(f[1]) if f[1].isdigit() else None, "rating": (float(f[2]) if "." in f[2] else int(f[2])) if re.fullmatch(r"[1-5](\.[05])?", f[2]) else None,
                     "shelf": SHELF.get(f[3].lower(), "read"), "genres": [g for g in genres if g in known], "series": f[5] or None,
                     "seriesNo": int(f[6]) if f[6].isdigit() else None, "note": f[7] or None})

    # 1. which Wikipedia article is it? (several candidates; the year breaks ties between remakes)
    for r in rows:
        q = f'{r["title"]} hastemplate:"Infobox video game"'
        hits = [h["title"] for h in get(f"{WP}&list=search&srlimit=6&srsearch={urllib.parse.quote(q)}")["query"]["search"]]
        k = key(r["title"])
        exact = [h for h in hits if key(h) == k]
        r["cands"] = exact or [h for h in hits[:1] if k in key(h) or key(h) in k]
        r["fuzzy"] = not exact
        # remakes and reboots share a name; Wikipedia titles them "Name (2018 video game)", which search may rank low
        r["guess"] = [f'{r["title"]} ({r["year"]} video game)'] if r["year"] else []
        time.sleep(0.15)

    # 2. page image + Wikidata id for every candidate
    titles = sorted({c for r in rows for c in r["cands"] + r["guess"]})
    page = {}
    for i in range(0, len(titles), 40):
        batch = titles[i:i + 40]
        w = get(f"{WP}&prop=pageimages|pageprops&piprop=thumbnail|name&pithumbsize=500&pilicense=any&ppprop=wikibase_item&redirects=1&titles={urllib.parse.quote('|'.join(batch))}")["query"]
        to = {x["from"]: x["to"] for x in w.get("normalized", []) + w.get("redirects", [])}
        got = {p["title"]: p for p in w.get("pages", {}).values()}
        for t in batch:
            f = t
            for _ in range(3):
                f = to.get(f, f)
            page[t] = got.get(f, {})
    for r in rows:  # a guessed title counts only if that article exists
        r["cands"] += [g for g in r["guess"] if "missing" not in page.get(g, {"missing": 1}) and g not in r["cands"]]
        r["fuzzy"] = r["fuzzy"] and not any(key(c) == key(r["title"]) for c in r["cands"])
    qids = sorted({p.get("pageprops", {}).get("wikibase_item") for p in page.values()} - {None})
    ent = {}
    for i in range(0, len(qids), 50):
        ent.update(get(f"{WD}&props=claims&ids={'|'.join(qids[i:i + 50])}").get("entities", {}))
    claims = lambda q: ent.get(q, {}).get("claims", {})

    # 3. pick the candidate (closest release year when one was given), then name the studios, platforms and series
    for r in rows:
        best = None
        for c in r["cands"]:
            q = page[c].get("pageprops", {}).get("wikibase_item")
            y = first_year(claims(q)) if q else None
            m = re.search(r"\((\d{4}) video game\)$", c)
            y = y or (int(m.group(1)) if m else None)
            d = abs(y - r["year"]) if (y and r["year"]) else (0 if not r["year"] else 50)
            if best is None or d < best[0]:
                best = (d, c, q, y)
        r["pick"] = best
        if not best:
            notes.append(f'line {r["line"]}: not found on Wikipedia: {r["title"]}')
        elif r["fuzzy"] or best[0] > 3:  # early access and regional releases put the dates a few years apart
            notes.append(f'line {r["line"]}: check the match: "{r["title"]}" {r["year"] or ""} -> "{best[1]}" ({best[3]})')
    need = sorted({x for r in rows if r["pick"] and r["pick"][2] for p in ("P178", "P123", "P179", "P400") for x in ids(claims(r["pick"][2]), p)[:6]})
    name = {}
    def labels(batch):  # one deleted id makes Wikidata refuse the whole batch: then ask one by one
        r = get(f"{WD}&props=labels&languages=en&languagefallback=1&ids={'|'.join(batch)}")
        if "entities" not in r and len(batch) > 1:
            for x in batch:
                labels([x])
        for k, e in r.get("entities", {}).items():
            name[k] = e.get("labels", {}).get("en", {}).get("value")
    for i in range(0, len(need), 50):
        labels(need[i:i + 50])

    items = []
    for r in rows:
        it = {"title": r["title"], "year": r["year"], "rating": r["rating"], "shelf": r["shelf"], "genres": r["genres"], "series": r["series"], "seriesNo": r["seriesNo"], "note": r["note"]}
        if r["pick"]:
            _, c, q, y = r["pick"]
            cl = claims(q) if q else {}
            studio = [name.get(x) for x in (ids(cl, "P178") or ids(cl, "P123"))[:2]]
            src_img = page[c].get("thumbnail", {}).get("source", "")
            it.update({"title": STRIP.sub("", c) if not r["fuzzy"] else r["title"], "wikidata": q, "year": r["year"] or y,
                       "author": " & ".join(x for x in studio if x), "platforms": [x for x in (name.get(p) for p in ids(cl, "P400")[:6]) if x],
                       "series": r["series"] or next((name.get(x) for x in ids(cl, "P179") if name.get(x)), None),
                       "cover": src_img.split("?")[0] if "/wikipedia/en/" in src_img or re.search(r"box|cover|logo", page[c].get("pageimage", ""), re.I) else None})
            if not it["cover"]:
                notes.append(f'line {r["line"]}: no cover art on Wikipedia: {it["title"]}')
        items.append({k: v for k, v in it.items() if v not in (None, "", [])})
    Path(out).write_text(json.dumps({"kind": "videogames", "items": items}, ensure_ascii=False, indent=1), "utf8")
    print(f"wrote {out}: {len(items)} games, {sum(1 for i in items if i.get('cover'))} with cover art, {sum(1 for i in items if i.get('wikidata'))} matched")
    for n in notes:
        print("  " + n)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
