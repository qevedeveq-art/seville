(function () {
  "use strict";
  const byId = Object.fromEntries(PLACES.map(p => [p.id, p]));
  const DAY_KEYS = DAYS.map(d => d.key);
  const EMOJIS = ["👍", "❤️", "😋", "🤔", "👎"];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const gmaps = p => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ", " + (p.addr || p.area) + ", Sevilla")}`;
  const $ = s => document.querySelector(s);

  /* =============== Session (prénom + code de groupe) =============== */
  let me = store.get("sev-me", null);           // { name, code }
  let state = null;                              // { proposals, comments, reactions }
  let currentDay = 0;
  const openThreads = new Set();

  // Lien d'invitation : https://…/seville/#code=xxxx (le fragment n'est jamais envoyé au serveur)
  const hashCode = new URLSearchParams(location.hash.slice(1)).get("code");
  if (hashCode) { $("#loginCode").value = hashCode; history.replaceState(null, "", location.pathname); }

  async function rpc(fn, args) {
    const r = await fetch(`${BACKEND.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: BACKEND.key, "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ p_code: me && me.code }, args || {}))
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      if (/code invalide/.test(e.message || "")) { logout(); throw new Error("Code de groupe invalide."); }
      throw new Error(e.message || `Erreur ${r.status}`);
    }
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function renderWho() {
    const who = $("#who");
    if (me) {
      who.innerHTML = `<span class="avatar" style="background:${colorOf(me.name)}">${esc(me.name[0].toUpperCase())}</span>
        <span>Connecté·e : <strong>${esc(me.name)}</strong></span> <button class="link" id="logout">changer</button>`;
      $("#logout").onclick = logout;
      $("#login").hidden = true;
    } else {
      who.innerHTML = "";
      $("#login").hidden = false;
    }
  }

  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("#loginName").value.trim().replace(/\s+/g, " ").slice(0, 30);
    const code = $("#loginCode").value.trim();
    if (!name || !code) return;
    me = { name: name[0].toUpperCase() + name.slice(1), code };
    try {
      await rpc("guide_check");
      store.set("sev-me", me); renderWho(); await refresh(); toast(`¡Hola ${me.name}! 👋`);
    } catch (err) { me = null; toast(err.message); }
  });

  function logout() { me = null; state = null; store.del("sev-me"); renderWho(); renderAll(); }

  const PALETTE = ["#b5452b", "#1f5f8b", "#2f7d4f", "#6b4fa3", "#7a2e52", "#b07a12"];
  function colorOf(name) { let h = 0; for (const c of String(name).toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }

  async function refresh(silent) {
    if (!me) return;
    try {
      const next = await rpc("guide_state");
      const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest(".c-form, #editForm, #loginForm");
      state = next;
      if (!(silent && (typing || dlg.open))) renderAll();
      $("#syncInfo").textContent = "Synchronisé à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    } catch (err) { if (!silent) toast(err.message); $("#syncInfo").textContent = "Hors ligne — affichage du dernier état connu"; }
  }
  setInterval(() => { if (me && document.visibilityState === "visible") refresh(true); }, 20000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(true); });

  /* =============== Helpers données partagées =============== */
  const commentsFor = t => (state ? state.comments.filter(c => c.target === t) : []);
  const reactionsFor = t => (state ? state.reactions.filter(r => r.target === t) : []);

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

  /* =============== Composants : réactions & fil de commentaires =============== */
  function reactionBar(target) {
    const rs = reactionsFor(target);
    return `<div class="reacts" data-target="${esc(target)}">${EMOJIS.map(e => {
      const who = rs.filter(r => r.emoji === e).map(r => r.author);
      const mine = me && who.some(a => a.toLowerCase() === me.name.toLowerCase());
      return `<button class="react ${mine ? "mine" : ""} ${who.length ? "" : "zero"}" data-emoji="${e}" title="${esc(who.join(", ") || "Réagir")}">${e}${who.length ? ` <b>${who.length}</b>` : ""}</button>`;
    }).join("")}
      <button class="react talk" data-thread="${esc(target)}">💬 ${commentsFor(target).length || ""}</button></div>`;
  }

  function thread(target) {
    const cs = commentsFor(target);
    return `<div class="thread" data-target="${esc(target)}" ${openThreads.has(target) ? "" : "hidden"}>
      ${cs.map(c => `<div class="msg"><span class="avatar sm" style="background:${colorOf(c.author)}">${esc(c.author[0].toUpperCase())}</span>
        <div><div class="meta"><strong>${esc(c.author)}</strong> · ${ago(c.created_at)}
        ${me && c.author.toLowerCase() === me.name.toLowerCase() ? `<button class="link del-c" data-id="${c.id}">supprimer</button>` : ""}</div>
        <div class="body">${esc(c.body)}</div></div></div>`).join("") || `<p class="muted small">Pas encore de commentaire.</p>`}
      <form class="c-form"><input name="body" maxlength="1000" placeholder="Votre avis, une idée…" autocomplete="off" required>
        <button class="btn sm">Envoyer</button></form></div>`;
  }

  function socialBlock(target) { return me ? reactionBar(target) + thread(target) : ""; }

  // Délégation d'événements globale
  document.addEventListener("click", async e => {
    const r = e.target.closest(".react[data-emoji]");
    if (r) {
      const target = r.parentElement.dataset.target;
      try { await rpc("guide_toggle_reaction", { p_author: me.name, p_target: target, p_emoji: r.dataset.emoji }); await refresh(); } catch (err) { toast(err.message); }
      return;
    }
    const t = e.target.closest(".react[data-thread]");
    if (t) {
      const target = t.dataset.thread;
      openThreads.has(target) ? openThreads.delete(target) : openThreads.add(target);
      const th = t.closest(".social").querySelector(`.thread`);
      if (th) { th.hidden = !openThreads.has(target); if (!th.hidden) th.querySelector("input").focus(); }
      return;
    }
    const dc = e.target.closest(".del-c");
    if (dc) {
      if (!confirm("Supprimer ce commentaire ?")) return;
      try { await rpc("guide_delete_comment", { p_author: me.name, p_id: dc.dataset.id }); await refresh(); } catch (err) { toast(err.message); }
      return;
    }
    const ed = e.target.closest("[data-edit]");
    if (ed) { openEditor(ed.dataset.edit); return; }
    const add = e.target.closest("[data-add]");
    if (add) { openEditor(null, add.dataset.add); return; }
    const sm = e.target.closest("[data-map]");
    if (sm) { showOnMap(sm.dataset.map); return; }
  });

  document.addEventListener("submit", async e => {
    const f = e.target.closest(".c-form");
    if (!f) return;
    e.preventDefault();
    const target = f.closest(".thread").dataset.target;
    const body = f.body.value.trim(); if (!body) return;
    f.querySelector("button").disabled = true;
    try { await rpc("guide_add_comment", { p_author: me.name, p_target: target, p_body: body }); openThreads.add(target); await refresh(); }
    catch (err) { toast(err.message); f.querySelector("button").disabled = false; }
  });

  /* =============== Éditeur de propositions =============== */
  const dlg = $("#editor"), ef = $("#editForm");
  ef.place.innerHTML = `<option value="">— aucun lieu —</option>` +
    Object.entries(CATEGORIES).map(([k, c]) => `<optgroup label="${esc(c.label)}">${PLACES.filter(p => p.cat === k)
      .map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</optgroup>`).join("");
  ef.day.innerHTML = DAYS.map(d => `<option value="${d.key}">${esc(d.title.split(" — ")[0])}</option>`).join("");

  function openEditor(id, day) {
    const p = id && state.proposals.find(x => x.id === id);
    $("#editTitle").textContent = p ? "Modifier la proposition" : "Nouvelle proposition";
    ef.id.value = p ? p.id : "";
    ef.day.value = p ? p.day : (day || DAY_KEYS[currentDay]);
    ef.time.value = p ? p.time_label : "";
    ef.body.value = p ? p.body : "";
    ef.tip.value = p ? (p.tip || "") : "";
    ef.place.value = p ? (p.place_id || "") : "";
    $("#delProp").hidden = !p;
    dlg.showModal();
  }
  $("#cancelEdit").onclick = () => dlg.close();
  $("#delProp").onclick = async () => {
    if (!confirm("Supprimer cette proposition (et ses commentaires) ?")) return;
    try { await rpc("guide_delete_proposal", { p_id: ef.id.value }); dlg.close(); await refresh(); toast("Proposition supprimée"); } catch (err) { toast(err.message); }
  };
  ef.addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await rpc("guide_save_proposal", {
        p_author: me.name, p_id: ef.id.value || null, p_day: ef.day.value, p_time: ef.time.value,
        p_body: ef.body.value, p_tip: ef.tip.value, p_place: ef.place.value
      });
      currentDay = DAY_KEYS.indexOf(ef.day.value);
      dlg.close(); await refresh(); toast("Enregistré ✔");
    } catch (err) { toast(err.message); }
  });

  /* =============== Compte à rebours =============== */
  (function () {
    const el = $("#countdown");
    const start = new Date("2026-09-30T18:00:00+02:00"), end = new Date("2026-10-03T23:59:00+02:00"), now = new Date();
    if (now < start) { const d = Math.ceil((start - now) / 864e5); el.textContent = d <= 1 ? "Départ demain soir ✈️" : `Départ dans ${d} jours ✈️`; }
    else if (now <= end) el.textContent = "¡Estamos en Sevilla! 💃";
    else el.textContent = "¡Hasta la próxima, Sevilla!";
  })();

  /* =============== Checklist =============== */
  (function () {
    const done = store.get("sev-todo", {});
    const ul = $("#todo");
    TODO.forEach(t => {
      const li = document.createElement("li");
      if (done[t.id]) li.classList.add("done");
      li.innerHTML = `<input type="checkbox" id="${t.id}" ${done[t.id] ? "checked" : ""}><label for="${t.id}">${esc(t.text)}</label>
        ${t.url ? `<a href="${t.url}" target="_blank" rel="noopener">Réserver →</a>` : ""}`;
      li.querySelector("input").addEventListener("change", e => { done[t.id] = e.target.checked; li.classList.toggle("done", e.target.checked); store.set("sev-todo", done); });
      ul.appendChild(li);
    });
  })();

  /* =============== Carte =============== */
  const map = L.map("map", { scrollWheelZoom: false }).setView([37.3905, -5.9920], 14);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  const layers = {}, markers = {};
  Object.keys(CATEGORIES).forEach(k => (layers[k] = L.layerGroup().addTo(map)));
  function popupHtml(p) {
    const c = CATEGORIES[p.cat];
    return `<h4>${esc(p.name)}</h4><div style="color:${c.color};font-weight:600;font-size:.8rem">${esc(c.label)} · ${esc(p.addr || p.area)}</div>
      <p>${esc(p.desc)}</p>${p.order ? `<p><strong>À commander :</strong> ${esc(p.order)}</p>` : ""}${p.tip ? `<p style="color:#6f6357">💡 ${esc(p.tip)}</p>` : ""}
      <div class="pop-links"><a href="${gmaps(p)}" target="_blank" rel="noopener">Itinéraire</a>${p.url ? `<a href="${p.url}" target="_blank" rel="noopener">Site</a>` : ""}</div>`;
  }
  PLACES.forEach(p => {
    const c = CATEGORIES[p.cat], big = p.cat === "base";
    const icon = L.divIcon({ className: "", iconSize: big ? [38, 38] : [30, 30], iconAnchor: big ? [19, 38] : [15, 30], popupAnchor: [0, -30],
      html: `<div class="pin ${big ? "big" : ""}" style="background:${c.color}"><span>${c.icon}</span></div>` });
    markers[p.id] = L.marker([p.lat, p.lng], { icon, title: p.name, zIndexOffset: big ? 1000 : 0 }).bindPopup(popupHtml(p), { maxWidth: 290 }).addTo(layers[p.cat]);
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
  function showOnMap(id) {
    const p = byId[id]; if (!p) return;
    if (!map.hasLayer(layers[p.cat])) { map.addLayer(layers[p.cat]); filters.querySelector(`[data-cat="${p.cat}"]`).classList.remove("off"); }
    $("#carte").scrollIntoView({ behavior: "smooth" });
    setTimeout(() => { map.setView([p.lat, p.lng], 17); markers[id].openPopup(); }, 350);
  }
  $("#fitAll").onclick = () => map.fitBounds(allBounds, { padding: [20, 20] });
  let meDot;
  $("#locate").onclick = () => {
    if (!navigator.geolocation) return toast("Géolocalisation indisponible.");
    navigator.geolocation.getCurrentPosition(pos => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      if (meDot) meDot.setLatLng(ll); else meDot = L.circleMarker(ll, { radius: 9, color: "#fff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1 }).addTo(map).bindPopup("Vous êtes ici");
      map.setView(ll, 16); meDot.openPopup();
    }, () => toast("Position non disponible (autorisez la localisation)."), { enableHighAccuracy: true, timeout: 10000 });
  };

  /* =============== Programme =============== */
  const tabs = $("#dayTabs"), panel = $("#dayPanel");
  DAYS.forEach((d, i) => {
    const b = document.createElement("button");
    b.setAttribute("role", "tab"); b.textContent = d.label;
    b.addEventListener("click", () => { currentDay = i; store.set("sev-day", i); renderDay(); });
    tabs.appendChild(b);
  });
  const todayIdx = { "2026-09-30": 0, "2026-10-01": 1, "2026-10-02": 2, "2026-10-03": 3 }[new Date().toISOString().slice(0, 10)];
  currentDay = todayIdx ?? Math.min(store.get("sev-day", 0), DAYS.length - 1);

  function itemsForDay(key) {
    if (state) return state.proposals.filter(p => p.day === key)
      .sort((a, b) => timeKey(a.time_label) - timeKey(b.time_label) || new Date(a.created_at) - new Date(b.created_at));
    // mode hors connexion : programme de base, lecture seule
    return DAYS.find(d => d.key === key).items.map(it => ({ time_label: it.time, body: it.text, place_id: it.place }));
  }

  const seenDays = new Set();
  function renderDay() {
    const d = DAYS[currentDay];
    if (!seenDays.has(d.key)) { seenDays.add(d.key); openThreads.add("day:" + d.key); } // discussion du jour ouverte par défaut
    [...tabs.children].forEach((b, j) => b.setAttribute("aria-selected", j === currentDay));
    const items = itemsForDay(d.key), tips = DAY_TIPS[d.key];
    panel.innerHTML = `<h3>${esc(d.title)}</h3><p class="mood">${esc(d.mood)}</p>
      ${me ? "" : `<p class="notice">👋 Identifiez-vous en haut de page pour modifier le programme, réagir et commenter.</p>`}
      <ol class="timeline">${items.map(it => {
        const p = it.place_id && byId[it.place_id];
        const edited = it.updated_by ? ` · modifié par ${esc(it.updated_by)} ${ago(it.updated_at)}` : "";
        return `<li><div class="t">${esc(it.time_label)}</div><div class="x">
          <div class="item-head"><div>${esc(it.body)}</div>
            ${me ? `<button class="icon-btn" data-edit="${it.id}" title="Modifier">✏️</button>` : ""}</div>
          ${it.tip ? `<div class="advice">💡 ${esc(it.tip)}</div>` : ""}
          ${p ? `<button class="chip" style="background:${CATEGORIES[p.cat].color}" data-map="${p.id}">📍 ${esc(p.name)}</button>` : ""}
          ${me ? `<div class="by">proposé par ${esc(it.author)}${edited}</div><div class="social">${socialBlock(it.id)}</div>` : ""}
        </div></li>`;
      }).join("") || `<li><div class="t"></div><div class="x muted">Rien de prévu pour l’instant.</div></li>`}</ol>
      ${me ? `<button class="btn add" data-add="${d.key}">＋ Proposer une activité</button>` : ""}
      <div class="day-extra">
        <div class="card soft"><h4>🧭 Conseils du jour</h4><ul>${tips.conseils.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>
        <div class="card soft"><h4>🔄 Plans B</h4><ul>${tips.planB.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>
      </div>
      ${me ? `<div class="card soft discuss"><h4>💬 Discussion du ${esc(d.title.split(" — ")[0].toLowerCase())}</h4>
        <div class="social">${reactionBar("day:" + d.key)}${thread("day:" + d.key)}</div></div>` : ""}`;

  }

  /* =============== Adresses =============== */
  function renderPlaces() {
    const list = $("#placeList"); list.innerHTML = "";
    Object.entries(CATEGORIES).forEach(([k, c]) => {
      const items = PLACES.filter(p => p.cat === k);
      const block = document.createElement("div");
      block.className = "cat-block";
      block.innerHTML = `<h3><span class="cat-dot" style="background:${c.color}"></span>${esc(c.label)}</h3>
        <div class="places">${items.map(p => `
          <article class="place" style="--c:${c.color}">
            <h4>${esc(p.name)}</h4>
            <div class="area">${esc(p.addr ? p.addr + " · " : "")}${esc(p.area)}</div>
            <p>${esc(p.desc)}</p>
            ${p.order ? `<p class="order"><strong>À commander :</strong> ${esc(p.order)}</p>` : ""}
            ${p.tip ? `<p class="tip">${esc(p.tip)}</p>` : ""}
            <div class="links"><button data-map="${p.id}">Voir sur la carte</button>
              <a href="${gmaps(p)}" target="_blank" rel="noopener">Itinéraire</a>
              ${p.url ? `<a href="${p.url}" target="_blank" rel="noopener">Site</a>` : ""}</div>
            ${me ? `<div class="social">${socialBlock("place:" + p.id)}</div>` : ""}
          </article>`).join("")}</div>`;
      list.appendChild(block);
    });
  }

  /* =============== Fil d'activité =============== */
  function renderFeed() {
    const box = $("#feed");
    if (!me || !state) { box.hidden = true; return; }
    const label = t => {
      if (t.startsWith("day:")) return "discussion du " + (DAYS.find(d => d.key === t.slice(4)) || {}).label;
      if (t.startsWith("place:")) return (byId[t.slice(6)] || {}).name || "une adresse";
      const p = state.proposals.find(x => x.id === t); return p ? `« ${p.body.slice(0, 45)}${p.body.length > 45 ? "…" : ""} »` : "une proposition";
    };
    const ev = [
      ...state.comments.map(c => ({ at: c.created_at, who: c.author, html: `a commenté ${esc(label(c.target))} : <em>${esc(c.body.slice(0, 80))}</em>` })),
      ...state.proposals.filter(p => p.author !== "Guide" || p.updated_by).map(p => ({
        at: p.updated_by ? p.updated_at : p.created_at, who: p.updated_by || p.author,
        html: `${p.updated_by ? "a modifié" : "a proposé"} « ${esc(p.body.slice(0, 60))} » (${esc((DAYS.find(d => d.key === p.day) || {}).label)})` })),
      ...state.reactions.map(r => ({ at: r.created_at, who: r.author, html: `a réagi ${r.emoji} à ${esc(label(r.target))}` }))
    ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8);
    box.hidden = false;
    box.innerHTML = `<h2>Quoi de neuf dans le groupe</h2>
      ${ev.length ? `<ul>${ev.map(x => `<li><span class="avatar sm" style="background:${colorOf(x.who)}">${esc(x.who[0].toUpperCase())}</span>
        <div><strong>${esc(x.who)}</strong> ${x.html} <span class="muted small">· ${ago(x.at)}</span></div></li>`).join("")}</ul>`
        : `<p class="muted">Rien encore. Soyez le premier à réagir sur le programme 👇</p>`}`;
  }

  function renderAll() { renderDay(); renderPlaces(); renderFeed(); }

  /* =============== Démarrage =============== */
  renderWho();
  renderAll();
  if (me) refresh();
})();
