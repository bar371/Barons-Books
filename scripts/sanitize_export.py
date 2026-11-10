#!/usr/bin/env python3
"""Strip the raw Goodreads export down to the columns the site uses -> data/library.csv.

The raw export (data/goodreads_library_export.csv) also holds your written reviews and private notes,
so it is git-ignored; only the stripped copy is committed.   python scripts/sanitize_export.py
"""
import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEEP = ["Book Id", "Title", "Author", "ISBN13", "My Rating", "Average Rating", "Number of Pages",
        "Year Published", "Original Publication Year", "Date Read", "Exclusive Shelf"]

with open(ROOT / "data" / "goodreads_library_export.csv", newline="", encoding="utf8") as f:
    rows = list(csv.DictReader(f))
with open(ROOT / "data" / "library.csv", "w", newline="", encoding="utf8") as f:
    w = csv.DictWriter(f, KEEP, extrasaction="ignore"); w.writeheader(); w.writerows(rows)
print(f"wrote data/library.csv: {len(rows)} rows, columns: {', '.join(KEEP)}")
