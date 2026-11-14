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

  const kinds = { books };
  const want = new URLSearchParams(location.search).get("kind");
  window.KIND = kinds[want] || books;
})();
