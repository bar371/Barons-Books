/* Baron's Library: what kind of library this page shows. Everything that is specific to books (words,
   where to search, where to link out, which tables hold the edits) lives here, so the map, scoring and
   editing code can be shared. ?kind=games is board games, ?kind=videogames video games; books stay the default. */
(() => {
  const many = (n, one, more) => `${n} ${n === 1 ? one : more}`;
  const ol = (id, size) => `https://covers.openlibrary.org/b/id/${id}-${size}.jpg`;

  const books = {
    id: "books",
    lib: "Library",                       // "Baron's Library"
    storeKey: "bl-overlay-v1",            // this-device edits (before signing in)
    tables: { edits: "edits", picks: "picks" },
    png: "barons-library.png",
    sub: (m) => `${m.read} read · ${m.queued || 0} queued · ${m.recommended} recommended`,
    items: "books",
    count: (n) => many(n, "book", "books"),
    Genres: "Genres",

    // tooltip + panel
    tipReading: "▶ Reading right now",
    tipQueue: (rank, N, score) => rank ? `🔖 Read-next #${rank} of ${N} · ${score}%` : "🔖 On my to-read list",
    kindLabel: { rec: "✦ Recommended", reading: "▶ Reading now", queue: "🔖 To read", read: "Read" },
    coverAlt: "Cover of",
    facts: (n, isRec, esc) => [n.series && `${esc(n.series)}${n.seriesNo ? " #" + n.seriesNo : ""}`, n.year, n.pages && `${n.pages} pages`, n.dateRead && `read ${esc(n.dateRead)}`, !isRec && n.avg && `avg ${n.avg}`],
    because: "Because I read",
    siblings: (hasSeries) => hasSeries ? "In this series / by this author" : "More by this author",
    link: (n, isRec) => !isRec && /^\d+$/.test(n.id) ? `https://www.goodreads.com/book/show/${n.id}` : `https://www.goodreads.com/search?q=${encodeURIComponent(n.title + " " + n.author)}`,
    linkLabel: (isRec) => `${isRec ? "Find on" : "Open in"} Goodreads ↗`,
    copyLink: "🔗 Copy link to this book",

    // scoring explanations
    ofQueue: "to read",
    queueHead: "Read next",
    recTier1: "Read this next",
    creatorBar: "Author",
    creatorNote: (avg, n) => `${avg}★ avg of ${n} read`,
    newCreator: "new author",
    seriesYes: "continues a series", seriesNo: "standalone / new",
    linkedAvg: "★ avg of linked books",
    linksNote: (n) => `${n} of your books`,

    // overview
    overviewBy: "Every book I've read, and what to read next.",
    tileRead: "Books read",
    tile3: { label: "Pages", value: (bs) => d3.sum(bs, (b) => b.pages || 0) },
    perYear: "Read per year",
    topCreators: "Most-read authors",
    key: { read: "Read", reading: "Reading now", queue: "To read" },
    hint: "Click anything to dive in. Recommendations are linked to the books that inspired them.",

    // search box
    tag: { reading: "▶ reading", queue: "to read", read: "read" },
    addRowNote: "Find it on Open Library and add it to your map",

    // editing (edit.js)
    ed: {
      genre: "genre", Genre: "Genre",
      addOne: "＋ Add a book", dockAdd: "＋ Book", dockAddTitle: "Add a book",
      modalTitle: "Add a book", searchPh: "Search by title or author…", noMatches: "No matches on Open Library",
      removeOne: "Remove this book", next: (n) => `Continue with ${many(n, "book", "books")} →`,
      shelves: [["read", "Read"], ["to-read", "To read"], ["reading", "Reading now"]],
      addMany: (n) => `Add ${n} books`, added: (n) => `Added ${n} books`,
      pending: "Added by you · Claude adds genres & picks on the next update",
      signupBlurb: "Map your own reading: add books, build genres, and get picks. You'll stay signed in on this device.",
    },
    // Goodreads: My Books -> Import and export -> Export library. One row per book, shelf in "Exclusive Shelf".
    importLabel: "Have a Goodreads account? Import your library export (CSV)",
    importAccept: ".csv,text/csv",
    importNote: "Your Goodreads shelves and star ratings come across as they are. Claude sorts the books into genres and adds picks on the next update (Account → Update my picks now).",
    importEmpty: "No books found in that file.",
    importSummary: (items, updates) => { const c = (s) => items.filter((i) => i.shelf === s).length;
      return `<p><b>${items.length}</b> books found: ${c("read")} read${c("reading") ? `, ${c("reading")} reading now` : ""}${c("to-read") ? `, ${c("to-read")} to read` : ""}.${updates ? ` ${updates} already on your map get updated, not doubled.` : ""}</p>`; },
    sameItem: (b, it) => b.id === it.id || (b.goodreadsId && b.goodreadsId === it.goodreadsId) || (String(b.title).toLowerCase().split(" (")[0].trim() === it.title.toLowerCase() && (!b.author || !it.author || b.author === it.author)),
    async importCSV(text) {
      const rows = d3.csvParse(text.replace(/^\uFEFF/, ""));
      if (!rows.columns.includes("Book Id") || !rows.columns.includes("Exclusive Shelf")) throw new Error("That file doesn't look like a Goodreads library export (it needs the Book Id and Exclusive Shelf columns)");
      const clean = (v) => String(v || "").replace(/^="?|"$/g, "").replace(/"/g, "").trim(); // Goodreads writes ISBNs as ="978..."
      const int = (v) => { const x = parseInt(v, 10); return x > 0 ? x : null; };
      const SHELF = { read: "read", "currently-reading": "reading", "to-read": "to-read" };
      return rows.filter((r) => r["Book Id"] && r.Title && SHELF[r["Exclusive Shelf"]]).map((r) => {
        const m = r.Title.match(/^(.*?)\s*\(([^()]*?),?\s*#(\d+(?:\.\d+)?)\)\s*$/), isbn = clean(r.ISBN13) || clean(r.ISBN), shelf = SHELF[r["Exclusive Shelf"]];
        const stars = Math.round(parseFloat(r["My Rating"]) || 0);
        return { id: String(r["Book Id"]), goodreadsId: String(r["Book Id"]), title: (m ? m[1] : r.Title).trim(), author: (r.Author || "").trim() || "Unknown",
          series: m ? m[2].trim() : null, seriesNo: m ? parseFloat(m[3]) : null, pages: int(r["Number of Pages"]), year: int(r["Original Publication Year"]) || int(r["Year Published"]),
          isbn13: isbn.length === 13 ? isbn : null, rating: shelf === "read" && stars ? stars : null, shelf,
          dateRead: shelf === "read" && r["Date Read"] ? r["Date Read"].replace(/\//g, "-") : null, note: (r["My Review"] || "").replace(/<[^>]+>/g, " ").trim().slice(0, 300) || null,
          cover: isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` : null };
      });
    },
    // Open Library search for the add dialog, normalised to { key, title, small, creator, thumb, big, make() }
    async find(s, signal) {
      const r = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(s)}&fields=key,title,author_name,first_publish_year,cover_i,isbn,number_of_pages_median&limit=8`, { signal });
      return ((await r.json()).docs || []).map((b) => ({
        key: b.key, title: b.title,
        small: (b.author_name || []).join(", ") + (b.first_publish_year ? " · " + b.first_publish_year : ""),
        creator: (b.author_name || [])[0] || "",
        thumb: b.cover_i ? ol(b.cover_i, "S") : null, big: b.cover_i ? ol(b.cover_i, "M") : null,
        make: () => ({ id: "ol-" + b.key.split("/").pop(), olKey: b.key, title: b.title, author: (b.author_name || ["Unknown"])[0], year: b.first_publish_year || null,
          pages: b.number_of_pages_median || null, isbn13: (b.isbn || []).find((x) => /^978[01]/.test(x)) || (b.isbn || []).find((x) => x.length === 13) || null,
          cover: b.cover_i ? ol(b.cover_i, "L") : null }),
      }));
    },
  };

  books.box = [32, 48]; // tall book covers

  // ---------- board games ----------
  // Lookups use Wikipedia (which pages are games) + Wikidata (players, play time, year, designer, BoardGameGeek id,
  // photo): both answer browsers directly with no login. BoardGameGeek's own API needs an approved app token.
  const WD = "https://www.wikidata.org/w/api.php?format=json&origin=*&action=wbgetentities";
  const val = (c, p) => c?.[p]?.[0]?.mainsnak?.datavalue?.value;
  const ids = (c, p) => (c?.[p] || []).map((x) => x.mainsnak?.datavalue?.value?.id).filter(Boolean);
  const designerIds = (c) => ["P287", "P50", "P170", "P178"].map((p) => ids(c, p)).find((a) => a.length) || []; // designed by / author / creator / developer
  const num = (c, p) => { const v = val(c, p); return v?.amount ? Math.round(+v.amount) : null; };
  const minutes = (c) => { const v = val(c, "P2047"); if (!v?.amount) return null; const a = +v.amount; return Math.round(/Q25235$/.test(v.unit) ? a * 60 : a); };
  const yearOf = (c) => { const v = val(c, "P577") || val(c, "P571"); const y = v?.time && parseInt(v.time.slice(1, 5)); return y || null; };
  const commons = (f, w) => f ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=${w}` : null;

  // ---------- box art ----------
  // Official box covers come from the game's English Wikipedia article (the infobox image, which Wikipedia hosts
  // itself under fair use at low resolution: pilicense=any). Wikidata/Commons pictures are mostly photos of people
  // playing, so those are only used when the file is clearly a box, cover or logo. Results are cached per browser.
  const WP = "https://en.wikipedia.org/w/api.php?format=json&origin=*&action=query";
  const isPhoto = (u) => /commons\.wikimedia\.org\/wiki\/Special:FilePath|\/wikipedia\/commons\//.test(u || "");
  const goodArt = (src, name) => src && (/\/wikipedia\/en\//.test(src) || /box|cover|logo/i.test(name || "")) ? src.replace(/\?utm_.*$/, "") : null;
  // One art source per kind: which Wikipedia infobox marks its articles, which title suffix to ignore, where to cache.
  function artSource({ cacheKey: ARTKEY, template, strip, hint = () => "" }) {
  const gkey = (s) => String(s || "").toLowerCase().replace(strip, "").replace(/[^a-z0-9]/g, "");
  let artCache = {}; try { artCache = JSON.parse(localStorage.getItem(ARTKEY) || "{}"); } catch {}
  const artKey = (it) => it.bggId ? "b" + it.bggId : /^Q\d+$/.test(it.wikidata || "") ? "q" + it.wikidata : "t" + gkey(it.title);
  const needsArt = (it) => !it.cover || isPhoto(it.cover);
  async function fetchArt(items) {
    const todo = items.filter((it) => needsArt(it) && !(artKey(it) in artCache)).slice(0, 80);
    if (!todo.length) return {};
    const wiki = new Map(); let failed = false; // artKey -> Wikipedia article title
    const j = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    const ids = todo.filter((i) => i.bggId || /^Q\d+$/.test(i.wikidata || ""));
    if (ids.length) { // Wikidata knows the Wikipedia article for a BGG id / Wikidata item
      const b = ids.filter((i) => i.bggId).map((i) => `"${String(i.bggId).replace(/\D/g, "")}"`).join(" ");
      const q = ids.filter((i) => !i.bggId).map((i) => "wd:" + i.wikidata).join(" ");
      const parts = [b && `{ VALUES ?bgg { ${b} } ?item wdt:P2339 ?bgg . }`, q && `{ VALUES ?item { ${q} } }`].filter(Boolean);
      const sparql = `SELECT ?item ?bgg ?title WHERE { ${parts.join(" UNION ")} ?a schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title . }`;
      try {
        for (const r of (await j("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(sparql))).results.bindings) {
          const qid = r.item.value.split("/").pop();
          for (const it of ids) if ((it.bggId && String(it.bggId) === r.bgg?.value) || (!it.bggId && it.wikidata === qid)) wiki.set(artKey(it), r.title.value);
        }
      } catch { failed = true; }
    }
    for (const it of todo.filter((i) => !wiki.has(artKey(i)))) { // otherwise: search for a game article with that name
      try {
        const h = (await j(`${WP}&list=search&srlimit=1&srsearch=${encodeURIComponent(it.title + hint(it) + ` hastemplate:"${template}"`)}`)).query?.search?.[0];
        if (h && gkey(h.title) === gkey(it.title)) wiki.set(artKey(it), h.title);
      } catch { failed = true; }
    }
    const titles = [...new Set(wiki.values())], art = {};
    for (let i = 0; i < titles.length; i += 40) {
      const batch = titles.slice(i, i + 40);
      try {
        const w = (await j(`${WP}&prop=pageimages&piprop=thumbnail|name&pithumbsize=500&pilicense=any&redirects=1&titles=${encodeURIComponent(batch.join("|"))}`)).query || {};
        const to = new Map([...(w.normalized || []), ...(w.redirects || [])].map((x) => [x.from, x.to])), got = {};
        for (const p of Object.values(w.pages || {})) got[p.title] = goodArt(p.thumbnail?.source, p.pageimage);
        for (const t of batch) { let f = t; for (let n = 0; n < 3 && to.has(f); n++) f = to.get(f); art[t] = got[f] ?? null; }
      } catch { failed = true; }
    }
    const out = {};
    for (const it of todo) {
      const k = artKey(it), t = wiki.get(k);
      if (t ? !(t in art) : failed) continue; // lookup didn't finish: try again next visit
      artCache[k] = t ? art[t] : null; out[it.id] = artCache[k];
    }
    try { localStorage.setItem(ARTKEY, JSON.stringify(artCache)); } catch {}
    return out;
  }
  return { fetchArt, isPhoto, artFor: (it) => needsArt(it) ? artCache[artKey(it)] : undefined };
  }
  const boardArt = artSource({ cacheKey: "bl-art-v1", template: "Infobox game", strip: /\s*\((board |card )?game\)$/ });
  const videoArt = artSource({ cacheKey: "bl-art-vg-v1", template: "Infobox video game", strip: /\s*\((\d{4} )?video game\)$/, hint: (it) => (it.year ? " " + it.year : "") });
  // categories come from <kind>/taxonomy.json (the picks routine reads the same file); empty ones stay hidden on the map
  const taxBase = (path) => async () => {
    const t = await fetch(path, { cache: "no-cache" }).then((r) => r.json()), genres = [];
    for (const { name, color, subs } of t.groups) {
      genres.push({ id: name, name, parent: null, color, count: 0 });
      for (const s of subs) genres.push({ id: s, name: s, parent: name, color, count: 0 });
    }
    return { genres, books: [], recs: [], queue: [], meta: { read: 0, queued: 0, recommended: 0 } };
  };
  const players = (n) => n.players ? (n.players[0] === n.players[1] || !n.players[1] ? `${n.players[0]} players` : `${n.players[0]}–${n.players[1]} players`) : null;
  const gslug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const games = {
    id: "games",
    lib: "Board Games",
    storeKey: "bl-overlay-games-v1",
    tables: { edits: "game_edits", picks: "game_picks" },
    png: "barons-board-games.png",
    box: [40, 40], // square game boxes
    // tabletop look instead of the star map: hex tiles, a hex board, embers and a compass rose (app.js + style.css)
    look: { table: true, poly: [6, Math.PI / 6, 1.1], squareDots: true, font: "Cinzel, Fraunces, Georgia, serif", themeColor: { dark: "#120c08", light: "#efe0bd" } },
    sub: (m) => `${m.read} owned or played · ${m.queued || 0} on the wishlist · ${m.recommended} recommended`,
    items: "games",
    count: (n) => many(n, "game", "games"),
    Genres: "Categories",
    tipReading: "▶ On the table right now",
    tipQueue: (rank, N, score) => rank ? `🎁 Wishlist #${rank} of ${N} · ${score}%` : "🎁 On my wishlist",
    kindLabel: { rec: "✦ Recommended", reading: "▶ On the table", queue: "🎁 Wishlist", read: (n) => n.owned === false ? "Played" : "Owned" },
    coverAlt: "Box of",
    facts: (n, isRec, esc) => [n.owned === false && "played, not owned", n.expansion && "expansion", n.series && n.series !== n.title && esc(n.series), players(n), n.playtime && `${n.playtime} min`, n.year, n.weight && `weight ${n.weight}/5`, n.plays && `played ×${n.plays}`],
    because: "Because I love",
    siblings: (hasSeries) => hasSeries ? "Same family / same designer" : "More by this designer",
    link: (n) => n.bggId ? `https://boardgamegeek.com/boardgame/${n.bggId}` : `https://boardgamegeek.com/geeksearch.php?action=search&objecttype=boardgame&q=${encodeURIComponent(n.title)}`,
    linkLabel: (isRec) => `${isRec ? "Find on" : "Open on"} BoardGameGeek ↗`,
    copyLink: "🔗 Copy link to this game",
    ofQueue: "on the wishlist",
    queueHead: "Get next",
    recTier1: "Play this next",
    creatorBar: "Designer",
    creatorNote: (avg, n) => `${avg}★ avg of ${n} of mine`,
    newCreator: "new designer",
    seriesYes: "same family as one you know", seriesNo: "standalone / new",
    linkedAvg: "★ avg of linked games",
    linksNote: (n) => `${n} of your games`,
    overviewBy: "Every game on my shelf, and what to play next.",
    tileRead: "Owned or played",
    tile3: { label: "Designers", value: (bs) => new Set(bs.map((b) => b.author).filter(Boolean)).size },
    perYear: "Added per year",
    topCreators: "Favourite designers",
    key: { read: "Owned / played", reading: "On the table", queue: "Wishlist" },
    hint: "Click anything to dive in. Recommendations are linked to the games that inspired them.",
    tag: { reading: "▶ on the table", queue: "wishlist", read: (n) => n.owned === false ? "played" : "owned" },
    addRowNote: "Look it up and add it to your shelf",
    ed: {
      genre: "category", Genre: "Category",
      addOne: "＋ Add a game", dockAdd: "＋ Game", dockAddTitle: "Add a game",
      modalTitle: "Add a game", searchPh: "Search by game name…", noMatches: "No matches",
      removeOne: "Remove this game", next: (n) => `Continue with ${many(n, "game", "games")} →`,
      shelves: [["read", "Owned"], ["to-read", "Wishlist"], ["reading", "On the table"]],
      addMany: (n) => `Add ${n} games`, added: (n) => `Added ${n} games`,
      pending: "Added by you · Claude fills in the details & picks on the next update",
      signupBlurb: "Map your own games: add them, build categories, and get picks. You'll stay signed in on this device.",
    },
    // Categories live in games/taxonomy.json (the picks routine reads the same file). Broad on purpose: a 20-game
    // shelf spreads over a few clusters instead of 20 lonely ones. Empty categories stay hidden on the map.
    base: taxBase("games/taxonomy.json"),
    async find(s, signal) {
      const w = await fetch(`https://en.wikipedia.org/w/api.php?format=json&origin=*&action=query&generator=search&gsrlimit=8&gsrsearch=${encodeURIComponent(s + ' hastemplate:"Infobox game"')}&prop=pageimages|description|pageprops&piprop=thumbnail|name&pithumbsize=500&pilicense=any&ppprop=wikibase_item`, { signal }).then((r) => r.json());
      const pages = Object.values(w.query?.pages || {}).sort((a, b) => a.index - b.index);
      const qids = pages.map((p) => p.pageprops?.wikibase_item).filter(Boolean);
      let ents = {}, names = {};
      if (qids.length) {
        ents = (await fetch(`${WD}&props=claims&ids=${qids.join("|")}`, { signal }).then((r) => r.json())).entities || {};
        const more = [...new Set(Object.values(ents).flatMap((e) => [...designerIds(e.claims), ...ids(e.claims, "P179")]))].slice(0, 50);
        if (more.length) {
          const ls = (await fetch(`${WD}&props=labels&languages=en&languagefallback=1&ids=${more.join("|")}`, { signal }).then((r) => r.json())).entities || {};
          for (const [k, e] of Object.entries(ls)) names[k] = e.labels?.en?.value;
        }
      }
      const out = pages.map((p) => {
        const q = p.pageprops?.wikibase_item, c = ents[q]?.claims, year = yearOf(c);
        const designers = designerIds(c).map((x) => names[x]).filter(Boolean), series = ids(c, "P179").map((x) => names[x]).filter(Boolean)[0] || null;
        const lo = num(c, "P1872"), hi = num(c, "P1873"), img = val(c, "P18");
        const box = goodArt(p.thumbnail?.source, p.pageimage) || (/box|cover/i.test(img || "") ? commons(img, 500) : null), thumb = box, big = box;
        return { key: q || "wp-" + p.pageid, title: p.title.replace(/ \((board |card )?game\)$/, ""), creator: designers.join(" & "),
          small: [designers.join(", ") || p.description, year].filter(Boolean).join(" · "), thumb, big,
          make: () => ({ id: q ? "wd-" + q : "g-" + gslug(p.title), wikidata: q || null, title: p.title.replace(/ \((board |card )?game\)$/, ""),
            author: designers.join(" & "), year, players: lo ? [lo, hi || lo] : null, playtime: minutes(c), bggId: val(c, "P2339") || null,
            series, cover: big }) };
      });
      // not every game has a Wikipedia page: you can always add it by name and let Claude fill in the rest
      out.push({ key: "typed:" + gslug(s), title: s, creator: "", small: "Add it as typed: Claude fills in the details", thumb: null, big: null,
        make: () => ({ id: "g-" + gslug(s), title: s, author: "", year: null, players: null, playtime: null, bggId: null, series: null, cover: null }) });
      return out;
    },
    // BoardGameGeek collection export (Collection page -> Export, CSV). Read in the browser; nothing is uploaded.
    // box art for games without one (filled in after the map shows; see fetchArt above)
    ...boardArt, // artFor, isPhoto, fetchArt
    queueToggle: "Wishlist", noReferrer: true, // publisher sites often refuse pictures shown on other sites
    fontHref: "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&display=swap", // the tabletop look's display font
    importLabel: "Have a BoardGameGeek collection? Import its CSV export",
    async importCSV(text) {
      const rows = d3.csvParse(text.replace(/^\uFEFF/, ""));
      if (!rows.columns.includes("objectid") || !rows.columns.includes("objectname")) throw new Error("That file doesn't look like a BoardGameGeek collection export");
      const int = (v) => { const x = parseInt(v, 10); return x > 0 ? x : null; };
      const stars = (v) => { const x = parseFloat(v); return x > 0 ? Math.min(5, Math.max(1, Math.ceil(x / 2))) : null; }; // BGG 1-10 -> 1-5 (9-10 = 5)
      const want = (r) => ["wishlist", "wanttobuy", "want", "preordered", "wanttoplay"].some((k) => r[k] === "1");
      const bases = rows.filter((r) => r.itemtype !== "expansion").map((r) => r.objectname);
      const items = [];
      for (const r of rows) {
        const played = r.own !== "1" && (stars(r.rating) || int(r.numplays) || r.prevowned === "1"); // rated / played / used to own: on the map, marked "not owned"
        const shelf = r.own === "1" || played ? "read" : want(r) ? "to-read" : null;
        if (!shelf) continue; // for trade only, ...
        const exp = r.itemtype === "expansion", lo = int(r.minplayers), w = parseFloat(r.avgweight);
        const base = exp ? bases.filter((b) => r.objectname.startsWith(b)).sort((a, b) => b.length - a.length)[0] || null : null;
        items.push({ id: "bgg-" + r.objectid, bggId: r.objectid, title: r.objectname, author: "", year: int(r.yearpublished),
          players: lo ? [lo, int(r.maxplayers) || lo] : null, playtime: int(r.playingtime) || int(r.maxplaytime), weight: w > 0 ? Math.round(w * 10) / 10 : null,
          plays: int(r.numplays), note: (r.comment || "").trim() || null, rating: shelf === "read" ? stars(r.rating) : null, shelf,
          ...(exp ? { expansion: true } : {}), series: base, dateRead: r.acquisitiondate || null, cover: null, ...(played ? { owned: false } : {}) });
      }
      for (const it of items) if (!it.expansion && items.some((x) => x.series === it.title)) it.series = it.title; // ties expansions to their base game
      // designers + a photo from Wikidata, matched by BGG id (one query; best effort)
      try {
        const vals = items.map((i) => `"${i.bggId.replace(/\D/g, "")}"`).join(" ");
        const q = `SELECT ?bgg (GROUP_CONCAT(DISTINCT ?dl; separator=" & ") AS ?designers) WHERE { VALUES ?bgg { ${vals} } ?item wdt:P2339 ?bgg .
          OPTIONAL { ?item wdt:P287|wdt:P50|wdt:P170 ?d . ?d rdfs:label ?dl FILTER(lang(?dl)="en") } } GROUP BY ?bgg`;
        const r = await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q)).then((x) => x.json());
        for (const b of r.results.bindings) {
          const it = items.find((i) => i.bggId === b.bgg.value); if (!it) continue;
          if (b.designers?.value && !it.author) it.author = b.designers.value;
        }
      } catch {}
      return items;
    },
    // page text outside the scripts (index.html is written for books)
    dom: [
      ["title", "textContent", "Baron's Board Games · a board game constellation"],
      ['meta[name="description"]', "content", "An interactive map of my board games, the categories they belong to, and what to play next."],
      [".brand h1", "innerHTML", "Baron's <em>Board Games</em>"],
      ["#q", "placeholder", "Search games, designers, categories…"],
      ["#stage", "aria-label", "Interactive map of board games and categories"],
      ["#loader p", "textContent", "Setting up the table…"],
      ['.modes [data-mode="clusters"]', "title", "Category clusters (2)"],
      ["label:has(#t-recs)", "title", "Show recommended games (R)"],
      ["label:has(#t-queue)", "title", "Show my wishlist and what's on the table (Q)"],
      ["#legend", "aria-label", "Categories"],
      ["#help ul", "innerHTML", `<li><b>Scroll / pinch</b> zoom · <b>drag</b> pan · drag a game to move it</li>
      <li><b>Hover</b> a game to light up everything it touches</li>
      <li><b>Click</b> to open details · <b>Esc</b> to clear</li>
      <li><b>Click a category</b> in the legend to isolate it</li>
      <li><kbd>/</kbd> search · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> layouts · <kbd>R</kbd> recommendations</li>
      <li><kbd>Q</kbd> wishlist · <kbd>T</kbd> titles · <kbd>S</kbd> surprise me · <kbd>D</kbd> theme · <kbd>0</kbd> fit · <kbd>L</kbd> layout</li>`],
      ["#help p.muted", "textContent", "Solid frames are games I own. Dotted frames with a ribbon are on my wishlist, and a golden marching frame is what's on the table right now. Dashed, softly pulsing frames are recommendations, tied by a dashed line to the games that inspired them. The better the match, the bigger and brighter the pick and the faster its lane; the top 10 wear a numbered medal."],
    ],
  };

  // ---------- video games ----------
  // Same map, own words. Lookups use Wikipedia's video game articles (cover art in the infobox) + Wikidata
  // (developer, platforms, series, year). A library usually starts from a list file (see importCSV below).
  let vgSkipped = 0; // Steam import: owned games left out because they were barely played
  const VG_STRIP = / \((\d{4} )?video game\)$/;
  const firstYear = (c) => { const ys = (c?.P577 || []).map((x) => parseInt(x.mainsnak?.datavalue?.value?.time?.slice(1, 5))).filter(Boolean); return ys.length ? Math.min(...ys) : null; };
  const plats = (n) => Array.isArray(n.platforms) && n.platforms.length ? n.platforms.slice(0, 3).join(", ") + (n.platforms.length > 3 ? ` +${n.platforms.length - 3}` : "") : null;
  const videogames = {
    id: "videogames",
    lib: "Video Games",
    storeKey: "bl-overlay-videogames-v1",
    tables: { edits: "videogame_edits", picks: "videogame_picks" },
    png: "barons-video-games.png",
    box: [36, 48], // portrait game covers
    // arcade look: a neon grid floor, pixel dust, scanlines and a HUD reticle (app.js + style.css)
    look: { arcade: true, poly: [8, Math.PI / 8, 1.06], squareDots: true, font: '"Chakra Petch", Inter, sans-serif', themeColor: { dark: "#07051a", light: "#e4e1f4" } },
    fontHref: "https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&display=swap",
    queueToggle: "Backlog", noReferrer: true,
    sub: (m) => `${m.read} played · ${m.queued || 0} in the backlog · ${m.recommended} recommended`,
    items: "games",
    count: (n) => many(n, "game", "games"),
    Genres: "Genres",
    // Old games are hard to go back to: graphics, controls and conveniences age. A pick's score includes how well it
    // holds up for someone playing it today (0-100): Claude's judgement when given (it knows pixel art ages better than
    // early 3D, and when a remake exists), otherwise an estimate from the release year. Your own games aren't affected.
    holdsUp: (r) => {
      const now = new Date().getFullYear(), age = r.year ? Math.max(0, now - r.year) : null;
      if (typeof r.holdsUp === "number") return { v: Math.max(0, Math.min(100, Math.round(r.holdsUp))), note: "my call" + (age != null ? ` · ${r.year}` : "") };
      if (age == null) return { v: 70, note: "year unknown" };
      return { v: age <= 5 ? 100 : Math.max(30, Math.round(100 - (age - 5) * 3.2)), note: age <= 1 ? "brand new" : `${age} years old` };
    },
    tipReading: "▶ Playing right now",
    tipQueue: (rank, N, score) => rank ? `🕹 Backlog #${rank} of ${N} · ${score}%` : "🕹 In my backlog",
    kindLabel: { rec: "✦ Recommended", reading: "▶ Playing now", queue: "🕹 Backlog", read: "Played" },
    coverAlt: "Cover of",
    facts: (n, isRec, esc) => [n.series && n.series !== n.title && `${esc(n.series)}${n.seriesNo ? " #" + n.seriesNo : ""}`, n.year, plats(n) && esc(plats(n)), n.hours && `${n.hours} h`],
    because: "Because I played",
    siblings: (hasSeries) => hasSeries ? "In this series / by this studio" : "More by this studio",
    link: (n) => /^Q\d+$/.test(n.wikidata || "") ? `https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/${n.wikidata}` : `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(n.title + " video game")}`,
    linkLabel: (isRec) => `${isRec ? "Find on" : "Open on"} Wikipedia ↗`,
    copyLink: "🔗 Copy link to this game",
    ofQueue: "in the backlog",
    queueHead: "Play next",
    recTier1: "Play this next",
    creatorBar: "Studio",
    creatorNote: (avg, n) => `${avg}★ avg of ${n} played`,
    newCreator: "new studio",
    seriesYes: "continues a series", seriesNo: "standalone / new",
    linkedAvg: "★ avg of linked games",
    linksNote: (n) => `${n} of your games`,
    overviewBy: "Every game I've played, and what to play next.",
    tileRead: "Games played",
    tile3: { label: "Studios", value: (bs) => new Set(bs.map((b) => b.author).filter(Boolean)).size },
    perYear: "Played per year",
    topCreators: "Favourite studios",
    key: { read: "Played", reading: "Playing now", queue: "Backlog" },
    hint: "Click anything to dive in. Recommendations are linked to the games that inspired them.",
    tag: { reading: "▶ playing", queue: "backlog", read: "played" },
    addRowNote: "Look it up and add it to your library",
    ed: {
      genre: "genre", Genre: "Genre",
      addOne: "＋ Add a game", dockAdd: "＋ Game", dockAddTitle: "Add a game",
      modalTitle: "Add a game", searchPh: "Search by game name…", noMatches: "No matches",
      removeOne: "Remove this game", next: (n) => `Continue with ${many(n, "game", "games")} →`,
      shelves: [["read", "Played"], ["to-read", "Backlog"], ["reading", "Playing now"]],
      addMany: (n) => `Add ${n} games`, added: (n) => `Added ${n} games`,
      pending: "Added by you · Claude fills in the details & picks on the next update",
      signupBlurb: "Map the games you've played: add them, build genres, and get picks. You'll stay signed in on this device.",
    },
    base: taxBase("videogames/taxonomy.json"),
    async find(s, signal) {
      const w = await fetch(`${WP}&generator=search&gsrlimit=8&gsrsearch=${encodeURIComponent(s + ' hastemplate:"Infobox video game"')}&prop=pageimages|description|pageprops&piprop=thumbnail|name&pithumbsize=500&pilicense=any&ppprop=wikibase_item`, { signal }).then((r) => r.json());
      const pages = Object.values(w.query?.pages || {}).sort((a, b) => a.index - b.index);
      const qids = pages.map((p) => p.pageprops?.wikibase_item).filter(Boolean);
      let ents = {}; const names = {};
      const studio = (c) => [ids(c, "P178"), ids(c, "P123")].find((a) => a.length) || []; // developer, else publisher
      if (qids.length) {
        ents = (await fetch(`${WD}&props=claims&ids=${qids.join("|")}`, { signal }).then((r) => r.json())).entities || {};
        const more = [...new Set(Object.values(ents).flatMap((e) => [...studio(e.claims), ...ids(e.claims, "P179"), ...ids(e.claims, "P400").slice(0, 6)]))];
        for (let i = 0; i < more.length && i < 150; i += 50) { // the API answers 50 ids at a time
          const ls = (await fetch(`${WD}&props=labels&languages=en&languagefallback=1&ids=${more.slice(i, i + 50).join("|")}`, { signal }).then((r) => r.json())).entities || {};
          for (const [k, e] of Object.entries(ls)) names[k] = e.labels?.en?.value;
        }
      }
      const out = pages.map((p) => {
        const q = p.pageprops?.wikibase_item, c = ents[q]?.claims, year = firstYear(c) || +(p.title.match(/\((\d{4}) video game\)$/)?.[1] || 0) || null;
        const studios = studio(c).map((x) => names[x]).filter(Boolean).slice(0, 2), series = ids(c, "P179").map((x) => names[x]).filter(Boolean)[0] || null;
        const platforms = ids(c, "P400").slice(0, 6).map((x) => names[x]).filter(Boolean), title = p.title.replace(VG_STRIP, "");
        const art = goodArt(p.thumbnail?.source, p.pageimage);
        return { key: q || "wp-" + p.pageid, title, creator: studios.join(" & "),
          small: [studios.join(", ") || p.description, year].filter(Boolean).join(" · "), thumb: art, big: art,
          make: () => ({ id: q ? "wd-" + q : "vg-" + gslug(p.title), wikidata: q || null, title, author: studios.join(" & "), year, platforms: platforms.length ? platforms : null, series, cover: art }) };
      });
      out.push({ key: "typed:" + gslug(s), title: s, creator: "", small: "Add it as typed: Claude fills in the details", thumb: null, big: null,
        make: () => ({ id: "vg-" + gslug(s), title: s, author: "", year: null, platforms: null, series: null, cover: null }) });
      return out;
    },
    ...videoArt, // artFor, isPhoto, fetchArt
    // A list file: { "kind": "videogames", "items": [{ title, year, author, platforms, series, seriesNo, rating, shelf, genres, cover, wikidata }] }.
    // Claude writes one from a list of games you name; importing it fills the map in one go. Read in the browser only.
    importLabel: "Import a list: a games list file, a Steam library, a CSV, or plain names",
    importAccept: ".json,.csv,.tsv,.txt,application/json,text/csv,text/plain",
    importNote: "Ratings and genres come from the file when it has them; change anything afterwards in edit mode. Claude fills in what's missing (genres, studios, covers) and adds picks on the next update.",
    importEmpty: "No games in that file.",
    sameItem: (b, it) => b.id === it.id || (b.wikidata && b.wikidata === it.wikidata) || (String(b.title || "").toLowerCase() === String(it.title || "").toLowerCase() && (!b.year || !it.year || b.year === it.year)), // remakes share a name: the year tells them apart
    importSummary: (items, updates) => { const c = (sh) => items.filter((i) => i.shelf === sh).length;
      return `<p><b>${items.length}</b> games found: ${c("read")} played${c("reading") ? `, ${c("reading")} playing now` : ""}${c("to-read") ? `, ${c("to-read")} for the backlog` : ""}.${updates ? ` ${updates} already on your map get updated, not doubled.` : ""}${vgSkipped ? ` ${vgSkipped} left out (played under 2 hours).` : ""}</p>`; },
    async importCSV(text) {
      const raw = text.replace(/^\uFEFF/, "").trim(), int = (v) => { const x = parseInt(v, 10); return x > 0 ? x : null; }, seen = new Set(), items = [];
      let j = null; try { j = JSON.parse(raw); } catch {}
      vgSkipped = 0;
      const steam = j?.response?.games || (Array.isArray(j?.games) ? j.games : null);
      if (steam) { // a Steam library (the saved answer of Steam's GetOwnedGames, see README): names, hours played and Steam's own cover art
        if (steam.length && !steam[0].name) throw new Error("That Steam file has no game names: add include_appinfo=1 to the link and save it again");
        for (const g of steam) {
          const mins = +g.playtime_forever || 0; if (mins < 120) { vgSkipped++; continue; } // owned but barely started: left out
          items.push({ id: "steam-" + g.appid, steamId: String(g.appid), title: String(g.name).replace(/[™®]/g, "").trim(), author: "", year: null, platforms: ["Microsoft Windows"], series: null,
            rating: null, shelf: "read", hours: Math.round(mins / 6) / 10, note: null, genres: [], cover: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/library_600x900.jpg`, soft: true });
        }
        const loads = (u) => new Promise((ok) => { const im = new Image(); const t = setTimeout(() => ok(false), 7000); im.onload = () => { clearTimeout(t); ok(im.naturalWidth > 50); }; im.onerror = () => { clearTimeout(t); ok(false); }; im.src = u; });
        for (let i = 0; i < items.length; i += 24) await Promise.all(items.slice(i, i + 24).map(async (it) => { if (!(await loads(it.cover))) it.cover = null; })); // older games have no library art
        return items;
      }
      if (!j) { // a table (CSV / TSV with a title or name column) or a plain list, one game per line
        const head = raw.split(/\r?\n/)[0], sep = head.includes("\t") ? "\t" : head.includes(";") && !head.includes(",") ? ";" : ",";
        const table = /(^|[,;\t"])\s*(title|name|game)\s*($|[,;\t"])/i.test(head) ? d3.dsvFormat(sep).parse(raw) : null;
        const col = (r, ...names) => { for (const k of Object.keys(r)) if (names.includes(k.trim().toLowerCase())) return String(r[k] ?? "").trim(); return ""; };
        const rows = table ? table.map((r) => ({ title: col(r, "title", "name", "game"), rating: col(r, "rating", "stars", "score", "my rating"), hours: col(r, "hours", "playtime", "time played", "hours played"),
          platform: col(r, "platform", "platforms", "system", "console"), shelf: col(r, "shelf", "status", "state"), year: col(r, "year", "release year", "released") }))
          : raw.split(/\r?\n/).map((l) => ({ title: l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim() })).filter((r) => r.title && !r.title.startsWith("#"));
        for (const r of rows) {
          if (!r.title) continue;
          const year = int(r.year), id = "vg-" + gslug(r.title + (year ? " " + year : "")); if (seen.has(id)) continue; seen.add(id);
          const st = (r.shelf || "").toLowerCase(), shelf = /playing|current|in progress/.test(st) ? "reading" : /backlog|wish|want|unplayed|not started|to.?play/.test(st) ? "to-read" : "read";
          let stars = parseFloat(r.rating) || 0; if (stars > 10) stars /= 20; else if (stars > 5) stars /= 2; stars = Math.round(stars * 2) / 2; // 100-point and 10-point scores become stars
          items.push({ id, title: r.title, author: "", year, platforms: r.platform ? r.platform.split(/\s*[,/|]\s*/).filter(Boolean).slice(0, 8) : null, series: null,
            rating: shelf === "read" && stars >= 1 ? Math.min(5, stars) : null, shelf, ...(parseFloat(r.hours) > 0 ? { hours: Math.round(parseFloat(r.hours) * 10) / 10 } : {}), note: null, genres: [], cover: null, ...(st ? {} : { soft: true }) });
        }
        if (!items.length) throw new Error("No game names found in that file");
        return items;
      }
      if (j?.kind !== "videogames" || !Array.isArray(j.items)) throw new Error("That file doesn't look like a games list or a Steam library");
      for (const r of j.items) {
        const title = String(r.title || "").trim(); if (!title) continue;
        const year = int(r.year), wikidata = /^Q\d+$/.test(r.wikidata || "") ? r.wikidata : null, id = wikidata ? "wd-" + wikidata : "vg-" + gslug(title + (year ? " " + year : ""));
        if (seen.has(id)) continue; seen.add(id);
        const shelf = ["read", "to-read", "reading"].includes(r.shelf) ? r.shelf : "read", stars = Math.round(parseFloat(r.rating) * 2) / 2 || null; // half stars allowed
        items.push({ id, wikidata, title, author: String(r.author || ""), year, platforms: Array.isArray(r.platforms) && r.platforms.length ? r.platforms.map(String).slice(0, 8) : null,
          series: r.series ? String(r.series) : null, ...(int(r.seriesNo) ? { seriesNo: int(r.seriesNo) } : {}), rating: shelf === "read" && stars >= 1 ? Math.min(5, stars) : null, shelf,
          note: r.note ? String(r.note) : null, genres: Array.isArray(r.genres) ? r.genres.map(String).slice(0, 3) : [], cover: /^https:\/\//.test(r.cover || "") ? r.cover : null });
      }
      return items;
    },
    dom: [
      ["title", "textContent", "Baron's Video Games · a video game constellation"],
      ['meta[name="description"]', "content", "An interactive map of the video games I've played, their genres, and what to play next."],
      [".brand h1", "innerHTML", "Baron's <em>Video Games</em>"],
      ["#q", "placeholder", "Search games, studios, genres…"],
      ["#stage", "aria-label", "Interactive map of video games and genres"],
      ["#loader p", "textContent", "Press start…"],
      ["label:has(#t-recs)", "title", "Show recommended games (R)"],
      ["label:has(#t-queue)", "title", "Show my backlog and what I'm playing now (Q)"],
      ["#help ul", "innerHTML", `<li><b>Scroll / pinch</b> zoom · <b>drag</b> pan · drag a game to move it</li>
      <li><b>Hover</b> a game to light up everything it touches</li>
      <li><b>Click</b> to open details · <b>Esc</b> to clear</li>
      <li><b>Click a genre</b> in the legend to isolate it</li>
      <li><kbd>/</kbd> search · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> layouts · <kbd>R</kbd> recommendations</li>
      <li><kbd>Q</kbd> backlog · <kbd>T</kbd> titles · <kbd>S</kbd> surprise me · <kbd>D</kbd> theme · <kbd>0</kbd> fit · <kbd>L</kbd> layout</li>`],
      ["#help p.muted", "textContent", "Solid frames are games I've played. Dotted frames with a ribbon are in my backlog, and a golden marching frame is what I'm playing right now. Dashed, softly pulsing frames are recommendations, tied by a dashed line to the games that inspired them. The better the match, the bigger and brighter the pick and the faster its lane; the top 10 wear a numbered medal."],
    ],
  };

  const kinds = { books, games, videogames };
  // which library: ?kind=... (old links), else the page itself (boardgames.html and videogames.html carry data-kind)
  const want = new URLSearchParams(location.search).get("kind") || document.documentElement.dataset.kind;
  const K = window.KIND = kinds[want] || books;
  K.pages = { books: "./", games: "boardgames.html", videogames: "videogames.html" }; // each library has its own page, icon and home-screen shortcut
  if (K.id !== (document.documentElement.dataset.kind || "books")) { // reached through ?kind= on another library's page: show the right icon at least
    const set = (sel, href) => { const el = document.querySelector(sel); if (el) el.href = href; };
    set('link[rel="icon"]', `icons/${K.id}.svg`); set('link[rel="apple-touch-icon"]', `icons/${K.id}-180.png`); set('link[rel="manifest"]', `${K.id}.webmanifest`);
  }
  for (const [sel, prop, v] of K.dom || []) { const el = document.querySelector(sel); if (el) el[prop] === undefined ? el.setAttribute(prop, v) : (el[prop] = v); }
  if (K.id !== "books") document.querySelector(".help-gr")?.remove(); // the Goodreads how-to is for book libraries
  if (K.dom) { const q = document.querySelector("#t-queue"), t = q?.parentElement?.lastChild; if (t?.nodeType === 3) t.nodeValue = K.queueToggle || "Wishlist"; }
  document.documentElement.dataset.kind = K.id; // lets style.css theme each kind
  if (K.fontHref) document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: K.fontHref })); // the look's display font
  if (K.noReferrer) document.head.append(Object.assign(document.createElement("meta"), { name: "referrer", content: "no-referrer" }));
})();
