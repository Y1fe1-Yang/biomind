// ── i18n ──────────────────────────────────────────────────────────
let currentLang = localStorage.getItem("lang") || "zh";

function t(key) {
  const dict = currentLang === "zh" ? window.I18N_ZH : window.I18N_EN;
  return key.split(".").reduce((o, k) => (o ? o[k] : ""), dict) || key;
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.documentElement.lang = currentLang;
}

document.getElementById("lang-toggle").addEventListener("click", () => {
  currentLang = currentLang === "zh" ? "en" : "zh";
  localStorage.setItem("lang", currentLang);
  applyI18n();
  renderCurrentView();
});

// ── Username ──────────────────────────────────────────────────────
function getUsername() {
  return localStorage.getItem("biomind_username");
}

function promptUsername() {
  return new Promise(resolve => {
    const modal = document.getElementById("username-modal");
    const title = document.getElementById("username-modal-title");
    const input = document.getElementById("username-input");
    const btn = document.getElementById("username-confirm");

    title.textContent = t("username.prompt");
    input.placeholder = t("username.placeholder");
    btn.textContent = t("username.confirm");
    modal.classList.remove("hidden");
    input.focus();

    function confirm() {
      const name = input.value.trim();
      if (!name) return;
      localStorage.setItem("biomind_username", name);
      modal.classList.add("hidden");
      resolve(name);
    }

    btn.onclick = confirm;
    input.onkeydown = e => { if (e.key === "Enter") confirm(); };
  });
}

// ── Router ────────────────────────────────────────────────────────
let currentView = "timeline";

function showView(viewName) {
  document.querySelectorAll(".view").forEach(el => el.classList.add("hidden"));
  const el = document.getElementById(`view-${viewName}`);
  if (el) el.classList.remove("hidden");
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("text-blue-600", btn.dataset.view === viewName);
    btn.classList.toggle("font-semibold", btn.dataset.view === viewName);
  });
  currentView = viewName;
  history.replaceState(null, "", `#${viewName}`);
}

function renderCurrentView() {
  // Views render themselves — called after lang change
  showView(currentView);
  renderView(currentView);
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    showView(btn.dataset.view);
    renderView(btn.dataset.view);
  });
});

// ── Search ────────────────────────────────────────────────────────
document.getElementById("search-input").addEventListener("input", e => {
  const q = e.target.value.trim();
  if (q.length > 1) {
    showView("search");
    renderSearch(q);
  } else if (!q) {
    showView(currentView === "search" ? "timeline" : currentView);
  }
});

// ── View renderers ────────────────────────────────────────────────
function renderView(name) {
  const renders = {
    timeline: renderTimeline,
    directions: renderDirections,
    sops: renderSops,
    presentations: renderPresentations,
  };
  if (renders[name]) renders[name]();
}

// ── Shared helpers ────────────────────────────────────────────────
function paperTypeColor(type) {
  return { journal: "bg-blue-100 text-blue-700", conference: "bg-green-100 text-green-700", book: "bg-emerald-100 text-emerald-700" }[type] || "bg-gray-100 text-gray-600";
}

function paperCard(p) {
  const doi = p.doi ? `<a href="https://doi.org/${p.doi}" target="_blank" class="text-xs text-blue-500 hover:underline ml-2">${t("paper.doi")}: ${p.doi}</a>` : "";
  const pdfLink = p.file ? `<a href="/api/files/${encodeURIComponent(p.file).replace(/%2F/g,'/')}" target="_blank" class="text-xs text-gray-500 hover:text-gray-700 ml-2">↗ ${t("paper.openPdf")}</a>` : "";
  const notes = currentLang === "zh" ? p.notes?.zh : p.notes?.en;
  return `
    <div class="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition cursor-pointer" onclick="this.querySelector('.card-detail').classList.toggle('hidden')">
      <div class="flex items-start gap-2">
        <span class="text-xs px-2 py-0.5 rounded-full font-medium ${paperTypeColor(p.type)}">${t("type." + p.type)}</span>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900 leading-snug">${p.title || p.file.split("/").pop()}</p>
          <p class="text-xs text-gray-500 mt-0.5">${(p.authors || []).join(", ")} ${p.journal ? "· " + p.journal : ""} ${p.year ? "· " + p.year : ""}</p>
        </div>
      </div>
      <div class="card-detail hidden mt-3 pt-3 border-t border-gray-100 text-xs text-gray-600 space-y-1">
        ${p.abstract ? `<p>${p.abstract}</p>` : `<p class="text-gray-400">${t("paper.noAbstract")}</p>`}
        ${notes ? `<p class="text-blue-700 bg-blue-50 rounded p-2 mt-2">${notes}</p>` : ""}
        <div class="flex gap-2 mt-2">${doi}${pdfLink}</div>
      </div>
    </div>`;
}

