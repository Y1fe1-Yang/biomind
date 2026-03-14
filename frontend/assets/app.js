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

// ── Auth ──────────────────────────────────────────────────────────
function getToken()    { return localStorage.getItem("biomind_token"); }
function getUsername() { return localStorage.getItem("biomind_username"); }

function setAuth(token, username, isAdmin) {
  localStorage.setItem("biomind_token", token);
  localStorage.setItem("biomind_username", username);
  localStorage.setItem("biomind_is_admin", isAdmin ? "true" : "false");
  window.__isAdmin = isAdmin === true;
}

function clearAuth() {
  localStorage.removeItem("biomind_token");
  localStorage.removeItem("biomind_username");
  localStorage.removeItem("biomind_is_admin");
  window.__isAdmin = false;
}

function authHeaders() {
  const tok = getToken();
  return tok ? { "Authorization": `Bearer ${tok}` } : {};
}

async function apiFetch(url, options = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (resp.status === 401) {
    clearAuth();
    showAuthModal();
    throw new Error("Session expired — please log in again");
  }
  return resp;
}

function updateNavUser() {
  const username = getUsername();
  const display = document.getElementById("user-display");
  const logoutBtn = document.getElementById("logout-btn");
  if (username) {
    display.textContent = username;
    display.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
    document.getElementById("ai-fab").classList.remove("hidden");
  } else {
    display.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    document.getElementById("ai-fab").classList.add("hidden");
  }
}

document.getElementById("logout-btn").addEventListener("click", () => {
  clearAuth();
  updateNavUser();
  showAuthModal("login");
});

// ── Auth modal ────────────────────────────────────────────────────
let _authResolve = null;

function showAuthModal(tab = "login") {
  applyI18n();
  switchAuthTab(tab);
  document.getElementById("auth-modal").classList.remove("hidden");
  document.getElementById("login-username").focus();
  return new Promise(resolve => { _authResolve = resolve; });
}

function hideAuthModal() {
  document.getElementById("auth-modal").classList.add("hidden");
  if (_authResolve) { _authResolve(); _authResolve = null; }
}

function switchAuthTab(tab) {
  // Registration is invite-only (admin creates accounts via API).
  // Always show login form; hide register tab.
  document.getElementById("auth-login-form").classList.remove("hidden");
  document.getElementById("auth-register-form").classList.add("hidden");
  document.getElementById("tab-login").className =
    "flex-1 py-3 text-sm font-medium transition border-b-2 text-blue-600 border-blue-600";
  document.getElementById("tab-register").classList.add("hidden");
  document.getElementById("login-error").classList.add("hidden");
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.classList.remove("hidden");
}

document.getElementById("login-submit").addEventListener("click", async () => {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  if (!username || !password) return;
  try {
    const resp = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      showError("login-error", err.detail || t("auth.loginFailed"));
      return;
    }
    const data = await resp.json();
    setAuth(data.access_token, data.username, data.is_admin === true);
    updateNavUser();
    hideAuthModal();
  } catch {
    showError("login-error", t("auth.loginFailed"));
  }
});

document.getElementById("reg-submit").addEventListener("click", async () => {
  const username = document.getElementById("reg-username").value.trim();
  const password = document.getElementById("reg-password").value;
  const confirm  = document.getElementById("reg-confirm").value;
  if (!username || !password) return;
  if (password !== confirm) {
    showError("reg-error", t("auth.passwordMismatch"));
    return;
  }
  try {
    const resp = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      showError("reg-error", err.detail || t("auth.registerFailed"));
      return;
    }
    const data = await resp.json();
    setAuth(data.access_token, data.username, data.is_admin === true);
    updateNavUser();
    hideAuthModal();
  } catch {
    showError("reg-error", t("auth.registerFailed"));
  }
});

// Enter key in auth inputs
["login-username", "login-password"].forEach(id => {
  document.getElementById(id).addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("login-submit").click();
  });
});
["reg-username", "reg-password", "reg-confirm"].forEach(id => {
  document.getElementById(id).addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("reg-submit").click();
  });
});

