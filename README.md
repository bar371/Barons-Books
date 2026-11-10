# Baron's Books

An interactive constellation of the books I've read on Goodreads, grouped by genre, plus
recommendations Claude draws from them. Live at <https://bar371.github.io/Barons-Books/>.

## Refreshing

1. Goodreads → **My Books → Import and export → Export Library**, save as
   `data/goodreads_library_export.csv`.
2. In Claude Code, ask for a refresh. Claude reads the export, updates `data/curation.json`
   (genres for each book plus new recommendations and the reason for each), then runs
   `python scripts/fetch_covers.py` and `python scripts/build_graph.py`.
3. Commit and push. The *Deploy to GitHub Pages* workflow publishes `site/` (it can also be
   triggered by hand from the Actions tab).

## Layout

| Path | What |
|------|------|
| `site/` | The static page (`index.html`, `app.js`, `style.css`, vendored D3, cover images) |
| `data/curation.json` | Genre tree, per-book genres, recommendations (`because` = read-book ids) |
| `data/covers.json` | Cache mapping book id → local cover file |
| `scripts/` | `fetch_covers.py` (Goodreads/Open Library artwork), `build_graph.py` (writes `site/data.json`) |

`data/sample_library.csv` is placeholder data used until the real export exists.
