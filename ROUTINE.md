# Claude picks routine

You are refreshing recommendations ("picks") for the maps at https://bar371.github.io/Barons-Books/. Each person can have
three libraries: **books**, **board games** (`?kind=games`) and **video games** (`?kind=videogames`). Each todo entry
has a `kind`; follow section 2 for books, section 2b for `games` (board games) and section 2c for `videogames`.
Each person's library lives in Supabase. Your output goes back to Supabase through `scripts/cloud_sync.py`.
**Do not commit, push or open pull requests**: nothing in git changes during this routine.

## 1. Find out who needs picks

- If this run started from the app (a payload saying an update was requested), run `python3 scripts/cloud_sync.py pull`.
- Otherwise (the monthly schedule), run `python3 scripts/cloud_sync.py pull --all`.

It prints a todo list and writes a snapshot for each library on it. Every entry tells you its `snapshot` file to read,
the `write` file to create, and the exact `push` command. If it says "Nothing to do", stop.
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

## 2b. Board-game libraries (`"kind": "games"`)

Read the entry's `snapshot` (`data/cloud/<slug>.games.json`). It has the same shape as a book snapshot, where:

- `read` means games they **own** (with `rating`), `reading` means **on the table** (played a lot right now), and `toRead` means the **wishlist**.
- `author` is the **designer**.
- `taxonomy` holds board-game **categories**.
- `needDetails` lists games missing a designer, year, player count or play time.
- `needCover` and `recsNeedCover` list games and earlier picks never searched for a box picture (the `covers` command below handles them).

Write `data/cloud/<slug>.games.picks.json` in the same format as section 2, with these additions.

**Entries in `books`.** Each can also carry:

