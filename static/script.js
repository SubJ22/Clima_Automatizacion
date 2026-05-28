/* script.js — lógica del formulario */

const $ = (sel) => document.querySelector(sel);

const CHECK_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

// ---------- carga ciudades ----------
async function loadCities() {
  const res = await fetch("/cities");
  const data = await res.json();
  const grid = $("#cities-grid");
  grid.innerHTML = "";
  const defaults = ["Madrid", "Barcelona", "Valencia", "Sevilla", "Bilbao"];
  data.cities.forEach((city) => {
    const checked = defaults.includes(city) ? "checked" : "";
    const label = document.createElement("label");
    label.className = "city-chip";
    label.innerHTML = `
      <input type="checkbox" name="city" value="${city}" ${checked} />
      <span class="chip-body">
        <span class="chip-check">${CHECK_SVG}</span>
        <span>${city}</span>
      </span>
    `;
    grid.appendChild(label);
  });
}

// ---------- range días ----------
function setupRange() {
  const range = $("#forecast-days");
  const out = $("#forecast-output");
  const update = () => {
    out.textContent = `${range.value} día${range.value === "1" ? "" : "s"}`;
    const pct = ((range.value - range.min) / (range.max - range.min)) * 100;
    range.style.setProperty("--p", `${pct}%`);
  };
  range.addEventListener("input", update);
  update();
}

// ---------- mapa de España: cámara que recorre las ciudades ----------
// Coordenadas [lat, lon] — espejo de AVAILABLE_CITIES en weather_job.py.
const CITY_COORDS = {
  "Madrid": [40.4168, -3.7038],
  "Barcelona": [41.3874, 2.1686],
  "Valencia": [39.4699, -0.3763],
  "Sevilla": [37.3891, -5.9845],
  "Bilbao": [43.2630, -2.9350],
  "Zaragoza": [41.6488, -0.8891],
  "Málaga": [36.7213, -4.4214],
  "Palencia": [42.0096, -4.5288],
};

const SVGNS = "http://www.w3.org/2000/svg";
const FULL_VIEW = [-9.4, -44.2, 13.1, 8.6]; // viewBox completo (toda España)
const ZOOM = 2.15;                           // acercamiento por ciudad (mantiene contexto del mapa)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const MapShow = (() => {
  const svg = () => $("#map-svg");
  let view = FULL_VIEW.slice();
  let markers = [];
  let cancelled = false;

  function svgEl(tag, attrs, text) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  // Proyección equirectangular simple: x = lon, y = -lat (norte arriba).
  function project(city) {
    const [lat, lon] = CITY_COORDS[city];
    return { name: city, x: lon, y: -lat };
  }

  const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

  function buildMarkers(cities) {
    const layer = $("#city-layer");
    layer.innerHTML = "";
    markers = cities.map((name) => {
      const p = project(name);
      const g = svgEl("g", { class: "city-marker" });
      const halo = svgEl("circle", { class: "halo", cx: p.x, cy: p.y, r: 0 });
      const ring = svgEl("circle", { class: "ring", cx: p.x, cy: p.y, r: 0 });
      const core = svgEl("circle", { class: "core", cx: p.x, cy: p.y, r: 0 });
      const label = svgEl("text", { class: "city-name", x: p.x, y: p.y }, name);
      g.append(halo, ring, core, label);
      layer.appendChild(g);
      return { ...p, el: g, halo, ring, core, label, item: null };
    });
  }

  // Checklist lateral de ciudades.
  function buildTrack(cities) {
    const track = $("#city-track");
    track.innerHTML = "";
    cities.forEach((name, i) => {
      const li = document.createElement("li");
      li.className = "track-item";
      li.innerHTML = `
        <span class="ti-icon">${CHECK}</span>
        <span class="ti-name">${name}</span>
        <span class="ti-sub">en cola</span>
      `;
      track.appendChild(li);
      markers[i].item = li;
    });
    $("#map-total").textContent = cities.length;
    $("#map-count").textContent = "0";
  }

  // Mantiene marcadores y etiquetas a tamaño aparente constante pese al zoom.
  function applyScale() {
    const s = view[2] / (svg().clientWidth || 600); // unidades-usuario por píxel
    for (const m of markers) {
      m.core.setAttribute("r", 5 * s);
      m.ring.setAttribute("r", 9 * s);
      m.halo.setAttribute("r", 17 * s);
      m.label.setAttribute("font-size", 13 * s);
      m.label.setAttribute("x", m.x);
      m.label.setAttribute("y", m.y + 15 * s);
    }
  }

  function setView(v) {
    view = v.slice();
    svg().setAttribute("viewBox", view.join(" "));
    applyScale();
  }

  function focusBox(m) {
    const w = FULL_VIEW[2] / ZOOM;
    const h = FULL_VIEW[3] / ZOOM;
    return [m.x - w / 2, m.y - h / 2, w, h];
  }

  function tween(target, dur) {
    return new Promise((res) => {
      const start = view.slice();
      const t0 = performance.now();
      function frame(now) {
        if (cancelled) return res();
        const k = Math.min(1, (now - t0) / dur);
        const e = easeOutCubic(k);
        const v = start.map((s0, i) => s0 + (target[i] - s0) * e);
        setView(v);
        if (k < 1) requestAnimationFrame(frame);
        else res();
      }
      requestAnimationFrame(frame);
    });
  }

  function setStatus(txt) { $("#map-status").textContent = txt; }

  function activate(m) {
    markers.forEach((x) => {
      x.el.classList.remove("active");
      if (x.item) {
        x.item.classList.remove("active");
        if (x === m && !x.item.classList.contains("done")) {
          x.item.querySelector(".ti-sub").textContent = "consultando…";
        }
      }
    });
    if (m) {
      m.el.classList.add("active");
      if (m.item) m.item.classList.add("active");
    }
  }

  function markDone(m) {
    m.el.classList.add("done");
    if (m.item) {
      m.item.classList.add("done");
      m.item.querySelector(".ti-sub").textContent = "listo";
    }
  }

  // Recorre TODAS las ciudades (mínimo una pasada completa); si el backend
  // sigue trabajando tras la pasada, vuelve a empezar. Luego hace el plano de salida.
  async function start(cities, state) {
    cancelled = false;
    $("#map-card").classList.remove("done");
    buildMarkers(cities);
    buildTrack(cities);
    setView(FULL_VIEW);
    setStatus("Conectando con Open-Meteo…");
    await sleep(750);
    if (cancelled) return;

    const done = new Set();
    do {
      for (let i = 0; i < markers.length; i++) {
        if (cancelled) return;
        const m = markers[i];
        activate(m);
        setStatus(`Consultando ${m.name}…`);
        await tween(focusBox(m), 800);
        if (cancelled) return;
        await sleep(480);
        markDone(m);
        done.add(i);
        $("#map-count").textContent = String(done.size);
      }
    } while (!state.done && !cancelled);

    // Salida: consolidando + plano general.
    activate(null);
    setStatus("Consolidando informe…");
    $("#map-card").classList.add("done");
    markers.forEach((m) => markDone(m));
    await tween(FULL_VIEW, 800);
    await sleep(500);
  }

  function stop() { cancelled = true; }

  return { start, stop };
})();

