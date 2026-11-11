#!/usr/bin/env python3
"""One-command refresh from a fresh Goodreads export.

    python scripts/refresh.py                 # newest goodreads_library_export*.csv in ~/Downloads
    python scripts/refresh.py path/to/export.csv
    python scripts/refresh.py --push          # also commit + push (the Pages workflow then deploys)

Steps: sanitize the export -> fetch covers for anything new -> verify covers -> rebuild site/data.json.
It never edits curation.json: books with no genres yet are listed at the end, and tagging those plus
recommendations for new reads is the part you ask Claude to do.
"""
import csv, json, shutil, subprocess, sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable


def run(*args):
    print("\n>", " ".join(args))
    subprocess.run([PY, *args], cwd=ROOT, check=True)


def read_library():
    p = ROOT / "data" / "library.csv"
    if not p.exists():
        return {}
    with open(p, newline="", encoding="utf8") as f:
        return {r["Book Id"]: r for r in csv.DictReader(f)}


def write_delta(old, new):
    """What changed since the last export -> data/delta.json. This is the work list for the Claude step:
    tag new books, recommend from newly read ones, drop recommendations you've now read."""
    label = lambda r: f'{r["Title"]} - {r["Author"]}'
    added = [{"id": i, "book": label(r), "shelf": r["Exclusive Shelf"], "rating": r["My Rating"]} for i, r in new.items() if i not in old]
    removed = [{"id": i, "book": label(r)} for i, r in old.items() if i not in new]
    moved = [{"id": i, "book": label(r), "from": old[i]["Exclusive Shelf"], "to": r["Exclusive Shelf"]}
             for i, r in new.items() if i in old and old[i]["Exclusive Shelf"] != r["Exclusive Shelf"]]
    rerated = [{"id": i, "book": label(r), "from": old[i]["My Rating"], "to": r["My Rating"]}
               for i, r in new.items() if i in old and old[i]["My Rating"] != r["My Rating"]]
    cur_p = ROOT / "data" / "curation.json"
    cur = json.loads(cur_p.read_text("utf8")) if cur_p.exists() else {}
    tagged = set(cur.get("books", {}))
    newly_read = {x["id"] for x in added if x["shelf"] == "read"} | {x["id"] for x in moved if x["to"] == "read"}
    read_titles = {new[i]["Title"].split(" (")[0].lower() for i in newly_read}
    delta = {
        "at": datetime.now().isoformat(timespec="seconds"),
        "added": added, "removed": removed, "shelfMoves": moved, "ratingChanges": rerated,
        "todo": {
            "tagGenres": [label(new[x["id"]]) for x in added if x["id"] not in tagged],
            "recommendFrom": [label(new[i]) for i in sorted(newly_read)],
            "dropReadRecs": [r["title"] for r in cur.get("recommendations", []) if r["title"].split(" (")[0].lower() in read_titles],
        },
    }
    (ROOT / "data" / "delta.json").write_text(json.dumps(delta, indent=1, ensure_ascii=False), "utf8")
    print(f"\ndelta: +{len(added)} added, -{len(removed)} removed, {len(moved)} shelf moves, {len(rerated)} rating changes")
    for k, v in delta["todo"].items():
        if v:
            print(f"  todo {k}: " + "; ".join(v))
    if not any((added, removed, moved, rerated)):
        print("  nothing changed since the last export")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    push = "--push" in sys.argv
    if args:
        src = Path(args[0])
    else:
        found = sorted((Path.home() / "Downloads").glob("goodreads_library_export*.csv"), key=lambda p: p.stat().st_mtime)
        if not found:
            sys.exit("No export found in ~/Downloads. Pass the CSV path.")
        src = found[-1]
    if not src.exists():
        sys.exit(f"{src} not found")
    print(f"using {src}")
    before = read_library()
    shutil.copyfile(src, ROOT / "data" / "goodreads_library_export.csv")
    run("scripts/sanitize_export.py")
    write_delta(before, read_library())
    run("scripts/fetch_covers.py")
    run("scripts/verify_covers.py")
    run("scripts/build_graph.py")
    if push:
        subprocess.run(["git", "add", "data", "site/covers", "site/atlas.jpg"], cwd=ROOT, check=True)
        if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode:
            subprocess.run(["git", "commit", "-m", "Refresh library from Goodreads export"], cwd=ROOT, check=True)
            subprocess.run(["git", "push", "origin", "main"], cwd=ROOT, check=True)
        else:
            print("nothing changed, nothing to push")


if __name__ == "__main__":
    main()
