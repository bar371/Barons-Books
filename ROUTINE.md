# Claude picks routine

You are refreshing book recommendations ("picks") for the reading maps at https://bar371.github.io/Barons-Books/.
Each person's library lives in Supabase. Your output goes back to Supabase through `scripts/cloud_sync.py`.
**Do not commit, push or open pull requests**: nothing in git changes during this routine.

## 1. Find out who needs picks

- If this run started from the app (a payload saying an update was requested), run `python3 scripts/cloud_sync.py pull`.
- Otherwise (the monthly schedule), run `python3 scripts/cloud_sync.py pull --all`.

It prints a todo list and writes `data/cloud/<slug>.json` for each person on it. If it says "Nothing to do", stop.
If it fails with "secret key is not reaching Supabase", stop and report that. Don't try to work around it.

## 2. For each person on the list, write `data/cloud/<slug>.picks.json`

Read `data/cloud/<slug>.json`. It holds:

- `read`: books they've read, with `rating` (1 to 5, or missing) and `genres`.
- `reading` and `toRead`.
- `taxonomy`: the allowed genres, as `{main genre: [sub-genres]}`. Books and recs use **sub-genre** names.
- `needGenres`: ids of books with no genres yet.
- `needFit`: ids of to-read books with no taste score yet.
- `currentPicks`: what they got last time.
- `fixedRecs`: Baron's hand-curated recommendations. Never repeat these.

Write this JSON:

```json
{
  "newGenres": [{"name": "Space Opera", "parent": "Science Fiction"}],
  "books": {
    "<book id>": {"genres": ["Epic Fantasy"], "blurb": "One spoiler-free sentence about the book.", "fit": 82}
  },
  "recs": [
    {"title": "The Lies of Locke Lamora", "author": "Scott Lynch", "year": 2006,
     "genres": ["Adventure Fantasy"], "because": ["<read book id>", "<read book id>"],
     "reason": "One or two sentences on why, naming the books it connects to.", "fit": 88}
  ]
}
```

### Books

For every id in `needGenres`, give 1 to 3 sub-genres from `taxonomy` and a blurb.

Only add a `newGenres` entry when nothing in the taxonomy fits. Its parent must be an existing main genre. Use it sparingly.

For every id in `needFit`, give `fit`: 0 to 100, how well that to-read book suits this reader's taste.

### Recommendations

`recs` is the person's **complete** list (it replaces last time's).

- **Size:** aim for about 20 for someone with few read books and up to 40 for a big library. For Baron, whose 55 curated picks are already in `fixedRecs`, give 5 to 15 *extra* picks focused on recently added or highly rated books.
- **What to keep:** keep strong picks from `currentPicks.recs` and drop any the person has since added to their library. The script also drops those.
- **What to recommend:** real, published books only. Never recommend anything already in `read`, `reading` or `toRead`.
- **`because`:** 1 to 3 ids from `read`, preferring books they rated 4 or 5.
- **`fit`:** your honest taste-match estimate, not a constant. The site combines it with their ratings to rank picks.
- **Ratings matter:** a 1 or 2 star book is a signal *against* its kind of book.

## 3. Save

Run `python3 scripts/cloud_sync.py push <slug>` for each person. It validates the file, finds covers on Open Library and saves.

Read what it reports as skipped. If many picks were skipped, fix the file and push again.

If you can't finish someone, run `python3 scripts/cloud_sync.py fail <slug>`.

## 4. Catch late requests

Run `python3 scripts/cloud_sync.py pull` once more, without `--all`. If anyone new appears, do steps 2 and 3 for them.

Finish with a short summary: who got picks, how many, and anything skipped.