function sopCard(s) {
  const pdfLink = s.file ? `<a href="/api/files/${encodeURIComponent(s.file).replace(/%2F/g,'/')}" target="_blank" class="text-blue-500 hover:underline text-xs">${t("sop.openPdf")}</a>` : "";
  return `
    <tr class="hover:bg-gray-50">
      <td class="py-3 px-4 text-sm font-medium">${s.title || s.id}</td>
      <td class="py-3 px-4 text-sm text-gray-500">${s.version || ""}</td>
      <td class="py-3 px-4 text-sm text-gray-500">${s.updated || ""}</td>
      <td class="py-3 px-4 text-sm text-gray-500">${s.author || ""}</td>
      <td class="py-3 px-4">
        ${(s.tags || []).map(tag => `<span class="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full mr-1">${tag}</span>`).join("")}
      </td>
      <td class="py-3 px-4">${pdfLink}</td>
    </tr>`;
}

function sopSearchCard(s) {
  const pdfLink = s.file ? `<a href="/api/files/${encodeURIComponent(s.file).replace(/%2F/g,'/')}" target="_blank" class="text-blue-500 hover:underline text-xs">${t("sop.openPdf")}</a>` : "";
  return `
    <div class="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition">
      <span class="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">${t("type.sop")}</span>
      <h3 class="text-sm font-medium mt-2">${s.title || s.id}</h3>
      <p class="text-xs text-gray-500 mt-1">${s.author || ""} · ${s.version || ""} · ${s.updated || ""}</p>
      <div class="flex flex-wrap gap-1 mt-2">
        ${(s.tags || []).map(tag => `<span class="text-xs bg-yellow-50 text-yellow-600 px-2 py-0.5 rounded-full">${tag}</span>`).join("")}
      </div>
      <div class="mt-3">${pdfLink}</div>
    </div>`;
}

function presentationCard(p) {
  const pdfLink = p.file ? `<a href="/api/files/${encodeURIComponent(p.file).replace(/%2F/g,'/')}" target="_blank" class="text-xs text-blue-500 hover:underline">${t("presentation.openPdf")}</a>` : "";
  const summary = currentLang === "zh" ? p.summary?.zh : p.summary?.en;
  return `
    <div class="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition">
      <span class="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">${t("type.presentation")}</span>
      <h3 class="text-sm font-medium mt-2">${p.title || p.id}</h3>
      <p class="text-xs text-gray-500 mt-1">${p.author || ""} · ${p.date || ""}</p>
      ${summary ? `<p class="text-xs text-gray-600 mt-2">${summary}</p>` : ""}
      <div class="flex flex-wrap gap-1 mt-2">
        ${(p.tags || []).map(tag => `<span class="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">${tag}</span>`).join("")}
      </div>
      <div class="mt-3">${pdfLink}</div>
    </div>`;
}

// ── Timeline ──────────────────────────────────────────────────────
function renderTimeline() {
  const data = window.DATA;
  const allItems = [
    ...data.papers.filter(p => !p.archived),
    ...data.books.filter(b => !b.archived),
    ...data.sops.filter(s => !s.archived).map(s => ({ ...s, type: "sop" })),
    ...data.presentations.map(p => ({ ...p, type: "presentation", year: p.date ? +p.date.slice(0, 4) : null })),
  ];

  const byYear = {};
  allItems.forEach(item => {
    const year = item.year || t("directions.unknownYear");
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(item);
  });
  const years = Object.keys(byYear).sort((a, b) => b - a);

  const html = years.map(year => `
    <div class="mb-8">
      <h2 class="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-3">
        ${year}
        <span class="text-sm font-normal text-gray-400">${byYear[year].length} 条</span>
      </h2>
      <div class="space-y-3">
        ${byYear[year].map(item => {
          if (item.type === "sop") return sopSearchCard(item);
          if (item.type === "presentation") return presentationCard(item);
          return paperCard(item);
        }).join("")}
      </div>
    </div>`).join("");

  document.getElementById("view-timeline").innerHTML = html || `<p class="text-gray-400 py-12 text-center">${t("noResults")}</p>`;
}

// ── Directions ────────────────────────────────────────────────────
let selectedDirections = [];

function renderDirections() {
  const data = window.DATA;
  const dirs = data.meta.directions || [];

  const tagBar = `
    <div class="flex flex-wrap gap-2 mb-6">
      <button onclick="selectedDirections=[];renderDirections()"
        class="px-3 py-1 rounded-full text-sm border ${selectedDirections.length===0 ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-blue-400'}">
        ${t("directions.all")}
      </button>
      ${dirs.map(d => `
        <button onclick="toggleDirection('${d}')"
          class="px-3 py-1 rounded-full text-sm border ${selectedDirections.includes(d) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-blue-400'}">
          ${d}
        </button>`).join("")}
    </div>`;

  const items = [
    ...data.papers.filter(p => !p.archived),
    ...data.books.filter(b => !b.archived),
  ].filter(item =>
    selectedDirections.length === 0 ||
    selectedDirections.some(d => (item.directions || []).includes(d))
  );

  document.getElementById("view-directions").innerHTML =
    tagBar +
    `<div class="space-y-3">${items.map(paperCard).join("") || `<p class="text-gray-400 py-12 text-center">${t("noResults")}</p>`}</div>`;
}

