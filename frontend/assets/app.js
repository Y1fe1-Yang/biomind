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
  const loginBtn = document.getElementById("nav-login-btn");
  if (username) {
    display.textContent = username;
    display.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
    if (loginBtn) loginBtn.classList.add("hidden");
    document.getElementById("ai-fab").classList.remove("hidden");
  } else {
    display.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    if (loginBtn) loginBtn.classList.remove("hidden");
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
let _currentArticleId = null; // id of currently-displayed article, or null

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
  if (currentView === "news" && _currentArticleId) {
    showView("news");
    history.replaceState(null, "", `#news/${_currentArticleId}`);
    renderNewsArticle(_currentArticleId);
  } else {
    showView(currentView);
    renderView(currentView);
  }
}

function navToArticle(id) {
  _currentArticleId = id;
  currentView = "news";
  document.querySelectorAll(".view").forEach(el => el.classList.add("hidden"));
  const newsView = document.getElementById("view-news");
  if (newsView) newsView.classList.remove("hidden");
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("text-blue-600", btn.dataset.view === "news");
    btn.classList.toggle("font-semibold", btn.dataset.view === "news");
  });
  history.pushState(null, "", `#news/${id}`);
  renderNewsArticle(id);
}

function navBack() {
  _currentArticleId = null;
  history.pushState(null, "", "#news");
  showView("news");
  renderNews();
}

function navToArticleEdit(id) {
  navBack();
  openNewsEditor(id);
}

window.addEventListener("popstate", () => {
  const hash = location.hash.slice(1) || "home";
  const [view, subId] = hash.split("/");
  if (view === "news" && subId) {
    _currentArticleId = subId;
    currentView = "news";
    document.querySelectorAll(".view").forEach(el => el.classList.add("hidden"));
    const newsView = document.getElementById("view-news");
    if (newsView) newsView.classList.remove("hidden");
    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.classList.toggle("text-blue-600", btn.dataset.view === "news");
      btn.classList.toggle("font-semibold", btn.dataset.view === "news");
    });
    renderNewsArticle(subId);
  } else {
    _currentArticleId = null;
    showView(view || "home");
    renderView(view || "home");
  }
});

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const view = btn.dataset.view;
    if (view === "sops" && !getUsername()) {
      await showAuthModal();
      if (!getUsername()) return;
    }
    showView(view);
    renderView(view);
    closeMobileMenu();
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
    const href = p.doi ? `https://doi.org/${p.doi}` : "#";
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
      <div class="home-papers-grid">
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
      <div class="home-dirs-grid">${dirCards}</div>
    </section>

    <!-- Footer -->
    <footer class="home-footer -mx-4 mt-0 px-10 py-8 flex justify-between items-center" style="background:#1a2d6d;color:rgba(255,255,255,.8)">
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
    members: renderMembers,
    news: renderNews,
  };
  if (renders[name]) renders[name]();
}

// ── Shared helpers ────────────────────────────────────────────────
function paperTypeColor(type) {
  return { journal: "bg-blue-100 text-blue-700", conference: "bg-green-100 text-green-700", book: "bg-emerald-100 text-emerald-700" }[type] || "bg-gray-100 text-gray-600";
}

function paperCard(p) {
  const doi = p.doi ? `<a href="https://doi.org/${p.doi}" target="_blank" class="text-xs text-blue-500 hover:underline ml-2">${t("paper.doi")}: ${p.doi}</a>` : "";
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
        <div class="flex gap-2 mt-2 flex-wrap">${doi}${sopBtn}</div>
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
  return `
    <div class="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition">
      <span class="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">${t("type.sop")}</span>
      <h3 class="text-sm font-medium mt-2">${s.title || s.id}</h3>
      <p class="text-xs text-gray-500 mt-1">${s.author || ""} · ${s.version || ""} · ${s.updated || ""}</p>
      <div class="flex flex-wrap gap-1 mt-2">
        ${(s.tags || []).map(tag => `<span class="text-xs bg-yellow-50 text-yellow-600 px-2 py-0.5 rounded-full">${tag}</span>`).join("")}
      </div>
    </div>`;
}

