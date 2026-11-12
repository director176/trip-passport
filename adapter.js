/* Trip Passport — standalone data layer.
   Gives the app the same `claude.use("db" | "user")` interface it had inside Claude,
   backed by Supabase, with an on-phone cache so it opens and works offline. */
(function () {
  const CFG = window.TRIP_CFG || {};
  const LS_CACHE = "tp-cache-v1", LS_WHO = "tp-who-v1";
  const $ = (id) => document.getElementById(id);
  let sb = null;
  try { sb = supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "tp-auth" } }); } catch (e) { console.error(e); }

  /* ---------------- local cache ---------------- */
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(LS_CACHE) || "{}") || {}; } catch { cache = {}; }
  const saveCache = () => { try { localStorage.setItem(LS_CACHE, JSON.stringify(cache)); } catch {} };
  let loaded = false;
  const subs = new Set();
  const segs = (p) => p.split("/");
  const inColl = (p, c) => p.startsWith(c + "/") && segs(p).length === segs(c).length + 1;
  const mk = (p) => { const d = cache[p]; return { id: segs(p).pop(), exists: d !== undefined, data: () => d, metadata: { fromCache: !loaded, hasPendingWrites: false } }; };
  const collSnap = (c, changes) => {
    const docs = Object.keys(cache).filter((p) => inColl(p, c)).sort().map(mk);
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => changes || [], metadata: { fromCache: !loaded, hasPendingWrites: false } };
  };
  function emitAll() { for (const s of subs) { try { s.kind === "doc" ? s.cb(mk(s.key)) : s.cb(collSnap(s.key, [])); } catch (e) { console.error(e); } } }
  function emit(path, type) {
    for (const s of subs) {
      try {
        if (s.kind === "doc" && s.key === path) s.cb(mk(path));
        else if (s.kind === "coll" && inColl(path, s.key)) s.cb(collSnap(s.key, [{ type, doc: mk(path) }]));
      } catch (e) { console.error(e); }
    }
  }
  const errOf = (error) => {
    const m = String((error && (error.message || error.code)) || "");
    if (/permission|row-level|42501|JWT|not authorized/i.test(m)) return { code: "invalid_argument", message: m };
    return { code: "unavailable", message: m || "offline" };
  };

  async function loadAll() {
    if (!sb) return;
    const { data, error } = await sb.from("docs").select("path,data");
    if (error) throw errOf(error);
    const n = {}; (data || []).forEach((r) => { n[r.path] = r.data; });
    cache = n; loaded = true; saveCache(); emitAll();
  }
  let rtStarted = false;
  function startRealtime() {
    if (rtStarted || !sb) return; rtStarted = true;
    sb.channel("docs-live").on("postgres_changes", { event: "*", schema: "public", table: "docs" }, (p) => {
      if (p.eventType === "DELETE") { const path = p.old && p.old.path; if (!path) return; const had = path in cache; delete cache[path]; saveCache(); if (had) emit(path, "removed"); }
      else { const r = p.new; if (!r || !r.path) return; const added = !(r.path in cache); cache[r.path] = r.data; saveCache(); emit(r.path, added ? "added" : "modified"); }
    }).subscribe();
  }
  async function sync() { try { await loadAll(); startRealtime(); } catch (e) { /* offline: keep cache */ } }
  addEventListener("online", sync);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && navigator.onLine !== false) sync(); });

  async function put(path, data) {
    const prev = cache[path]; cache[path] = data; saveCache(); emit(path, prev === undefined ? "added" : "modified");
    if (!sb) throw { code: "unavailable", message: "not configured" };
    const { error } = await sb.from("docs").upsert({ path, coll: segs(path)[0], data, updated_at: new Date().toISOString() });
    if (error) throw errOf(error);
  }
  async function del(path) {
    const had = path in cache; delete cache[path]; saveCache(); if (had) emit(path, "removed");
    if (!sb) throw { code: "unavailable", message: "not configured" };
    const { error } = await sb.from("docs").delete().eq("path", path);
    if (error) throw errOf(error);
  }
  const docRef = (path) => ({
    id: segs(path).pop(), path,
    get: async () => mk(path),
    set: (d) => put(path, JSON.parse(JSON.stringify(d))),
    update: (d) => put(path, Object.assign({}, cache[path] || {}, JSON.parse(JSON.stringify(d)))),
    delete: () => del(path),
    onSnapshot(cb) { const s = { kind: "doc", key: path, cb }; subs.add(s); setTimeout(() => { if (subs.has(s)) cb(mk(path)); }, 0); return () => subs.delete(s); },
    collection: (c) => collRef(path + "/" + c),
  });
  const collRef = (c) => ({
    path: c,
    doc: (id) => docRef(c + "/" + (id || Date.now().toString(36) + Math.random().toString(36).slice(2, 8))),
    add: async (d) => { const r = docRef(c + "/" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); await r.set(d); return r; },
    get: async () => collSnap(c, []),
    onSnapshot(cb) { const s = { kind: "coll", key: c, cb }; subs.add(s); setTimeout(() => { if (subs.has(s)) cb(collSnap(c, [])); }, 0); return () => subs.delete(s); },
    where() { return this; }, orderBy() { return this; }, limit() { return this; },
  });
  const DB = { doc: docRef, collection: collRef };

  /* ---------------- who is signed in ---------------- */
  let WHO = null; // {id,email,name}
  try { WHO = JSON.parse(localStorage.getItem(LS_WHO) || "null"); } catch {}
  const saveWho = () => { try { localStorage.setItem(LS_WHO, JSON.stringify(WHO)); } catch {} };
  const initials = (n) => (n || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const avatar = (n) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#22305a"/><text x="20" y="26" font-size="15" font-family="Georgia,serif" font-weight="700" text-anchor="middle" fill="#e3c27a">${initials(n).replace(/[<&>]/g, "")}</text></svg>`);
  const nameOf = (id) => { const p = cache["settings/people"]; return (p && p.names && typeof p.names[id] === "string" && p.names[id]) || (WHO && id === WHO.id ? WHO.name || "" : ""); };
  const USER = {
    id: async () => (WHO ? WHO.id : null),
    isOwner: async () => !!(WHO && CFG.ownerEmail && WHO.email && WHO.email.toLowerCase() === CFG.ownerEmail.toLowerCase()),
    canEdit: async () => !!WHO, can: async () => !!WHO,
    name: async () => (WHO && nameOf(WHO.id)) || "",
    me: async () => ({ id: WHO ? WHO.id : null, name: WHO ? nameOf(WHO.id) : "", avatarUrl: avatar(WHO ? nameOf(WHO.id) : ""), color: "#22305a", email: WHO ? WHO.email : null, isOwner: await USER.isOwner(), canEdit: !!WHO }),
    profiles: async (ids) => { const o = {}; [].concat(ids || []).forEach((i) => { const n = nameOf(i); o[i] = { id: i, name: n, avatarUrl: avatar(n), color: "#22305a", email: null, isMe: !!(WHO && i === WHO.id), guest: false }; }); return o; },
    search: async () => [],
  };
  async function rememberName() {
    if (!WHO || !WHO.name) return;
    const cur = cache["settings/people"] || { names: {} };
    if (cur.names && cur.names[WHO.id] === WHO.name) return;
    try { await put("settings/people", { names: Object.assign({}, cur.names || {}, { [WHO.id]: WHO.name }) }); } catch {}
  }

  /* ---------------- sign-in (passport styled) ---------------- */
  let readyResolve; const ready = new Promise((r) => (readyResolve = r));
  function finish(user, name) {
    WHO = { id: user.id, email: user.email || "", name: name || (WHO && WHO.id === user.id ? WHO.name : "") || (user.user_metadata && user.user_metadata.name) || "" };
    saveWho(); const g = $("gate"); if (g) g.remove(); readyResolve(true);
    sync().then(rememberName);
  }
  function showGate() {
    const g = $("gate"); if (!g) return; g.classList.add("on");
    let mode = "in";
    const draw = () => {
      $("gName").parentElement.style.display = mode === "up" ? "" : "none";
      $("gGo").textContent = mode === "up" ? "Create my passport" : "Open passport";
      $("gSwap").textContent = mode === "up" ? "Already have one? Sign in" : "First time here? Create your passport";
      $("gErr").textContent = "";
    };
    draw();
    $("gSwap").onclick = () => { mode = mode === "up" ? "in" : "up"; draw(); };
    $("gForm").onsubmit = async (e) => {
      e.preventDefault();
      const email = $("gEmail").value.trim(), pw = $("gPw").value, name = $("gName").value.trim();
      if (!email || pw.length < 6) { $("gErr").textContent = "Enter your email and a password of at least 6 characters."; return; }
      if (mode === "up" && !name) { $("gErr").textContent = "Add your name for the passport."; return; }
      $("gGo").disabled = true; $("gErr").textContent = "";
      try {
        if (mode === "up") {
          const { data, error } = await sb.auth.signUp({ email, password: pw, options: { data: { name } } });
          if (error) throw error;
          if (!data.session) { $("gErr").textContent = "Account created. Turn off “Confirm email” in Supabase (see the setup steps), then sign in."; mode = "in"; draw(); return; }
          finish(data.user, name);
        } else {
          const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
          if (error) throw error;
          finish(data.user, (data.user.user_metadata && data.user.user_metadata.name) || "");
        }
      } catch (err) {
        $("gErr").textContent = navigator.onLine === false ? "You're offline. Connect once to sign in; after that it works offline." : (err && err.message) || "Couldn't sign in.";
      } finally { const gb = $("gGo"); if (gb) gb.disabled = false; }
    };
  }
  const domReady = new Promise((r) => (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", r, { once: true }) : r()));
  (async function boot() {
    await domReady;
    if (!sb || !CFG.url || !CFG.key || /YOUR_/.test(CFG.url + CFG.key)) { const g = $("gate"); if (g) { g.classList.add("on"); $("gForm").innerHTML = '<p class="gnote">Almost there — this copy isn’t connected to its database yet.</p>'; } return; }
    try {
      const { data } = await sb.auth.getSession();
      if (data && data.session && data.session.user) { finish(data.session.user); return; }
    } catch {}
    if (WHO && navigator.onLine === false) { const g = $("gate"); if (g) g.remove(); readyResolve(true); return; } // offline: trust last sign-in, use cached data
    showGate();
  })();

  window.claude = {
    use: async (name) => {
      if (name === "db") { await ready; return DB; }
      if (name === "user") { await ready; return USER; }
      return null; // room / sample / tts are Claude-only
    },
  };
  window.TP_SIGN_OUT = async () => { try { await sb.auth.signOut(); } catch {} try { localStorage.removeItem(LS_WHO); localStorage.removeItem(LS_CACHE); } catch {} location.reload(); };
})();
