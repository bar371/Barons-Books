/* Baron's Library: Supabase connection (sign-in, libraries, saved edits), using its REST API directly
   so the page stays light. The publishable key below is meant to be public: row-level security in
   supabase/schema.sql decides who may read or write what. */
(() => {
  const URL_ = "https://vimynskvwneemuqplujf.supabase.co";
  const KEY = "sb_publishable_TBQcptpeWuANbjitnKqjRw_kpcI2nln";
  const SKEY = "bl-session";
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };

  let session = null;
  try { session = JSON.parse(ls.get(SKEY) || "null"); } catch {}
  const keep = (s) => {
    session = s && { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), user: { id: s.user.id, email: s.user.email } };
    ls.set(SKEY, session ? JSON.stringify(session) : null);
  };

  async function call(path, opts = {}, ms = 6000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(URL_ + path, { ...opts, signal: ctl.signal, headers: { apikey: KEY, "Content-Type": "application/json", ...(opts.headers || {}) } });
      const body = r.status === 204 ? null : await r.json().catch(() => null);
      if (!r.ok) throw Object.assign(new Error(body?.msg || body?.message || body?.error_description || `HTTP ${r.status}`), { status: r.status, body });
      return body;
    } finally { clearTimeout(t); }
  }
  // tokens last an hour; the refresh token keeps you signed in on this device until you sign out
  async function token() {
    if (!session) return null;
    if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
    try { keep(await call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: session.refresh_token }) })); }
    catch (e) { if (e.status === 400 || e.status === 401) keep(null); return null; }
    return session?.access_token || null;
  }
  async function rest(path, opts = {}) {
    const t = await token();
    return call("/rest/v1" + path, { ...opts, headers: { ...(t ? { Authorization: "Bearer " + t } : {}), ...(opts.headers || {}) } });
  }

  let profiles = null, ok = true;
  async function loadProfiles() {
    if (profiles) return profiles;
    try { profiles = await rest("/profiles?select=id,slug,display_name,is_public&order=created_at"); }
    catch (e) { ok = false; profiles = []; console.warn("Supabase not ready:", e.message); }
    return profiles;
  }

  window.Cloud = {
    get user() { return session?.user || null; },
    get ok() { return ok; },
    async signIn(email, password) {
      keep(await call("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) }));
      profiles = null; return session.user;
    },
    async signOut() {
      const t = session?.access_token;
      keep(null); profiles = null;
      if (t) call("/auth/v1/logout", { method: "POST", headers: { Authorization: "Bearer " + t } }).catch(() => {});
    },
    profiles: loadProfiles,
    async me() { const ps = await loadProfiles(); return session ? ps.find((p) => p.id === session.user.id) || null : null; },
    // which library to show: ?lib=slug, else your own once signed in, else Baron's
    async resolve() {
      const ps = await loadProfiles(), want = new URLSearchParams(location.search).get("lib");
      const mine = session ? ps.find((p) => p.id === session.user.id) : null;
      const prof = (want && ps.find((p) => p.slug === want)) || mine || ps.find((p) => p.slug === "baron") || null;
      return { slug: prof?.slug || want || "baron", profile: prof, isMine: !!(prof && mine && prof.id === mine.id), ok };
    },
    async loadEdits(userId) {
      try { const rows = await rest(`/edits?user_id=eq.${encodeURIComponent(userId)}&select=data,updated_at`); return rows?.[0]?.data || null; }
      catch (e) { console.warn("edits not loaded:", e.message); return null; }
    },
    async saveEdits(data) {
      if (!session) throw new Error("Not signed in");
      await rest("/edits?on_conflict=user_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_id: session.user.id, data, updated_at: new Date().toISOString() }) });
    },
    async requestRefresh(note) {
      if (!session) throw new Error("Not signed in");
      await rest("/refresh_requests", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: session.user.id, note: note || null }) });
    },
  };
})();
