(function () {
  const byId = Object.fromEntries(PLACES.map(p => [p.id, p]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const gmaps = p => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ", " + (p.addr || p.area) + ", Sevilla")}`;

  /* ---------- Compte à rebours ---------- */
  (function () {
    const el = document.getElementById("countdown");
    const start = new Date("2026-09-30T18:00:00+02:00"), end = new Date("2026-10-03T23:59:00+02:00"), now = new Date();
    if (now < start) {
      const d = Math.ceil((start - now) / 864e5);
      el.textContent = d <= 1 ? "Départ demain soir ✈️" : `Départ dans ${d} jours ✈️`;
    } else if (now <= end) el.textContent = "¡Estamos en Sevilla! 💃";
    else el.textContent = "¡Hasta la próxima, Sevilla!";
  })();

  /* ---------- Checklist ---------- */
  (function () {
    const done = store.get("sev-todo", {});
    const ul = document.getElementById("todo");
    TODO.forEach(t => {
      const li = document.createElement("li");
      if (done[t.id]) li.classList.add("done");
      li.innerHTML = `<input type="checkbox" id="${t.id}" ${done[t.id] ? "checked" : ""}>
        <label for="${t.id}">${esc(t.text)}</label>
        ${t.url ? `<a href="${t.url}" target="_blank" rel="noopener">Réserver →</a>` : ""}`;
      li.querySelector("input").addEventListener("change", e => {
        done[t.id] = e.target.checked; li.classList.toggle("done", e.target.checked); store.set("sev-todo", done);
      });
      ul.appendChild(li);
    });
  })();

  /* ---------- Carte ---------- */
  const map = L.map("map", { scrollWheelZoom: false, tap: true }).setView([37.3905, -5.9920], 14);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  const layers = {}, markers = {};
  Object.keys(CATEGORIES).forEach(k => (layers[k] = L.layerGroup().addTo(map)));

  function popupHtml(p) {
    const c = CATEGORIES[p.cat];
    return `<h4>${esc(p.name)}</h4>
      <div style="color:${c.color};font-weight:600;font-size:.8rem">${esc(c.label)} · ${esc(p.addr || p.area)}</div>
      <p>${esc(p.desc)}</p>
      ${p.order ? `<p><strong>À commander :</strong> ${esc(p.order)}</p>` : ""}
      ${p.tip ? `<p style="color:#6f6357">💡 ${esc(p.tip)}</p>` : ""}
      <div class="pop-links"><a href="${gmaps(p)}" target="_blank" rel="noopener">Itinéraire</a>${p.url ? `<a href="${p.url}" target="_blank" rel="noopener">Site</a>` : ""}</div>`;
  }

  PLACES.forEach(p => {
    const c = CATEGORIES[p.cat], big = p.cat === "base";
    const icon = L.divIcon({
      className: "", iconSize: big ? [38, 38] : [30, 30], iconAnchor: big ? [19, 38] : [15, 30], popupAnchor: [0, -30],
      html: `<div class="pin ${big ? "big" : ""}" style="background:${c.color}"><span>${c.icon}</span></div>`
    });
    const m = L.marker([p.lat, p.lng], { icon, title: p.name, zIndexOffset: big ? 1000 : 0 })
      .bindPopup(popupHtml(p), { maxWidth: 290 });
    m.addTo(layers[p.cat]);
    markers[p.id] = m;
  });

  const allBounds = L.latLngBounds(PLACES.map(p => [p.lat, p.lng]));
  map.fitBounds(allBounds, { padding: [20, 20] });
  map.on("focus", () => map.scrollWheelZoom.enable());

  // Filtres
  const filters = document.getElementById("filters");
  Object.entries(CATEGORIES).forEach(([k, c]) => {
    const b = document.createElement("button");
    b.style.setProperty("--c", c.color);
    b.textContent = `${c.icon} ${c.label}`;
    b.addEventListener("click", () => {
      const on = map.hasLayer(layers[k]);
      on ? map.removeLayer(layers[k]) : map.addLayer(layers[k]);
      b.classList.toggle("off", on);
    });
    filters.appendChild(b);
  });

  window.showOnMap = function (id) {
    const p = byId[id]; if (!p) return;
    if (!map.hasLayer(layers[p.cat])) {
      map.addLayer(layers[p.cat]);
      [...filters.children].forEach((b, i) => { if (Object.keys(CATEGORIES)[i] === p.cat) b.classList.remove("off"); });
    }
    document.getElementById("carte").scrollIntoView({ behavior: "smooth" });
    setTimeout(() => { map.setView([p.lat, p.lng], 17); markers[id].openPopup(); }, 350);
  };

  document.getElementById("fitAll").addEventListener("click", () => map.fitBounds(allBounds, { padding: [20, 20] }));
  let me;
  document.getElementById("locate").addEventListener("click", () => {
    if (!navigator.geolocation) return alert("Géolocalisation indisponible.");
    navigator.geolocation.getCurrentPosition(pos => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      if (me) me.setLatLng(ll); else me = L.circleMarker(ll, { radius: 9, color: "#fff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1 }).addTo(map).bindPopup("Vous êtes ici");
      map.setView(ll, 16); me.openPopup();
    }, () => alert("Position non disponible (autorisez la localisation)."), { enableHighAccuracy: true, timeout: 10000 });
  });

  /* ---------- Programme ---------- */
  const tabs = document.getElementById("dayTabs"), panel = document.getElementById("dayPanel");
  function renderDay(i) {
    const d = DAYS[i];
    [...tabs.children].forEach((b, j) => b.setAttribute("aria-selected", j === i));
    panel.innerHTML = `<h3>${esc(d.title)}</h3><p class="mood">${esc(d.mood)}</p>
      <ol class="timeline">${d.items.map(it => {
        const p = it.place && byId[it.place];
        return `<li><div class="t">${esc(it.time)}</div><div class="x">${esc(it.text)}
          ${p ? `<br><button class="chip" style="background:${CATEGORIES[p.cat].color}" onclick="showOnMap('${p.id}')">📍 ${esc(p.name)}</button>` : ""}</div></li>`;
      }).join("")}</ol>`;
    store.set("sev-day", i);
  }
  DAYS.forEach((d, i) => {
    const b = document.createElement("button");
    b.setAttribute("role", "tab"); b.textContent = d.label;
    b.addEventListener("click", () => renderDay(i));
    tabs.appendChild(b);
  });
  // jour courant pendant le séjour, sinon dernier onglet consulté
  const today = new Date().toISOString().slice(0, 10);
  const dayIdx = { "2026-09-30": 0, "2026-10-01": 1, "2026-10-02": 2, "2026-10-03": 3 }[today];
  renderDay(dayIdx ?? Math.min(store.get("sev-day", 0), DAYS.length - 1));

  /* ---------- Liste des adresses ---------- */
  const list = document.getElementById("placeList");
  Object.entries(CATEGORIES).forEach(([k, c]) => {
    const items = PLACES.filter(p => p.cat === k);
    if (!items.length) return;
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
          <div class="links"><button onclick="showOnMap('${p.id}')">Voir sur la carte</button>
            <a href="${gmaps(p)}" target="_blank" rel="noopener">Itinéraire</a>
            ${p.url ? `<a href="${p.url}" target="_blank" rel="noopener">Site</a>` : ""}</div>
        </article>`).join("")}</div>`;
    list.appendChild(block);
  });
})();
