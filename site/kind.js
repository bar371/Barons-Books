/* Baron's Library: what kind of library this page shows. Everything that is specific to books (words,
   where to search, where to link out, which tables hold the edits) lives here, so the map, scoring and
   editing code can be shared. ?kind=games switches to board games; books stay the default. */
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
  const players = (n) => n.players ? (n.players[0] === n.players[1] || !n.players[1] ? `${n.players[0]} players` : `${n.players[0]}–${n.players[1]} players`) : null;
  const gslug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const games = {
    id: "games",
    lib: "Games",
    storeKey: "bl-overlay-games-v1",
    tables: { edits: "game_edits", picks: "game_picks" },
    png: "barons-games.png",
    box: [40, 40], // square game boxes
    sub: (m) => `${m.read} owned · ${m.queued || 0} on the wishlist · ${m.recommended} recommended`,
    items: "games",
    count: (n) => many(n, "game", "games"),
    Genres: "Categories",
    tipReading: "▶ On the table right now",
    tipQueue: (rank, N, score) => rank ? `🎁 Wishlist #${rank} of ${N} · ${score}%` : "🎁 On my wishlist",
    kindLabel: { rec: "✦ Recommended", reading: "▶ On the table", queue: "🎁 Wishlist", read: "Owned" },
    coverAlt: "Box of",
    facts: (n, isRec, esc) => [n.series && n.series !== n.title && esc(n.series), players(n), n.playtime && `${n.playtime} min`, n.year, n.weight && `weight ${n.weight}/5`, n.plays && `played ×${n.plays}`],
    because: "Because I love",
    siblings: (hasSeries) => hasSeries ? "Same family / same designer" : "More by this designer",
    link: (n) => n.bggId ? `https://boardgamegeek.com/boardgame/${n.bggId}` : `https://boardgamegeek.com/geeksearch.php?action=search&objecttype=boardgame&q=${encodeURIComponent(n.title)}`,
    linkLabel: (isRec) => `${isRec ? "Find on" : "Open on"} BoardGameGeek ↗`,
    copyLink: "🔗 Copy link to this game",
    ofQueue: "on the wishlist",
    queueHead: "Get next",
    recTier1: "Play this next",
    creatorBar: "Designer",
    creatorNote: (avg, n) => `${avg}★ avg of ${n} owned`,
    newCreator: "new designer",
    seriesYes: "same family as one you own", seriesNo: "standalone / new",
    linkedAvg: "★ avg of linked games",
    linksNote: (n) => `${n} of your games`,
    overviewBy: "Every game on my shelf, and what to play next.",
    tileRead: "Games owned",
    tile3: { label: "Designers", value: (bs) => new Set(bs.map((b) => b.author).filter(Boolean)).size },
    perYear: "Added per year",
    topCreators: "Favourite designers",
    key: { read: "Owned", reading: "On the table", queue: "Wishlist" },
    hint: "Click anything to dive in. Recommendations are linked to the games that inspired them.",
    tag: { reading: "▶ on the table", queue: "wishlist", read: "owned" },
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
    // Broad groups on purpose: a 20-game shelf spreads over a few clusters instead of 20 lonely ones.
    // Empty categories stay hidden on the map.
    genres: [
      ["Strategy", "#74c0fc", ["Engine building", "Worker placement", "Area control", "Economic & trading"]],
      ["Cooperative", "#63e6be", ["Co-op adventure", "Co-op puzzle"]],
      ["Party & Social", "#f783ac", ["Party", "Social deduction", "Word & trivia"]],
      ["Family", "#ffc078", ["Gateway", "Dexterity & light"]],
      ["Cards & Dice", "#b197fc", ["Deck-building", "Card drafting", "Dice"]],
      ["Thematic", "#ff8787", ["Fantasy adventure", "Dungeon crawl", "Campaign & legacy", "Sci-fi"]],
      ["Abstract & Puzzle", "#a9e34b", ["Abstract", "Tile laying & puzzle"]],
    ],
    base() {
      const genres = [];
      for (const [name, color, subs] of this.genres) {
        genres.push({ id: name, name, parent: null, color, count: 0 });
        for (const s of subs) genres.push({ id: s, name: s, parent: name, color, count: 0 });
      }
      return { genres, books: [], recs: [], queue: [], meta: { read: 0, queued: 0, recommended: 0 } };
    },
    async find(s, signal) {
      const w = await fetch(`https://en.wikipedia.org/w/api.php?format=json&origin=*&action=query&generator=search&gsrlimit=8&gsrsearch=${encodeURIComponent(s + ' hastemplate:"Infobox game"')}&prop=pageimages|description|pageprops&piprop=thumbnail&pithumbsize=400&ppprop=wikibase_item`, { signal }).then((r) => r.json());
      const pages = Object.values(w.query?.pages || {}).sort((a, b) => a.index - b.index);
      const qids = pages.map((p) => p.pageprops?.wikibase_item).filter(Boolean);
      let ents = {}, names = {};
      if (qids.length) {
        ents = (await fetch(`${WD}&props=claims&ids=${qids.join("|")}`, { signal }).then((r) => r.json())).entities || {};
        const more = [...new Set(Object.values(ents).flatMap((e) => [...designerIds(e.claims), ...ids(e.claims, "P179")]))].slice(0, 50);
        if (more.length) {
          const ls = (await fetch(`${WD}&props=labels&languages=en&ids=${more.join("|")}`, { signal }).then((r) => r.json())).entities || {};
          for (const [k, e] of Object.entries(ls)) names[k] = e.labels?.en?.value;
        }
      }
      const out = pages.map((p) => {
        const q = p.pageprops?.wikibase_item, c = ents[q]?.claims, year = yearOf(c);
        const designers = designerIds(c).map((x) => names[x]).filter(Boolean), series = ids(c, "P179").map((x) => names[x]).filter(Boolean)[0] || null;
        const lo = num(c, "P1872"), hi = num(c, "P1873"), img = val(c, "P18");
        const thumb = commons(img, 120) || p.thumbnail?.source || null, big = commons(img, 600) || p.thumbnail?.source || null;
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
    // page text outside the scripts (index.html is written for books)
    dom: [
      ["title", "textContent", "Baron's Games · a board game constellation"],
      ['meta[name="description"]', "content", "An interactive map of my board games, the categories they belong to, and what to play next."],
      [".brand h1", "innerHTML", "Baron's <em>Games</em>"],
      ["#q", "placeholder", "Search games, designers, categories…"],
      ["#stage", "aria-label", "Interactive map of board games and categories"],
      ['.modes [data-mode="clusters"]', "title", "Category clusters (2)"],
      ["label:has(#t-recs)", "title", "Show recommended games (R)"],
      ["label:has(#t-queue)", "title", "Show my wishlist and what's on the table (Q)"],
      ["#legend", "aria-label", "Categories"],
      ["#help ul", "innerHTML", `<li><b>Scroll / pinch</b> zoom · <b>drag</b> pan · drag a game to move it</li>
      <li><b>Hover</b> a game to light up everything it touches</li>
      <li><b>Click</b> to open details · <b>Esc</b> to clear</li>
      <li><b>Click a category</b> in the legend to isolate it</li>
      <li><kbd>/</kbd> search · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> layouts · <kbd>R</kbd> recommendations</li>
      <li><kbd>Q</kbd> wishlist · <kbd>T</kbd> titles · <kbd>S</kbd> surprise me · <kbd>D</kbd> theme · <kbd>0</kbd> fit</li>`],
      ["#help p.muted", "textContent", "Solid frames are games I own. Dotted frames with a ribbon are on my wishlist, and a golden marching frame is what's on the table right now. Dashed, softly pulsing frames are recommendations, tied by a dashed line to the games that inspired them. The better the match, the bigger and brighter the pick and the faster its lane; the top 10 wear a numbered medal."],
    ],
  };

  const kinds = { books, games };
  const want = new URLSearchParams(location.search).get("kind");
  const K = window.KIND = kinds[want] || books;
  for (const [sel, prop, v] of K.dom || []) { const el = document.querySelector(sel); if (el) el[prop] === undefined ? el.setAttribute(prop, v) : (el[prop] = v); }
  if (K.dom) { const q = document.querySelector("#t-queue"), t = q?.parentElement?.lastChild; if (t?.nodeType === 3) t.nodeValue = "Wishlist"; }
  document.documentElement.dataset.kind = K.id; // lets style.css theme each kind
})();
