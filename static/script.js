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
  $("#overlay").classList.remove("hidden");

  try {
    const res = await fetch("/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Error desconocido");
    renderResult(data);
  } catch (err) {
    renderError(err.message);
  } finally {
    btn.disabled = false;
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
