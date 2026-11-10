#!/usr/bin/env python3
"""One-command refresh from a fresh Goodreads export.

    python scripts/refresh.py                 # newest goodreads_library_export*.csv in ~/Downloads
    python scripts/refresh.py path/to/export.csv
    python scripts/refresh.py --push          # also commit + push (the Pages workflow then deploys)

Steps: sanitize the export -> fetch covers for anything new -> verify covers -> rebuild site/data.json.
It never edits curation.json: books with no genres yet are listed at the end, and tagging those plus
recommendations for new reads is the part you ask Claude to do.
"""
import shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable


def run(*args):
    print("\n>", " ".join(args))
    subprocess.run([PY, *args], cwd=ROOT, check=True)


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
    shutil.copyfile(src, ROOT / "data" / "goodreads_library_export.csv")
    run("scripts/sanitize_export.py")
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
