(function () {
  "use strict";
  /* ================================================================
     Séville · guide collaboratif
     ================================================================ */
  const byId = Object.fromEntries(PLACES.map(p => [p.id, p]));
  const DAY_KEYS = DAYS.map(d => d.key);
  const DAY_DATE = { mer: "2026-09-30", jeu: "2026-10-01", ven: "2026-10-02", sam: "2026-10-03" };
  const DATE_DAY = Object.fromEntries(Object.entries(DAY_DATE).map(([k, v]) => [v, k]));
  const EMOJIS = ["👍", "❤️", "😋", "🤔", "👎"];
  const $ = s => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const walkTo = p => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking`;
  const dayLabel = k => (DAYS.find(d => d.key === k) || {}).label || "";
  const dayName = k => ((DAYS.find(d => d.key === k) || {}).title || "").split(" — ")[0];
  const cap = s => { s = String(s || "").trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };
  const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();
  const euro = n => (Math.round(n * 100) / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

  /* ---------- Heure de Séville ---------- */
  function madridNow() {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" })
      .formatToParts(new Date()).map(x => [x.type, x.value]));
    const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
    return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute, wd };
  }

  /* ---------- Session ---------- */
  let me = store.get("sev-me", null);
  let state = me ? store.get("sev-state", null) : null;
  let currentDay = 0;
  const openThreads = new Set();
  const thumbs = store.get("sev-thumbs", {});
  let online = navigator.onLine;

  const hashCode = new URLSearchParams(location.hash.slice(1)).get("code");
  if (hashCode) { $("#loginCode").value = hashCode; history.replaceState(null, "", location.pathname); }

  function setOnline(v) { online = v; $("#offline").hidden = v; }
  window.addEventListener("online", () => { setOnline(true); refresh(true); });
  window.addEventListener("offline", () => setOnline(false));
  setOnline(navigator.onLine);

  async function rpc(fn, args) {
    let r;
    try {
      r = await fetch(`${BACKEND.url}/rest/v1/rpc/${fn}`, {
        method: "POST", headers: { apikey: BACKEND.key, "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ p_code: me && me.code }, args || {}))
      });
    } catch (e) { setOnline(false); throw new Error("Pas de réseau — réessayez plus tard."); }
    setOnline(true);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      if (/code invalide/.test(e.message || "")) { logout(); throw new Error("Code de groupe invalide."); }
      throw new Error(e.message || `Erreur ${r.status}`);
    }
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }

  function toast(msg, ms) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms || 2600);
  }

  const PALETTE = ["#b5452b", "#1f5f8b", "#2f7d4f", "#6b4fa3", "#7a2e52", "#b07a12"];
  function colorOf(name) { let h = 0; for (const c of String(name).toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
  const avatar = (n, sm) => `<span class="avatar ${sm ? "sm" : ""}" style="background:${colorOf(n)}">${esc(String(n || "?")[0].toUpperCase())}</span>`;

  function renderWho() {
    const who = $("#who");
    if (me) {
      who.innerHTML = `${avatar(me.name)}<span>Connecté·e : <strong>${esc(me.name)}</strong></span> <button class="link" id="logout">changer</button>`;
      $("#logout").onclick = logout; $("#login").hidden = true;
    } else { who.innerHTML = ""; $("#login").hidden = false; }
  }

  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const name = cap($("#loginName").value.replace(/\s+/g, " ").slice(0, 30));
    const code = $("#loginCode").value.trim();
    if (!name || !code) return;
    me = { name, code };
    try { await rpc("guide_check"); store.set("sev-me", me); renderWho(); await refresh(); toast(`¡Hola ${me.name}! 👋`); }
    catch (err) { me = null; toast(err.message); }
  });
  function logout() { me = null; state = null; store.del("sev-me"); store.del("sev-state"); renderWho(); renderAll(); }

  const dlg = $("#editor");
  async function refresh(silent) {
    if (!me) return;
    try {
      const next = await rpc("guide_state");
      state = next; store.set("sev-state", next);
      const a = document.activeElement;
      const typing = a && a.closest && a.closest(".c-form, form, .neb-search, .place-filters");
      const modal = [...document.querySelectorAll("dialog")].some(d => d.open);
      if (!(silent && (typing || modal))) renderAll();
      $("#syncInfo").textContent = "Synchronisé à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    } catch (err) {
      if (!silent) toast(err.message);
      $("#syncInfo").textContent = "Hors ligne — dernière version enregistrée";
    }
  }
  setInterval(() => { if (me && document.visibilityState === "visible") refresh(true); }, 20000);
  setInterval(() => renderNow(), 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(true); });

  /* ---------- Helpers état ---------- */
  const S = k => (state && state[k]) || [];
  const commentsFor = t => S("comments").filter(c => c.target === t);
  const reactionsFor = t => S("reactions").filter(r => r.target === t);
  const photosFor = t => S("photos").filter(p => p.target === t);
  function members() {
    const set = new Map();
    const add = n => { n = cap(n); if (n && n !== "Guide" && !/\(restauration\)/.test(n)) set.set(n.toLowerCase(), n); };
    if (me) add(me.name);
    S("proposals").forEach(p => { add(p.author); add(p.updated_by); });
    S("comments").forEach(c => add(c.author)); S("reactions").forEach(r => add(r.author));
    S("expenses").forEach(e => { add(e.payer); (e.shared_with || []).forEach(add); });
    return [...set.values()].sort((a, b) => a.localeCompare(b));
  }
  function timeKey(label) {
    const s = String(label || "").toLowerCase();
    const m = s.match(/(\d{1,2})\s*[h:]\s*(\d{2})?/);
    if (m) { let h = +m[1]; if (h < 6) h += 24; return h * 60 + (+m[2] || 0); }
    const words = { matin: 540, midi: 780, "après-midi": 960, soir: 1200, arrivée: 1290, nuit: 1380, minuit: 1440, tard: 1500 };
    for (const [w, v] of Object.entries(words)) if (s.includes(w)) return v;
    return 2000;
  }
  function ago(iso) {
    const d = (Date.now() - new Date(iso)) / 1000;
    if (d < 60) return "à l’instant";
    if (d < 3600) return `il y a ${Math.floor(d / 60)} min`;
    if (d < 86400) return `il y a ${Math.floor(d / 3600)} h`;
    return new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  }

  /* ---------- Votes → statut ---------- */
  function voteStatus(id) {
    const rs = reactionsFor(id);
    const up = rs.filter(r => r.emoji === "👍").length, down = rs.filter(r => r.emoji === "👎").length;
    if (up >= 3 && up > down) return { s: "ok", label: `✅ Validé (${up} 👍)`, up, down };
    if (down >= 2 && down > up) return { s: "ko", label: `❌ Écarté (${down} 👎)`, up, down };
    return { s: "", label: "", up, down };
  }

  /* ---------- Horaires : ouvert maintenant ---------- */
  function openInfo(p) {
    if (!p.hours) return null;
    const n = madridNow(), toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const today = p.hours.filter(h => h.d.includes(n.wd));
    for (const h of today) if (n.min >= toMin(h.o) && n.min < toMin(h.c)) return { open: true, txt: `🟢 Ouvert · ferme à ${h.c === "24:00" ? "minuit" : h.c.replace(":", "h")}` };
    const later = today.filter(h => toMin(h.o) > n.min).sort((a, b) => toMin(a.o) - toMin(b.o))[0];
    if (later) return { open: false, txt: `⚪ Fermé · ouvre à ${later.o.replace(":", "h")}` };
    return { open: false, txt: "⚪ Fermé aujourd’hui" };
  }
  const openBadge = p => { const o = openInfo(p); return o ? `<span class="badge ${o.open ? "open" : "closed"}" title="Horaires vérifiés">${o.txt}</span>` : ""; };

  /* ---------- Géolocalisation ---------- */
  let myPos = null;
  function locateMe() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error("Géolocalisation indisponible."));
      navigator.geolocation.getCurrentPosition(p => { myPos = [p.coords.latitude, p.coords.longitude]; res(myPos); },
        () => rej(new Error("Position non disponible (autorisez la localisation).")), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    });
  }
  function distKm(a, b) {
    const R = 6371, r = x => x * Math.PI / 180, dLat = r(b[0] - a[0]), dLng = r(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const walkMin = km => Math.max(1, Math.round(km * 1.3 / 4.5 * 60)); // ruelles ≈ ×1,3 ; 4,5 km/h

  /* ---------- Météo (Open-Meteo, sans clé) ---------- */
  let weather = store.get("sev-weather", null);
  const WCODE = c => c === 0 ? "☀️" : c <= 2 ? "🌤" : c === 3 ? "☁️" : c <= 48 ? "🌫" : c <= 67 ? "🌧" : c <= 77 ? "🌨" : c <= 82 ? "🌦" : "⛈";
  async function loadWeather() {
    if (weather && Date.now() - weather.at < 3 * 3600e3) return;
    try {
      const u = "https://api.open-meteo.com/v1/forecast?latitude=37.389&longitude=-5.984&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Europe%2FMadrid&start_date=2026-09-30&end_date=2026-10-03";
      const j = await (await fetch(u)).json();
      if (!j.daily) return;
      const w = {};
      j.daily.time.forEach((t, i) => { w[t] = { code: j.daily.weather_code[i], max: Math.round(j.daily.temperature_2m_max[i]), min: Math.round(j.daily.temperature_2m_min[i]), rain: j.daily.precipitation_probability_max[i] }; });
      weather = { at: Date.now(), days: w }; store.set("sev-weather", weather);
      renderDay(); renderNow();
    } catch (e) {}
  }
  function weatherHtml(key, full) {
    const w = weather && weather.days && weather.days[DAY_DATE[key]];
    if (!w) return full ? `<div class="weather muted small">Météo : quelques jours avant.</div>` : "";
    const alerts = [];
    if (w.max >= 32) alerts.push("🥵 Forte chaleur : visites le matin, siesta, eau.");
    if (w.rain >= 50) alerts.push("☔ Pluie probable : voir les plans B du jour.");
    return `<div class="weather"><span class="w-ico">${WCODE(w.code)}</span><b>${w.max}°</b> / ${w.min}° · 💧${w.rain ?? 0} %
      ${full && alerts.length ? `<div class="w-alert">${alerts.join("<br>")}</div>` : ""}</div>`;
  }

  /* ================================================================
     Composants sociaux : réactions, commentaires, photos
     ================================================================ */
  function reactionBar(target, opts) {
    const rs = reactionsFor(target);
    return `<div class="reacts" data-target="${esc(target)}">${EMOJIS.map(e => {
      const who = rs.filter(r => r.emoji === e).map(r => r.author);
      const mine = me && who.some(a => same(a, me.name));
      return `<button class="react ${mine ? "mine" : ""} ${who.length ? "" : "zero"}" data-emoji="${e}" title="${esc(who.join(", ") || "Réagir")}">${e}${who.length ? ` <b>${who.length}</b>` : ""}</button>`;
    }).join("")}
      <button class="react talk" data-thread="${esc(target)}">💬 ${commentsFor(target).length || ""}</button>
      ${opts && opts.noPhoto ? "" : `<button class="react cam" data-photo="${esc(target)}" title="Ajouter une photo">📷 ${photosFor(target).length || ""}</button>`}</div>`;
  }
  function photoStrip(target) {
    const ps = photosFor(target);
    if (!ps.length) return "";
    return `<div class="strip">${ps.map(p => `<button class="thumb" data-photo-id="${p.id}" title="${esc(p.author + (p.caption ? " — " + p.caption : ""))}">
      ${thumbs[p.id] ? `<img src="${thumbs[p.id]}" alt="">` : `<span class="ph"></span>`}</button>`).join("")}</div>`;
  }
  function thread(target) {
    const cs = commentsFor(target);
    return `<div class="thread" data-target="${esc(target)}" ${openThreads.has(target) ? "" : "hidden"}>
      ${cs.map(c => `<div class="msg">${avatar(c.author, true)}
        <div><div class="meta"><strong>${esc(c.author)}</strong> · ${ago(c.created_at)}
        ${me && same(c.author, me.name) ? `<button class="link del-c" data-id="${c.id}">supprimer</button>` : ""}</div>
        <div class="body">${esc(c.body)}</div></div></div>`).join("") || `<p class="muted small">Pas encore de commentaire.</p>`}
      <form class="c-form"><input name="body" maxlength="1000" placeholder="Votre avis, une idée…" autocomplete="off" required>
        <button class="btn sm">Envoyer</button></form></div>`;
  }
  const socialBlock = (target, opts) => me ? reactionBar(target, opts) + photoStrip(target) + thread(target) : "";

  /* ---------- Photos : envoi ---------- */
  let photoTarget = null;
  function resize(file, max, q) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        res(c.toDataURL("image/jpeg", q));
      };
      img.onerror = () => rej(new Error("Image illisible (format HEIC ? essayez une capture d’écran ou un JPEG).")); img.src = url;
    });
  }
  $("#photoInput").addEventListener("change", async e => {
    const files = [...e.target.files]; e.target.value = "";
    if (!files.length || !photoTarget || !me) return;
    const caption = files.length === 1 ? (prompt("Légende (facultatif) :") || "") : "";
    let n = 0;
    for (const f of files) {
      try {
        toast(`Envoi photo ${++n}/${files.length}…`, 20000);
        let full = await resize(f, 1600, 0.78);
        if (full.length > 690000) full = await resize(f, 1200, 0.7);
        const th = await resize(f, 360, 0.7);
        const id = await rpc("guide_add_photo", { p_author: me.name, p_target: photoTarget, p_caption: caption, p_thumb: th, p_full: full });
        thumbs[id] = th;
      } catch (err) { toast(err.message, 4000); return; }
    }
    toast(files.length > 1 ? `${files.length} photos ajoutées 📸` : "Photo ajoutée 📸"); await refresh(); saveThumbs();
  });
  function saveThumbs() {
    const ids = S("photos").map(p => p.id).slice(-150), keep = {};
    ids.forEach(i => { if (thumbs[i]) keep[i] = thumbs[i]; });
    store.set("sev-thumbs", keep);
  }
  let loadingThumbs = false;
  async function loadThumbs() {
    if (!me || loadingThumbs || !online) return;
    const missing = S("photos").map(p => p.id).filter(i => !thumbs[i]);
    if (!missing.length) return;
    loadingThumbs = true;
    try {
      for (let i = 0; i < missing.length; i += 20) Object.assign(thumbs, await rpc("guide_photo_thumbs", { p_ids: missing.slice(i, i + 20) }));
      saveThumbs();
      document.querySelectorAll("[data-photo-id]").forEach(b => { const t = thumbs[b.dataset.photoId]; if (t && !b.querySelector("img")) b.insertAdjacentHTML("afterbegin", `<img src="${t}" alt="">`); b.querySelector(".ph") && t && b.querySelector(".ph").remove(); });
    } catch (e) {} finally { loadingThumbs = false; }
  }
  async function openPhoto(id) {
    const p = S("photos").find(x => x.id === id); if (!p) return;
    const d = $("#photoDlg");
    $("#photoFull").src = thumbs[id] || ""; $("#photoCap").textContent = `${p.author} · ${ago(p.created_at)}${p.caption ? " — " + p.caption : ""}`;
    $("#photoDel").hidden = !(me && same(p.author, me.name));
    $("#photoDel").onclick = async () => {
      if (!confirm("Supprimer cette photo ?")) return;
      try { await rpc("guide_delete_photo", { p_author: me.name, p_id: id }); d.close(); await refresh(); } catch (err) { toast(err.message); }
    };
    d.dataset.current = id; $("#photoReacts").innerHTML = `<div class="social">${reactionBar("photo:" + id, { noPhoto: true })}${thread("photo:" + id)}</div>`;
    d.showModal();
    try { const full = await rpc("guide_photo_full", { p_id: id }); if (full) $("#photoFull").src = full; } catch (e) {}
  }
  $("#photoClose").onclick = () => $("#photoDlg").close();

  /* ---------- Délégation d’événements ---------- */
  document.addEventListener("click", async e => {
    const t = e.target;
    const r = t.closest(".react[data-emoji]");
    if (r) {
      if (!me) return;
      try { await rpc("guide_toggle_reaction", { p_author: me.name, p_target: r.parentElement.dataset.target, p_emoji: r.dataset.emoji }); await refresh(); } catch (err) { toast(err.message); }
      return;
    }
    const th = t.closest(".react[data-thread]");
    if (th) {
      const target = th.dataset.thread;
      openThreads.has(target) ? openThreads.delete(target) : openThreads.add(target);
      const box = th.closest(".social").querySelector(".thread");
      if (box) { box.hidden = !openThreads.has(target); if (!box.hidden) box.querySelector("input").focus(); }
      return;
    }
    const cam = t.closest("[data-photo]"); if (cam) { if (!me) return; photoTarget = cam.dataset.photo; $("#photoInput").click(); return; }
    const pid = t.closest("[data-photo-id]"); if (pid) { openPhoto(pid.dataset.photoId); return; }
    const dc = t.closest(".del-c");
    if (dc) { if (!confirm("Supprimer ce commentaire ?")) return; try { await rpc("guide_delete_comment", { p_author: me.name, p_id: dc.dataset.id }); await refresh(); } catch (err) { toast(err.message); } return; }
    const ed = t.closest("[data-edit]"); if (ed) { openEditor(ed.dataset.edit); return; }
    const add = t.closest("[data-add]"); if (add) { openEditor(null, add.dataset.add); return; }
    const sm = t.closest("[data-map]"); if (sm) { showOnMap(sm.dataset.map); return; }
    const route = t.closest("[data-route]"); if (route) { routeSel.value = route.dataset.route; drawRoute(); go("carte"); return; }
    const exp = t.closest("[data-expand]"); if (exp) { exp.closest("li").classList.remove("collapsed"); return; }
    const bk = t.closest("[data-book]"); if (bk) { openBooking(bk.dataset.book === "new" ? null : bk.dataset.book); return; }
    const dx = t.closest("[data-del-exp]"); if (dx) { if (!confirm("Supprimer cette dépense ?")) return; try { await rpc("guide_delete_expense", { p_author: me.name, p_id: dx.dataset.delExp }); await refresh(); } catch (err) { toast(err.message); } return; }
    const neb = t.closest("[data-neb]"); if (neb) { showNeb(neb.dataset.neb); return; }
    if (t.closest("#histBtn")) { openHistory(); return; }
    if (t.closest(".print-btn")) { printCarnet(); return; }
    if (t.closest("#nowLocate")) { try { await locateMe(); renderNow(); } catch (err) { toast(err.message); } return; }
  });
  document.addEventListener("submit", async e => {
    const f = e.target.closest(".c-form"); if (!f) return;
    e.preventDefault();
    const target = f.closest(".thread").dataset.target, body = f.body.value.trim(); if (!body) return;
    f.querySelector("button").disabled = true;
    try { await rpc("guide_add_comment", { p_author: me.name, p_target: target, p_body: body }); openThreads.add(target); await refresh(); }
    catch (err) { toast(err.message); f.querySelector("button").disabled = false; }
  });

  /* ================================================================
     Éditeur de propositions + historique
     ================================================================ */
  const ef = $("#editForm");
  const placeOptions = `<option value="">— aucun lieu —</option>` + Object.entries(CATEGORIES).map(([k, c]) => `<optgroup label="${esc(c.label)}">${PLACES.filter(p => p.cat === k).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</optgroup>`).join("");
  const dayOptions = DAYS.map(d => `<option value="${d.key}">${esc(dayName(d.key))}</option>`).join("");
  ef.place.innerHTML = placeOptions; ef.day.innerHTML = dayOptions;
  function openEditor(id, day) {
    const p = id && S("proposals").find(x => x.id === id);
    $("#editTitle").textContent = p ? "Modifier la proposition" : "Nouvelle proposition";
    ef.id.value = p ? p.id : ""; ef.day.value = p ? p.day : (day || DAY_KEYS[currentDay]);
    ef.time.value = p ? p.time_label : ""; ef.body.value = p ? p.body : ""; ef.tip.value = p ? (p.tip || "") : ""; ef.place.value = p ? (p.place_id || "") : "";
    $("#delProp").hidden = !p;
    $("#editInfo").innerHTML = p ? `Créée par <b>${esc(p.author === "Guide" ? "Assistant" : p.author)}</b>${p.updated_by ? ` · modifiée par <b>${esc(p.updated_by === "Guide" ? "Assistant" : p.updated_by)}</b> ${ago(p.updated_at)}` : ""} · <button type="button" class="link" data-hist="${p.id}">voir l’historique</button>` : "Votre prénom sera enregistré dans le journal.";
    dlg.showModal();
  }
  $("#cancelEdit").onclick = () => dlg.close();
  $("#delProp").onclick = async () => {
    if (!confirm("Supprimer cette proposition ? (restaurable depuis l’historique)")) return;
    try { await rpc("guide_delete_proposal", { p_author: me.name, p_id: ef.id.value }); dlg.close(); await refresh(); toast("Supprimée — restaurable via 🕘 Historique"); } catch (err) { toast(err.message); }
  };
  ef.addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await rpc("guide_save_proposal", { p_author: me.name, p_id: ef.id.value || null, p_day: ef.day.value, p_time: ef.time.value, p_body: ef.body.value, p_tip: ef.tip.value, p_place: ef.place.value });
      currentDay = DAY_KEYS.indexOf(ef.day.value); dlg.close(); await refresh(); toast("Enregistré ✔");
    } catch (err) { toast(err.message); }
  });
  async function openHistory() {
    const d = $("#histDlg"), box = $("#histList");
    box.innerHTML = `<p class="muted">Chargement…</p>`; d.showModal();
    try {
      const h = (await rpc("guide_history")).filter(x => x.by_name && x.by_name !== "Guide");
      box.innerHTML = h.length ? `<ul class="hist">${h.map(x => `<li><div>${avatar(x.by_name, true)} <strong>${esc(x.by_name)}</strong>
        ${x.action === "delete" ? "a supprimé" : "a modifié"} · ${ago(x.at)}<div class="muted small">Version précédente (${esc(dayLabel(x.snapshot.day))} ${esc(x.snapshot.time_label)}) : « ${esc(x.snapshot.body)} »</div></div>
        <button class="btn sm ghost" data-restore="${x.id}">Restaurer</button></li>`).join("")}</ul>` : `<p class="muted">Aucune modification du groupe pour l’instant.</p>`;
      box.querySelectorAll("[data-restore]").forEach(b => b.onclick = async () => {
        try { await rpc("guide_restore", { p_author: me.name, p_hist_id: +b.dataset.restore }); d.close(); await refresh(); toast("Version restaurée ↩︎"); } catch (err) { toast(err.message); }
      });
    } catch (err) { box.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
  }
  $("#histClose").onclick = () => $("#histDlg").close();

  /* ================================================================
     Carte
     ================================================================ */
  const map = L.map("map", { scrollWheelZoom: false }).setView([37.3905, -5.9920], 14);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  const layers = {}, markers = {};
  Object.keys(CATEGORIES).forEach(k => (layers[k] = L.layerGroup().addTo(map)));
  const nebLayer = L.layerGroup();
  function popupHtml(p) {
    const c = CATEGORIES[p.cat];
    return `<h4>${esc(p.name)}</h4><div style="color:${c.color};font-weight:600;font-size:.8rem">${esc(c.label)} · ${esc(p.addr || p.area)}</div>
      ${openBadge(p)}<p>${esc(p.desc)}</p>${p.order ? `<p><strong>À commander :</strong> ${esc(p.order)}</p>` : ""}${p.tip ? `<p style="color:#6f6357">💡 ${esc(p.tip)}</p>` : ""}
      <div class="pop-links"><a href="${walkTo(p)}" target="_blank" rel="noopener">Y aller à pied</a>${p.url ? `<a href="${p.url}" target="_blank" rel="noopener">Site</a>` : ""}</div>`;
  }
  PLACES.forEach(p => {
    const c = CATEGORIES[p.cat], big = p.cat === "base";
    const icon = L.divIcon({ className: "", iconSize: big ? [38, 38] : [30, 30], iconAnchor: big ? [19, 38] : [15, 30], popupAnchor: [0, -30],
      html: `<div class="pin ${big ? "big" : ""}" style="background:${c.color}"><span>${c.icon}</span></div>` });
    markers[p.id] = L.marker([p.lat, p.lng], { icon, title: p.name, zIndexOffset: big ? 1000 : 0 }).bindPopup(() => popupHtml(p), { maxWidth: 290 }).addTo(layers[p.cat]);
  });
  const allBounds = L.latLngBounds(PLACES.map(p => [p.lat, p.lng]));
  map.fitBounds(allBounds, { padding: [20, 20] });
  map.on("focus", () => map.scrollWheelZoom.enable());
  const filters = $("#filters");
  Object.entries(CATEGORIES).forEach(([k, c]) => {
    const b = document.createElement("button");
    b.style.setProperty("--c", c.color); b.textContent = `${c.icon} ${c.label}`; b.dataset.cat = k;
    b.addEventListener("click", () => { const on = map.hasLayer(layers[k]); on ? map.removeLayer(layers[k]) : map.addLayer(layers[k]); b.classList.toggle("off", on); });
    filters.appendChild(b);
  });
  const nebBtn = document.createElement("button");
  nebBtn.style.setProperty("--c", "#c8901a"); nebBtn.className = "off"; nebBtn.textContent = "✦ Tout le programme NEB";
  nebBtn.onclick = () => { const on = map.hasLayer(nebLayer); on ? map.removeLayer(nebLayer) : map.addLayer(nebLayer); nebBtn.classList.toggle("off", on); };
  filters.appendChild(nebBtn);

  function showOnMap(id) {
    const p = byId[id]; if (!p) return;
    if (!map.hasLayer(layers[p.cat])) { map.addLayer(layers[p.cat]); filters.querySelector(`[data-cat="${p.cat}"]`).classList.remove("off"); }
    go("carte");
    setTimeout(() => { map.setView([p.lat, p.lng], 17); markers[id].openPopup(); }, 350);
  }
  $("#fitAll").onclick = () => map.fitBounds(allBounds, { padding: [20, 20] });
  let meDot;
  $("#locate").onclick = async () => {
    try {
      const ll = await locateMe();
      if (meDot) meDot.setLatLng(ll); else meDot = L.circleMarker(ll, { radius: 9, color: "#fff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1 }).addTo(map).bindPopup("Vous êtes ici");
      map.setView(ll, 16); meDot.openPopup();
    } catch (err) { toast(err.message); }
  };

  /* ---------- Itinéraire du jour ---------- */
  const routeLayer = L.layerGroup().addTo(map);
  const routeSel = document.createElement("select");
  routeSel.id = "routeSel"; routeSel.className = "route-sel";
  routeSel.innerHTML = `<option value="">🧭 Itinéraire du jour…</option>` + DAYS.map(d => `<option value="${d.key}">${esc(dayName(d.key))}</option>`).join("");
  routeSel.onchange = drawRoute;
  $(".map-actions").prepend(routeSel);
  const routeInfo = document.createElement("div"); routeInfo.className = "route-info muted small"; $(".map-actions").after(routeInfo);
  function drawRoute() {
    routeLayer.clearLayers(); routeInfo.textContent = "";
    const key = routeSel.value; if (!key) return;
    const pts = [];
    itemsForDay(key).filter(it => it.place_id && byId[it.place_id] && voteStatus(it.id).s !== "ko").forEach(it => {
      const p = byId[it.place_id]; if (!pts.length || pts[pts.length - 1].p.id !== p.id) pts.push({ p, it });
    });
    if (!pts.length) { routeInfo.textContent = "Aucun lieu placé ce jour-là."; return; }
    const ll = pts.map(x => [x.p.lat, x.p.lng]);
    L.polyline(ll, { color: "#b5452b", weight: 4, opacity: .85, dashArray: "8 8" }).addTo(routeLayer);
    pts.forEach((x, i) => L.marker([x.p.lat, x.p.lng], { zIndexOffset: 2000, icon: L.divIcon({ className: "", iconSize: [24, 24], iconAnchor: [12, 12], html: `<div class="route-num">${i + 1}</div>` }) })
      .bindPopup(`<strong>${i + 1}. ${esc(x.it.time_label)}</strong> — ${esc(x.p.name)}`).addTo(routeLayer));
    let km = 0; for (let i = 1; i < ll.length; i++) km += distKm(ll[i - 1], ll[i]);
    routeInfo.textContent = `${dayName(key)} : ${pts.length} étapes · ≈ ${(km * 1.3).toFixed(1)} km à pied (~${Math.round(walkMin(km) / 5) * 5} min de marche au total, hors taxi).`;
    map.fitBounds(L.latLngBounds(ll), { padding: [30, 30] });
  }

  /* ---------- Noche en Blanco ---------- */
  let NEB = [];
  fetch("neb.json").then(r => r.json()).then(list => {
    NEB = list;
    list.forEach(a => {
      L.circleMarker([a.lat, a.lng], { radius: 6, color: "#fff", weight: 1.5, fillColor: a.full ? "#9a9a9a" : "#c8901a", fillOpacity: .95 })
        .bindPopup(() => `<h4>${esc(a.t)}</h4><div class="small" style="color:#c8901a;font-weight:600">${esc(a.org)} · ${esc(a.z)}</div>
          <p>📍 ${esc(a.addr)}<br>🕘 ${esc(a.h || "voir site")}<br>💶 ${esc(a.p)}${a.full ? "<br><strong>⛔ Complet</strong>" : ""}</p>
          <div class="pop-links"><a href="${a.u}" target="_blank" rel="noopener">Détails & réservation</a><a href="${walkTo(a)}" target="_blank" rel="noopener">Y aller</a></div>`, { maxWidth: 280 })
        .addTo(nebLayer);
    });
    if (DAY_KEYS[currentDay] === "ven") renderDay();
  }).catch(() => {});
  function showNeb(id) {
    const a = NEB.find(x => x.id === id); if (!a) return;
    if (!map.hasLayer(nebLayer)) { map.addLayer(nebLayer); nebBtn.classList.remove("off"); }
    go("carte");
    setTimeout(() => { map.setView([a.lat, a.lng], 17); nebLayer.eachLayer(l => { const g = l.getLatLng(); if (g.lat === a.lat && g.lng === a.lng) l.openPopup(); }); }, 350);
  }
  let nebFilter = store.get("sev-nebf", { q: "", free: false, hideFull: true });
  function nebBlock() {
    if (!NEB.length) return "";
    const votes = id => reactionsFor("neb:" + id).filter(r => r.emoji === "👍").length;
    const liked = NEB.filter(a => reactionsFor("neb:" + a.id).length).sort((a, b) => votes(b.id) - votes(a.id));
    const q = nebFilter.q.toLowerCase();
    const list = NEB.filter(a => (!nebFilter.free || /gratu/i.test(a.p)) && (!nebFilter.hideFull || !a.full) &&
      (!q || (a.t + " " + a.org + " " + a.z + " " + a.addr).toLowerCase().includes(q)));
    const row = a => `<li class="neb-item ${a.full ? "full" : ""}"><div><strong>${esc(a.t)}</strong> <span class="muted small">— ${esc(a.org)}</span>
        <div class="small">🕘 ${esc(a.h || "?")} · 💶 ${esc(a.p)} · 📍 ${esc(a.z)}${a.full ? " · <b>complet</b>" : ""}</div>
        <div class="small"><button class="link" data-neb="${esc(a.id)}">carte</button> · <a href="${a.u}" target="_blank" rel="noopener">détails / réserver</a></div>
        ${me ? `<div class="social">${reactionBar("neb:" + a.id, { noPhoto: true })}${thread("neb:" + a.id)}</div>` : ""}</div></li>`;
    return `<details class="card soft neb" ${store.get("sev-nebopen", false) ? "open" : ""}><summary><h4>✦ Programme Noche en Blanco (${NEB.length} activités)</h4></summary>
      ${liked.length ? `<p class="small"><strong>Sélection du groupe :</strong></p><ul class="neb-list">${liked.map(row).join("")}</ul><hr>` : `<p class="small muted">Réagissez 👍 sur les activités qui vous tentent : elles remonteront ici pour tout le groupe.</p>`}
      <div class="neb-search"><input id="nebQ" placeholder="Rechercher : palacio, flamenco, vino, Triana…" value="${esc(nebFilter.q)}">
        <label class="chk"><input type="checkbox" id="nebFree" ${nebFilter.free ? "checked" : ""}> gratuit</label>
        <label class="chk"><input type="checkbox" id="nebFull" ${nebFilter.hideFull ? "checked" : ""}> masquer complets</label></div>
      <ul class="neb-list">${list.slice(0, 60).map(row).join("")}</ul>${list.length > 60 ? `<p class="muted small">+${list.length - 60} autres : affinez la recherche.</p>` : ""}</details>`;
  }
  function bindNeb() {
    const det = panel.querySelector("details.neb"); if (!det) return;
    det.addEventListener("toggle", () => store.set("sev-nebopen", det.open));
    const upd = () => { nebFilter = { q: $("#nebQ").value, free: $("#nebFree").checked, hideFull: $("#nebFull").checked }; store.set("sev-nebf", nebFilter); renderDay(); const i = $("#nebQ"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } };
    let tmo; $("#nebQ").addEventListener("input", () => { clearTimeout(tmo); tmo = setTimeout(upd, 400); });
    $("#nebFree").onchange = upd; $("#nebFull").onchange = upd;
  }

  /* ================================================================
     Programme
     ================================================================ */
  const tabs = $("#dayTabs"), panel = $("#dayPanel");
  DAYS.forEach((d, i) => {
    const b = document.createElement("button"); b.setAttribute("role", "tab"); b.textContent = d.label;
    b.addEventListener("click", () => { currentDay = i; store.set("sev-day", i); renderDay(); renderAlbum(); });
    tabs.appendChild(b);
  });
  const todayKey = DATE_DAY[madridNow().date];
  currentDay = todayKey ? DAY_KEYS.indexOf(todayKey) : Math.min(store.get("sev-day", 0), DAYS.length - 1);

  function itemsForDay(key) {
    if (state && state.proposals) return state.proposals.filter(p => p.day === key)
      .sort((a, b) => timeKey(a.time_label) - timeKey(b.time_label) || new Date(a.created_at) - new Date(b.created_at));
    return DAYS.find(d => d.key === key).items.map((it, i) => ({ id: "static" + i, time_label: it.time, body: it.text, place_id: it.place }));
  }

  const seenDays = new Set();
  function renderDay() {
    const d = DAYS[currentDay];
    if (!seenDays.has(d.key)) { seenDays.add(d.key); openThreads.add("day:" + d.key); }
    [...tabs.children].forEach((b, j) => b.setAttribute("aria-selected", j === currentDay));
    const plan = flightPlan();
    const items = [...itemsForDay(d.key), ...flightItems(d.key)].sort((x, y) => timeKey(x.time_label) - timeKey(y.time_label)), tips = DAY_TIPS[d.key];
    panel.innerHTML = `<div class="day-head"><div><h3>${esc(d.title)}</h3><p class="mood">${esc(d.mood)}</p></div>${weatherHtml(d.key, true)}</div>
      ${me ? "" : `<p class="notice">👋 Identifiez-vous en haut de page pour modifier le programme, voter, commenter et partager des photos.</p>`}
      <div class="day-actions"><button class="btn sm ghost" data-route="${d.key}">🗺 Itinéraire du jour</button></div>
      <ol class="timeline">${items.map(it => {
        const p = it.place_id && byId[it.place_id];
        const vs = me ? voteStatus(it.id) : { s: "" };
        const vote = /^🗳/.test(it.body || "");
        const edited = it.updated_by ? ` · modifié par ${esc(it.updated_by)} ${ago(it.updated_at)}` : "";
        const tag = vs.label ? `<span class="status ${vs.s}">${vs.label}</span> ` : (vote && me ? `<span class="status vote">🗳 En vote · ${vs.up} 👍 / ${vs.down} 👎</span> ` : "");
        if (it.flight) return `<li class="flight"><div class="t">${esc(it.time_label)}</div><div class="x"><div class="item-head"><div><strong>${esc(it.body)}</strong></div>${me ? `<button class="icon-btn" data-flights title="Modifier les vols">✏️</button>` : ""}</div>${it.tip ? `<div class="advice">💡 ${esc(it.tip)}</div>` : ""}</div></li>`;
        const late = d.key === "sam" && plan.lastStop != null && /\d/.test(it.time_label || "") && timeKey(it.time_label) > plan.lastStop;
        return `<li class="${vs.s === "ko" ? "collapsed ko" : ""} ${vs.s === "ok" ? "ok" : ""}"><div class="t">${esc(it.time_label)}</div><div class="x">${late ? `<div class="late">⚠️ Après l’heure limite avant l’avion (${fmtMin(plan.lastStop)})</div>` : ""}
          ${vs.s === "ko" ? `<div class="ko-line">${vs.label} — ${esc((it.body || "").replace(/^🗳\s*/, "").slice(0, 50))}… <button class="link" data-expand>afficher</button></div>` : ""}
          <div class="full">
          <div class="item-head"><div>${tag}${esc((it.body || "").replace(/^🗳\s*/, ""))}</div>
            ${me ? `<span class="item-btns"><button class="icon-btn" data-edit="${it.id}" title="Modifier">✏️</button>${it.updated_by ? `<button class="icon-btn" data-hist="${it.id}" title="Historique de cette étape">🕘</button>` : ""}</span>` : ""}</div>
          ${it.tip ? `<div class="advice">💡 ${esc(it.tip)}</div>` : ""}
          ${p ? `<button class="chip" style="background:${CATEGORIES[p.cat].color}" data-map="${p.id}">📍 ${esc(p.name)}</button> ${openBadge(p)}` : ""}
          ${me ? `<div class="by">proposé par ${esc(it.author)}${edited}</div><div class="social">${socialBlock(it.id)}</div>` : ""}
          </div></div></li>`;
      }).join("") || `<li><div class="t"></div><div class="x muted">Rien de prévu pour l’instant.</div></li>`}</ol>
      ${me ? `<button class="btn add" data-add="${d.key}">＋ Proposer une activité</button>` : ""}
      ${d.key === "ven" ? nebBlock() : ""}
      <div class="day-extra">
        <div class="card soft"><h4>🧭 Conseils du jour</h4><ul>${tips.conseils.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>
        <div class="card soft"><h4>🔄 Plans B</h4><ul>${tips.planB.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>
      </div>
      ${me ? `<div class="card soft discuss"><h4>💬 Discussion du ${esc(dayName(d.key).toLowerCase())}</h4><div class="social">${socialBlock("day:" + d.key)}</div></div>` : ""}`;
    if (d.key === "ven") bindNeb();
    if (routeSel.value) drawRoute();
  }

  /* ================================================================
     Maintenant / ensuite
     ================================================================ */
  function renderNowBase() {
    const box = $("#now"), n = madridNow(), key = DATE_DAY[n.date];
    const start = new Date("2026-09-30T18:00:00+02:00"), end = new Date("2026-10-04T02:00:00+02:00"), now = new Date();
    if (!key && now < start) {
      const days = Math.ceil((start - now) / 864e5);
      const todo = me ? S("bookings").filter(b => b.status === "à réserver").length : 0;
      box.innerHTML = `<h2>⏳ Départ ${days <= 1 ? "demain soir" : `dans ${days} jours`}</h2>
        <p>${trip().out && trip().out.dep ? `Premier rendez-vous : <strong>mercredi, vol ${esc(trip().out.num || "")} à ${hm(trip().out.dep)}</strong> depuis Toulouse — dîner avant de partir, arrivée à l’appartement vers ${fmtMin(flightPlan().home)}.` : `Premier rendez-vous : <strong>mercredi soir</strong>.`}</p>
        ${todo ? `<p>🎟 <strong>${todo} réservation${todo > 1 ? "s" : ""}</strong> encore à faire → <a href="#resa" data-go="resa">voir les fiches</a></p>` : ""}
        <div class="w-row">${DAY_KEYS.map(k => `<div><div class="small muted">${esc(dayLabel(k))}</div>${weatherHtml(k) || "<span class='muted small'>météo à venir</span>"}</div>`).join("")}</div>`;
      return;
    }
    if (now > end) {
      box.innerHTML = `<h2>🧡 ¡Hasta la próxima, Sevilla!</h2><p>Tout le séjour (votes, commentaires, photos, dépenses) est rassemblé dans le carnet.</p><button class="btn print-btn">📖 Générer le carnet de voyage (PDF)</button>`;
      return;
    }
    const k = key || "mer", items = itemsForDay(k).filter(it => voteStatus(it.id).s !== "ko");
    let cur = null, next = null;
    for (const it of items) { const t = timeKey(it.time_label); if (t <= n.min + 10) cur = it; else if (!next) next = it; }
    const card = (it, lbl) => {
      if (!it) return "";
      const p = it.place_id && byId[it.place_id];
      const dist = p && myPos ? distKm(myPos, [p.lat, p.lng]) : null;
      return `<div class="now-card"><div class="small muted">${lbl} · ${esc(it.time_label)}</div><div class="now-body">${esc((it.body || "").replace(/^🗳\s*/, ""))}</div>
        ${it.tip ? `<div class="advice">💡 ${esc(it.tip)}</div>` : ""}
        ${p ? `<div class="now-links"><a class="btn sm" href="${walkTo(p)}" target="_blank" rel="noopener">🚶 Y aller${dist != null ? ` · ${walkMin(dist)} min` : ""}</a>
          <button class="btn sm ghost" data-map="${p.id}">Carte</button> ${openBadge(p)}</div>` : ""}</div>`;
    };
    box.innerHTML = `<div class="now-head"><h2>📍 ${esc(dayName(k))}</h2>${weatherHtml(k)}</div>
      ${card(cur, "En ce moment")}${card(next, "Ensuite")}
      ${!cur && !next ? `<p class="muted">Rien de prévu : improvisez ! (Adresses → « ouvert maintenant »)</p>` : ""}
      <div class="now-links"><button class="btn sm ghost" id="nowLocate">📍 ${myPos ? "Actualiser ma position" : "Calculer les temps de marche"}</button>
      <button class="btn sm ghost" data-route="${k}">🗺 Itinéraire du jour</button></div>`;
  }

  function renderNow() {
    renderNowBase();
    const box = $("#now"), plan = flightPlan(), t = trip(), others = S("positions").filter(p => !me || !same(p.author, me.name));
    const remindOn = store.get("sev-remind", false) && "Notification" in window && Notification.permission === "granted";
    box.insertAdjacentHTML("beforeend", `
      ${t.out || t.ret ? `<div class="small now-fl">✈️ ${t.out ? `Aller ${esc(t.out.num || "")} ${hm(t.out.dep)}→${hm(t.out.arr)}` : ""}${t.ret ? ` · Retour ${esc(t.ret.num || "")} ${hm(t.ret.dep)}${plan.leave != null ? ` (quitter l’appart. ${fmtMin(plan.leave)})` : ""}` : ""}</div>` : ""}
      ${others.length ? `<div class="small now-pos">👥 ${others.map(p => `<button class="link" data-pos="${esc(p.author)}">${esc(p.author)}</button> <span class="muted">(${ago(p.updated_at)}${myPos ? `, ${walkMin(distKm(myPos, [p.lat, p.lng]))} min` : ""})</span>`).join(" · ")}</div>` : ""}
      <div class="now-links"><button class="btn sm" id="improvBtn">🎲 On improvise</button>
      ${me && !remindOn ? `<button class="btn sm ghost" id="remindBtn">🔔 Rappels sur ce téléphone</button>` : ""}${remindOn ? `<span class="small muted">🔔 rappels actifs</span>` : ""}</div>
      <div id="improv" class="improv" hidden></div>`);
  }
  document.addEventListener("click", e => { const b = e.target.closest("[data-pos]"); if (!b) return; const p = S("positions").find(x => same(x.author, b.dataset.pos)); if (p) { go("carte"); setTimeout(() => map.setView([p.lat, p.lng], 17), 350); } });

  /* ================================================================
     Réservations
     ================================================================ */
  const bd = $("#bookDlg"), bf = $("#bookForm");
  bf.day.innerHTML = `<option value="">—</option>` + dayOptions; bf.place.innerHTML = placeOptions;
  const STATUS_CLASS = { "à réserver": "todo", "réservé": "done", "complet": "full", "annulé": "cancel" };
  function renderBookings() {
    const box = $("#resaList");
    if (!me) {
      box.innerHTML = `<div class="card"><p class="notice">Identifiez-vous pour voir et modifier les fiches partagées.</p><ul class="plain">${TODO.map(t => `<li>☐ ${esc(t.text)} ${t.url ? `<a href="${t.url}" target="_blank" rel="noopener">→</a>` : ""}</li>`).join("")}</ul></div>`;
      return;
    }
    const bs = S("bookings").slice().sort((a, b) => DAY_KEYS.indexOf(a.day) - DAY_KEYS.indexOf(b.day) || timeKey(a.time_label) - timeKey(b.time_label));
    box.innerHTML = `${flightCard()}${watchPanel()}<div class="books">${bs.map(b => { const p = b.place_id && byId[b.place_id]; const files = S("files").filter(f => f.booking_id === b.id); return `
      <article class="book ${STATUS_CLASS[b.status] || ""}">
        <div class="book-top"><span class="st">${esc(b.status)}</span><button class="icon-btn" data-book="${b.id}" title="Modifier">✏️</button></div>
        <h4>${esc(b.title)}</h4>
        <div class="small">${esc(dayName(b.day) || "")} ${esc(b.time_label || "")} · ${b.people || "?"} pers.</div>
        ${b.ref ? `<div class="ref">N° <strong>${esc(b.ref)}</strong></div>` : ""}
        ${b.notes ? `<p class="small muted">${esc(b.notes)}</p>` : ""}
        <div class="links small">${b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">Réserver / billets →</a>` : ""}${p ? ` <button class="link" data-map="${p.id}">carte</button>` : ""}</div>
        <div class="files">${files.map(f => `<span class="file"><button class="link" data-file="${f.id}">${f.mime === "application/pdf" ? "📄" : "🖼"} ${esc(f.name.slice(0, 28))}</button><button class="x" data-file-del="${f.id}" title="Retirer">×</button></span>`).join("")}
          <button class="btn sm ghost" data-attach="${b.id}">📎 Joindre billet / QR</button></div>
        <div class="by">mis à jour par ${esc(b.updated_by || "?")} · ${ago(b.updated_at)}</div>
      </article>`; }).join("")}</div>
      <button class="btn add0" data-book="new">＋ Ajouter une réservation</button>`;
  }
  function openBooking(id) {
    const b = id && S("bookings").find(x => x.id === id);
    $("#bookTitle").textContent = b ? "Modifier la réservation" : "Nouvelle réservation";
    bf.id.value = b ? b.id : ""; bf.title.value = b ? b.title : ""; bf.day.value = b ? (b.day || "") : ""; bf.time.value = b ? (b.time_label || "") : "";
    bf.people.value = b ? (b.people || 4) : 4; bf.status.value = b ? b.status : "à réserver"; bf.ref.value = b ? (b.ref || "") : "";
    bf.url.value = b ? (b.url || "") : ""; bf.place.value = b ? (b.place_id || "") : ""; bf.notes.value = b ? (b.notes || "") : "";
    $("#bookDel").hidden = !b; bd.showModal();
  }
  $("#bookCancel").onclick = () => bd.close();
  $("#bookDel").onclick = async () => { if (!confirm("Supprimer cette fiche ?")) return; try { await rpc("guide_delete_booking", { p_author: me.name, p_id: bf.id.value }); bd.close(); await refresh(); } catch (err) { toast(err.message); } };
  bf.addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await rpc("guide_save_booking", { p_author: me.name, p_id: bf.id.value || null, p_title: bf.title.value, p_day: bf.day.value || null, p_time: bf.time.value,
        p_people: +bf.people.value || null, p_status: bf.status.value, p_ref: bf.ref.value, p_url: bf.url.value, p_notes: bf.notes.value, p_place: bf.place.value });
      bd.close(); await refresh(); toast("Réservation enregistrée ✔");
    } catch (err) { toast(err.message); }
  });

  /* ================================================================
     Dépenses partagées
     ================================================================ */
  function balances() {
    const bal = {};
    S("expenses").forEach(e => {
      const share = e.amount / e.shared_with.length;
      bal[e.payer] = (bal[e.payer] || 0) + +e.amount;
      e.shared_with.forEach(n => { bal[n] = (bal[n] || 0) - share; });
    });
    return bal;
  }
  function settle(bal) {
    const cred = [], debt = [];
    Object.entries(bal).forEach(([n, v]) => { v = Math.round(v * 100) / 100; if (v > 0.009) cred.push([n, v]); else if (v < -0.009) debt.push([n, -v]); });
    cred.sort((a, b) => b[1] - a[1]); debt.sort((a, b) => b[1] - a[1]);
    const out = [];
    while (cred.length && debt.length) {
      const x = Math.min(cred[0][1], debt[0][1]);
      out.push(`${esc(debt[0][0])} → ${esc(cred[0][0])} : <strong>${euro(x)}</strong>`);
      cred[0][1] -= x; debt[0][1] -= x;
      if (cred[0][1] < 0.01) cred.shift(); if (debt[0][1] < 0.01) debt.shift();
    }
    return out;
  }
  function renderExpenses() {
    const box = $("#expenses");
    if (!me) { box.innerHTML = `<p class="notice">Identifiez-vous pour saisir les dépenses du groupe.</p>`; return; }
    const ms = members(), ex = S("expenses"), total = ex.reduce((s, e) => s + +e.amount, 0), bal = balances(), st = settle(bal);
    box.innerHTML = `<div class="grid2">
      <form id="expForm" class="card">
        <h3>Ajouter une dépense</h3>
        <div class="row"><label>Quoi<input name="label" maxlength="120" required placeholder="Tapas Eslava"></label>
          <label>Montant €<input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required></label></div>
        <div class="row"><label>Payé par<select name="payer">${ms.map(n => `<option ${same(n, me.name) ? "selected" : ""}>${esc(n)}</option>`).join("")}<option value="__other">Autre…</option></select></label>
          <label>Jour<select name="day"><option value="">—</option>${dayOptions}</select></label></div>
        <fieldset><legend>Partagé entre</legend>${ms.map(n => `<label class="chk"><input type="checkbox" name="sw" value="${esc(n)}" checked> ${esc(n)}</label>`).join("")}
          <input name="extra" placeholder="+ prénom manquant" maxlength="30" class="mini"></fieldset>
        <button class="btn">Ajouter</button>
        <p class="muted small">Les prénoms apparaissent dès que chacun s’est connecté une fois.</p>
      </form>
      <div class="card">
        <h3>Soldes · total ${euro(total)}</h3>
        ${Object.keys(bal).length ? `<ul class="bal">${Object.entries(bal).sort((a, b) => b[1] - a[1]).map(([n, v]) => `<li>${avatar(n, true)} ${esc(n)} <span class="${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : ""}${euro(v)}</span></li>`).join("")}</ul>
          <h4>Pour équilibrer</h4>${st.length ? `<ul class="plain">${st.map(s => `<li>${s}</li>`).join("")}</ul>` : `<p class="muted">Tout le monde est à l’équilibre 👌</p>`}` : `<p class="muted">Aucune dépense pour l’instant.</p>`}
      </div></div>
      ${ex.length ? `<div class="card exp-list"><h3>Détail</h3><ul>${ex.slice().reverse().map(e => `<li><div><strong>${esc(e.label)}</strong> · ${euro(+e.amount)}
        <div class="small muted">payé par ${esc(e.payer)} · pour ${e.shared_with.map(esc).join(", ")}${e.day ? " · " + esc(dayLabel(e.day)) : ""} · saisi par ${esc(e.created_by)}</div></div>
        <button class="icon-btn" data-del-exp="${e.id}" title="Supprimer">🗑</button></li>`).join("")}</ul></div>` : ""}`;
    const f = $("#expForm");
    f.payer.onchange = () => { if (f.payer.value === "__other") { const n = cap(prompt("Prénom de la personne qui a payé :") || ""); if (n) f.payer.add(new Option(n, n, true, true)); else f.payer.selectedIndex = 0; } };
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const shared = [...f.querySelectorAll("[name=sw]:checked")].map(i => i.value);
      if (f.extra.value.trim()) shared.push(cap(f.extra.value.trim()));
      if (!shared.length) return toast("Choisissez au moins une personne.");
      try {
        await rpc("guide_save_expense", { p_author: me.name, p_id: null, p_label: f.label.value, p_amount: +f.amount.value, p_payer: f.payer.value, p_shared: shared, p_day: f.day.value || null });
        await refresh(); toast("Dépense ajoutée 💶");
      } catch (err) { toast(err.message); }
    });
  }

  /* ================================================================
     Album
     ================================================================ */
  function targetDay(t) {
    if (t.startsWith("day:")) return t.slice(4);
    const p = S("proposals").find(x => x.id === t); return p ? p.day : "autres";
  }
  function renderAlbum() {
    const box = $("#albumBox");
    if (!me) { box.innerHTML = `<p class="notice">Identifiez-vous pour voir et partager les photos du groupe.</p>`; return; }
    const ps = S("photos"), groups = {};
    ps.forEach(p => { const k = targetDay(p.target); (groups[k] = groups[k] || []).push(p); });
    box.innerHTML = `<p class="muted small">Ajoutez des photos avec 📷 sous chaque étape du programme, ou ici pour le jour sélectionné. Elles sont réduites automatiquement et visibles uniquement par le groupe.</p>
      <div class="album-actions"><button class="btn sm" data-photo="day:${DAY_KEYS[currentDay]}">📷 Ajouter au ${esc(dayName(DAY_KEYS[currentDay]).toLowerCase())}</button>
      <button class="btn sm ghost print-btn">📖 Carnet de voyage (PDF)</button>${ps.length ? `<button class="btn sm ghost" id="zipBtn">⬇️ Toutes les photos (zip)</button>` : ""}</div>
      ${ps.length ? [...DAY_KEYS, "autres"].filter(k => groups[k]).map(k => `<h3 class="album-day">${k === "autres" ? "Adresses & divers" : esc(dayName(k))} <span class="muted small">(${groups[k].length})</span></h3>
        <div class="album-grid">${groups[k].map(p => `<button class="thumb big" data-photo-id="${p.id}" title="${esc(p.author)}">${thumbs[p.id] ? `<img src="${thumbs[p.id]}" alt="">` : `<span class="ph"></span>`}<span class="cap">${esc(p.author)}</span></button>`).join("")}</div>`).join("")
        : `<p class="muted">Pas encore de photo. À vous de jouer 📸</p>`}`;
  }

  /* ================================================================
     Adresses (+ filtres, ouvert maintenant)
     ================================================================ */
  let placeFilter = store.get("sev-pf", { q: "", area: "", openOnly: false });
  function renderPlaces() {
    const list = $("#placeList");
    const areas = [...new Set(PLACES.map(p => p.area))].sort();
    const q = placeFilter.q.toLowerCase();
    const match = p => (!placeFilter.area || p.area === placeFilter.area) && (!placeFilter.openOnly || (openInfo(p) || {}).open) &&
      (!q || (p.name + " " + p.desc + " " + (p.order || "") + " " + p.area).toLowerCase().includes(q));
    list.innerHTML = `<div class="place-filters"><input id="pfQ" placeholder="Rechercher : croquetas, vin, flamenco…" value="${esc(placeFilter.q)}">
      <select id="pfArea"><option value="">Tous les quartiers</option>${areas.map(a => `<option ${a === placeFilter.area ? "selected" : ""}>${esc(a)}</option>`).join("")}</select>
      <label class="chk"><input type="checkbox" id="pfOpen" ${placeFilter.openOnly ? "checked" : ""}> ouvert maintenant <span class="muted small">(horaires vérifiés)</span></label></div>`;
    let shown = 0;
    Object.entries(CATEGORIES).forEach(([k, c]) => {
      const items = PLACES.filter(p => p.cat === k && match(p)); if (!items.length) return; shown += items.length;
      const block = document.createElement("div"); block.className = "cat-block";
      block.innerHTML = `<h3><span class="cat-dot" style="background:${c.color}"></span>${esc(c.label)}</h3>
        <div class="places">${items.map(p => `
          <article class="place" style="--c:${c.color}">
            <h4>${esc(p.name)}</h4><div class="area">${esc(p.addr ? p.addr + " · " : "")}${esc(p.area)}</div>${openBadge(p)}
            <p>${esc(p.desc)}</p>${p.order ? `<p class="order"><strong>À commander :</strong> ${esc(p.order)}</p>` : ""}${p.tip ? `<p class="tip">${esc(p.tip)}</p>` : ""}
            <div class="links"><button data-map="${p.id}">Voir sur la carte</button><a href="${walkTo(p)}" target="_blank" rel="noopener">Y aller</a>
              ${p.url ? `<a href="${p.url}" target="_blank" rel="noopener">Site</a>` : ""}</div>
            ${me ? `<div class="social">${socialBlock("place:" + p.id)}</div>` : ""}
          </article>`).join("")}</div>`;
      list.appendChild(block);
    });
    if (!shown) list.insertAdjacentHTML("beforeend", `<p class="muted">Aucune adresse ne correspond.</p>`);
    const upd = () => { placeFilter = { q: $("#pfQ").value, area: $("#pfArea").value, openOnly: $("#pfOpen").checked }; store.set("sev-pf", placeFilter); renderPlaces(); const i = $("#pfQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
    let tmo; $("#pfQ").addEventListener("input", () => { clearTimeout(tmo); tmo = setTimeout(upd, 400); });
    $("#pfArea").onchange = upd; $("#pfOpen").onchange = upd;
  }

  /* ================================================================
     Fil d’activité
     ================================================================ */
  function renderFeed() {
    const box = $("#feed");
    if (!me || !state) { box.hidden = true; return; }
    const label = t => {
      if (t.startsWith("day:")) return "discussion du " + dayLabel(t.slice(4));
      if (t.startsWith("place:")) return (byId[t.slice(6)] || {}).name || "une adresse";
      if (t.startsWith("neb:")) return "✦ " + ((NEB.find(a => a.id === t.slice(4)) || {}).t || "une activité NEB");
      const p = S("proposals").find(x => x.id === t); return p ? `« ${p.body.replace(/^🗳\s*/, "").slice(0, 45)}… »` : "une proposition";
    };
    const ev = [
      ...S("comments").map(c => ({ at: c.created_at, who: c.author, html: `a commenté ${esc(label(c.target))} : <em>${esc(c.body.slice(0, 80))}</em>` })),
      ...S("proposals").filter(p => p.author !== "Guide" || (p.updated_by && p.updated_by !== "Guide")).map(p => ({ at: p.updated_by ? p.updated_at : p.created_at, who: p.updated_by || p.author,
        html: `${p.updated_by ? "a modifié" : "a proposé"} « ${esc(p.body.slice(0, 60))} » (${esc(dayLabel(p.day))})` })),
      ...S("reactions").map(r => ({ at: r.created_at, who: r.author, html: `a réagi ${r.emoji} à ${esc(label(r.target))}` })),
      ...S("photos").map(p => ({ at: p.created_at, who: p.author, html: `a ajouté une photo 📷 (${esc(label(p.target))})` })),
      ...S("expenses").map(e => ({ at: e.created_at, who: e.created_by, html: `a saisi une dépense : ${esc(e.label)} (${euro(+e.amount)})` }))
    ].filter(x => x.who && x.who !== "Guide").sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8);
    box.hidden = typeof view !== "undefined" && view !== "accueil";
    box.innerHTML = `<div class="feed-head"><h2>Quoi de neuf dans le groupe</h2><div><button class="btn sm ghost" data-go="journal">🕘 Journal complet</button> <button class="btn sm ghost print-btn">📖 Carnet</button></div></div>
      ${ev.length ? `<ul>${ev.map(x => `<li>${avatar(x.who, true)}<div><strong>${esc(x.who)}</strong> ${x.html} <span class="muted small">· ${ago(x.at)}</span></div></li>`).join("")}</ul>`
        : `<p class="muted">Rien encore. Votez sur les options 🗳 du programme 👇</p>`}`;
  }

  /* ================================================================
     Carnet de voyage (impression → PDF)
     ================================================================ */
  async function printCarnet() {
    if (!me || !state) return toast("Identifiez-vous d’abord.");
    toast("Préparation du carnet…", 6000);
    await loadThumbs();
    const bal = balances(), total = S("expenses").reduce((s, e) => s + +e.amount, 0);
    $("#printArea").innerHTML = `<div class="print-doc"><h1>Puechoultres &amp; Devesa à Séville</h1><p>30 sept – 3 oct 2026</p><p class="small">Carnet généré le ${new Date().toLocaleDateString("fr-FR")} · ${members().map(esc).join(", ")}</p>
      ${DAYS.map(d => {
        const items = itemsForDay(d.key).filter(it => voteStatus(it.id).s !== "ko");
        const dayPhotos = S("photos").filter(p => targetDay(p.target) === d.key);
        const talk = commentsFor("day:" + d.key);
        return `<section class="p-day"><h2>${esc(d.title)}</h2>${weatherHtml(d.key)}
          <ul>${items.map(it => { const cs = commentsFor(it.id), rs = reactionsFor(it.id); const p = it.place_id && byId[it.place_id];
            return `<li><strong>${esc(it.time_label)}</strong> — ${esc((it.body || "").replace(/^🗳\s*/, ""))}${p ? ` <em>(${esc(p.name)})</em>` : ""}${rs.length ? ` <span>${rs.map(r => r.emoji).join("")}</span>` : ""}
              ${cs.length ? `<ul class="p-com">${cs.map(c => `<li>${esc(c.author)} : ${esc(c.body)}</li>`).join("")}</ul>` : ""}</li>`; }).join("")}</ul>
          ${talk.length ? `<div class="p-com"><strong>Discussion :</strong> ${talk.map(c => `${esc(c.author)} : ${esc(c.body)}`).join(" · ")}</div>` : ""}
          ${dayPhotos.length ? `<div class="p-photos">${dayPhotos.map(p => thumbs[p.id] ? `<figure><img src="${thumbs[p.id]}"><figcaption>${esc(p.author)}${p.caption ? " — " + esc(p.caption) : ""}</figcaption></figure>` : "").join("")}</div>` : ""}</section>`;
      }).join("")}
      <section class="p-day"><h2>🏆 Palmarès</h2>
        ${(() => { const tp = ranking(["tapa", "dessert"]).slice(0, 5), vn = ranking(["vin", "cocktail"]).slice(0, 5);
          const loved = S("proposals").map(p => ({ p, n: reactionsFor(p.id).filter(r => ["👍", "❤️", "😋"].includes(r.emoji)).length })).filter(x => x.n).sort((a, b) => b.n - a.n).slice(0, 5);
          return `${tp.length ? `<h3>Meilleures tapas</h3><ol>${tp.map(x => `<li>${esc(x.item)} ${x.place ? `(${esc(x.place)})` : ""} — ${x.avg.toFixed(1)}/5</li>`).join("")}</ol>` : ""}
            ${vn.length ? `<h3>Meilleurs vins</h3><ol>${vn.map(x => `<li>${esc(x.item)} ${x.place ? `(${esc(x.place)})` : ""} — ${x.avg.toFixed(1)}/5</li>`).join("")}</ol>` : ""}
            ${loved.length ? `<h3>Moments préférés du groupe</h3><ol>${loved.map(x => `<li>${esc(x.p.body.replace(/^🗳\s*/, ""))} — ${x.n} ❤️/👍</li>`).join("")}</ol>` : ""}`; })()}
      </section>
      <section class="p-day"><h2>🗺 Notre parcours</h2>${routeSvg()}</section>
      ${(() => { const best = S("photos").map(p => ({ p, n: reactionsFor("photo:" + p.id).length })).sort((a, b) => b.n - a.n).filter(x => thumbs[x.p.id]).slice(0, 8);
        return best.length ? `<section class="p-day"><h2>📸 Meilleures photos</h2><div class="p-photos">${best.map(x => `<figure><img src="${thumbs[x.p.id]}"><figcaption>${esc(x.p.author)}${x.n ? ` · ${x.n} ❤️` : ""}</figcaption></figure>`).join("")}</div></section>` : ""; })()}
      <section class="p-day"><h2>Dépenses</h2><p>Total : <strong>${euro(total)}</strong></p><ul>${Object.entries(bal).map(([n, v]) => `<li>${esc(n)} : ${v >= 0 ? "+" : ""}${euro(v)}</li>`).join("")}</ul></section></div>`;
    setTimeout(() => window.print(), 400);
  }

  /* ================================================================
     v4 — Vols, rappels, billets, improvisation, dégustations,
          audio, positions, veille des places, carnet enrichi
     ================================================================ */

  /* ---------- Petit constructeur de formulaires en dialogue ---------- */
  function formDialog(title, fields, onSave, opts) {
    const d = document.createElement("dialog");
    d.innerHTML = `<form class="dlg-pad form-grid"><h3>${esc(title)}</h3>
      ${fields.map(f => f.type === "row" ? `<div class="row">${f.items.map(fieldHtml).join("")}</div>` : fieldHtml(f)).join("")}
      <div class="dlg-actions">${opts && opts.onDelete ? `<button type="button" class="btn danger" data-del>Supprimer</button>` : ""}<span class="spacer"></span>
      <button type="button" class="btn ghost" data-cancel>Annuler</button><button class="btn">Enregistrer</button></div></form>`;
    function fieldHtml(f) {
      const v = f.value == null ? "" : f.value;
      if (f.type === "select") return `<label>${esc(f.label)}<select name="${f.name}">${f.options.map(o => `<option value="${esc(o[0])}" ${String(o[0]) === String(v) ? "selected" : ""}>${esc(o[1])}</option>`).join("")}</select></label>`;
      if (f.type === "textarea") return `<label>${esc(f.label)}<textarea name="${f.name}" rows="2" maxlength="${f.max || 500}">${esc(v)}</textarea></label>`;
      if (f.type === "stars") return `<label>${esc(f.label)}<div class="stars" data-name="${f.name}">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-star="${i}" class="${i <= (+v || 0) ? "on" : ""}">★</button>`).join("")}<input type="hidden" name="${f.name}" value="${esc(v)}"></div></label>`;
      return `<label>${esc(f.label)}<input name="${f.name}" type="${f.type || "text"}" value="${esc(v)}" ${f.required ? "required" : ""} maxlength="${f.max || 120}" placeholder="${esc(f.ph || "")}" ${f.list ? `list="${f.list}"` : ""}></label>`;
    }
    document.body.appendChild(d);
    const form = d.querySelector("form");
    d.querySelectorAll(".stars").forEach(st => st.addEventListener("click", e => {
      const b = e.target.closest("[data-star]"); if (!b) return;
      st.querySelector("input").value = b.dataset.star;
      st.querySelectorAll("[data-star]").forEach(x => x.classList.toggle("on", +x.dataset.star <= +b.dataset.star));
    }));
    d.querySelector("[data-cancel]").onclick = () => d.close();
    const del = d.querySelector("[data-del]"); if (del) del.onclick = async () => { if (confirm("Supprimer ?")) { try { await opts.onDelete(); d.close(); } catch (err) { toast(err.message); } } };
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      try { await onSave(data); d.close(); } catch (err) { toast(err.message); }
    });
    d.addEventListener("close", () => d.remove());
    d.showModal();
    return d;
  }

  /* ---------- Vols ---------- */
  const hm = iso => iso ? iso.slice(11, 16).replace(":", "h") : "?";
  const minOf = iso => iso ? (+iso.slice(11, 13)) * 60 + (+iso.slice(14, 16)) : null;
  const fmtMin = m => { m = ((m % 1440) + 1440) % 1440; return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`; };
  function trip() { return (state && state.trip) || {}; }
  function flightPlan() {
    const t = trip(), out = t.out, ret = t.ret, plan = {};
    if (out && out.arr) plan.home = minOf(out.arr) + 50;             // bagages + taxi 20 min
    if (ret && ret.dep) { plan.leave = minOf(ret.dep) - 125; plan.lastStop = plan.leave - 45; } // taxi 25 min + 1h40 d’avance
    return plan;
  }
  function flightItems(key) {
    const t = trip(), p = flightPlan(), out = [];
    const inProg = num => num && S("proposals").some(p => (p.body || "").includes(num));
    if (key === "mer" && t.out && !inProg(t.out.num)) {
      out.push({ id: "fl-out", flight: true, time_label: hm(t.out.dep), body: `✈️ Décollage ${t.out.num || ""} de Toulouse`, tip: t.out.num ? `Suivi en direct : bouton « Suivre le vol ».` : "" });
      if (t.out.arr) out.push({ id: "fl-arr", flight: true, time_label: hm(t.out.arr), body: `🛬 Atterrissage à Séville — à l’appartement vers ${fmtMin(p.home)}`, tip: "Taxi officiel à la sortie, tarif forfaitaire affiché." });
    }
    if (key === "sam" && t.ret && t.ret.dep) {
      if (!inProg(t.ret.num)) out.push({ id: "fl-leave", flight: true, time_label: fmtMin(p.leave), body: `🧳 Départ de l’appartement pour l’aéroport (vol ${t.ret.num || ""} à ${hm(t.ret.dep)})`, tip: `Terminer la dernière étape vers ${fmtMin(p.lastStop)}. Réserver un taxi 30 min avant.` });
      out.push({ id: "fl-ret", flight: true, time_label: hm(t.ret.dep), body: `✈️ Décollage ${t.ret.num || ""} vers Toulouse`, tip: "" });
    }
    return out;
  }
  function flightCard() {
    const t = trip(), p = flightPlan();
    const one = (k, lbl) => {
      const f = t[k];
      if (!f) return `<div class="fl"><div class="small muted">${lbl}</div><p class="muted">Non renseigné</p></div>`;
      const links = f.num ? `<a href="https://www.flightradar24.com/data/flights/${encodeURIComponent(f.num.replace(/\s/g, "").toLowerCase())}" target="_blank" rel="noopener">Suivre le vol</a> · <a href="https://www.flightaware.com/live/flight/${encodeURIComponent(f.num.replace(/\s/g, ""))}" target="_blank" rel="noopener">FlightAware</a>` : "";
      return `<div class="fl"><div class="small muted">${lbl}</div><strong>${esc(f.num || "Vol")}</strong> · ${esc(f.date || "")} <br>🛫 ${hm(f.dep)} → 🛬 ${hm(f.arr)}
        ${f.ref ? `<div class="small">Réf. <strong>${esc(f.ref)}</strong></div>` : ""}<div class="small">${links}</div></div>`;
    };
    return `<div class="card flights"><div class="book-top"><h3>✈️ Nos vols</h3>${me ? `<button class="icon-btn" data-flights title="Modifier">✏️</button>` : ""}</div>
      <div class="fl-row">${one("out", "Aller · mer. 30 sept.")}${one("ret", "Retour · sam. 3 oct.")}</div>
      ${p.home != null ? `<p class="small">🏠 Arrivée estimée à l’appartement : <strong>${fmtMin(p.home)}</strong></p>` : ""}
      ${p.leave != null ? `<p class="small">🧳 Samedi : quitter l’appartement à <strong>${fmtMin(p.leave)}</strong>, dernière étape jusqu’à ${fmtMin(p.lastStop)}.</p>` : ""}
      ${!t.out && !t.ret ? `<p class="small muted">Renseignez les numéros et horaires : le mercredi et le samedi se recalculent tout seuls, avec rappel « partir pour l’aéroport ».</p>` : ""}</div>`;
  }
  function editFlights() {
    const t = trip(), o = t.out || {}, r = t.ret || {};
    const tm = iso => iso ? iso.slice(11, 16) : "";
    formDialog("Nos vols", [
      { type: "row", items: [{ name: "o_num", label: "Aller : n° de vol", value: o.num, ph: "V7 1234" }, { name: "o_ref", label: "Réf. réservation", value: o.ref }] },
      { type: "row", items: [{ name: "o_dep", label: "Décollage (mer. 30)", type: "time", value: tm(o.dep) }, { name: "o_arr", label: "Atterrissage", type: "time", value: tm(o.arr) }] },
      { type: "row", items: [{ name: "r_num", label: "Retour : n° de vol", value: r.num, ph: "V7 1235" }, { name: "r_ref", label: "Réf. réservation", value: r.ref }] },
      { type: "row", items: [{ name: "r_dep", label: "Décollage (sam. 3)", type: "time", value: tm(r.dep) }, { name: "r_arr", label: "Atterrissage", type: "time", value: tm(r.arr) }] }
    ], async d => {
      const next = date => { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
      const mk = (date, dep, arr, num, ref) => ({ date, num: num.trim().toUpperCase(), ref: ref.trim(), dep: dep ? `${date}T${dep}` : null,
        arr: arr ? `${dep && arr < dep ? next(date) : date}T${arr}` : null });
      await rpc("guide_save_trip", { p_author: me.name, p_key: "out", p_data: mk("2026-09-30", d.o_dep, d.o_arr, d.o_num, d.o_ref) });
      await rpc("guide_save_trip", { p_author: me.name, p_key: "ret", p_data: mk("2026-10-03", d.r_dep, d.r_arr, d.r_num, d.r_ref) });
      await refresh(); toast("Vols enregistrés ✈️");
    });
  }

  /* ---------- Rappels sur ce téléphone ---------- */
  const notified = new Set(store.get("sev-notified", []));
  async function enableReminders() {
    if (!("Notification" in window)) return toast("Notifications non disponibles ici (sur iPhone : ajoutez l’appli à l’écran d’accueil).", 5000);
    const p = await Notification.requestPermission();
    store.set("sev-remind", p === "granted");
    toast(p === "granted" ? "🔔 Rappels activés sur ce téléphone" : "Rappels refusés", 3000); renderNow();
  }
  async function notify(title, body, tag) {
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) reg.showNotification(title, { body, tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png" });
      else new Notification(title, { body, tag });
    } catch (e) {}
  }
  function checkReminders() {
    if (!store.get("sev-remind", false) || !("Notification" in window) || Notification.permission !== "granted") return;
    const n = madridNow(), key = DATE_DAY[n.date]; if (!key) return;
    const items = [...itemsForDay(key).filter(it => voteStatus(it.id).s !== "ko"), ...flightItems(key)];
    items.forEach(it => {
      const t = timeKey(it.time_label), delta = t - n.min, id = key + ":" + (it.id || it.body);
      if (delta > 0 && delta <= 40 && !notified.has(id)) {
        notified.add(id); store.set("sev-notified", [...notified]);
        const p = it.place_id && byId[it.place_id];
        const bk = S("bookings").find(b => b.day === key && p && b.place_id === p.id && b.ref);
        notify(`Dans ${delta} min · ${it.time_label}`, `${(it.body || "").replace(/^🗳\s*/, "")}${p ? " — " + p.name : ""}${bk ? ` (réf. ${bk.ref})` : ""}`, id);
      }
    });
  }
  setInterval(checkReminders, 60000);

  /* ---------- Stockage local (IndexedDB) pour billets hors ligne ---------- */
  const idb = (() => {
    let dbp;
    const open = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open("sev-files", 1); r.onupgradeneeded = () => r.result.createObjectStore("f"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
    const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction("f", mode); const q = fn(t.objectStore("f")); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
    return { get: k => tx("readonly", s => s.get(k)).catch(() => null), set: (k, v) => tx("readwrite", s => s.put(v, k)).catch(() => null), keys: () => tx("readonly", s => s.getAllKeys()).catch(() => []) };
  })();
  async function prefetchFiles() {
    if (!me || !online) return;
    const have = new Set(await idb.keys());
    for (const f of S("files")) if (!have.has(f.id)) { try { const x = await rpc("guide_get_file", { p_id: f.id }); if (x) await idb.set(f.id, x); } catch (e) {} }
    document.querySelectorAll("[data-file]").forEach(async b => { if (await idb.get(b.dataset.file)) b.classList.add("offline-ok"); });
  }
  async function openFile(id) {
    let f = await idb.get(id);
    if (!f) { try { f = await rpc("guide_get_file", { p_id: id }); if (f) idb.set(id, f); } catch (err) { return toast(err.message); } }
    if (!f) return toast("Fichier introuvable.");
    const bin = atob(f.data.split(",")[1]), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: f.mime }));
    const w = window.open(url, "_blank"); if (!w) location.href = url;
  }
  let fileBooking = null;
  const fileInput = document.createElement("input");
  fileInput.type = "file"; fileInput.accept = "application/pdf,image/*"; fileInput.hidden = true; document.body.appendChild(fileInput);
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0]; fileInput.value = ""; if (!f || !fileBooking) return;
    try {
      toast("Envoi du billet…", 20000);
      let data, mime = f.type;
      if (/^image\//.test(mime)) { data = await resize(f, 1800, 0.85); mime = "image/jpeg"; }
      else if (mime === "application/pdf") {
        if (f.size > 2.3e6) throw new Error("PDF trop lourd (max 2,3 Mo). Faites une capture d’écran du QR code.");
        data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      } else throw new Error("Format non pris en charge (PDF ou image).");
      const id = await rpc("guide_add_file", { p_author: me.name, p_booking: fileBooking, p_name: f.name, p_mime: mime, p_data: data });
      await idb.set(id, { id, name: f.name, mime, data });
      await refresh(); toast("Billet ajouté 🎟 (disponible hors ligne)");
    } catch (err) { toast(err.message, 5000); }
  });

  /* ---------- Veille des places ---------- */
  function watchPanel() {
    const w = S("watch"); if (!w.length) return "";
    const last = w.reduce((m, x) => x.checked_at > m ? x.checked_at : m, "");
    return `<div class="card watch"><h3>🔔 Veille des places <span class="muted small">· vérifiée ${ago(last)} · toutes les 2 h</span></h3>
      <ul>${w.map(x => `<li><span class="wbadge ${x.status}">${x.status === "dispo" ? "dispo" : "complet"}</span> <strong>${esc(x.label)}</strong>
        <div class="small muted">${esc(x.detail || "")}${x.status === "dispo" && x.changed_at && Date.now() - new Date(x.changed_at) < 6 * 3600e3 ? " · <b>nouveau</b>" : ""}</div></li>`).join("")}</ul>
      <p class="small muted">Les créneaux libérés sont signalés ici et par notification. Réservez sur le site officiel.</p></div>`;
  }

  /* ---------- On improvise ---------- */
  const TYPICAL = { tapas: [["12:30", "16:30"], ["20:00", "24:00"]], table: [["13:30", "16:00"], ["20:30", "23:30"]], nuit: [["21:00", "26:00"]], marche: [["09:00", "14:30"]], monument: [["10:00", "18:00"]] };
  function typicalOpen(p, min) {
    const r = TYPICAL[p.cat]; if (!r) return false;
    const toM = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const m = min < 360 ? min + 1440 : min;
    return r.some(([o, c]) => m >= toM(o) && m < toM(c));
  }
  async function improvise() {
    let pos = myPos;
    if (!pos) { try { pos = await locateMe(); } catch (e) { pos = [byId.apt.lat, byId.apt.lng]; toast("Position indisponible : suggestions autour de l’appartement."); } }
    const n = madridNow(), min = n.min;
    const moment = min < 690 ? "petit-déj / balade" : min < 900 ? "apéro & déjeuner" : min < 1140 ? "visite / pause" : min < 1290 ? "apéro & tapas" : min < 1410 ? "dîner" : "dernier verre";
    const cats = min < 690 ? ["tapas", "marche", "monument"] : min < 900 ? ["tapas", "table", "marche"] : min < 1140 ? ["monument", "tapas"] : min < 1290 ? ["tapas", "nuit"] : min < 1410 ? ["tapas", "table", "nuit"] : ["nuit", "tapas"];
    let cand = PLACES.filter(p => cats.includes(p.cat) && p.cat !== "base").map(p => {
      const o = openInfo(p); const open = o ? o.open : typicalOpen(p, min);
      return { p, km: distKm(pos, [p.lat, p.lng]), open, verified: !!o };
    }).filter(x => x.open && x.km < 1.2).sort((a, b) => a.km - b.km).slice(0, 3);
    let neb = [];
    if (DATE_DAY[n.date] === "ven" && min >= 1080) neb = NEB.filter(a => !a.full).map(a => ({ a, km: distKm(pos, [a.lat, a.lng]) })).filter(x => x.km < 0.8).sort((a, b) => a.km - b.km).slice(0, 2);
    const box = $("#improv");
    box.innerHTML = `<h4>🎲 On improvise · ${moment}</h4>${cand.length || neb.length ? `<ul class="plain">${cand.map(x => `<li><strong>${esc(x.p.name)}</strong> <span class="muted small">· ${walkMin(x.km)} min à pied${x.verified ? "" : " · horaires habituels"}</span>
        <div class="small">${esc(x.p.order ? "👉 " + x.p.order : x.p.desc.slice(0, 90) + "…")}</div>
        <div class="now-links"><a class="btn sm" href="${walkTo(x.p)}" target="_blank" rel="noopener">🚶 Y aller</a><button class="btn sm ghost" data-map="${x.p.id}">Carte</button></div></li>`).join("")}
        ${neb.map(x => `<li>✦ <strong>${esc(x.a.t)}</strong> <span class="muted small">· ${walkMin(x.km)} min · ${esc(x.a.h)} · ${esc(x.a.p)}</span><div class="now-links"><a class="btn sm" href="${walkTo(x.a)}" target="_blank" rel="noopener">🚶 Y aller</a></div></li>`).join("")}</ul>`
        : `<p class="muted">Rien d’ouvert tout près dans notre sélection : ouvrez la carte, ou demandez « ¿Dónde se tapea bien por aquí? » 😉</p>`}`;
    box.hidden = false; box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ---------- Audio (prononciation) ---------- */
  function speak(text) {
    if (!("speechSynthesis" in window)) return toast("Synthèse vocale non disponible sur cet appareil.");
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = "es-ES"; u.rate = 0.9;
    const v = speechSynthesis.getVoices().find(v => /^es(-ES)?/i.test(v.lang)); if (v) u.voice = v;
    speechSynthesis.speak(u);
  }
  const PHRASES = [
    ["Buenas, ¿tenéis sitio para cuatro?", "Bonjour, vous avez de la place pour quatre ?"],
    ["¿Qué nos recomienda?", "Que nous conseillez-vous ?"],
    ["Una tapa de espinacas con garbanzos, por favor.", "Une tapa d’épinards aux pois chiches"],
    ["Dos cañas y dos finos bien fríos.", "Deux pressions et deux finos bien frais"],
    ["Media ración de boquerones en adobo.", "Une demi-portion d’anchois marinés frits"],
    ["Un montadito de pringá.", "Un petit sandwich de pringá"],
    ["¿Qué hay fuera de carta hoy?", "Qu’y a-t-il hors carte aujourd’hui ?"],
    ["Otra ronda, por favor.", "Une autre tournée, s’il vous plaît"],
    ["¿Nos cobras, por favor?", "L’addition, s’il vous plaît (familier)"],
    ["Tenemos una reserva a nombre de Puechoultres.", "Nous avons une réservation au nom de…"],
    ["¡Estaba todo buenísimo!", "C’était délicieux !"],
    ["¿Dónde se tapea bien por aquí?", "Où mange-t-on bien des tapas par ici ?"]
  ];
  function renderPhrases() {
    const box = $("#phrases"); if (!box) return;
    box.innerHTML = `<h3>🔊 Commander à l’oral</h3><p class="small muted">Touchez une phrase pour l’entendre (voix espagnole de votre téléphone).</p>
      <ul class="phr">${PHRASES.map(([es, fr]) => `<li><button class="say" data-say="${esc(es)}">🔊</button><div><strong>${esc(es)}</strong><div class="small muted">${esc(fr)}</div></div></li>`).join("")}</ul>`;
  }

  /* ---------- Positions partagées ---------- */
  const posLayer = L.layerGroup().addTo(map);
  let posWatch = null, lastSent = 0, sharingUntil = store.get("sev-share-until", 0);
  async function startSharing() {
    if (!me) return toast("Identifiez-vous d’abord.");
    if (!navigator.geolocation) return toast("Géolocalisation indisponible.");
    sharingUntil = Date.now() + 2 * 3600e3; store.set("sev-share-until", sharingUntil);
    posWatch = navigator.geolocation.watchPosition(async p => {
      myPos = [p.coords.latitude, p.coords.longitude];
      if (Date.now() > sharingUntil) return stopSharing();
      if (Date.now() - lastSent < 55000) return;
      lastSent = Date.now();
      try { await rpc("guide_share_pos", { p_author: me.name, p_lat: myPos[0], p_lng: myPos[1], p_acc: p.coords.accuracy, p_minutes: Math.round((sharingUntil - Date.now()) / 60000) }); }
      catch (err) { toast(/check constraint|lat|lng/.test(err.message) ? "Vous n’êtes pas à Séville : position non partagée." : err.message, 4000); stopSharing(); }
    }, () => { toast("Position non disponible."); stopSharing(); }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 });
    renderShareBtn(); toast("📡 Position partagée avec le groupe pendant 2 h");
  }
  async function stopSharing() {
    if (posWatch != null) navigator.geolocation.clearWatch(posWatch); posWatch = null;
    sharingUntil = 0; store.set("sev-share-until", 0); lastSent = 0;
    try { if (me) await rpc("guide_stop_pos", { p_author: me.name }); } catch (e) {}
    renderShareBtn(); refresh(true);
  }
  const shareBtn = document.createElement("button"); shareBtn.className = "btn ghost"; shareBtn.id = "shareBtn";
  shareBtn.onclick = () => posWatch != null ? stopSharing() : startSharing();
  $(".map-actions").appendChild(shareBtn);
  function renderShareBtn() { shareBtn.textContent = posWatch != null ? "📡 Arrêter le partage" : "📡 Où êtes-vous ? (partager 2 h)"; shareBtn.classList.toggle("sharing", posWatch != null); }
  function renderPositions() {
    posLayer.clearLayers();
    S("positions").filter(p => !me || !same(p.author, me.name)).forEach(p => {
      L.marker([p.lat, p.lng], { zIndexOffset: 3000, icon: L.divIcon({ className: "", iconSize: [34, 34], iconAnchor: [17, 17], html: `<div class="pos-pin" style="background:${colorOf(p.author)}">${esc(p.author[0].toUpperCase())}</div>` }) })
        .bindPopup(`<strong>${esc(p.author)}</strong><br><span class="small">${ago(p.updated_at)}${myPos ? ` · ${walkMin(distKm(myPos, [p.lat, p.lng]))} min à pied` : ""}</span><br><a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking" target="_blank" rel="noopener">Le/la rejoindre</a>`)
        .addTo(posLayer);
    });
  }
  if (sharingUntil > Date.now() && me) startSharing(); else renderShareBtn();

  /* ---------- Dégustations ---------- */
  const KIND = { tapa: "🍤 Tapa", vin: "🍷 Vin", dessert: "🍮 Dessert", cocktail: "🍸 Cocktail", autre: "✨ Autre" };
  const placeName = t => t.place_id && byId[t.place_id] ? byId[t.place_id].name : (t.place_free || "");
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  function ranking(kinds) {
    const g = {};
    S("tastings").filter(t => kinds.includes(t.kind)).forEach(t => {
      const k = norm(t.item) + "|" + norm(placeName(t));
      (g[k] = g[k] || { item: t.item, place: placeName(t), kind: t.kind, notes: [] }).notes.push(t);
    });
    return Object.values(g).map(x => ({ ...x, avg: x.notes.reduce((s, t) => s + t.rating, 0) / x.notes.length }))
      .sort((a, b) => b.avg - a.avg || b.notes.length - a.notes.length);
  }
  const starsTxt = n => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
  function editTasting(t) {
    const places = PLACES.filter(p => ["tapas", "table", "nuit", "marche"].includes(p.cat));
    formDialog(t ? "Modifier ma note" : "Noter une dégustation", [
      { type: "row", items: [{ type: "select", name: "kind", label: "Type", value: t ? t.kind : "tapa", options: Object.entries(KIND) }, { type: "stars", name: "rating", label: "Note", value: t ? t.rating : 4 }] },
      { name: "item", label: "Quoi", value: t ? t.item : "", required: true, ph: "Espinacas con garbanzos, fino La Ina…", list: "dishList" },
      { type: "select", name: "place", label: "Où", value: t ? (t.place_id || "") : "", options: [["", "— autre / hors liste —"], ...places.map(p => [p.id, p.name])] },
      { name: "place_free", label: "Autre lieu (si hors liste)", value: t ? (t.place_free || "") : "" },
      { type: "textarea", name: "note", label: "Commentaire", value: t ? (t.note || "") : "" }
    ], async d => {
      if (!+d.rating) throw new Error("Choisissez une note (étoiles).");
      await rpc("guide_save_tasting", { p_author: me.name, p_id: t ? t.id : null, p_kind: d.kind, p_item: d.item, p_place: d.place, p_place_free: d.place_free, p_rating: +d.rating, p_note: d.note });
      await refresh(); toast("Note enregistrée ⭐");
    }, t ? { onDelete: async () => { await rpc("guide_delete_tasting", { p_author: me.name, p_id: t.id }); await refresh(); } } : null);
  }
  function renderTastings() {
    const box = $("#degustBox"); if (!box) return;
    if (!me) { box.innerHTML = `<p class="notice">Identifiez-vous pour noter tapas et vins.</p>`; return; }
    const all = S("tastings"), mine = all.filter(t => same(t.author, me.name));
    const dishes = [...new Set(all.map(t => t.item))];
    const podium = (title, list) => `<div class="card"><h3>${title}</h3>${list.length ? `<ol class="podium">${list.slice(0, 5).map((x, i) => `<li><span class="rank">${["🥇", "🥈", "🥉", "4", "5"][i]}</span><div><strong>${esc(x.item)}</strong>${x.place ? ` <span class="muted small">· ${esc(x.place)}</span>` : ""}
        <div class="small"><span class="stars-txt">${starsTxt(x.avg)}</span> ${x.avg.toFixed(1)} · ${x.notes.length} note${x.notes.length > 1 ? "s" : ""} (${x.notes.map(n => esc(n.author)).join(", ")})</div></div></li>`).join("")}</ol>` : `<p class="muted small">Pas encore de note.</p>`}</div>`;
    box.innerHTML = `<datalist id="dishList">${dishes.map(d => `<option value="${esc(d)}">`).join("")}</datalist>
      <div class="album-actions"><button class="btn" id="addTaste">⭐ Noter une dégustation</button></div>
      <div class="grid2">${podium("🏆 Meilleures tapas", ranking(["tapa", "dessert"]))}${podium("🍷 Meilleurs vins & verres", ranking(["vin", "cocktail"]))}</div>
      ${all.length ? `<div class="card exp-list"><h3>Toutes les notes (${all.length})</h3><ul>${all.slice().reverse().map(t => `<li><div>${KIND[t.kind].split(" ")[0]} <strong>${esc(t.item)}</strong> <span class="stars-txt">${starsTxt(t.rating)}</span>
        <div class="small muted">${esc(t.author)}${placeName(t) ? " · " + esc(placeName(t)) : ""} · ${ago(t.created_at)}${t.note ? " — " + esc(t.note) : ""}</div></div>
        ${same(t.author, me.name) ? `<button class="icon-btn" data-taste="${t.id}">✏️</button>` : ""}</li>`).join("")}</ul></div>` : ""}`;
    $("#addTaste").onclick = () => editTasting(null);
  }

  /* ---------- Téléchargement groupé (zip) ---------- */
  function loadJSZip() {
    return window.JSZip ? Promise.resolve(window.JSZip) : new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.onload = () => res(window.JSZip); s.onerror = () => rej(new Error("Impossible de charger l’outil zip.")); document.head.appendChild(s);
    });
  }
  async function downloadAlbum() {
    const ps = S("photos"); if (!ps.length) return toast("Aucune photo.");
    try {
      const JSZip = await loadJSZip(), zip = new JSZip();
      let i = 0;
      for (const p of ps) {
        toast(`Préparation ${++i}/${ps.length}…`, 30000);
        const full = await rpc("guide_photo_full", { p_id: p.id }); if (!full) continue;
        const day = dayLabel(targetDay(p.target)) || "divers";
        zip.file(`${day.replace(/\s/g, "-")}_${String(i).padStart(3, "0")}_${p.author}.jpg`, full.split(",")[1], { base64: true });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "Puechoultres-Devesa-Seville-photos.zip"; a.click();
      toast("Album téléchargé 📦");
    } catch (err) { toast(err.message, 4000); }
  }

  /* ---------- Carte SVG du parcours (carnet) ---------- */
  function routeSvg() {
    const days = DAYS.map((d, i) => ({ d, color: ["#6b4fa3", "#b5452b", "#1f5f8b", "#2f7d4f"][i],
      pts: itemsForDay(d.key).filter(it => it.place_id && byId[it.place_id] && voteStatus(it.id).s !== "ko").map(it => byId[it.place_id]) }));
    const all = days.flatMap(x => x.pts); if (!all.length) return "";
    const lats = all.map(p => p.lat), lngs = all.map(p => p.lng);
    const [a, b, c, e] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    const W = 600, H = 420, pad = 30, kx = (W - 2 * pad) / ((e - c) || 1), ky = (H - 2 * pad) / ((b - a) || 1), k = Math.min(kx, ky / 1.25);
    const X = p => pad + (p.lng - c) * k, Y = p => H - pad - (p.lat - a) * k * 1.25;
    return `<svg viewBox="0 0 ${W} ${H}" class="route-svg" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#fbf6ec"/>
      ${days.map(x => `<polyline fill="none" stroke="${x.color}" stroke-width="3" stroke-dasharray="6 4" points="${x.pts.map(p => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(" ")}"/>
        ${x.pts.map(p => `<circle cx="${X(p).toFixed(1)}" cy="${Y(p).toFixed(1)}" r="4" fill="${x.color}"/>`).join("")}`).join("")}
      <circle cx="${X(byId.apt)}" cy="${Y(byId.apt)}" r="7" fill="#1f2a44"/><text x="${X(byId.apt) + 9}" y="${Y(byId.apt) + 4}" font-size="11" font-family="sans-serif">appart.</text>
      ${days.map((x, i) => `<rect x="${pad + i * 140}" y="8" width="10" height="10" fill="${x.color}"/><text x="${pad + i * 140 + 14}" y="17" font-size="11" font-family="sans-serif">${esc(x.d.label)}</text>`).join("")}</svg>`;
  }

  /* ---------- Événements v4 ---------- */
  document.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("[data-flights]")) return editFlights();
    if (t.closest("#remindBtn")) return enableReminders();
    if (t.closest("#improvBtn")) return improvise();
    const say = t.closest("[data-say]"); if (say) return speak(say.dataset.say);
    const fa = t.closest("[data-attach]"); if (fa) { fileBooking = fa.dataset.attach; fileInput.click(); return; }
    const fo = t.closest("[data-file]"); if (fo) return openFile(fo.dataset.file);
    const fd = t.closest("[data-file-del]"); if (fd) { if (confirm("Retirer ce billet ?")) rpc("guide_delete_file", { p_id: fd.dataset.fileDel }).then(() => refresh()).catch(err => toast(err.message)); return; }
    const tt = t.closest("[data-taste]"); if (tt) return editTasting(S("tastings").find(x => x.id === tt.dataset.taste));
    if (t.closest("#zipBtn")) return downloadAlbum();
  });

  function renderV4() {
    renderPositions(); renderTastings(); renderPhrases();
    const ro = $("#roBanner"); if (ro) ro.hidden = !(state && state.read_only);
    const pd = $("#photoDlg"); if (pd.open && pd.dataset.current) $("#photoReacts").innerHTML = `<div class="social">${reactionBar("photo:" + pd.dataset.current, { noPhoto: true })}${thread("photo:" + pd.dataset.current)}</div>`;
    checkReminders(); prefetchFiles();
  }

  /* ================================================================
     v5 — Navigation par onglets + Journal « qui a fait quoi »
     ================================================================ */
  const VIEWS = ["accueil", "programme", "carte", "resa", "plus", "journal", "depenses", "album", "degust", "adresses", "pratique"];
  const PARENT = { journal: "plus", depenses: "plus", album: "plus", degust: "plus", adresses: "plus", pratique: "plus" };
  const TITLES = { journal: "Journal", depenses: "Dépenses", album: "Album", degust: "Dégustations", adresses: "Adresses", pratique: "Pratique" };
  let view = "accueil";
  function go(v, opts) {
    if (!VIEWS.includes(v)) v = "accueil";
    view = v;
    document.querySelectorAll("[data-view]").forEach(el => { el.hidden = el.dataset.view !== v; });
    $("#login").hidden = !!me;
    $("#feed").hidden = v !== "accueil" || !me || !state;
    document.querySelectorAll("#nav [data-go]").forEach(a => a.classList.toggle("on", a.dataset.go === (PARENT[v] || v)));
    const back = $("#backBar");
    back.hidden = !PARENT[v]; back.querySelector("b").textContent = TITLES[v] || "";
    if (!opts || !opts.keepHash) history.replaceState(null, "", "#" + v);
    if (v === "carte") setTimeout(() => map.invalidateSize(), 60);
    if (v === "journal") loadJournal();
    renderInstall();
    window.scrollTo({ top: 0 });
  }
  const backBar = document.createElement("div");
  backBar.id = "backBar"; backBar.className = "back-bar"; backBar.hidden = true;
  backBar.innerHTML = `<button class="link" data-go="plus">‹ Plus</button><b></b>`;
  $("main").prepend(backBar);
  document.addEventListener("click", e => {
    const g = e.target.closest("[data-go]"); if (!g) return;
    e.preventDefault(); go(g.dataset.go);
  });
  window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (VIEWS.includes(v) && v !== view) go(v, { keepHash: true }); });

  /* ---------- Journal ---------- */
  let journal = [], journalFilter = { who: "", kind: "", item: "" };
  const who = n => (!n || n === "Guide") ? "Assistant" : n.replace(/\s*\(restauration\)$/, "");
  const ENT = { proposals: "📅 Programme", bookings: "🎟 Réservations", trip: "✈️ Vols", expenses: "💶 Dépenses" };
  const short = (s, n) => { s = String(s || "").replace(/^🗳\s*/, ""); return s.length > (n || 60) ? s.slice(0, n || 60) + "…" : s; };
  function diffLines(a) {
    const b = a.before || {}, n = a.after || {}, out = [];
    if (a.action !== "modif") return out;
    if (a.entity === "proposals") {
      if (b.day !== n.day) out.push(`jour : ${dayName(b.day)} → <b>${dayName(n.day)}</b>`);
      if (b.time_label !== n.time_label) out.push(`heure : ${esc(b.time_label || "—")} → <b>${esc(n.time_label || "—")}</b>`);
      if (b.body !== n.body) out.push(`texte : <s>${esc(short(b.body, 80))}</s> → <b>${esc(short(n.body, 80))}</b>`);
      if ((b.tip || "") !== (n.tip || "")) out.push(`conseil modifié`);
      if ((b.place_id || "") !== (n.place_id || "")) out.push(`lieu : ${esc((byId[b.place_id] || {}).name || "—")} → <b>${esc((byId[n.place_id] || {}).name || "—")}</b>`);
    } else if (a.entity === "bookings") {
      [["status", "statut"], ["day", "jour"], ["time_label", "heure"], ["people", "personnes"], ["ref", "n° de confirmation"], ["title", "intitulé"]].forEach(([k, l]) => {
        if (String(b[k] ?? "") !== String(n[k] ?? "")) out.push(`${l} : ${esc(k === "day" ? dayName(b[k]) : (b[k] ?? "—"))} → <b>${esc(k === "day" ? dayName(n[k]) : (n[k] ?? "—"))}</b>`);
      });
      if ((b.notes || "") !== (n.notes || "")) out.push("notes modifiées");
    } else if (a.entity === "trip") {
      const x = b.data || {}, y = n.data || {};
      ["num", "dep", "arr", "ref"].forEach(k => { if ((x[k] || "") !== (y[k] || "")) out.push(`${{ num: "vol", dep: "départ", arr: "arrivée", ref: "réf." }[k]} : ${esc(k.length === 3 && x[k] && x[k].includes("T") ? hm(x[k]) : (x[k] || "—"))} → <b>${esc(k.length === 3 && y[k] && y[k].includes("T") ? hm(y[k]) : (y[k] || "—"))}</b>`); });
    } else if (a.entity === "expenses") {
      if (+b.amount !== +n.amount) out.push(`montant : ${euro(+b.amount)} → <b>${euro(+n.amount)}</b>`);
      if (b.label !== n.label) out.push(`libellé : ${esc(b.label)} → <b>${esc(n.label)}</b>`);
    }
    return out;
  }
  function verb(a) {
    const what = { proposals: "l’étape", bookings: "la réservation", trip: "le vol", expenses: "la dépense" }[a.entity] || "l’élément";
    const v = { ajout: "a ajouté", modif: "a modifié", suppression: "a supprimé" }[a.action];
    return a.undo_of ? `a annulé une action sur ${what}` : `${v} ${what}`;
  }
  async function loadJournal() {
    const box = $("#journalBox");
    if (!me) { box.innerHTML = `<p class="notice">Identifiez-vous pour voir le journal.</p>`; return; }
    if (!journal.length) box.innerHTML = `<p class="muted">Chargement…</p>`;
    try { journal = await rpc("guide_activity"); renderJournal(); } catch (err) { box.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
  }
  function renderJournal() {
    const box = $("#journalBox"); if (!box) return;
    const people = [...new Set(journal.map(a => who(a.who)))];
    const f = journalFilter;
    const list = journal.filter(a => (!f.who || who(a.who) === f.who) && (!f.kind || a.entity === f.kind) && (!f.item || a.entity_id === f.item));
    let lastDay = "";
    box.innerHTML = `<div class="jfilters">
        <select id="jWho"><option value="">Tout le monde</option>${people.map(p => `<option ${p === f.who ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
        <select id="jKind"><option value="">Tout</option>${Object.entries(ENT).map(([k, l]) => `<option value="${k}" ${k === f.kind ? "selected" : ""}>${l}</option>`).join("")}</select>
        ${f.item ? `<button class="btn sm ghost" id="jAll">✕ Toutes les étapes</button>` : ""}</div>
      ${list.length ? `<ul class="journal">${list.map(a => {
        const d = new Date(a.at).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
        const head = d !== lastDay ? `<li class="jday">${d}</li>` : ""; lastDay = d;
        const lines = diffLines(a);
        const canUndo = !a.undone_by && !a.undo_of && !(state && state.read_only);
        return `${head}<li class="jitem ${a.undone_by ? "undone" : ""}">${avatar(who(a.who), true)}
          <div class="jbody"><div><strong>${esc(who(a.who))}</strong> ${verb(a)} <span class="muted">« ${esc(short(a.label))} »</span></div>
          ${lines.length ? `<ul class="jdiff">${lines.map(l => `<li>${l}</li>`).join("")}</ul>` : ""}
          <div class="small muted">${new Date(a.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · ${ENT[a.entity] || ""}${a.undone_by ? ` · <b>annulé par ${esc(who(a.undone_by))}</b>` : ""}</div></div>
          ${canUndo ? `<button class="btn sm ghost" data-undo="${a.id}">↩︎ Annuler</button>` : ""}</li>`;
      }).join("")}</ul>` : `<p class="muted">Aucune action pour ce filtre.</p>`}`;
    $("#jWho").onchange = e => { journalFilter.who = e.target.value; renderJournal(); };
    $("#jKind").onchange = e => { journalFilter.kind = e.target.value; renderJournal(); };
    const all = $("#jAll"); if (all) all.onclick = () => { journalFilter.item = ""; renderJournal(); };
  }
  document.addEventListener("click", async e => {
    const u = e.target.closest("[data-undo]");
    if (u) {
      const a = journal.find(x => x.id === +u.dataset.undo); if (!a) return;
      const what = { ajout: "Supprimer ce qui a été ajouté", modif: "Revenir à la version précédente", suppression: "Remettre ce qui a été supprimé" }[a.action];
      if (!confirm(`${what} ?\n« ${short(a.label, 80)} »`)) return;
      try { await rpc("guide_undo", { p_author: me.name, p_id: a.id }); toast("Action annulée ↩︎"); await refresh(); await loadJournal(); } catch (err) { toast(err.message, 4000); }
      return;
    }
    const h = e.target.closest("[data-hist]");
    if (h) { journalFilter = { who: "", kind: "", item: h.dataset.hist }; if (dlg.open) dlg.close(); go("journal"); }
  });


  /* ================================================================
     v6 — Bouton « Installer l’appli » (Android / iPhone)
     ================================================================ */
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isIOSSafari = isIOS && !/crios|fxios|edgios|opios|gsa\//i.test(ua);
  const isAndroid = /android/i.test(ua);
  const isInstalled = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function renderInstall() {
    const show = !isInstalled();
    document.querySelectorAll(".install-item").forEach(el => { el.hidden = !show; });
    const bar = $("#installBar");
    let later = 0; try { later = +localStorage.getItem("sev_install_later") || 0; } catch (e) {}
    bar.hidden = !show || (Date.now() - later < 3 * 864e5) || view !== "accueil";
    bar.dataset.ok = show ? "1" : "";
  }
  function installSteps() {
    const share = `<b class="ico">⬆︎</b>`;
    if (isIOS && !isIOSSafari) return `<p>Sur iPhone, l’ajout se fait depuis <b>Safari</b>.</p><ol><li>Copiez l’adresse de la page (ou le lien reçu) et ouvrez-la dans <b>Safari</b>.</li><li>Puis suivez les étapes : Partager ${share} → « Sur l’écran d’accueil ».</li></ol>`;
    if (isIOS) return `<ol class="isteps"><li>Touchez le bouton <b>Partager</b> ${share} en bas de Safari (en haut sur iPad).</li><li>Faites défiler et choisissez <b>« Sur l’écran d’accueil »</b> ➕.</li><li>Touchez <b>Ajouter</b> en haut à droite.</li></ol><p class="muted small">L’icône « P&amp;D Séville » apparaît sur l’écran d’accueil. Votre prénom est conservé.</p>`;
    if (isAndroid) return `<ol class="isteps"><li>Ouvrez le menu <b>⋮</b> de Chrome (en haut à droite).</li><li>Choisissez <b>« Installer l’application »</b> ou <b>« Ajouter à l’écran d’accueil »</b>.</li><li>Confirmez avec <b>Installer</b>.</li></ol><p class="muted small">Sur Samsung Internet : menu ☰ → « Ajouter la page à » → « Écran d’accueil ».</p>`;
    return `<p>Sur ordinateur (Chrome ou Edge) : cliquez sur l’icône d’installation ⊕ à droite de la barre d’adresse, ou menu ⋮ → « Installer… ».</p><p class="muted small">Sur téléphone, ouvrez ce lien dans Chrome (Android) ou Safari (iPhone).</p>`;
  }
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-install]"); if (!b) return;
    e.preventDefault();
    if (window.__bip) {
      const p = window.__bip; window.__bip = null;
      p.prompt();
      try { const r = await p.userChoice; if (r.outcome === "accepted") toast("Appli installée 🎉"); } catch (err) {}
      renderInstall(); return;
    }
    $("#installSteps").innerHTML = installSteps();
    $("#installDlg").showModal();
  });
  $("#installOk").onclick = () => $("#installDlg").close();
  $("#installLater").onclick = () => { try { localStorage.setItem("sev_install_later", Date.now()); } catch (e) {} $("#installBar").hidden = true; };
  document.addEventListener("bip", renderInstall);
  window.addEventListener("appinstalled", () => { window.__bip = null; renderInstall(); toast("Appli installée 🎉"); });

  /* ================================================================
     Rendu global + démarrage
     ================================================================ */
  function renderAll() { renderNow(); renderDay(); renderBookings(); renderExpenses(); renderAlbum(); renderPlaces(); renderFeed(); renderV4(); loadThumbs(); }
  renderWho();
  renderAll();
  go(VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "accueil", { keepHash: true });
  renderInstall();
  loadWeather();
  if (me) refresh();
})();