function presentationCard(p) {
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

// ── Members ───────────────────────────────────────────────────────
const _memberPhotoIdx = {};  // { memberId: currentIndex }

function _memberPhoto(id, delta) {
  const member = (window.MEMBERS || []).find(m => m.id === id);
  const photos = member?.photos || (member?.photo ? [member.photo] : []);
  if (photos.length <= 1) return;
  const cur = _memberPhotoIdx[id] || 0;
  const next = (cur + delta + photos.length) % photos.length;
  _memberPhotoIdx[id] = next;
  const img = document.getElementById(`mphoto-img-${id}`);
  if (img) {
    img.style.opacity = "0";
    setTimeout(() => { img.src = photos[next]; img.style.opacity = "1"; }, 150);
  }
  document.querySelectorAll(`#mphoto-dots-${id} .mph-dot`).forEach((d, i) => {
    d.style.background = i === next ? "#2563eb" : "#d1d5db";
  });
}

function renderMembers() {
  Object.keys(_memberPhotoIdx).forEach(k => delete _memberPhotoIdx[k]);
  const members = window.MEMBERS || [];
  const groups = [
    { key: "pi",         labelZh: "课题组长",  labelEn: "Principal Investigator" },
    { key: "postdoc",    labelZh: "博士后",    labelEn: "Postdoctoral Researchers" },
    { key: "researcher", labelZh: "研究人员",  labelEn: "Researchers" },
    { key: "phd",        labelZh: "博士生",    labelEn: "PhD Students" },
    { key: "master",     labelZh: "硕士生",    labelEn: "Master's Students" },
    { key: "alumni",     labelZh: "往届成员",  labelEn: "Alumni" },
  ];

  function photoSlot(m) {
    const photos = m.photos || (m.photo ? [m.photo] : []);
    const name = currentLang === "zh" ? m.name.zh : m.name.en;
    if (photos.length === 0) {
      return `<div style="width:96px;height:128px;flex-shrink:0;background:#f3f4f6;border-radius:.5rem"></div>`;
    }
    const hasMany = photos.length > 1;
    const arrows = hasMany ? `
      <button onclick="event.stopPropagation();_memberPhoto('${m.id}',-1)"
        style="position:absolute;left:2px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.9);border:none;border-radius:50%;width:20px;height:20px;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;box-shadow:0 1px 4px rgba(0,0,0,.18)">‹</button>
      <button onclick="event.stopPropagation();_memberPhoto('${m.id}',1)"
        style="position:absolute;right:2px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.9);border:none;border-radius:50%;width:20px;height:20px;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;box-shadow:0 1px 4px rgba(0,0,0,.18)">›</button>` : "";
    const dots = hasMany ? `
      <div id="mphoto-dots-${m.id}" style="position:absolute;bottom:5px;left:0;right:0;display:flex;justify-content:center;gap:3px;pointer-events:none">
        ${photos.map((_, i) => `<span class="mph-dot" style="width:5px;height:5px;border-radius:50%;background:${i === 0 ? "#2563eb" : "#d1d5db"}"></span>`).join("")}
      </div>` : "";
    return `
      <div style="position:relative;width:96px;height:128px;flex-shrink:0">
        <img id="mphoto-img-${m.id}" src="${photos[0]}" alt="${name}"
             style="width:96px;height:128px;object-fit:cover;object-position:top;border-radius:.5rem;border:1px solid #f3f4f6;transition:opacity .15s"
             onerror="this.style.opacity='.15'">
        ${arrows}
        ${dots}
      </div>`;
  }

  function memberCard(m) {
    const name     = currentLang === "zh" ? m.name.zh  : m.name.en;
    const title    = currentLang === "zh" ? m.title.zh : m.title.en;
    const bio      = currentLang === "zh" ? m.bio.zh   : m.bio.en;
    const research = (currentLang === "zh" ? m.research.zh : m.research.en)
      .map(r => `<span class="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">${r}</span>`)
      .join("");
    return `
      <div class="bg-white rounded-xl border border-gray-200 p-5 flex gap-5 items-start hover:shadow-sm transition">
        ${photoSlot(m)}
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline gap-2 flex-wrap mb-0.5">
            <h3 class="text-base font-bold text-gray-900">${name}</h3>
            <span class="text-xs text-blue-700 font-medium">${title}</span>
          </div>
          <a href="mailto:${m.email}" class="text-xs text-gray-400 hover:text-blue-500 mb-2 inline-block">${m.email}</a>
          <p class="text-sm text-gray-600 leading-relaxed mb-3">${bio}</p>
          <div class="flex flex-wrap gap-1">${research}</div>
        </div>
      </div>`;
  }

  const sections = groups.map(g => {
    const gm = members.filter(m => m.group === g.key);
    if (!gm.length) return "";
    const label = currentLang === "zh" ? g.labelZh : g.labelEn;
    return `
      <div class="mb-8">
        <div style="font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#9ca3af;margin-bottom:.75rem;padding-bottom:.4rem;border-bottom:1px solid #f3f4f6">${label}</div>
        <div class="members-grid grid grid-cols-1 gap-4">
          ${gm.map(memberCard).join("")}
        </div>
      </div>`;
  }).join("");

  document.getElementById("view-members").innerHTML = `
    <div style="position:relative;margin:-1.5rem -1rem 2rem;padding:3rem 2.5rem 2rem;background:#f8fafc;border-bottom:1px solid #e5e7eb;overflow:hidden">
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:8rem;font-weight:900;color:rgba(37,99,235,.05);letter-spacing:-.25rem;pointer-events:none;user-select:none">TEAM</div>
      <h2 style="font-size:1.5rem;font-weight:800;color:#1e3a8a;position:relative" data-i18n="members.title"></h2>
    </div>
    ${sections}`;
  applyI18n();
}

// ── News ──────────────────────────────────────────────────────────
let _newsCache = [];

function _mdInline(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:underline">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code style=\"background:#f3f4f6;padding:0 3px;border-radius:3px\">$1</code>");
}

function _renderMd(md) {
  if (!md) return "";
  const lines = md.split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<figure style="margin:1.25rem 0;text-align:center"><img src="${imgMatch[2]}" alt="${imgMatch[1]}" style="max-width:100%;border-radius:.75rem;display:inline-block" onerror="this.style.display='none'"><figcaption style="font-size:.75rem;color:#9ca3af;margin-top:.4rem">${_mdInline(imgMatch[1])}</figcaption></figure>`;
      continue;
    }
    if (/^## /.test(line)) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h3 style="font-size:1rem;font-weight:700;color:#1e3a8a;margin:1.5rem 0 .5rem">${_mdInline(line.slice(3))}</h3>`;
      continue;
    }
    if (/^### /.test(line)) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h4 style="font-size:.9rem;font-weight:600;color:#374151;margin:1rem 0 .25rem">${_mdInline(line.slice(4))}</h4>`;
      continue;
    }
    if (/^[-*] /.test(line)) {
      if (!inList) { html += `<ul style="list-style:disc;padding-left:1.5rem;margin:.5rem 0">`; inList = true; }
      html += `<li style="margin:.2rem 0">${_mdInline(line.slice(2))}</li>`;
      continue;
    }
    if (!line.trim()) {
      if (inList) { html += "</ul>"; inList = false; }
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    html += `<p style="margin:.6rem 0;line-height:1.7">${_mdInline(line)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

async function renderNews() {
  const el = document.getElementById("view-news");
  el.innerHTML = `<div style="text-align:center;padding:4rem;color:#9ca3af">${t("loading")}</div>`;
  try {
    const resp = await fetch("/api/news");
    _newsCache = resp.ok ? await resp.json() : [];
  } catch { _newsCache = []; }

  const canWrite = !!getToken();

  // Gradient palettes for articles without a cover image
  const PALETTES = [
    "linear-gradient(135deg,#1e3a8a,#2563eb)",
    "linear-gradient(135deg,#064e3b,#059669)",
    "linear-gradient(135deg,#7c2d12,#ea580c)",
    "linear-gradient(135deg,#4c1d95,#7c3aed)",
    "linear-gradient(135deg,#0c4a6e,#0284c7)",
  ];
  function coverBg(id) {
    let h = 0; for (const c of id) h = c.charCodeAt(0) + ((h << 5) - h);
    return PALETTES[Math.abs(h) % PALETTES.length];
  }

  function fmtDate(dateStr) {
    const [y, m, d] = dateStr.split("-");
    return { year: y, md: `${m}-${d}` };
  }

  function tagHtml(item) {
    const src = (item.source || "").toLowerCase();
    if (src.includes("somestech") || src.includes("中科创星") || src.includes("企业")) {
      return `<span style="display:inline-block;font-size:.6rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:3px;background:#fef3c7;color:#92400e;margin-bottom:.55rem">企业</span>`;
    }
    return `<span style="display:inline-block;font-size:.6rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:3px;background:#eff6ff;color:#1d4ed8;margin-bottom:.55rem">科研</span>`;
  }

  function editActions(item) {
    const canEdit = window.__isAdmin || getUsername() === item.createdBy;
    if (!canEdit) return "";
    return `<div class="news-card-acts" onclick="event.stopPropagation()">
      <button class="nca-btn" style="color:#2563eb" title="${t("news.edit")}" onclick="openNewsEditor('${item.id}')">✎</button>
      <button class="nca-btn" style="color:#dc2626" title="${t("news.delete")}" onclick="deleteNewsArticle('${item.id}')">✕</button>
    </div>`;
  }

  function featuredCard(item) {
    const title   = currentLang === "zh" ? item.title.zh : (item.title.en || item.title.zh);
    const excerpt = currentLang === "zh" ? item.excerpt.zh : (item.excerpt.en || item.excerpt.zh);
    const { year, md } = fmtDate(item.date);
    const imgInner = item.coverImage
      ? `<img src="${item.coverImage}" alt="" class="news-card-img-v2" style="width:100%;height:100%;object-fit:cover">`
      : `<div style="width:100%;height:100%;background:${coverBg(item.id)};display:flex;align-items:center;justify-content:center"><span style="font-size:3.5rem;opacity:.18;color:white">✦</span></div>`;
    return `
      <div class="news-featured-card" onclick="navToArticle('${item.id}')">
        <div style="overflow:hidden;min-height:240px">${imgInner}</div>
        <div style="padding:1.75rem;display:flex;flex-direction:column;justify-content:center">
          ${tagHtml(item)}
          <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:.65rem">
            <span style="font-size:1.4rem;font-weight:900;color:#1d4ed8;line-height:1">${year}</span>
            <span style="font-size:.72rem;color:#9ca3af;font-weight:500">${md}</span>
          </div>
          <h3 class="line-clamp-3" style="font-size:1.05rem;font-weight:800;color:#111827;line-height:1.5;margin-bottom:.75rem">${title}</h3>
          <p class="line-clamp-3" style="font-size:.8rem;color:#6b7280;line-height:1.65">${excerpt}</p>
          <div style="margin-top:1.1rem;font-size:.72rem;font-weight:700;color:#2563eb;letter-spacing:.02em">${t("news.readMore")} →</div>
        </div>
        ${editActions(item)}
      </div>`;
  }

  function gridCard(item) {
    const title   = currentLang === "zh" ? item.title.zh : (item.title.en || item.title.zh);
    const excerpt = currentLang === "zh" ? item.excerpt.zh : (item.excerpt.en || item.excerpt.zh);
    const { year, md } = fmtDate(item.date);
    const imgBlock = `<div style="overflow:hidden;aspect-ratio:3/2">
      ${item.coverImage
        ? `<img src="${item.coverImage}" alt="" class="news-card-img-v2" style="width:100%;height:100%;object-fit:cover">`
        : `<div style="width:100%;height:100%;background:${coverBg(item.id)};display:flex;align-items:center;justify-content:center"><span style="font-size:2rem;opacity:.2;color:white">✦</span></div>`
      }
    </div>`;
    return `
      <div class="news-card-v2" onclick="navToArticle('${item.id}')">
        ${imgBlock}
        <div class="news-card-content" style="padding:.9rem 1rem">
          ${tagHtml(item)}
          <div style="display:flex;align-items:baseline;gap:5px;margin-bottom:.45rem">
            <span style="font-size:1.05rem;font-weight:900;color:#1d4ed8;line-height:1">${year}</span>
            <span style="font-size:.68rem;color:#9ca3af">${md}</span>
          </div>
          <h3 class="line-clamp-2" style="font-size:.8rem;font-weight:700;color:#111827;line-height:1.45;margin-bottom:.4rem">${title}</h3>
          <p class="line-clamp-2" style="font-size:.7rem;color:#6b7280;line-height:1.6">${excerpt}</p>
          <div class="news-card-link" style="font-size:.67rem;font-weight:700;color:#2563eb">${t("news.readMore")} →</div>
        </div>
        ${editActions(item)}
      </div>`;
  }

  const writeBtn = canWrite ? `
    <button onclick="openNewsEditor(null)"
      style="flex-shrink:0;background:rgba(255,255,255,.12);color:white;border:1px solid rgba(255,255,255,.28);border-radius:.5rem;padding:.5rem 1.1rem;font-size:.825rem;font-weight:600;cursor:pointer;transition:background .2s"
      onmouseover="this.style.background='rgba(255,255,255,.22)'" onmouseout="this.style.background='rgba(255,255,255,.12)'">
      ✏ ${t("news.write")}
    </button>` : "";

  const [featured, ...rest] = _newsCache;

  el.innerHTML = `
    <div class="news-hero-bg">
      <div class="news-hero-wm">NEWS</div>
      <div style="position:relative;padding:2.25rem 2rem 1.75rem;display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:1rem">
        <div>
          <div style="font-size:.6rem;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:rgba(255,255,255,.4);margin-bottom:.5rem">BioMiND Lab</div>
          <h2 style="font-size:1.6rem;font-weight:900;color:white;line-height:1.1" data-i18n="news.title"></h2>
          <p style="font-size:.78rem;color:rgba(255,255,255,.5);margin-top:.35rem" data-i18n="news.subtitle"></p>
        </div>
        ${writeBtn}
      </div>
    </div>
    ${featured ? `<div style="margin-bottom:1.75rem">${featuredCard(featured)}</div>` : ""}
    ${rest.length ? `<div class="news-grid-v2">${rest.map(gridCard).join("")}</div>` : ""}`;
  applyI18n();
}

async function renderNewsArticle(id) {
  const el = document.getElementById("view-news");
  el.innerHTML = `<div style="text-align:center;padding:4rem;color:#9ca3af">${t("loading")}</div>`;

  // Ensure news cache is populated (e.g. when navigating directly to #news/id)
  if (!_newsCache.length) {
    try {
      const resp = await fetch("/api/news");
      _newsCache = resp.ok ? await resp.json() : [];
    } catch { _newsCache = []; }
  }

  const item = _newsCache.find(a => a.id === id);
  if (!item) {
    el.innerHTML = `
      <div style="text-align:center;padding:4rem">
        <p style="color:#64748b;margin-bottom:1rem">文章未找到</p>
        <button onclick="navBack()" style="color:#2563eb;font-size:.9rem;cursor:pointer;background:none;border:none">← ${t("news.title")}</button>
      </div>`;
    return;
  }

  const title   = currentLang === "zh" ? item.title.zh   : (item.title.en   || item.title.zh);
  const excerpt = currentLang === "zh" ? item.excerpt?.zh : (item.excerpt?.en || item.excerpt?.zh);
  const body    = currentLang === "zh" ? item.body.zh     : (item.body.en    || item.body.zh);

  const src = (item.source || "").toLowerCase();
  const isBiz = src.includes("somestech") || src.includes("中科创星") || src.includes("企业");
  const tagCls   = isBiz ? "art-tag-biz" : "art-tag-research";
  const tagLabel = isBiz ? "企业" : "科研";

  const coverHtml = item.coverImage
    ? `<div class="article-hero-cover"><img src="${item.coverImage}" alt="${title}"></div>`
    : `<div class="article-hero-cover"><div class="article-hero-cover-placeholder">✦</div></div>`;

  const canEdit = window.__isAdmin || getUsername() === item.createdBy;
  const editBtnHtml = canEdit
    ? `<button onclick="navToArticleEdit('${item.id}')" style="font-size:.78rem;color:#2563eb;background:#eff6ff;border:none;cursor:pointer;padding:4px 12px;border-radius:20px;margin-left:auto">${t("news.edit")}</button>`
    : "";

  // Related: up to 2 other articles, most recent first (API order)
  const others = _newsCache.filter(a => a.id !== id).slice(0, 2);
  const relatedHtml = others.length === 0 ? "" : `
    <div class="article-related">
      <div class="article-related-label">${currentLang === "zh" ? "相关进展" : "Related"}</div>
      <div class="article-related-grid">
        ${others.map(o => {
          const oTitle = currentLang === "zh" ? o.title.zh : (o.title.en || o.title.zh);
          return `<div class="article-related-card" onclick="navToArticle('${o.id}')">
            <div class="arc-title">${oTitle}</div>
            <div class="arc-date">${o.date}</div>
          </div>`;
        }).join("")}
      </div>
    </div>`;

  const sourceHtml = item.url
    ? `<div class="article-source-footer">
        <span>📰 ${currentLang === "zh" ? "来源" : "Source"}：</span>
        <a href="${item.url}" target="_blank" rel="noopener">${item.source || "siat.ac.cn"} ↗</a>
        <span style="margin-left:auto">${item.date}</span>
       </div>`
    : "";

  el.innerHTML = `
    <div class="article-breadcrumb">
      <span class="ab-back" onclick="navBack()">← ${t("news.title")}</span>
      <span class="ab-sep">/</span>
      <span class="ab-title">${title}</span>
      ${editBtnHtml}
    </div>
    <div class="article-hero">
      <div class="article-hero-inner">
        <div class="article-hero-meta">
          <span class="art-tag ${tagCls}">${tagLabel}</span>
          <span class="art-tag art-tag-date">${item.date}</span>
        </div>
        <div class="article-hero-title">${title}</div>
        ${excerpt ? `<div class="article-hero-excerpt">${excerpt}</div>` : ""}
        ${coverHtml}
      </div>
    </div>
    <div class="article-body-wrap">
      <div class="article-body-card">
        ${_renderMd(body)}
        ${sourceHtml}
      </div>
      ${relatedHtml}
    </div>`;
}

// ── News editor ────────────────────────────────────────────────────
let _neArticleId = null;

function openNewsEditor(idOrNull) {
  _neArticleId = idOrNull;
  const article = idOrNull ? _newsCache.find(a => a.id === idOrNull) : null;
  document.getElementById("ne-title-zh").value   = article?.title?.zh    || "";
  document.getElementById("ne-title-en").value   = article?.title?.en    || "";
  document.getElementById("ne-excerpt-zh").value = article?.excerpt?.zh  || "";
  document.getElementById("ne-excerpt-en").value = article?.excerpt?.en  || "";
  document.getElementById("ne-date").value        = article?.date         || new Date().toISOString().slice(0, 10);
  document.getElementById("ne-source").value      = article?.source       || "";
  document.getElementById("ne-url").value         = article?.url          || "";
  document.getElementById("ne-cover").value       = article?.coverImage   || "";
  document.getElementById("ne-body-zh").value     = article?.body?.zh     || "";
  document.getElementById("ne-body-en").value     = article?.body?.en     || "";
  document.getElementById("ne-preview").innerHTML = "";
  document.getElementById("ne-preview-wrap").classList.add("hidden");
  document.getElementById("ne-error").classList.add("hidden");
  document.getElementById("ne-status").textContent = "";
  document.getElementById("news-editor-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  applyI18n();
}

function closeNewsEditor() {
  document.getElementById("news-editor-modal").classList.add("hidden");
  document.body.style.overflow = "";
}

function toggleNePreview() {
  const wrap = document.getElementById("ne-preview-wrap");
  if (wrap.classList.contains("hidden")) {
    document.getElementById("ne-preview").innerHTML = _renderMd(document.getElementById("ne-body-zh").value);
    wrap.classList.remove("hidden");
  } else {
    wrap.classList.add("hidden");
  }
}

async function uploadNewsImage(input) {
  const file = input.files[0];
  if (!file) return;
  const status = document.getElementById("ne-img-status");
  status.textContent = t("news.editor.uploadingImage");
  try {
    const fd = new FormData();
    fd.append("file", file);
    const resp = await apiFetch("/api/news/images", { method: "POST", body: fd });
    if (!resp.ok) throw new Error();
    const data = await resp.json();
    const ta = document.getElementById("ne-body-zh");
    const pos = ta.selectionStart;
    const ins = `\n![](${data.url})\n`;
    ta.value = ta.value.slice(0, pos) + ins + ta.value.slice(pos);
    ta.selectionStart = ta.selectionEnd = pos + ins.length;
    ta.focus();
    status.textContent = t("news.editor.imageUploaded");
    setTimeout(() => { status.textContent = ""; }, 2000);
  } catch {
    status.textContent = "Upload failed";
    setTimeout(() => { status.textContent = ""; }, 2000);
  }
  input.value = "";
}

async function uploadNewsCover(input) {
  const file = input.files[0];
  if (!file) return;
  try {
    const fd = new FormData();
    fd.append("file", file);
    const resp = await apiFetch("/api/news/images", { method: "POST", body: fd });
    if (!resp.ok) throw new Error();
    const data = await resp.json();
    document.getElementById("ne-cover").value = data.url;
  } catch {}
  input.value = "";
}

async function submitNewsArticle() {
  const titleZh = document.getElementById("ne-title-zh").value.trim();
  const bodyZh  = document.getElementById("ne-body-zh").value.trim();
  if (!titleZh || !bodyZh) {
    const errEl = document.getElementById("ne-error");
    errEl.textContent = t("news.editor.errorEmpty");
    errEl.classList.remove("hidden");
    return;
  }
  const payload = {
    title_zh:    titleZh,
    title_en:    document.getElementById("ne-title-en").value.trim(),
    excerpt_zh:  document.getElementById("ne-excerpt-zh").value.trim(),
    excerpt_en:  document.getElementById("ne-excerpt-en").value.trim(),
    date:        document.getElementById("ne-date").value,
    source:      document.getElementById("ne-source").value.trim(),
    url:         document.getElementById("ne-url").value.trim(),
    cover_image: document.getElementById("ne-cover").value.trim(),
    body_zh:     bodyZh,
    body_en:     document.getElementById("ne-body-en").value.trim(),
  };
  const statusEl = document.getElementById("ne-status");
  statusEl.textContent = t("news.editor.saving");
  document.getElementById("ne-error").classList.add("hidden");
  try {
    const method = _neArticleId ? "PUT" : "POST";
    const url    = _neArticleId ? `/api/news/${_neArticleId}` : "/api/news";
    const resp   = await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || t("news.editor.errorSave"));
    }
    statusEl.textContent = t("news.editor.saved");
    setTimeout(() => { closeNewsEditor(); renderNews(); }, 600);
  } catch (e) {
    document.getElementById("ne-error").textContent = e.message;
    document.getElementById("ne-error").classList.remove("hidden");
    statusEl.textContent = "";
  }
}

async function deleteNewsArticle(id) {
  if (!confirm(`${t("news.delete")}?`)) return;
  try {
    const resp = await apiFetch(`/api/news/${id}`, { method: "DELETE" });
    if (resp.ok) renderNews();
  } catch {}
}

// ── Mobile menu ───────────────────────────────────────────────────
function toggleMobileMenu() {
  document.getElementById("mobile-nav-menu").classList.toggle("hidden");
}

function closeMobileMenu() {
  document.getElementById("mobile-nav-menu").classList.add("hidden");
}

// ── Boot ──────────────────────────────────────────────────────────
async function boot() {
  window.__isAdmin = localStorage.getItem("biomind_is_admin") === "true";
  applyI18n();
  updateNavUser();
  const rawHash = location.hash.slice(1) || "home";
  const [view, subId] = rawHash.split("/");
  if (view === "sops" && !getUsername()) {
    showView("home");
    renderView("home");
  } else if (view === "news" && subId) {
    _currentArticleId = subId;
    currentView = "news";
    document.querySelectorAll(".view").forEach(el => el.classList.add("hidden"));
    const newsView = document.getElementById("view-news");
    if (newsView) newsView.classList.remove("hidden");
    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.classList.toggle("text-blue-600", btn.dataset.view === "news");
      btn.classList.toggle("font-semibold", btn.dataset.view === "news");
    });
    await renderNewsArticle(subId);
  } else {
    showView(view || "home");
    renderView(view || "home");
  }
  // One-time event delegation for extract-sop / view-sop buttons on paper cards
  document.querySelector("main").addEventListener("click", _handleSopAction);
}

boot();
