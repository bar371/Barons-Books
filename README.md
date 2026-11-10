# Baron's Books

An interactive constellation of the books I've read on Goodreads, grouped by genre, with my
to-read shelf, what I'm reading now, and recommendations Claude draws from what I've read.
Live at <https://bar371.github.io/Barons-Books/>.

## Refreshing

1. Goodreads -> **My Books -> Import and export -> Export Library**, save as
   `data/goodreads_library_export.csv` (git-ignored: it contains written reviews).
2. In Claude Code, ask for a refresh. Claude will:
   - `python scripts/sanitize_export.py` - strip the export to the columns the site needs (`data/library.csv`)
   - update `scripts/make_curation.py` (genres for new books, new recommendations and why) and run it
   - `python scripts/fetch_covers.py` - download covers (Goodreads, then Open Library), shrink them, build the atlas
   - `python scripts/verify_covers.py` - check every cover and render contact sheets to eyeball
   - `python scripts/build_graph.py` - write `site/data.json`
3. Commit and push. The *Deploy to GitHub Pages* workflow publishes `site/` (also runnable by hand from the Actions tab).

## How recommendations are ranked

Each pick gets a 0-100 match: 60% **taste fit** (Claude's judgment, the `FIT` table in
`scripts/make_curation.py`), 30% how highly I rated the books it's linked to, 10% how many of my
books point to it. Better matches are bigger, glow brighter and get faster "lanes"; the top 10 wear
a numbered medal, and the **Top** slider in the dock shows only the best N.

## Layout

| Path | What |
|------|------|
| `site/` | The static page: `index.html`, `app.js`, `style.css`, vendored D3, `atlas.jpg` (all covers in one image), `covers/` (full-size, loaded on zoom) |
| `data/curation.json` | Genre tree, per-book genres, recommendations (`because` = ids of books I've read) |
| `data/library.csv` | Sanitized Goodreads export (committed) |
| `data/cover_overrides.json` | Pin a specific cover image for a book, or `null` to leave it blank on purpose |
| `scripts/` | The pipeline above |

## Performance

The page makes about 9 requests (~1.4 MB): data, D3, and one cover atlas. Full-size covers are
only fetched for books you zoom right up to.