// ── Router ────────────────────────────────────────────────────────
let currentView = "home";

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
    showView(currentView === "search" ? "home" : currentView);
  }
});

// ── Home view ─────────────────────────────────────────────────────
function renderHome() {
  const papers = (window.DATA && window.DATA.papers ? window.DATA.papers : [])
    .slice()
    .sort((a, b) => (b.year || 0) - (a.year || 0))
    .slice(0, 4);

  const DIRECTIONS = [
    { icon: "🔬", name: "生物传感与即时检测", sub: "基于电化学/光学传感" },
    { icon: "💡", name: "等离激元纳米光子学", sub: "SPR / LSPR 平台" },
    { icon: "🧫", name: "微流控与单细胞分析", sub: "Lab-on-chip · 膜蛋白" },
    { icon: "⚡", name: "柔性微纳器件",       sub: "MXene · 可穿戴传感" },
  ];

  const TAGS_ZH = ["生物传感", "微纳器件", "等离激元光学", "微流控", "单细胞分析", "即时检测"];
  const TAGS_EN = ["Biosensing", "Nanodevices", "Plasmonics", "Microfluidics", "Single-cell", "POC"];
  const heroTags = currentLang === "zh" ? TAGS_ZH : TAGS_EN;

  function badgeClass(type) {
    return type === "journal"
      ? "bg-blue-100 text-blue-700"
      : type === "conference"
      ? "bg-green-100 text-green-700"
      : "bg-gray-100 text-gray-600";
  }

  // Named `buildCard` to avoid shadowing the module-level `paperCard` function
  function buildCard(p) {
    const href = p.doi
      ? `https://doi.org/${p.doi}`
      : p.file ? `/api/files/${encodeURIComponent(p.file).replace(/%2F/g, "/")}` : "#";
    const dirTags = (p.directions || [])
      .map(d => `<span class="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg">${d}</span>`)
      .join("");
    const typeLabel = p.type === "journal" ? (currentLang === "zh" ? "期刊" : "Journal")
                     : p.type === "conference" ? (currentLang === "zh" ? "会议" : "Conf.")
                     : (currentLang === "zh" ? "综述" : "Review");
    return `
      <a class="home-paper-card" href="${href}" target="_blank" rel="noopener">
        <div class="flex-shrink-0 w-20">
          <img src="/data/thumbs/${p.id}.png"
               onerror="this.style.display='none'"
               class="w-20 rounded-md border border-gray-200 object-cover object-top"
               style="height:104px" alt="">
        </div>
        <div class="flex flex-col flex-1 min-w-0">
          <div class="flex gap-1 mb-1.5 flex-wrap">
            <span class="text-xs px-2 py-0.5 rounded-full font-semibold ${badgeClass(p.type)}">${typeLabel}</span>
            ${p.year ? `<span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">${p.year}</span>` : ""}
          </div>
          <p class="home-paper-title text-sm font-bold text-gray-900 leading-snug mb-1"
             style="-webkit-line-clamp:2;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden">
            ${p.title || p.file?.split("/").pop() || ""}
          </p>
          <p class="text-xs text-gray-500 italic mb-1.5">${[p.journal, p.year].filter(Boolean).join(" · ")}</p>
          ${p.abstract ? `<p class="text-xs text-gray-600 leading-relaxed flex-1"
             style="-webkit-line-clamp:3;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden">
             ${p.abstract}</p>` : ""}
          ${dirTags ? `<div class="flex flex-wrap gap-1 mt-2">${dirTags}</div>` : ""}
        </div>
      </a>`;
  }

  const dirCards = DIRECTIONS.map(d => `
    <div class="home-dir-card" onclick="showView('directions');renderView('directions')">
      <div class="text-2xl mb-2">${d.icon}</div>
      <div class="text-sm font-bold text-gray-900 mb-1">${d.name}</div>
      <div class="text-xs text-gray-500">${d.sub}</div>
    </div>`).join("");

  const html = `
    <!-- Hero -->
    <section class="home-hero -mx-4 -mt-6 px-10 pt-14 pb-12 mb-8 border-b border-gray-200">
      <p class="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-4" data-i18n="home.eyebrow"></p>
      <div class="flex items-baseline gap-4 flex-wrap mb-2">
        <h1 class="text-4xl font-black text-blue-900 tracking-tight">BioMiND</h1>
        <span class="text-lg font-semibold text-blue-700 opacity-75" data-i18n="home.titleZh"></span>
      </div>
      <p class="text-sm text-gray-600 leading-relaxed max-w-2xl mb-6" data-i18n="home.desc"></p>
      <div class="flex flex-wrap gap-2">
        ${heroTags.map(tag => `<span class="home-tag">${tag}</span>`).join("")}
      </div>
    </section>

    <!-- Latest publications -->
    <section class="mb-10">
      <div class="flex items-center gap-2 mb-6 pb-3 border-b-2 border-blue-900">
        <h2 class="text-xl font-extrabold text-gray-900" data-i18n="home.latestPubs"></h2>
        <span class="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">${papers.length}${t("home.papers")}</span>
        <button onclick="showView('timeline');renderView('timeline')"
                class="ml-auto text-sm text-blue-600 font-medium hover:underline"
                data-i18n="home.viewAll"></button>
      </div>
      <div class="grid grid-cols-2 gap-5">
        ${papers.map(buildCard).join("")}
      </div>
    </section>

    <!-- Research directions -->
    <section class="bg-blue-50 -mx-4 px-10 py-10 border-t border-blue-100">
      <div class="flex items-center gap-2 mb-6 pb-3 border-b-2 border-blue-900">
        <h2 class="text-xl font-extrabold text-gray-900" data-i18n="home.directions"></h2>
        <span class="text-xs text-gray-400 font-medium" data-i18n="home.multiDisc"></span>
        <button onclick="showView('directions');renderView('directions')"
                class="ml-auto text-sm text-blue-600 font-medium hover:underline"
                data-i18n="home.directionsMore"></button>
      </div>
      <div class="grid grid-cols-4 gap-4">${dirCards}</div>
    </section>

    <!-- Footer -->
    <footer class="-mx-4 mt-0 px-10 py-8 flex justify-between items-center" style="background:#1a2d6d;color:rgba(255,255,255,.8)">
      <div>
        <p class="font-black text-lg text-white mb-1">BioMiND</p>
        <p class="text-xs leading-relaxed">
          Laboratory of Biomedical Microsystems and Nano Devices<br>
          生物医学微系统与纳米器件实验室
        </p>
      </div>
      <p class="text-xs opacity-40">© 2026 BioMiND Lab</p>
    </footer>`;

  document.getElementById("view-home").innerHTML = html;
  applyI18n();
}

// ── View renderers ────────────────────────────────────────────────
function renderView(name) {
  const renders = {
    home: renderHome,
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

  // Admin-only SOP button
  let sopBtn = "";
  if (window.__isAdmin === true) {
    const hasSop = (window.DATA.sops || []).some(s => s.source_paper_id === p.id);
    if (hasSop) {
      sopBtn = `<button data-action="view-sop" data-paper-id="${p.id}"
        class="text-xs text-purple-600 hover:text-purple-800 ml-2 cursor-pointer">${t("sop.btnViewSop")}</button>`;
    } else {
      sopBtn = `<button data-action="extract-sop" data-paper-id="${p.id}"
        class="text-xs text-green-600 hover:text-green-800 ml-2 cursor-pointer">${t("sop.btnExtract")}</button>`;
    }
  }

  return `
    <div class="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition cursor-pointer" onclick="this.querySelector('.card-detail').classList.toggle('hidden')">
      <div class="flex items-start gap-3">
        <div class="flex-shrink-0 w-14">
          <img src="/data/thumbs/${p.id}.png" onerror="this.parentElement.style.display='none'"
               class="w-14 rounded border border-gray-200 object-cover object-top" style="height:80px" alt="">
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5 mb-1 flex-wrap">
            <span class="text-xs px-2 py-0.5 rounded-full font-medium ${paperTypeColor(p.type)}">${t("type." + p.type)}</span>
          </div>
          <p class="text-sm font-medium text-gray-900 leading-snug">${p.title || p.file.split("/").pop()}</p>
          <p class="text-xs text-gray-500 italic mt-0.5">${[p.journal, p.year].filter(Boolean).join(" · ") || (p.year || "")}</p>
        </div>
      </div>
      <div class="card-detail hidden mt-3 pt-3 border-t border-gray-100 text-xs text-gray-600 space-y-1">
        ${p.abstract ? `<p>${p.abstract}</p>` : `<p class="text-gray-400">${t("paper.noAbstract")}</p>`}
        ${notes ? `<p class="text-blue-700 bg-blue-50 rounded p-2 mt-2">${notes}</p>` : ""}
        <div class="flex gap-2 mt-2 flex-wrap">${doi}${pdfLink}${sopBtn}</div>
      </div>
    </div>`;
}

function sopCard(s) {
  const isAuto = s.status === "auto" || s.status === "abstract-only";
  const responsible = s.responsible || s.author || "";

  // Source info line: find the source paper for journal+year
  let sourceInfo = s.updated || "";
  if (s.source_paper_id && window.DATA && window.DATA.papers) {
    const src = window.DATA.papers.find(p => p.id === s.source_paper_id);
    if (src) sourceInfo = [src.journal, s.updated].filter(Boolean).join(" ");
  }

  // Category badge (auto SOPs only)
  const catBadge = isAuto && s.category
    ? `<span class="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">${s.category}${s.subcategory ? " › " + s.subcategory : ""}</span>`
    : "";

  // Status badge
  const statusBadge = s.status === "abstract-only"
    ? `<span class="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">${t("sop.statusAbstractOnly")}</span>`
    : isAuto
    ? `<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">🤖 ${t("sop.statusAutoLabel")}</span>`
    : "";

  const tags = (s.tags || [])
    .map(tag => `<span class="text-xs bg-yellow-50 text-yellow-600 px-2 py-0.5 rounded-full">${tag}</span>`)
    .join("");

  // Expanded content: steps-based (auto) or PDF link (file-based)
  let expandedContent = "";
  if (s.steps && s.steps.length) {
    const mats = (s.materials || []).map(m => `<li>${m}</li>`).join("");
    const stps = (s.steps || []).map(st => `<li class="mb-1 pb-1 border-b border-gray-50 last:border-0">${st}</li>`).join("");
    const nts  = (s.protocol_notes || []).map(n => `<li>${n}</li>`).join("");
    expandedContent = `
      ${s.purpose ? `<p class="text-xs text-gray-700 mb-3"><span class="font-semibold">${t("sop.fieldPurpose")}：</span>${s.purpose}</p>` : ""}
      ${mats ? `<div class="mb-3"><p class="text-xs font-semibold text-gray-600 mb-1">${t("sop.fieldMaterials")}</p><ul class="text-xs text-gray-600 list-disc ml-4 space-y-0.5">${mats}</ul></div>` : ""}
      ${stps ? `<div class="mb-3"><p class="text-xs font-semibold text-gray-600 mb-1">${t("sop.fieldSteps")}</p><ol class="text-xs text-gray-600 list-decimal ml-4">${stps}</ol></div>` : ""}
      ${nts  ? `<div class="mb-2"><p class="text-xs font-semibold text-gray-600 mb-1">${t("sop.fieldNotes")}</p><ul class="text-xs text-gray-600 list-disc ml-4">${nts}</ul></div>` : ""}
      ${s.reference ? `<p class="text-xs text-gray-400 italic mt-2">${t("sop.fieldSource")}: ${s.reference}</p>` : ""}`;
  } else if (s.file) {
    expandedContent = `<a href="/api/files/${encodeURIComponent(s.file).replace(/%2F/g,'/')}" target="_blank" class="text-xs text-blue-500 hover:underline">↗ ${t("sop.openPdf")}</a>`;
  }

  return `
    <div class="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition">
      <div class="flex items-start justify-between gap-2 cursor-pointer"
           onclick="const d=this.closest('.bg-white').querySelector('.sop-detail');d.classList.toggle('hidden');this.querySelector('.sop-card-expand-icon').classList.toggle('open')">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1 mb-1.5 flex-wrap">
            ${statusBadge}${catBadge}
          </div>
          <p class="text-sm font-medium text-gray-900">${isAuto ? "📋 " : ""}${s.title || s.id}</p>
          <p class="text-xs text-gray-500 mt-0.5">${[responsible ? t("sop.fieldResponsible") + ": " + responsible : "", sourceInfo, s.version].filter(Boolean).join(" · ")}</p>
          ${tags ? `<div class="flex flex-wrap gap-1 mt-1.5">${tags}</div>` : ""}
        </div>
        <span class="sop-card-expand-icon text-xs text-gray-400 flex-shrink-0 mt-1">▼</span>
      </div>
      <div class="sop-detail hidden mt-3 pt-3 border-t border-gray-100 text-sm">${expandedContent}</div>
    </div>`;
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
let selectedSopCategory = "";
let selectedSopSubcategory = "";

const _SOP_CATS = ["微流控器件", "生物样本处理", "检测与表征", "数据分析"];

function renderSops() {
  const data = window.DATA;
  const allSops = data.sops.filter(s => !s.archived);

  // Category filter
  let filtered = selectedSopCategory
    ? allSops.filter(s => s.category === selectedSopCategory)
    : allSops;

  // Subcategory filter
  if (selectedSopCategory && selectedSopSubcategory) {
    filtered = filtered.filter(s => s.subcategory === selectedSopSubcategory);
  }

  // Search filter (title + purpose + tags)
  if (sopSearchQuery) {
    const q = sopSearchQuery.toLowerCase();
    filtered = filtered.filter(s =>
      [s.title, s.purpose, ...(s.tags || [])].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }

  // Category tabs
  const catTabItems = [{ label: t("sop.categoryAll"), val: "" }, ..._SOP_CATS.map(c => ({ label: c, val: c }))];
  const catTabs = catTabItems.map(({ label, val }) => {
    const active = selectedSopCategory === val;
    return `<button onclick="selectedSopCategory='${val}';selectedSopSubcategory='';renderSops()"
      class="sop-cat-tab${active ? ' active' : ''}">${label}</button>`;
  }).join("");

  // Subcategory buttons (only when a category is selected)
  let subRow = "";
  if (selectedSopCategory) {
    const subs = [...new Set(
      allSops.filter(s => s.category === selectedSopCategory && s.subcategory).map(s => s.subcategory)
    )];
    if (subs.length) {
      subRow = `<div class="flex flex-wrap gap-2 mb-3">
        ${subs.map(sub => `<button onclick="selectedSopSubcategory=selectedSopSubcategory==='${sub}'?'':'${sub}';renderSops()"
          class="px-3 py-1 rounded-full text-xs border ${selectedSopSubcategory === sub ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-blue-400'}">${sub}</button>`).join("")}
      </div>`;
    }
  }

  document.getElementById("view-sops").innerHTML = `
    <div class="border-b border-gray-200 mb-0 flex gap-0.5">${catTabs}</div>
    <div class="bg-white border border-t-0 border-gray-200 rounded-b-lg px-4 py-3 mb-4">
      ${subRow}
      <input type="text" placeholder="${t("search.placeholder")}"
        value="${sopSearchQuery}"
        oninput="sopSearchQuery=this.value;renderSops()"
        class="border rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500">
    </div>
    <div class="space-y-3">${filtered.map(sopCard).join("") || `<p class="text-gray-400 py-12 text-center">${t("noResults")}</p>`}</div>`;
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

// ── AI Chat Panel ─────────────────────────────────────────────────
let currentConvId = "";

function openChatPanel() {
  document.getElementById("chat-panel").classList.remove("hidden");
  document.getElementById("chat-backdrop").classList.remove("hidden");
  loadConvList();
}

function closeChatPanel() {
  document.getElementById("chat-panel").classList.add("hidden");
  document.getElementById("chat-backdrop").classList.add("hidden");
}

// FAB and close buttons
document.getElementById("ai-fab").addEventListener("click", openChatPanel);
document.getElementById("close-panel-btn").addEventListener("click", closeChatPanel);
document.getElementById("chat-backdrop").addEventListener("click", closeChatPanel);
document.getElementById("new-chat-btn").addEventListener("click", () => {
  currentConvId = "";
  document.getElementById("chat-messages").innerHTML = "";
  loadConvList();
});

// ── Conversation list ─────────────────────────────────────────────

async function loadConvList() {
  try {
    const resp = await apiFetch("/api/conversations");
    const convs = await resp.json();
    renderConvList(convs);
  } catch { /* auth error already handled */ }
}

function renderConvList(convs) {
  const el = document.getElementById("conv-list");
  if (!convs.length) {
    el.innerHTML = '<p class="text-xs text-gray-400 p-3 text-center">暂无对话</p>';
    return;
  }
  el.innerHTML = convs.map(c => `
    <div class="group px-3 py-2 cursor-pointer border-b border-gray-100 hover:bg-gray-100 transition ${c.conv_id === currentConvId ? "bg-blue-50" : ""}"
         onclick="selectConv('${c.conv_id}')">
      <p class="text-xs font-medium truncate ${c.conv_id === currentConvId ? "text-blue-700" : "text-gray-700"}">${escHtml(c.title)}</p>
      <div class="flex items-center justify-between mt-0.5">
        <span class="text-xs text-gray-400">${new Date(c.ts * 1000).toLocaleDateString()}</span>
        <button class="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition text-xs leading-none"
                onclick="deleteConv(event,'${c.conv_id}')">✕</button>
      </div>
    </div>`).join("");
}

async function selectConv(convId) {
  currentConvId = convId;
  try {
    const resp = await apiFetch(`/api/conversations/${convId}`);
    const msgs = await resp.json();
    renderMessages(msgs);
  } catch {}
  loadConvList();
}

async function deleteConv(e, convId) {
  e.stopPropagation();
  try {
    await apiFetch(`/api/conversations/${convId}`, { method: "DELETE" });
    if (currentConvId === convId) {
      currentConvId = "";
      document.getElementById("chat-messages").innerHTML = "";
    }
    loadConvList();
  } catch {}
}

// ── Message rendering ─────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function msgHTML(role, content) {
  const isUser = role === "user";
  const bubble = isUser
    ? "bg-blue-600 text-white rounded-2xl rounded-br-sm ml-12"
    : "bg-gray-100 text-gray-800 rounded-2xl rounded-bl-sm mr-12";
  return `
    <div class="flex ${isUser ? "justify-end" : "justify-start"}">
      <div class="px-4 py-2.5 text-sm leading-relaxed max-w-full ${bubble}" style="white-space:pre-wrap;word-break:break-word">${escHtml(content)}</div>
    </div>`;
}

function renderMessages(msgs) {
  const el = document.getElementById("chat-messages");
  el.innerHTML = msgs.map(m => msgHTML(m.role, m.content)).join("");
  el.scrollTop = el.scrollHeight;
}

function appendMsg(role, content) {
  const el = document.getElementById("chat-messages");
  el.insertAdjacentHTML("beforeend", msgHTML(role, content));
  el.scrollTop = el.scrollHeight;
}

function appendStreaming(id) {
  const el = document.getElementById("chat-messages");
  el.insertAdjacentHTML("beforeend", `
    <div class="flex justify-start" id="${id}">
      <div class="px-4 py-2.5 text-sm leading-relaxed bg-gray-100 text-gray-800 rounded-2xl rounded-bl-sm mr-12" style="white-space:pre-wrap;word-break:break-word">
        <span class="animate-pulse">▋</span>
      </div>
    </div>`);
  el.scrollTop = el.scrollHeight;
}

function updateStreaming(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelector("div").innerHTML = escHtml(text) + '<span class="animate-pulse text-gray-400">▋</span>';
  document.getElementById("chat-messages").scrollTop = 9999;
}

function finalizeStreaming(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelector("div").innerHTML = escHtml(text);
}

// ── Send message ──────────────────────────────────────────────────

async function sendMessage() {
  const input = document.getElementById("chat-input");
  const msg = input.value.trim();
  if (!msg) return;

  input.value = "";
  input.style.height = "auto";

  appendMsg("user", msg);

  const streamId = "stream-" + Date.now();
  appendStreaming(streamId);

  // Disable send while streaming
  const sendBtn = document.getElementById("chat-send");
  sendBtn.disabled = true;
  sendBtn.classList.add("opacity-50");

  try {
    const resp = await apiFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conv_id: currentConvId, message: msg }),
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let fullText = "";

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6);
        if (raw.trim() === "[DONE]") {
          finalizeStreaming(streamId, fullText);
          loadConvList();
          break outer;
        }
        try {
          const chunk = JSON.parse(raw);
          if (chunk.conv_id) currentConvId = chunk.conv_id;
          if (chunk.text)    { fullText += chunk.text; updateStreaming(streamId, fullText); }
          if (chunk.error)   { finalizeStreaming(streamId, "⚠ " + chunk.error); break outer; }
        } catch {}
      }
    }
  } catch (err) {
    finalizeStreaming(streamId, "⚠ " + err.message);
  } finally {
    sendBtn.disabled = false;
    sendBtn.classList.remove("opacity-50");
  }
}