function toggleDirection(d) {
  const idx = selectedDirections.indexOf(d);
  if (idx === -1) selectedDirections.push(d);
  else selectedDirections.splice(idx, 1);
  renderDirections();
}

// ── SOP Library ───────────────────────────────────────────────────
let sopSearchQuery = "";
let selectedSopTags = [];

function renderSops() {
  const data = window.DATA;
  let sops = data.sops.filter(s => !s.archived);

  if (selectedSopTags.length > 0) {
    sops = sops.filter(s => selectedSopTags.every(tag => (s.tags || []).includes(tag)));
  }
  if (sopSearchQuery) {
    const q = sopSearchQuery.toLowerCase();
    sops = sops.filter(s => [s.title, s.author, s.version, ...(s.tags || [])].filter(Boolean).join(" ").toLowerCase().includes(q));
  }

  const allTags = [...new Set(data.sops.flatMap(s => s.tags || []))];

  document.getElementById("view-sops").innerHTML = `
    <div class="flex flex-wrap gap-2 mb-4">
      <input type="text" placeholder="${t("search.placeholder")}"
        value="${sopSearchQuery}"
        oninput="sopSearchQuery=this.value;renderSops()"
        class="border rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-500">
      ${allTags.map(tag => `
        <button onclick="toggleSopTag('${tag}')"
          class="px-3 py-1 rounded-full text-sm border ${selectedSopTags.includes(tag) ? 'bg-yellow-500 text-white border-yellow-500' : 'border-gray-300 text-gray-600 hover:border-yellow-400'}">
          ${tag}
        </button>`).join("")}
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
            <th class="py-3 px-4">${t("type.sop")}</th>
            <th class="py-3 px-4">${t("sop.version")}</th>
            <th class="py-3 px-4">${t("sop.updated")}</th>
            <th class="py-3 px-4">${t("sop.author")}</th>
            <th class="py-3 px-4">Tags</th>
            <th class="py-3 px-4"></th>
          </tr>
        </thead>
        <tbody>${sops.map(sopCard).join("") || `<tr><td colspan="6" class="py-12 text-center text-gray-400">${t("noResults")}</td></tr>`}</tbody>
      </table>
    </div>`;
}

function toggleSopTag(tag) {
  const idx = selectedSopTags.indexOf(tag);
  if (idx === -1) selectedSopTags.push(tag); else selectedSopTags.splice(idx, 1);
  renderSops();
}

// ── Presentations ─────────────────────────────────────────────────
function renderPresentations() {
  const data = window.DATA;
  const sorted = [...data.presentations].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  document.getElementById("view-presentations").innerHTML =
    `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">${sorted.map(presentationCard).join("") || `<p class="text-gray-400 py-12 text-center col-span-3">${t("noResults")}</p>`}</div>`;
}

// ── Client-side search ────────────────────────────────────────────
function renderSearch(q) {
  const lq = q.toLowerCase();
  const match = item => {
    const text = [item.title, item.abstract, ...(item.authors || []), ...(item.tags || []),
                  item.journal, item.version, item.author].filter(Boolean).join(" ").toLowerCase();
    return text.includes(lq);
  };

  const data = window.DATA;
  const results = [
    ...data.papers.filter(p => !p.archived && match(p)).map(p => ({ ...p, _section: "papers" })),
    ...data.books.filter(b => !b.archived && match(b)).map(b => ({ ...b, _section: "books" })),
    ...data.sops.filter(s => !s.archived && match(s)).map(s => ({ ...s, type: "sop", _section: "sops" })),
    ...data.presentations.filter(p => match(p)).map(p => ({ ...p, type: "presentation", _section: "presentations" })),
  ];

  const html = results.map(item => {
    if (item.type === "sop") return sopSearchCard(item);
    if (item.type === "presentation") return presentationCard(item);
    return paperCard(item);
  }).join("");

  document.getElementById("view-search").innerHTML =
    `<p class="text-sm text-gray-500 mb-4">"${q}" — ${results.length} 条结果</p><div class="space-y-3">${html || `<p class="text-gray-400 py-12 text-center">${t("noResults")}</p>`}</div>`;
}

// ── Boot ──────────────────────────────────────────────────────────
async function boot() {
  applyI18n();
  if (!getUsername()) await promptUsername();

  const hash = location.hash.replace("#", "") || "timeline";
  showView(hash);
  renderView(hash);
}

boot();