// ---------- envío del form ----------
async function handleSubmit(ev) {
  ev.preventDefault();

  const cities = [...document.querySelectorAll('input[name="city"]:checked')].map(c => c.value);
  if (cities.length === 0) {
    alert("Selecciona al menos una ciudad.");
    return;
  }

  const payload = {
    cities,
    forecast_days: parseInt($("#forecast-days").value, 10),
    smtp_host: $("#smtp_host").value.trim(),
    smtp_port: parseInt($("#smtp_port").value, 10) || 587,
    smtp_user: $("#smtp_user").value.trim(),
    smtp_pass: $("#smtp_pass").value,
    email_to: $("#email_to").value.trim() || null,
  };

  const btn = $("#launch-btn");
  btn.disabled = true;
  document.body.classList.add("running");
  $("#overlay").classList.remove("hidden");

  // Lanza la animación del mapa en paralelo a la petición.
  const state = { done: false };
  const show = MapShow.start(cities, state);

  try {
    const res = await fetch("/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    state.done = true;
    await show; // deja terminar el plano de salida
    if (!res.ok) throw new Error(data.detail || "Error desconocido");
    renderResult(data);
  } catch (err) {
    state.done = true;
    try { await show; } catch (_) {}
    renderError(err.message);
  } finally {
    MapShow.stop();
    btn.disabled = false;
    document.body.classList.remove("running");
    $("#overlay").classList.add("hidden");
  }
}

// ---------- render resultado ----------
function renderResult(d) {
  const r = $("#result");
  r.classList.remove("hidden");

  const downloadLink = d.excel_filename
    ? `<a class="download" href="/download/${d.excel_filename}">↓ Descargar Excel</a>`
    : "";

  const errorsBlock = d.cities_failed.length
    ? `<div class="errors">
         <strong>Ciudades con error:</strong>
         <ul>${d.cities_failed.map(f => `<li>${f.city} — ${f.error}</li>`).join("")}</ul>
       </div>`
    : "";

  const emailBlock = d.email_sent
    ? `<p style="margin-top:14px;color:#16a34a;font-weight:500;">✓ Email enviado correctamente.</p>`
    : d.email_error
      ? `<p style="margin-top:14px;color:var(--orange-600);">Email no enviado: ${d.email_error}</p>`
      : "";

  r.querySelector("#result-body").innerHTML = `
    <div class="result-grid">
      <div class="result-stat">
        <div class="stat-label">Ciudades OK</div>
        <div class="stat-value">${d.cities_ok.length}</div>
      </div>
      <div class="result-stat">
        <div class="stat-label">Registros</div>
        <div class="stat-value">${d.total_records}</div>
      </div>
      <div class="result-stat accent">
        <div class="stat-label">Prioridad alta</div>
        <div class="stat-value">${d.high_priority_days}</div>
      </div>
      <div class="result-stat">
        <div class="stat-label">Run ID</div>
        <div class="stat-value" style="font-size:14px;">${d.run_id}</div>
      </div>
    </div>
    ${downloadLink}
    ${errorsBlock}
    ${emailBlock}
  `;
  r.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderError(msg) {
  const r = $("#result");
  r.classList.remove("hidden");
  r.querySelector("#result-body").innerHTML = `
    <div class="errors">
      <strong>Error en la ejecución:</strong>
      <p>${msg}</p>
    </div>
  `;
}

// ---------- init ----------
document.addEventListener("DOMContentLoaded", () => {
  loadCities();
  setupRange();
  $("#run-form").addEventListener("submit", handleSubmit);
});