document.getElementById("chat-send").addEventListener("click", sendMessage);
document.getElementById("chat-input").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// Auto-resize textarea as user types
document.getElementById("chat-input").addEventListener("input", function() {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 120) + "px";
});

async function _handleSopAction(e) {
  // Handle "view-sop" — navigate to SOP library
  const viewBtn = e.target.closest("[data-action='view-sop']");
  if (viewBtn) {
    e.stopPropagation();
    showView("sops");
    renderView("sops");
    return;
  }

  // Handle "extract-sop" — trigger SSE extraction
  const extractBtn = e.target.closest("[data-action='extract-sop']");
  if (!extractBtn) return;
  e.stopPropagation();

  const paperId = extractBtn.dataset.paperId;
  extractBtn.disabled = true;
  extractBtn.textContent = t("sop.progressExtracting");

  try {
    const resp = await apiFetch("/api/extract-sop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paper_id: paperId }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      extractBtn.textContent = t("sop.progressError") + (err.detail || resp.status);
      extractBtn.disabled = false;
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "progress") extractBtn.textContent = ev.message;
          if (ev.type === "done") {
            extractBtn.textContent = t("sop.progressDone");
            setTimeout(() => window.location.reload(), 600);
          }
          if (ev.type === "error") {
            extractBtn.textContent = t("sop.progressError") + ev.message;
            extractBtn.disabled = false;
          }
        } catch { /* ignore malformed SSE */ }
      }
    }
  } catch (err) {
    extractBtn.textContent = t("sop.progressError") + err.message;
    extractBtn.disabled = false;
  }
}

// ── Boot ──────────────────────────────────────────────────────────
async function boot() {
  window.__isAdmin = localStorage.getItem("biomind_is_admin") === "true";
  applyI18n();
  updateNavUser();
  const hash = location.hash.replace("#", "") || "home";
  showView(hash);
  renderView(hash);
  // One-time event delegation for extract-sop / view-sop buttons on paper cards
  document.querySelector("main").addEventListener("click", _handleSopAction);
  if (!getUsername()) showAuthModal();
}

boot();
