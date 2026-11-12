/* Baron's Library: editing layer (add books, add genres, re-tag books).
   Edits live in an "overlay" that is merged into data.json before the map is built, so the map itself
   never changes shape. Storage is this browser for now; the Supabase adapter swaps in once login exists.
   Turn edit mode on with ?edit in the URL (it is remembered on this device). */
(() => {
  const KEY = "bl-overlay-v1", EDIT = "bl-edit";
  const PALETTE = ["#f783ac", "#b197fc", "#74c0fc", "#63e6be", "#ffc078", "#e599f7", "#a9e34b", "#ff8787"];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  // ---------- storage: Supabase when you're signed in to your own library, else this browser ----------
  const EMPTY = () => ({ books: [], genres: [], assign: {}, ratings: {} });
  const norm = (o) => Object.assign(EMPTY(), o || {});
  const local = () => { try { return norm(JSON.parse(ls.get(KEY) || "{}")); } catch { return EMPTY(); } };
  let ctx = { slug: "baron", profile: null, isMine: false, ok: false };
  let ov = EMPTY();
  let pk = null; // Claude's picks for this library: { newGenres, books: {id: {genres, blurb, fit}}, recs }
  if (new URLSearchParams(location.search).has("edit")) ls.set(EDIT, "1");
  const canEdit = () => ctx.isMine || (!ctx.ok && ls.get(EDIT) != null); // offline fallback: ?edit keeps local editing
  let editing = false;
  const Store = {
    async save(o) {
      if (ctx.isMine) {
        try { await window.Cloud.saveEdits(o); toast("Saved"); }
        catch (e) { ls.set(KEY + ":" + ctx.slug, JSON.stringify(o)); toast("Couldn't save to the cloud (" + e.message + "), kept on this device"); }
      } else ls.set(KEY, JSON.stringify(o));
    },
  };
  function toast(msg) {
    let t = document.querySelector("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast glass"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2600);
  }

  // ---------- which library, and its data ----------
  const emptyBase = (d) => ({ ...d, books: [], recs: [], queue: [], genres: d.genres.map((g) => ({ ...g, count: 0 })), meta: { read: 0, queued: 0, recommended: 0 } });
  async function loadData() {
    const get = () => fetch("data.json", { cache: "no-cache" }).then((r) => r.json());
    if (!window.Cloud) return get();
    const [c, base] = await Promise.all([window.Cloud.resolve().catch(() => ctx), get()]);
    ctx = c;
    let d = base;
    if (ctx.slug !== "baron") d = await fetch(`libraries/${ctx.slug}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : emptyBase(base))).catch(() => emptyBase(base));
    if (ctx.profile) {
      const [remote, picks] = await Promise.all([window.Cloud.loadEdits(ctx.profile.id), window.Cloud.loadPicks(ctx.profile.id)]);
      pk = picks;
      ov = norm(remote);
      const old = local(); // first sign-in: move edits made on this device into the cloud
      if (ctx.isMine && !remote && (old.books.length || old.genres.length || Object.keys(old.assign).length)) { ov = old; Store.save(ov).then(() => ls.set(KEY, "{}")); }
    } else ov = local();
    d.meta = { ...d.meta, owner: ctx.profile?.display_name || "Baron" };
    return d;
  }

  // ---------- merge the overlay into data.json ----------
  function apply(d) {
    d.recs = d.recs || []; d.queue = d.queue || [];
    const ids = new Set(d.genres.map((g) => g.id));
    let pi = d.genres.filter((g) => !g.parent).length;
    for (const g of [...(pk?.newGenres || []), ...ov.genres]) {
      if (ids.has(g.id)) continue;
      const parent = g.parent && d.genres.find((x) => x.id === g.parent);
      if (g.parent && !parent) continue;
      d.genres.push({ id: g.id, name: g.name, parent: g.parent || null, color: parent ? parent.color : PALETTE[pi++ % PALETTE.length], count: 0, custom: true });
      ids.add(g.id);
    }
    const replaced = new Set(ov.books.map((b) => b.replaces).filter(Boolean)); // e.g. a to-read book you've now read
    d.books = d.books.filter((b) => !replaced.has(b.id)); d.queue = (d.queue || []).filter((b) => !replaced.has(b.id));
    for (const b of ov.books) {
      const item = { ...b, genres: (b.genres || []).filter((g) => ids.has(g)), mine: true };
      if (b.shelf === "read") d.books.push({ ...item, shelf: "read" });
      else (d.queue = d.queue || []).push({ ...item, shelf: b.shelf === "reading" ? "reading" : "to-read" });
    }
    // Claude's notes on books (genres for ones you added, blurbs, taste fit for the to-read list)
    const pb = pk?.books || {};
    for (const it of [...d.books, ...(d.queue || [])]) {
      const p = pb[it.id]; if (!p) continue;
      if (!(it.genres || []).length && p.genres) it.genres = p.genres.filter((g) => ids.has(g));
      if (!it.blurb && p.blurb) it.blurb = p.blurb;
      if (p.fit != null) it.fit = p.fit;
      it.pending = false;
    }
    // Claude's recommendations; anything you've since added to your shelves drops off the list
    const tkey = (t) => String(t || "").toLowerCase().split(" (")[0].trim();
    const owned = new Set([...d.books, ...(d.queue || [])].map((b) => tkey(b.title)));
    if (pk || ov.books.length) d.recs = (d.recs || []).filter((r) => !owned.has(tkey(r.title)));
    const readIds = new Set(d.books.map((b) => b.id)), have = new Set(d.recs.map((r) => tkey(r.title)));
    for (const r of pk?.recs || []) {
      const k = tkey(r.title), because = (r.because || []).filter((x) => readIds.has(x)), genres = (r.genres || []).filter((g) => ids.has(g));
      if (owned.has(k) || have.has(k) || !because.length || !genres.length) continue;
      have.add(k); d.recs.push({ ...r, because, genres, picked: true });
    }
    const all = [...d.books, ...d.recs, ...(d.queue || [])];
    for (const [id, gs] of Object.entries(ov.assign)) { const it = all.find((x) => x.id === id); if (it) it.genres = gs.filter((g) => ids.has(g)); }
    for (const [id, r] of Object.entries(ov.ratings || {})) { const it = d.books.find((x) => x.id === id); if (it) it.rating = r || null; }
    score(d);
    d.meta = { ...d.meta, read: d.books.length, queued: d.queue.length, recommended: d.recs.length }; // header counts include your edits & Claude's picks
  }

  // Same formulas as scripts/build_graph.py (incl. Python's round-half-to-even), recomputed here so new
  // picks and rating changes re-rank straight away.
  const pr = (x) => { const f = Math.floor(x), e = x - f; return e > 0.5 ? f + 1 : e < 0.5 ? f : f % 2 === 0 ? f : f + 1; };
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const order = (a, b) => b.score - a.score || b.parts.taste - a.parts.taste || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
  function score(d) {
    const books = d.books;
    for (const r of d.recs) {
      const taste = r.fit ?? r.parts?.taste ?? 70, bc = new Set(r.because || []);
      const stars = books.filter((b) => bc.has(b.id) && b.rating).map((b) => b.rating);
      const ratings = stars.length ? pr(avg(stars) / 5 * 100) : 70, links = pr(Math.min(bc.size, 3) / 3 * 100);
      r.score = pr(0.6 * taste + 0.3 * ratings + 0.1 * links);
      r.parts = { taste, ratings, links, avgStars: stars.length ? pr(avg(stars) * 10) / 10 : null };
    }
    d.recs.sort(order).forEach((r, i) => (r.rank = i + 1));
    const series = new Set(books.map((b) => b.series).filter(Boolean)), q = d.queue || [];
    for (const it of q) {
      if (it.shelf !== "to-read") { delete it.score; delete it.parts; delete it.rank; continue; }
      const taste = it.fit ?? it.parts?.taste ?? 70, stars = books.filter((b) => b.author === it.author && b.rating).map((b) => b.rating);
      const author = stars.length ? pr(avg(stars) / 5 * 100) : 70, ser = it.series && series.has(it.series) ? 100 : 50;
      it.score = pr(0.6 * taste + 0.25 * author + 0.15 * ser);
      it.parts = { taste, author, series: ser, avgStars: stars.length ? pr(avg(stars) * 10) / 10 : null, nAuthor: stars.length };
    }
    q.filter((it) => it.score != null).sort(order).forEach((it, i) => (it.rank = i + 1));
  }
  function commit(reselect) { if (!canEdit()) return; Store.save(ov); reload(); if (reselect) window.Library.select(reselect); }
  // rebuilding from a fresh copy of data.json keeps removals/renames clean
  let pristine = null;
  function reload() {
    const L = window.Library, d = structuredClone(pristine);
    apply(d); Object.keys(L.data).forEach((k) => delete L.data[k]); Object.assign(L.data, d); L.rebuild();
  }

  // ---------- helpers ----------
  const D = () => window.Library.data;
  const macros = () => D().genres.filter((g) => !g.parent);
  const subsOf = (m) => D().genres.filter((g) => g.parent === m);
  const slug = (s) => s.trim().replace(/\s+/g, " ");
  function genreSelect(cls) {
    return `<select class="ed-sel ${cls}"><option value="">Add a genre…</option>${macros().map((m) => `<optgroup label="${esc(m.name)}">${subsOf(m.id).map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</optgroup>`).join("")}<option value="__new">＋ New genre…</option></select>`;
  }
  function newGenreForm() {
    return `<div class="ed-new" hidden><input class="ed-gname" placeholder="Genre name" maxlength="40"><select class="ed-gparent">${macros().map((m) => `<option value="${esc(m.id)}">under ${esc(m.name)}</option>`).join("")}<option value="">as a new main genre</option></select><button class="ed-gadd">Add</button></div>`;
  }
  function createGenre(name, parent) {
    name = slug(name); if (!name) return null;
    const exists = D().genres.find((g) => g.name.toLowerCase() === name.toLowerCase());
    if (exists) return exists.parent ? exists.id : null;
    if (!parent) { // a new main genre needs a sub-genre to hold books: use "General"
      ov.genres.push({ id: name, name, parent: null });
      const sub = `${name} (general)`; ov.genres.push({ id: sub, name: "General " + name, parent: name }); return sub;
    }
    ov.genres.push({ id: name, name, parent }); return name;
  }

  // ---------- panel: re-tag a book ----------
  function panelExtra(n) {
    if (!editing) return n.mine && n.pending ? `<p class="ed-note">Added by you · Claude adds genres & picks on the next update</p>` : n.picked ? `<p class="ed-note">✦ A fresh pick from Claude</p>` : "";
    const cur = n.genreIds || [];
    return `<div class="ed-box" data-ed-book="${esc(n.id)}"><h4>Edit genres</h4>
      <div class="chips">${cur.map((g) => `<span class="chip ed-chip">${esc(D().genres.find((x) => x.id === g)?.name || g)}<button data-ed-rm="${esc(g)}" aria-label="Remove">×</button></span>`).join("") || `<span class="muted">No genre yet</span>`}</div>
      ${genreSelect("ed-pick")}${newGenreForm()}
      ${n.mine ? `<button class="ed-del">Remove this book</button>` : ""}
      <p class="ed-note">${n.mine && n.pending ? "Added by you · Claude adds genres & picks on the next update" : "Changes recluster the map straight away"}</p></div>`;
  }
  // in ✎ mode the stars under a read book's title become clickable
  function rateHTML(n) {
    if (!editing || n.kind !== "book") return "";
    return `<div class="ab-stars ed-stars" data-ed-rated="${esc(n.id)}" title="Click to change your rating">${[1, 2, 3, 4, 5].map((r) => `<button data-ed-rate="${r}" class="${r <= (n.rating || 0) ? "on" : ""}" aria-label="${r} stars">★</button>`).join("")}${n.rating ? `<button class="ed-unrate" data-ed-rate="0">clear</button>` : `<small>rate it</small>`}</div>`;
  }
  function legendExtra() { return editing ? `<button class="ed-add-legend" data-ed-open>＋ Add a book</button>` : ""; }
  function setGenres(id, gs) { ov.assign[id] = [...new Set(gs)]; const b = ov.books.find((x) => x.id === id); if (b) b.genres = ov.assign[id]; commit(id); }

  document.addEventListener("change", (e) => {
    const box = e.target.closest("[data-ed-book]"); if (!box || !e.target.classList.contains("ed-pick")) return;
    const v = e.target.value, n = window.Library.node(box.dataset.edBook);
    if (v === "__new") { box.querySelector(".ed-new").hidden = false; box.querySelector(".ed-gname").focus(); return; }
    if (v) setGenres(n.id, [...(n.genreIds || []), v]);
  });
  document.addEventListener("click", (e) => {
    const rt = e.target.closest("[data-ed-rate]"), rated = e.target.closest("[data-ed-rated]");
    if (rt && rated) { const id = rated.dataset.edRated; ov.ratings = ov.ratings || {}; ov.ratings[id] = +rt.dataset.edRate; return commit(id); }
    const box = e.target.closest("[data-ed-book]");
    if (box) {
      const n = window.Library.node(box.dataset.edBook);
      const rm = e.target.closest("[data-ed-rm]");
      if (rm) return setGenres(n.id, (n.genreIds || []).filter((g) => g !== rm.dataset.edRm));
      if (e.target.closest(".ed-gadd")) { const g = createGenre(box.querySelector(".ed-gname").value, box.querySelector(".ed-gparent").value); if (g) setGenres(n.id, [...(n.genreIds || []), g]); return; }
      if (e.target.closest(".ed-del") && confirm(`Remove "${n.title}" from your library?`)) { ov.books = ov.books.filter((b) => b.id !== n.id); delete ov.assign[n.id]; if (ov.ratings) delete ov.ratings[n.id]; commit(null); window.Library.select(null); return; }
    }
    if (e.target.closest("[data-ed-open]")) openAdd();
    if (e.target.closest("#b-edit")) setEditing(!editing);
  });

  // ---------- add a book (Open Library search) ----------
  const modal = document.createElement("div");
  modal.id = "addbook"; modal.className = "modal"; modal.hidden = true;
  modal.innerHTML = `<div class="card glass add-card"><h2>Add a book</h2>
    <input id="ab-q" placeholder="Search by title or author…" autocomplete="off">
    <p class="ab-hint">Adding several? Ctrl+click (⌘+click on a Mac), or tap ○, to pick more than one, even across searches.</p>
    <ul id="ab-res" class="ab-res"></ul><div id="ab-basket" hidden></div>
    <div id="ab-form" hidden></div><button class="ab-close" aria-label="Close">✕</button></div>`;
  document.body.appendChild(modal);
  const abq = modal.querySelector("#ab-q"), abres = modal.querySelector("#ab-res"), abform = modal.querySelector("#ab-form"), basket = modal.querySelector("#ab-basket");
  let timer = 0, results = [], picks = [], ctl = null;
  const isPicked = (b) => picks.some((p) => p.key === b.key);
  function openAdd(prefill) {
    modal.hidden = false; abform.hidden = true; abres.innerHTML = ""; picks = []; renderBasket(); abq.value = typeof prefill === "string" ? prefill : "";
    setTimeout(() => abq.focus(), 30); if (abq.value) search();
  }
  function renderResults() {
    abres.innerHTML = results.length ? results.map((b, i) => `<li data-i="${i}" class="${isPicked(b) ? "picked" : ""}">${b.cover_i ? `<img src="https://covers.openlibrary.org/b/id/${b.cover_i}-S.jpg" alt="">` : `<span class="ph"></span>`}<span><b>${esc(b.title)}</b><small>${esc((b.author_name || []).join(", "))}${b.first_publish_year ? " · " + b.first_publish_year : ""}</small></span><button class="ab-tick" data-tick aria-label="Pick">${isPicked(b) ? "✓" : ""}</button></li>`).join("") : `<li class="muted">No matches on Open Library</li>`;
  }
  function renderBasket() {
    basket.hidden = !picks.length;
    basket.innerHTML = picks.length ? `<div class="chips">${picks.map((p, i) => `<span class="chip ed-chip">${esc(p.title)}<button data-unpick="${i}" aria-label="Remove">×</button></span>`).join("")}</div>
      <button class="ab-save ab-next">Continue with ${picks.length} book${picks.length === 1 ? "" : "s"} →</button>` : "";
  }
  function togglePick(b) { picks = isPicked(b) ? picks.filter((p) => p.key !== b.key) : [...picks, b]; renderResults(); renderBasket(); }
  basket.addEventListener("click", (e) => {
    const u = e.target.closest("[data-unpick]"); if (u) { picks.splice(+u.dataset.unpick, 1); renderResults(); renderBasket(); return; }
    if (e.target.closest(".ab-next")) showForm();
  });
  function closeAdd() { modal.hidden = true; }
  modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest(".ab-close")) closeAdd(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) { e.stopPropagation(); closeAdd(); } }, true);
  abq.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 350); });
  async function search() {
    const s = abq.value.trim(); if (s.length < 3) { abres.innerHTML = ""; return; }
    ctl?.abort(); ctl = new AbortController();
    abform.hidden = true; abres.innerHTML = `<li class="muted">Searching…</li>`;
    try {
      const r = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(s)}&fields=key,title,author_name,first_publish_year,cover_i,isbn,number_of_pages_median&limit=8`, { signal: ctl.signal });
      results = (await r.json()).docs || [];
      renderResults();
    } catch (err) { if (err.name !== "AbortError") abres.innerHTML = `<li class="muted">Search failed, try again</li>`; }
  }
  // plain click: this book (plus any already picked) → details; Ctrl/⌘/Shift-click or the ○: pick and keep searching
  abres.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-i]"); if (!li) return;
    const b = results[+li.dataset.i];
    if (e.target.closest("[data-tick]") || e.ctrlKey || e.metaKey || e.shiftKey) { e.preventDefault(); return togglePick(b); }
    if (!isPicked(b)) picks.push(b);
    showForm();
  });
  const haveOf = (p) => [...D().books, ...(D().queue || [])].find((b) => b.title.toLowerCase().split(" (")[0] === p.title.toLowerCase());
  function showForm() {
    if (!picks.length) return;
    abres.innerHTML = ""; basket.hidden = true; picks.forEach((p) => (p.have = haveOf(p)));
    const many = picks.length > 1, dup = picks.filter((p) => p.have);
    abform.hidden = false;
    abform.innerHTML = (many
      ? `<div class="ab-many">${picks.map((p) => `<div title="${esc(p.title)}">${p.cover_i ? `<img src="https://covers.openlibrary.org/b/id/${p.cover_i}-M.jpg" alt="">` : `<span class="ph"></span>`}<small>${esc(p.title)}</small></div>`).join("")}</div>
         ${dup.length ? `<p class="ed-note">Already on your map: ${dup.map((p) => "“" + esc(p.have.title) + "”").join(", ")}. Saving moves ${dup.length === 1 ? "it" : "them"} to the shelf you pick.</p>` : ""}`
      : `<div class="ab-pick">${picks[0].cover_i ? `<img src="https://covers.openlibrary.org/b/id/${picks[0].cover_i}-M.jpg" alt="">` : ""}<div><b>${esc(picks[0].title)}</b><small>${esc((picks[0].author_name || [])[0] || "")}</small>${dup.length ? `<p class="ed-note">Already on your map as “${esc(dup[0].have.title)}”: saving moves it to the shelf you pick.</p>` : ""}</div></div>`)
      + `<div class="ab-row"><label><input type="radio" name="ab-shelf" value="read" checked> Read</label><label><input type="radio" name="ab-shelf" value="to-read"> To read</label><label><input type="radio" name="ab-shelf" value="reading"> Reading now</label></div>
      <div class="ab-row ab-stars">${[1, 2, 3, 4, 5].map((r) => `<button data-star="${r}" aria-label="${r} stars">★</button>`).join("")}<small>${many ? "rating for all of them (change any one later in ✎ mode)" : "your rating"}</small></div>
      <div class="ab-row">${genreSelect("ab-genre")}</div>${newGenreForm()}
      <button class="ab-save ab-commit">${many ? `Add ${picks.length} books` : "Add to my library"}</button>${many ? `<button class="ed-del ab-back">← Back to picking</button>` : ""}`;
    abform.dataset.r = "0"; delete abform.dataset.g;
  }
  abform.addEventListener("click", (e) => {
    const st = e.target.closest("[data-star]");
    if (st) { abform.dataset.r = st.dataset.star; abform.querySelectorAll("[data-star]").forEach((b) => b.classList.toggle("on", +b.dataset.star <= +st.dataset.star)); return; }
    if (e.target.closest(".ed-gadd")) { const g = createGenre(abform.querySelector(".ed-gname").value, abform.querySelector(".ed-gparent").value); if (g) { Store.save(ov); abform.dataset.g = g; abform.querySelector(".ed-new").hidden = true; abform.querySelector(".ab-genre").outerHTML = `<span class="chip">${esc(abform.querySelector(".ed-gname").value)}</span>`; } return; }
    if (e.target.closest(".ab-back")) { abform.hidden = true; renderResults(); renderBasket(); abq.focus(); return; }
    if (!e.target.closest(".ab-commit")) return;
    const shelf = abform.querySelector("[name=ab-shelf]:checked").value, sel = abform.querySelector(".ab-genre");
    const g = abform.dataset.g || (sel && sel.value && sel.value !== "__new" ? sel.value : null);
    let first = null;
    for (const pick of picks) {
      const id = "ol-" + pick.key.split("/").pop(); first = first || id;
      if (ov.books.some((b) => b.id === id)) continue;
      ov.books.push({ id, olKey: pick.key, title: pick.title, author: (pick.author_name || ["Unknown"])[0], year: pick.first_publish_year || null,
        pages: pick.number_of_pages_median || null, isbn13: (pick.isbn || []).find((x) => /^978[01]/.test(x)) || (pick.isbn || []).find((x) => x.length === 13) || null,
        cover: pick.cover_i ? `https://covers.openlibrary.org/b/id/${pick.cover_i}-L.jpg` : null,
        replaces: pick.have && !pick.have.mine ? pick.have.id : undefined, shelf, rating: shelf === "read" ? +abform.dataset.r || null : null, genres: g ? [g] : pick.have ? pick.have.genres || [] : [],
        dateRead: shelf === "read" ? new Date().toISOString().slice(0, 10) : null, added: new Date().toISOString(), pending: true });
    }
    const n = picks.length; picks = []; closeAdd(); commit(n === 1 ? first : null);
    if (n > 1) setTimeout(() => toast(`Added ${n} books`), 2700);
  });
  abform.addEventListener("change", (e) => { if (e.target.classList.contains("ab-genre") && e.target.value === "__new") { abform.querySelector(".ed-new").hidden = false; abform.querySelector(".ed-gname").focus(); } });

  // ---------- edit mode toggle in the dock ----------
  function setEditing(v) { editing = v && canEdit(); document.body.classList.toggle("editing", v); const b = document.querySelector("#b-edit"); if (b) b.classList.toggle("on", v); window.Library.refreshPanel(); window.Library.refreshLegend(); }
  function mountDock() {
    const dock = document.querySelector(".dock"); if (!dock || document.querySelector("#b-edit") || !canEdit()) return; // only for the library's owner
    const add = document.createElement("button"); add.id = "b-add"; add.dataset.edOpen = ""; add.title = "Add a book"; add.textContent = "＋ Book";
    const ed = document.createElement("button"); ed.id = "b-edit"; ed.title = "Edit mode"; ed.setAttribute("aria-label", "Edit mode"); ed.textContent = "✎";
    dock.insertBefore(ed, document.querySelector("#b-help")); dock.insertBefore(add, ed);
    ed.classList.toggle("on", editing); document.body.classList.toggle("editing", editing);
  }

  // ---------- account: sign in, switch library, sign out ----------
  const go = (lib) => { const p = new URLSearchParams(location.search); p.delete("edit"); lib ? p.set("lib", lib) : p.delete("lib"); const q = p.toString(); location.href = location.pathname + (q ? "?" + q : ""); };
  function mountAccount() {
    const dock = document.querySelector(".dock"); if (!dock || document.querySelector("#b-acct")) return;
    const b = document.createElement("button"); b.id = "b-acct"; const u = window.Cloud?.user;
    b.title = u ? "Account and libraries" : "Sign in"; b.textContent = u ? "◉ Account" : "Sign in";
    dock.insertBefore(b, document.querySelector("#b-help"));
    b.onclick = openAccount;
    if (sessionStorage.getItem("bl-welcome")) { sessionStorage.removeItem("bl-welcome"); setTimeout(() => toast("Welcome! Your email is confirmed."), 800); if (!ctx.isMine) window.Cloud.me().then((me) => me && go(me.slug)); }
    const linkErr = sessionStorage.getItem("bl-link-error"); if (linkErr) { sessionStorage.removeItem("bl-link-error"); setTimeout(() => toast("Link problem: " + linkErr), 800); }
    const owner = ctx.profile?.display_name || "Baron", h1 = document.querySelector(".brand h1");
    if (h1) h1.innerHTML = `${esc(owner)}'s <em>Library</em>`;
    document.title = `${owner}'s Library`;
  }
  const acct = document.createElement("div"); acct.id = "account"; acct.className = "modal"; acct.hidden = true; document.body.appendChild(acct);
  acct.addEventListener("click", (e) => { if (e.target === acct || e.target.closest(".ab-close")) acct.hidden = true; });
  function loginForm(signup) {
    const C = window.Cloud;
    acct.innerHTML = `<form class="card glass add-card login"><h2>${signup ? "Create your library" : "Sign in"}</h2>
      <p class="muted">${signup ? "Map your own reading: add books, build genres, and get picks. You'll stay signed in on this device." : "Sign in to edit your library. You'll stay signed in on this device."}</p>
      ${signup ? `<input name="name" placeholder="Your name (shown as “Name's Library”)" maxlength="40" autocomplete="given-name" required>` : ""}
      <input name="email" type="email" placeholder="Email" autocomplete="username" required>
      <input name="pw" type="password" placeholder="Password${signup ? " (at least 6 characters)" : ""}" minlength="${signup ? 6 : 1}" autocomplete="${signup ? "new-password" : "current-password"}" required>
      <p class="err" hidden></p><button class="ab-save" type="submit">${signup ? "Create account" : "Sign in"}</button>
      <p class="switch-auth">${signup ? `Already have an account? <a href="#" data-auth="in">Sign in</a>` : `New here? <a href="#" data-auth="up">Create an account</a>`}</p>
      <button class="ab-close" type="button" aria-label="Close">✕</button></form>`;
    const f = acct.querySelector("form"), btn = f.querySelector(".ab-save"), err = f.querySelector(".err");
    setTimeout(() => (signup ? f.name : f.email).focus(), 30);
    f.querySelector("[data-auth]").onclick = (e) => { e.preventDefault(); loginForm(!signup); };
    f.onsubmit = async (e) => {
      e.preventDefault(); err.hidden = true; btn.disabled = true; btn.textContent = signup ? "Creating…" : "Signing in…";
      try {
        if (signup) {
          const r = await C.signUp(f.name.value.trim(), f.email.value.trim(), f.pw.value);
          if (r === "confirm") { f.innerHTML = `<h2>Check your email</h2><p class="muted">We sent a confirmation link to <b>${esc(f.email.value)}</b>. Open it on this device and you'll land in your new library.</p><button class="ab-close" type="button" aria-label="Close">✕</button>`; return; }
        } else await C.signIn(f.email.value.trim(), f.pw.value);
        const me = await C.me(); go(me?.slug);
      } catch (x) {
        err.textContent = /invalid login/i.test(x.message) ? "Wrong email or password." : /already registered|exists/i.test(x.message) ? "That email already has an account. Sign in instead." : /not confirmed/i.test(x.message) ? "Please confirm your email first (check your inbox)." : x.message;
        err.hidden = false; btn.disabled = false; btn.textContent = signup ? "Create account" : "Sign in";
      }
    };
  }
  async function openAccount() {
    const C = window.Cloud; acct.hidden = false;
    if (!C.user) return loginForm(false);
    const ps = await C.profiles(), me = await C.me();
    acct.innerHTML = `<div class="card glass add-card"><h2>${esc(me?.display_name || C.user.email)}</h2><p class="muted">${esc(C.user.email)}</p>
      <h4>Libraries</h4><ul class="ab-res libs">${ps.map((p) => `<li data-lib="${esc(p.slug)}" class="${p.slug === ctx.slug ? "on" : ""}"><span><b>${esc(p.display_name)}'s Library</b><small>${p.id === me?.id ? "yours" : p.is_public ? "public" : "private"}</small></span></li>`).join("") || `<li class="muted">No libraries yet: run supabase/schema.sql and add profiles</li>`}</ul>
      ${me ? `<button class="ed-del req">Update my picks now</button>` : ""}
      ${me ? `<button class="ed-del vis">${me.is_public ? "Make my map private" : "Make my map public"}</button>` : ""}
      <button class="ed-del out">Sign out</button><button class="ab-close" aria-label="Close">✕</button></div>`;
    acct.querySelector(".libs").onclick = (e) => { const li = e.target.closest("[data-lib]"); if (li) go(li.dataset.lib); };
    acct.querySelector(".out").onclick = async () => { await C.signOut(); go(null); };
    const vis = acct.querySelector(".vis");
    if (vis) vis.onclick = async () => { try { await C.setPublic(!me.is_public); toast(me.is_public ? "Your map is now private" : "Your map is now public"); acct.hidden = true; } catch (x) { toast("Couldn't change: " + x.message); } };
    const rq = acct.querySelector(".req");
    if (rq) rq.onclick = async () => { try { await C.requestRefresh(); rq.textContent = "Requested: Claude picks it up on the next run"; } catch (x) { rq.textContent = /duplicate|unique|409/i.test(x.message) ? "Already requested" : /row-level|policy|403/i.test(x.message) ? "Picks from Claude are invite-only for now: ask Baron" : "Couldn't request: " + x.message; } rq.disabled = true; };
  }

  window.LibraryEdits = { loadData, apply(d) { pristine = structuredClone(d); apply(d); mountDock(); mountAccount(); }, panelExtra, rateHTML, legendExtra, get editing() { return editing; }, get canAdd() { return canEdit(); }, openAdd };
})();