- `author` (the designer, e.g. "Uwe Rosenberg"; several designers joined with " & ")
- `year`
- `players` as `[min, max]`
- `playtime` in minutes
- `weight` (BoardGameGeek-style complexity, 1.0 to 5.0)
- `series` (the game's family, e.g. "Catan")

For each id in `needDetails`, fill in what you know reliably and leave out what you don't. A game the person added by
name may be obscure or homemade: never invent its details, just give categories.

**`recs`.** Use real, published board games only. Each rec takes `title`, `author` (designer), `year`, `genres`
(categories), `because` (ids from `read`), `reason` and `fit`, plus `players` and `playtime` when you know them.

**Size and focus.** Aim for about 2 picks per game in `read`, between 10 and 40 in all. Games marked `"owned": false` were played and rated but not bought: they count as taste just like owned ones.

- Look at what they rate highly: mechanisms, weight, player counts and themes.
- Never repeat anything in `read` (owned or just played), on the table or have on the wishlist. Expansions of games they own are welcome when they're notable.
- Low ratings are signals against that style of game.

The push command looks up each pick on Wikipedia and Wikidata for a picture and BoardGameGeek link.

### Box covers from the web (games only)

**Required for every game library, and there is no time limit: finish it.** Wikipedia only has box art for famous games,
so the rest are found on the web, one small batch at a time. Each game is searched only once, ever: later runs only
handle games that are new. Do it **after** the first push (the push tells you when it's needed):

1. Run `python3 scripts/cloud_sync.py covers <slug>`. It prints the next batch of games (each with a `key`) and how many are left.
2. For each game in the batch, use **WebSearch** to find its official page, e.g. `"Century: Spice Road" board game`.
   Prefer the **publisher's own site**; if it has nothing usable, a big shop's product page is fine.
   **Never use boardgamegeek.com or geekdo images**: their terms only allow their art through their API.
3. Run `python3 scripts/cloud_sync.py og <page-url> [<page-url> ...]` for the batch's pages. It lists up to 5 candidate
   pictures per page and saves each under `data/cloud/covers/`.
4. **Look at the saved files with Read** and pick the game's **box** (a flat cover or a 3D box shot). Not a logo, a banner,
   a gameplay or components photo, a person, or a different game or edition. If none fits, try one more page.
5. Record each game:
   - found: `python3 scripts/cloud_sync.py cover <slug> <key> <picture-url>`
   - not found after checking 1 or 2 pages: `python3 scripts/cloud_sync.py cover <slug> <key> none <page-url> [<page-url> ...]`
6. Run `covers` again for the next batch. **Repeat until it prints ALL DONE**, then run the push command again.

## 2c. Video-game libraries (`"kind": "videogames"`)

Read the entry's `snapshot` (`data/cloud/<slug>.videogames.json`). It has the same shape as a book snapshot, where:

- `read` means games they have **played** (with `rating`, and often a `note` in their own words: read it, it says what
  they liked and disliked), `reading` means **playing now**, and `toRead` means the **backlog**.
- `author` is the **studio** (developer), `platforms` the systems the game is on, `series` and `seriesNo` its franchise.
- `taxonomy` holds video-game **genres**.
- `needDetails` lists games missing a studio or year.
- `needCover` and `recsNeedCover` list games and earlier picks never searched for a cover picture.

Write `data/cloud/<slug>.videogames.picks.json` in the same format as section 2, with these additions.

**Entries in `books`.** Each can also carry `author` (the developer, e.g. "FromSoftware"), `year` (first release),
`series` (e.g. "The Witcher") and `platforms` (a list, e.g. `["PlayStation 5", "Microsoft Windows"]`).
For each id in `needDetails`, fill in what you know reliably and leave out what you don't; never invent details.

**`recs`.** Real, released video games only (nothing unreleased or cancelled). Each rec takes `title`, `author`
(developer), `year`, `genres`, `because` (ids from `read`), `reason` and `fit`, plus `series` and `platforms`.
When a name is shared by a remake or reboot, the `year` says which one you mean.

**Size and focus.** Aim for about 1 pick per 2 games in `read`, between 15 and 40 in all.

- Go by what they rate highly and what their notes praise: story, combat, exploration, difficulty, art, length.
- Never repeat anything in `read`, `reading` or `toRead`, and don't pick a remaster or remake of a game they already
  played. The next entry of a series they love is welcome if it's well regarded; say so in `reason`.
- Prefer games playable on platforms they already use (see `platforms` across their library), and say when a pick is not.
- Low ratings and critical notes are signals against that style of game.

The push command looks up each pick's cover on Wikipedia.

### Covers from the web (video games)

Same worklist as "Box covers from the web" above, with `--videogames` on each command:
`covers <slug> --videogames`, `cover <slug> <key> <picture-url> --videogames`, and `cover <slug> <key> none <page-url> --videogames`.
Wikipedia has cover art for most video games, so this is usually a short list or empty. Look for the game's **official
cover or key art** (publisher or developer site, or its store page on Steam, PlayStation, Xbox or Nintendo): portrait
cover art if there is one. Not a screenshot, logo or banner of a different game.

## 3. Save

Run each entry's `push` command: `python3 scripts/cloud_sync.py push <slug>` for books, `... push <slug> --games` for board games, `... push <slug> --videogames` for video games. It validates the file, finds covers on Open Library and saves.
A push can take up to about 3 minutes (picture lookups). Run it in the foreground with a 10-minute Bash timeout
(`timeout: 600000`), not in the background, and wait for its "saved N picks" line. Never finish the run while a push is still going:
nothing is saved until it prints that line.

Read what it reports as skipped. If many picks were skipped, fix the file and push again.

**Game libraries (board and video): the run isn't done until the push prints "covers: all searched".** If it prints "NEXT STEP, required",
do "Box covers from the web" until `covers` says ALL DONE, then push again.

If you can't finish a library, run `python3 scripts/cloud_sync.py fail <slug>`, adding `--games` or `--videogames` for a game library.

## 4. Catch late requests

Run `python3 scripts/cloud_sync.py pull` once more, without `--all`. If anyone new appears, do steps 2 and 3 for them.

Finish with a short summary: whose library (books, board games or video games) got picks, how many, and anything skipped.
