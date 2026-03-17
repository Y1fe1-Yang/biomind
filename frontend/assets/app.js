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
  updateNavAdmin();
}

function clearAuth() {
  localStorage.removeItem("biomind_token");
  localStorage.removeItem("biomind_username");
  localStorage.removeItem("biomind_is_admin");
  window.__isAdmin = false;
  updateNavAdmin();
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
    if (_AUTH_VIEWS.has(view) && !getUsername()) {
      await showAuthModal();
      if (!getUsername()) return;
    }
    if (_ADMIN_VIEWS.has(view) && !window.__isAdmin) return;
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
    papers: renderPapers,
    timeline: renderTimeline,
    directions: renderDirections,
    sops: renderSops,
    presentations: renderPresentations,
    members: renderMembers,
    news: renderNews,
    share: renderShare,
    admin: renderAdmin,
  };
  if (renders[name]) renders[name]();
}

// ── Auth-gated views ──────────────────────────────────────────────
const _AUTH_VIEWS  = new Set(["sops", "share", "admin"]);
const _ADMIN_VIEWS = new Set(["admin"]);

// ── Placeholder render functions (filled by worktrees) ────────────
async function renderAdmin() {
  const el = document.getElementById("view-admin");
  el.innerHTML = "";

  const tabs = [
    { key: "members",  label: "成员管理" },
    { key: "papers",   label: "论文管理" },
    { key: "news",     label: "新闻管理" },
    { key: "ai",       label: "AI配置" },
    { key: "footer",   label: "友情链接" },
  ];

  let activeTab = "members";

  // ── Tab bar ──────────────────────────────────────────────────────
  const tabBar = document.createElement("div");
  tabBar.className = "flex gap-2 mb-6 flex-wrap";
  tabBar.innerHTML = tabs.map(tab =>
    `<button data-tab="${tab.key}" class="px-4 py-2 text-sm rounded-lg font-medium transition ${
      tab.key === activeTab
        ? "bg-blue-600 text-white"
        : "text-gray-600 hover:bg-gray-100"
    }">${tab.label}</button>`
  ).join("");

  // ── Content area ─────────────────────────────────────────────────
  const content = document.createElement("div");
  content.id = "admin-tab-content";

  el.appendChild(tabBar);
  el.appendChild(content);

  // ── Tab click handler ─────────────────────────────────────────────
  tabBar.addEventListener("click", e => {
    const btn = e.target.closest("[data-tab]");
    if (!btn) return;
    activeTab = btn.dataset.tab;
    tabBar.querySelectorAll("[data-tab]").forEach(b => {
      const active = b.dataset.tab === activeTab;
      b.className = `px-4 py-2 text-sm rounded-lg font-medium transition ${
        active ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
      }`;
    });
    _renderAdminTab(activeTab, content);
  });

  await _renderAdminTab(activeTab, content);
}

// ── Per-tab renderers ─────────────────────────────────────────────

async function _renderAdminTab(tab, container) {
  container.innerHTML = `<div class="text-gray-400 text-sm py-8 text-center">加载中…</div>`;
  try {
    switch (tab) {
      case "members": await _adminTabMembers(container); break;
      case "papers":  await _adminTabPapers(container);  break;
      case "news":    _adminTabNews(container);           break;
      case "ai":      await _adminTabAi(container);      break;
      case "footer":  await _adminTabFooter(container);  break;
    }
  } catch (err) {
    container.innerHTML = `<div class="text-red-500 text-sm py-8 text-center">加载失败: ${err.message}</div>`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function _adminInput(id, placeholder, value = "") {
  return `<input id="${id}" type="text" placeholder="${placeholder}" value="${_esc(value)}"
    class="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500">`;
}

function _adminBtn(label, cls = "primary", onclick = "") {
  const base = "rounded-lg px-4 py-2 text-sm font-medium cursor-pointer";
  const style = cls === "primary"
    ? "bg-blue-600 text-white hover:bg-blue-700 " + base
    : cls === "danger"
    ? "text-red-600 hover:text-red-700 text-sm cursor-pointer"
    : base;
  return `<button class="${style}" onclick="${onclick}">${label}</button>`;
}

function _esc(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
}

function _adminCard(html) {
  return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">${html}</div>`;
}

// ── Members tab ───────────────────────────────────────────────────

async function _adminTabMembers(container) {
  const resp = await apiFetch("/api/admin/members");
  const members = resp.ok ? await resp.json() : [];

  const groupLabel = { pi: "PI", postdoc: "博士后", researcher: "研究人员", phd: "博士生", master: "硕士生", alumni: "往届成员" };

  const rows = members.map(m => `
    <div class="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <div>
        <span class="font-medium text-sm">${_esc(m.name?.zh || m.id)}</span>
        <span class="text-xs text-gray-400 ml-2">${_esc(groupLabel[m.group] || m.group || "")}</span>
        <span class="text-xs text-gray-400 ml-2">${_esc(m.email || "")}</span>
      </div>
      <div class="flex gap-3 items-center">
        <button class="text-blue-600 hover:text-blue-700 text-sm" onclick="_adminEditMember('${_esc(m.id)}')">编辑</button>
        <button class="text-red-600 hover:text-red-700 text-sm" onclick="_adminDeleteMember('${_esc(m.id)}', this)">删除</button>
      </div>
    </div>`).join("") || `<p class="text-gray-400 text-sm">暂无成员</p>`;

  container.innerHTML = _adminCard(`
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-gray-800">成员列表</h3>
      <button class="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
        onclick="_adminAddMember()">+ 添加成员</button>
    </div>
    <div id="admin-members-list">${rows}</div>
  `) + _adminCard(`
    <h3 class="font-semibold text-gray-800 mb-4" id="admin-member-form-title">添加成员</h3>
    <div class="grid grid-cols-1 gap-3" id="admin-member-form">
      <div class="grid grid-cols-2 gap-3">
        ${_adminInput("amf-id", "ID（如 zhang-san）")}
        ${_adminInput("amf-group", "分组（pi/phd/master/researcher/alumni）")}
      </div>
      <div class="grid grid-cols-2 gap-3">
        ${_adminInput("amf-name-zh", "中文姓名")}
        ${_adminInput("amf-name-en", "English Name")}
      </div>
      <div class="grid grid-cols-2 gap-3">
        ${_adminInput("amf-title-zh", "职称（中文）")}
        ${_adminInput("amf-title-en", "Title (English)")}
      </div>
      ${_adminInput("amf-email", "邮箱")}
      <div class="flex gap-2">
        <button id="amf-save-btn" class="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
          onclick="_adminSaveMember()">保存</button>
        <button class="text-gray-500 hover:text-gray-700 text-sm px-4 py-2" onclick="_adminClearMemberForm()">清空</button>
      </div>
      <div id="amf-status" class="text-sm"></div>
    </div>
  `);
}

let _editingMemberId = null;

function _adminClearMemberForm() {
  _editingMemberId = null;
  document.getElementById("admin-member-form-title").textContent = "添加成员";
  document.getElementById("amf-save-btn").textContent = "保存";
  ["amf-id","amf-group","amf-name-zh","amf-name-en","amf-title-zh","amf-title-en","amf-email"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const idField = document.getElementById("amf-id");
  if (idField) idField.disabled = false;
}

async function _adminEditMember(memberId) {
  const resp = await apiFetch("/api/admin/members");
  if (!resp.ok) return;
  const members = await resp.json();
  const m = members.find(x => x.id === memberId);
  if (!m) return;
  _editingMemberId = memberId;
  document.getElementById("admin-member-form-title").textContent = "编辑成员";
  document.getElementById("amf-save-btn").textContent = "更新";
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
  set("amf-id", m.id);
  set("amf-group", m.group);
  set("amf-name-zh", m.name?.zh);
  set("amf-name-en", m.name?.en);
  set("amf-title-zh", m.title?.zh);
  set("amf-title-en", m.title?.en);
  set("amf-email", m.email);
  const idField = document.getElementById("amf-id");
  if (idField) idField.disabled = true;
  document.getElementById("admin-member-form").scrollIntoView({ behavior: "smooth" });
}

async function _adminSaveMember() {
  const get = id => document.getElementById(id)?.value?.trim() || "";
  const statusEl = document.getElementById("amf-status");
  const payload = {
    id: get("amf-id"),
    group: get("amf-group"),
    name: { zh: get("amf-name-zh"), en: get("amf-name-en") },
    title: { zh: get("amf-title-zh"), en: get("amf-title-en") },
    email: get("amf-email"),
    photos: [], research: { zh: [], en: [] }, edu: { zh: [], en: [] }, bio: { zh: "", en: "" },
  };
  if (!payload.id) { statusEl.textContent = "ID 不能为空"; statusEl.className = "text-sm text-red-500"; return; }
  try {
    let resp;
    if (_editingMemberId) {
      resp = await apiFetch(`/api/admin/members/${_editingMemberId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
    } else {
      resp = await apiFetch("/api/admin/members", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
    }
    if (!resp.ok) {
      const err = await resp.json();
      statusEl.textContent = err.detail || "保存失败";
      statusEl.className = "text-sm text-red-500";
      return;
    }
    statusEl.textContent = "已保存";
    statusEl.className = "text-sm text-green-600";
    _adminClearMemberForm();
    await _adminTabMembers(document.getElementById("admin-tab-content"));
  } catch {
    statusEl.textContent = "网络错误";
    statusEl.className = "text-sm text-red-500";
  }
}

async function _adminDeleteMember(memberId, btn) {
  if (!confirm(`确认删除成员 "${memberId}"？`)) return;
  try {
    const resp = await apiFetch(`/api/admin/members/${memberId}`, { method: "DELETE" });
    if (resp.ok) {
      await _adminTabMembers(document.getElementById("admin-tab-content"));
    }
  } catch {}
}

// ── SOP/Share Upload ──────────────────────────────────────────────

function _userSopCard(s) {
  const title = currentLang === "zh" ? s.title.zh : (s.title.en || s.title.zh);
  const tags = (s.tags || [])
    .map(tag => `<span style="font-size:.65rem;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:9999px">${escHtml(tag)}</span>`)
    .join("");
  const dateStr = s.uploadedAt ? new Date(s.uploadedAt * 1000).toLocaleDateString() : "";
  const fileIcon = s.fileType === "pdf" ? "📄" : s.fileType === "docx" ? "📝" : "📋";
  return `
    <div style="background:white;border-radius:.75rem;border:1px solid #e5e7eb;padding:1rem;cursor:pointer;transition:box-shadow .2s"
         onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,.08)'"
         onmouseout="this.style.boxShadow='none'"
         onclick="showView('sops');renderView('sops');setTimeout(()=>renderSopDetail('${escHtml(s.id)}'),50)">
      <div style="display:flex;align-items:flex-start;gap:.75rem">
        <span style="font-size:1.4rem;flex-shrink:0">${fileIcon}</span>
        <div style="flex:1;min-width:0">
          <p style="font-size:.875rem;font-weight:600;color:#111827;margin:0 0 .25rem">${escHtml(title)}</p>
          <p style="font-size:.72rem;color:#9ca3af;margin:0 0 .4rem">${escHtml(s.uploadedBy)} · ${dateStr}</p>
          ${tags ? `<div style="display:flex;flex-wrap:wrap;gap:3px">${tags}</div>` : ""}
        </div>
      </div>
    </div>`;
}

async function renderShare() {
  const el = document.getElementById("view-share");
  el.innerHTML = `<div style="text-align:center;padding:4rem;color:#9ca3af">${t("loading")}</div>`;

  let shares = [];
  try {
    const resp = await apiFetch("/api/sops?type=share");
    shares = resp.ok ? await resp.json() : [];
  } catch { shares = []; }

  const uploadBtn = `
    <button onclick="openSopUploadModal('share')"
      style="flex-shrink:0;background:rgba(255,255,255,.12);color:white;border:1px solid rgba(255,255,255,.28);border-radius:.5rem;padding:.5rem 1.1rem;font-size:.825rem;font-weight:600;cursor:pointer;transition:background .2s"
      onmouseover="this.style.background='rgba(255,255,255,.22)'" onmouseout="this.style.background='rgba(255,255,255,.12)'">
      + 上传分享
    </button>`;

  el.innerHTML = `
    <div style="background:linear-gradient(135deg,#0c1445,#1e3a8a,#1d4ed8);margin:-1.5rem -1rem 2rem;padding:2.25rem 2rem 1.75rem;display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:1rem;position:relative;overflow:hidden">
      <div style="position:absolute;right:-1rem;bottom:-.5rem;font-size:8rem;font-weight:900;color:rgba(255,255,255,.04);letter-spacing:-.3rem;line-height:1;pointer-events:none;user-select:none">SHARE</div>
      <div style="position:relative">
        <div style="font-size:.6rem;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:rgba(255,255,255,.4);margin-bottom:.5rem">BioMiND Lab</div>
        <h2 style="font-size:1.6rem;font-weight:900;color:white;line-height:1.1">组内分享</h2>
        <p style="font-size:.78rem;color:rgba(255,255,255,.5);margin-top:.35rem">团队成员的知识分享与资料汇编</p>
      </div>
      ${uploadBtn}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem">
      ${shares.map(_userSopCard).join("") || `<p style="color:#9ca3af;padding:3rem 0;text-align:center;grid-column:1/-1">${t("noResults")}</p>`}
    </div>`;
}

async function renderSopDetail(id) {
  const el = document.getElementById("view-sops");

  let sop = null;
  try {
    const resp = await apiFetch(`/api/sops/${id}`);
    if (resp.ok) sop = await resp.json();
  } catch {}

  if (!sop) {
    el.insertAdjacentHTML("beforeend", `
      <div style="text-align:center;padding:3rem">
        <p style="color:#64748b;margin-bottom:1rem">SOP 未找到</p>
        <button onclick="renderSops()" style="color:#2563eb;font-size:.9rem;cursor:pointer;background:none;border:none">← 返回 SOP 列表</button>
      </div>`);
    return;
  }

  const title = currentLang === "zh" ? sop.title.zh : (sop.title.en || sop.title.zh);
  const desc  = currentLang === "zh" ? sop.description?.zh : (sop.description?.en || sop.description?.zh);
  const dateStr = sop.uploadedAt ? new Date(sop.uploadedAt * 1000).toLocaleDateString() : "";
  const tags = (sop.tags || [])
    .map(tag => `<span style="font-size:.7rem;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:9999px">${escHtml(tag)}</span>`)
    .join("");

  const canEdit = window.__isAdmin || getUsername() === sop.uploadedBy;

  // File download or Markdown rendering
  let contentHtml = "";
  if (sop.fileType === "md" && sop.mdContent) {
    contentHtml = `<div style="margin-top:1.25rem;padding:1.25rem;background:#f8fafc;border-radius:.75rem;border:1px solid #e2e8f0;font-size:.875rem;color:#374151">${_renderMd(sop.mdContent)}</div>`;
  } else if (sop.file) {
    contentHtml = `<div style="margin-top:1.25rem">
      <a href="/data/${escHtml(sop.file)}" target="_blank" rel="noopener"
         style="display:inline-flex;align-items:center;gap:.5rem;background:#2563eb;color:white;padding:.6rem 1.25rem;border-radius:.5rem;font-size:.875rem;font-weight:600;text-decoration:none">
        ↓ 下载文件 (${sop.fileType?.toUpperCase()})
      </a>
    </div>`;
  }

  // Inline edit form
  const editFormHtml = canEdit ? `
    <details id="sop-detail-edit-${id}" style="margin-top:1.25rem">
      <summary style="font-size:.8rem;color:#2563eb;cursor:pointer;font-weight:600;user-select:none">编辑</summary>
      <div style="margin-top:.75rem;display:flex;flex-direction:column;gap:.6rem">
        <input id="sde-title-zh-${id}" value="${escHtml(sop.title.zh)}" placeholder="标题（中文）"
          style="border:1px solid #d1d5db;border-radius:.5rem;padding:.45rem .75rem;font-size:.85rem">
        <input id="sde-title-en-${id}" value="${escHtml(sop.title.en || '')}" placeholder="Title (English)"
          style="border:1px solid #d1d5db;border-radius:.5rem;padding:.45rem .75rem;font-size:.85rem">
        <input id="sde-tags-${id}" value="${escHtml((sop.tags || []).join(','))}" placeholder="标签（逗号分隔）"
          style="border:1px solid #d1d5db;border-radius:.5rem;padding:.45rem .75rem;font-size:.85rem">
        <div style="display:flex;gap:.5rem;margin-top:.25rem">
          <button onclick="_submitSopEdit('${escHtml(id)}')"
            style="background:#2563eb;color:white;border:none;border-radius:.5rem;padding:.4rem .9rem;font-size:.8rem;font-weight:600;cursor:pointer">保存</button>
          <button onclick="document.getElementById('sop-detail-edit-${id}').removeAttribute('open')"
            style="background:#f3f4f6;color:#374151;border:none;border-radius:.5rem;padding:.4rem .9rem;font-size:.8rem;cursor:pointer">取消</button>
          <span id="sde-status-${id}" style="font-size:.75rem;color:#9ca3af;align-self:center"></span>
        </div>
      </div>
    </details>` : "";

  const deleteBtn = canEdit ? `
    <button onclick="_deleteSopFromDetail('${escHtml(id)}')"
      style="font-size:.75rem;color:#dc2626;background:none;border:1px solid #fecaca;border-radius:.375rem;padding:.3rem .7rem;cursor:pointer;margin-left:.5rem">删除</button>` : "";

  el.insertAdjacentHTML("beforeend", `
    <div id="sop-detail-card-${id}" style="margin-top:1.5rem;background:white;border:1px solid #e5e7eb;border-radius:1rem;padding:1.5rem;box-shadow:0 2px 8px rgba(0,0,0,.04)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem">
        <div style="flex:1;min-width:0">
          <h3 style="font-size:1.1rem;font-weight:800;color:#111827;margin:0 0 .3rem">${escHtml(title)}</h3>
          <p style="font-size:.75rem;color:#9ca3af;margin:0 0 .5rem">${escHtml(sop.uploadedBy)} · ${dateStr}</p>
          ${tags ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:.5rem">${tags}</div>` : ""}
          ${desc ? `<p style="font-size:.85rem;color:#6b7280;margin:0">${escHtml(desc)}</p>` : ""}
        </div>
        <div style="flex-shrink:0;display:flex;align-items:center">
          <button onclick="document.getElementById('sop-detail-card-${id}').remove()"
            style="font-size:.75rem;color:#6b7280;background:none;border:1px solid #e5e7eb;border-radius:.375rem;padding:.3rem .7rem;cursor:pointer">关闭</button>
          ${deleteBtn}
        </div>
      </div>
      ${contentHtml}
      ${editFormHtml}
      <div id="sop-social-${id}" style="margin-top:1.5rem"></div>
    </div>`);
  renderSopSocial(id);
}

async function _submitSopEdit(id) {
  const titleZh = document.getElementById(`sde-title-zh-${id}`)?.value?.trim();
  const titleEn = document.getElementById(`sde-title-en-${id}`)?.value?.trim();
  const tagsStr = document.getElementById(`sde-tags-${id}`)?.value?.trim();
  const statusEl = document.getElementById(`sde-status-${id}`);
  const tags = tagsStr ? tagsStr.split(",").map(t => t.trim()).filter(Boolean) : [];
  if (statusEl) statusEl.textContent = "保存中…";
  try {
    const resp = await apiFetch(`/api/sops/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title_zh: titleZh, title_en: titleEn, tags }),
    });
    if (!resp.ok) throw new Error("保存失败");
    if (statusEl) statusEl.textContent = "已保存";
    // Refresh detail
    const card = document.getElementById(`sop-detail-card-${id}`);
    if (card) card.remove();
    renderSopDetail(id);
  } catch (e) {
    if (statusEl) statusEl.textContent = e.message;
  }
}

async function _deleteSopFromDetail(id) {
  if (!confirm("确认删除此 SOP？")) return;
  try {
    const resp = await apiFetch(`/api/sops/${id}`, { method: "DELETE" });
    if (resp.ok) {
      const card = document.getElementById(`sop-detail-card-${id}`);
      if (card) card.remove();
    }
  } catch {}
}

function _adminAddMember() {
  _adminClearMemberForm();
  document.getElementById("admin-member-form").scrollIntoView({ behavior: "smooth" });
}

// ── Papers tab ────────────────────────────────────────────────────

async function _adminTabPapers(container) {
  const papers = (window.DATA?.papers || []).concat(window.DATA?.books || []);

  const rows = papers.map(p => `
    <div class="py-3 border-b border-gray-50 last:border-0">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-800 leading-snug">${_esc(p.title)}</p>
          <p class="text-xs text-gray-400 mt-0.5">${_esc(p.id)} · ${p.year || ""} · ${_esc(p.journal || p.type || "")}${p.doi ? ` · DOI: ${_esc(p.doi)}` : ""}</p>
        </div>
        <button class="flex-shrink-0 text-blue-600 hover:text-blue-700 text-sm"
          onclick="_adminEditPaper('${_esc(p.id)}')">编辑</button>
      </div>
    </div>`).join("") || `<p class="text-gray-400 text-sm">无论文数据</p>`;

  container.innerHTML = _adminCard(`
    <h3 class="font-semibold text-gray-800 mb-4">论文列表</h3>
    <div class="max-h-96 overflow-y-auto">${rows}</div>
  `) + _adminCard(`
    <h3 class="font-semibold text-gray-800 mb-4" id="admin-paper-form-title">编辑论文</h3>
    <div class="grid grid-cols-1 gap-3">
      ${_adminInput("apf-id", "论文 ID（只读）")}
      ${_adminInput("apf-title", "标题")}
      ${_adminInput("apf-authors", "作者（逗号分隔）")}
      ${_adminInput("apf-doi", "DOI")}
      ${_adminInput("apf-directions", "研究方向（逗号分隔）")}
      <textarea id="apf-abstract" rows="4" placeholder="摘要"
        class="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"></textarea>
      <div class="flex gap-2">
        <button class="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
          onclick="_adminSavePaper()">保存</button>
      </div>
      <div id="apf-status" class="text-sm"></div>
    </div>
  `);
  const idField = document.getElementById("apf-id");
  if (idField) idField.disabled = true;
}

function _adminEditPaper(paperId) {
  const papers = (window.DATA?.papers || []).concat(window.DATA?.books || []);
  const p = papers.find(x => x.id === paperId);
  if (!p) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
  set("apf-id", p.id);
  set("apf-title", p.title);
  set("apf-authors", (p.authors || []).join(", "));
  set("apf-doi", p.doi || "");
  set("apf-directions", (p.directions || []).join(", "));
  const abs = document.getElementById("apf-abstract");
  if (abs) abs.value = p.abstract || "";
  const idField = document.getElementById("apf-id");
  if (idField) idField.disabled = true;
  document.getElementById("admin-paper-form-title").textContent = `编辑: ${p.title?.slice(0, 40) || p.id}`;
  document.getElementById("apf-abstract")?.scrollIntoView({ behavior: "smooth" });
}

async function _adminSavePaper() {
  const get = id => document.getElementById(id)?.value?.trim() || "";
  const statusEl = document.getElementById("apf-status");
  const paperId = get("apf-id");
  if (!paperId) { statusEl.textContent = "请先选择要编辑的论文"; statusEl.className = "text-sm text-red-500"; return; }
  const authorsRaw = get("apf-authors");
  const directionsRaw = get("apf-directions");
  const payload = {
    title: get("apf-title"),
    authors: authorsRaw ? authorsRaw.split(",").map(s => s.trim()).filter(Boolean) : [],
    doi: get("apf-doi"),
    directions: directionsRaw ? directionsRaw.split(",").map(s => s.trim()).filter(Boolean) : [],
    abstract: document.getElementById("apf-abstract")?.value || "",
  };
  try {
    const resp = await apiFetch(`/api/admin/papers/${paperId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const err = await resp.json();
      statusEl.textContent = err.detail || "保存失败";
      statusEl.className = "text-sm text-red-500";
      return;
    }
    const updated = await resp.json();
    // Patch local window.DATA so the list refreshes without reload
    const arr = window.DATA?.papers || [];
    const idx = arr.findIndex(x => x.id === paperId);
    if (idx >= 0) arr[idx] = { ...arr[idx], ...updated };
    else {
      const bookArr = window.DATA?.books || [];
      const bi = bookArr.findIndex(x => x.id === paperId);
      if (bi >= 0) bookArr[bi] = { ...bookArr[bi], ...updated };
    }
    statusEl.textContent = "已保存";
    statusEl.className = "text-sm text-green-600";
  } catch {
    statusEl.textContent = "网络错误";
    statusEl.className = "text-sm text-red-500";
  }
}

// ── News tab ─────────────────────────────────────────────────────

function _adminTabNews(container) {
  const items = _newsCache || [];
  const rows = items.map(item => {
    const title = item.title?.zh || item.title?.en || "(无标题)";
    return `
      <div class="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
        <div>
          <span class="text-sm font-medium">${_esc(title)}</span>
          <span class="text-xs text-gray-400 ml-2">${_esc(item.date || "")}</span>
        </div>
        <button class="text-blue-600 hover:text-blue-700 text-sm"
          onclick="showView('news');renderNews().then(()=>openNewsEditor('${_esc(item.id)}'))">编辑</button>
      </div>`;
  }).join("") || `<p class="text-gray-400 text-sm">暂无新闻，请切换到"新闻"页面查看</p>`;

  container.innerHTML = _adminCard(`
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-gray-800">新闻文章</h3>
      <button class="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
        onclick="showView('news');renderNews().then(()=>openNewsEditor(null))">+ 新建文章</button>
    </div>
    <div>${rows}</div>
  `);
}

// ── AI Config tab ─────────────────────────────────────────────────

async function _adminTabAi(container) {
  const resp = await apiFetch("/api/admin/ai-config");
  const config = resp.ok ? await resp.json() : { provider: "", keys: {} };

  const providerOptions = ["zhipu", "claude", "kimi"].map(p =>
    `<option value="${p}" ${config.provider === p ? "selected" : ""}>${p}</option>`
  ).join("");

  container.innerHTML = _adminCard(`
    <h3 class="font-semibold text-gray-800 mb-4">AI 提供商配置</h3>
    <div class="grid grid-cols-1 gap-4">
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1">AI 提供商</label>
        <select id="ai-provider"
          class="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500">
          ${providerOptions}
        </select>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1">ZhipuAI Key ${_aiKeyHint(config.keys?.zhipu)}</label>
        <input id="ai-key-zhipu" type="password" placeholder="留空保持不变"
          class="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1">Claude Key ${_aiKeyHint(config.keys?.claude)}</label>
        <input id="ai-key-claude" type="password" placeholder="留空保持不变"
          class="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1">Kimi Key ${_aiKeyHint(config.keys?.kimi)}</label>
        <input id="ai-key-kimi" type="password" placeholder="留空保持不变"
          class="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
      <div class="flex gap-2 items-center">
        <button class="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
          onclick="_adminSaveAi()">保存配置</button>
        <div id="ai-status" class="text-sm"></div>
      </div>
    </div>
  `);
}

function _aiKeyHint(masked) {
  if (!masked) return '<span class="text-red-400">（未配置）</span>';
  return `<span class="text-green-600">（已配置: ${_esc(masked)}）</span>`;
}

async function _adminSaveAi() {
  const provider = document.getElementById("ai-provider")?.value;
  const statusEl = document.getElementById("ai-status");
  const keysPayload = {};
  const zhipu = document.getElementById("ai-key-zhipu")?.value || "";
  const claude = document.getElementById("ai-key-claude")?.value || "";
  const kimi   = document.getElementById("ai-key-kimi")?.value   || "";
  if (zhipu !== "") keysPayload.zhipu = zhipu;
  if (claude !== "") keysPayload.claude = claude;
  if (kimi   !== "") keysPayload.kimi   = kimi;

  const payload = { provider };
  if (Object.keys(keysPayload).length > 0) payload.keys = keysPayload;

  try {
    const resp = await apiFetch("/api/admin/ai-config", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const err = await resp.json();
      statusEl.textContent = err.detail || "保存失败";
      statusEl.className = "text-sm text-red-500";
      return;
    }
    statusEl.textContent = "已保存";
    statusEl.className = "text-sm text-green-600";
    // Refresh to show updated masked keys
    await _adminTabAi(document.getElementById("admin-tab-content"));
  } catch {
    statusEl.textContent = "网络错误";
    statusEl.className = "text-sm text-red-500";
  }
}

// ── Footer tab ────────────────────────────────────────────────────

async function _adminTabFooter(container) {
  const resp = await apiFetch("/api/admin/footer");
  const data = resp.ok ? await resp.json() : { links: [] };
  const links = data.links || [];

  const rows = links.map((lnk, i) => `
    <div class="flex gap-2 mb-2 items-center" data-link-idx="${i}">
      <input type="text" value="${_esc(lnk.label)}" placeholder="标签"
        class="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500 link-label">
      <input type="text" value="${_esc(lnk.url)}" placeholder="URL"
        class="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500 link-url">
      <button class="text-red-600 hover:text-red-700 text-sm px-2"
        onclick="this.closest('[data-link-idx]').remove()">删除</button>
    </div>`).join("");

  container.innerHTML = _adminCard(`
    <h3 class="font-semibold text-gray-800 mb-4">友情链接</h3>
    <div id="footer-links-list">${rows}</div>
    <button class="text-blue-600 hover:text-blue-700 text-sm mt-2"
      onclick="_adminAddFooterLink()">+ 添加链接</button>
    <div class="flex gap-2 items-center mt-4">
      <button class="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
        onclick="_adminSaveFooter()">保存</button>
      <div id="footer-status" class="text-sm"></div>
    </div>
  `);
}

function _adminAddFooterLink() {
  const list = document.getElementById("footer-links-list");
  const idx = list.querySelectorAll("[data-link-idx]").length;
  const div = document.createElement("div");
  div.className = "flex gap-2 mb-2 items-center";
  div.setAttribute("data-link-idx", idx);
  div.innerHTML = `
    <input type="text" placeholder="标签"
      class="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500 link-label">
    <input type="text" placeholder="URL"
      class="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500 link-url">
    <button class="text-red-600 hover:text-red-700 text-sm px-2"
      onclick="this.closest('[data-link-idx]').remove()">删除</button>`;
  list.appendChild(div);
}

async function _adminSaveFooter() {
  const statusEl = document.getElementById("footer-status");
  const rows = document.querySelectorAll("#footer-links-list [data-link-idx]");
  const links = [];
  rows.forEach(row => {
    const label = row.querySelector(".link-label")?.value?.trim() || "";
    const url   = row.querySelector(".link-url")?.value?.trim()   || "";
    if (label || url) links.push({ label, url });
  });
  try {
    const resp = await apiFetch("/api/admin/footer", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ links }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      statusEl.textContent = err.detail || "保存失败";
      statusEl.className = "text-sm text-red-500";
      return;
    }
    statusEl.textContent = "已保存";
    statusEl.className = "text-sm text-green-600";
    setTimeout(() => { statusEl.textContent = ""; }, 2000);
  } catch {
    statusEl.textContent = "网络错误";
    statusEl.className = "text-sm text-red-500";
  }
}
function openSopUploadModal(type) {
  document.getElementById("sop-modal-title").textContent = type === "share" ? "上传分享" : "上传 SOP";
  const container = document.getElementById("sop-upload-form-container");
  container.innerHTML = `
    <form id="sop-upload-form" onsubmit="event.preventDefault();_submitSopUpload('${type}')">
      <div style="display:flex;flex-direction:column;gap:.75rem">
        <div>
          <label style="font-size:.75rem;font-weight:600;color:#374151;display:block;margin-bottom:.3rem">类型</label>
          <select id="suf-type" style="width:100%;border:1px solid #d1d5db;border-radius:.5rem;padding:.45rem .75rem;font-size:.85rem">
            <option value="sop" ${type === "sop" ? "selected" : ""}>SOP（操作规程）</option>
            <option value="share" ${type === "share" ? "selected" : ""}>分享</option>
          </select>
        </div>
        <div>
          <label style="font-size:.75rem;font-weight:600;color:#374151;display:block;margin-bottom:.3rem">标题（中文）<span style="color:#ef4444">*</span></label>
          <input id="suf-title-zh" required placeholder="例：PCR 操作规程"
            style="width:100%;border:1px solid #d1d5db;border-radius:.5rem;padding:.45rem .75rem;font-size:.85rem;box-sizing:border-box">
        </div>
        <div>
          <label style="font-size:.75rem;font-weight:600;color:#374151;display:block;margin-bottom:.3rem">Title (English)</label>
          <input id="suf-title-en" placeholder="e.g. PCR Protocol"
            style="width:100%;border:1px solid #d1d5db;border-radius:.5rem;padding:.45rem .75rem;font-size:.85rem;box-sizing:border-box">
        </div>
        <div>
          <label style="font-size:.75rem;font-weight:600;color:#374151;display:block;margin-bottom:.3rem">简介（中文）</label>
          <textarea id="suf-desc-zh" rows="2" placeholder="简短描述..."
            style="width:100%;border:1px solid #d1d5db;border-radius:.5rem;padding:.45rem .75rem;font-size:.85rem;resize:none;box-sizing:border-box"></textarea>
        </div>
        <div>
          <label style="font-size:.75rem;font-weight:600;color:#374151;display:block;margin-bottom:.3rem">Description (English)</label>
          <textarea id="suf-desc-en" rows="2" placeholder="Brief description..."
            style="width:100%;border:1px solid #d1d5db;border-radius:.5rem;padding:.45rem .75rem;font-size:.85rem;resize:none;box-sizing:border-box"></textarea>
        </div>
        <div>
          <label style="font-size:.75rem;font-weight:600;color:#374151;display:block;margin-bottom:.3rem">标签（逗号分隔）</label>
          <input id="suf-tags" placeholder="PCR, 分子生物学, ..."
            style="width:100%;border:1px solid #d1d5db;border-radius:.5rem;padding:.45rem .75rem;font-size:.85rem;box-sizing:border-box">
        </div>
        <div>
          <label style="font-size:.75rem;font-weight:600;color:#374151;display:block;margin-bottom:.5rem">内容</label>
          <div style="display:flex;gap:.5rem;margin-bottom:.5rem">
            <button type="button" id="suf-tab-file" onclick="_sufSwitchTab('file')"
              style="flex:1;padding:.4rem;border-radius:.375rem;border:1px solid #2563eb;background:#2563eb;color:white;font-size:.75rem;font-weight:600;cursor:pointer">上传文件</button>
            <button type="button" id="suf-tab-md" onclick="_sufSwitchTab('md')"
              style="flex:1;padding:.4rem;border-radius:.375rem;border:1px solid #d1d5db;background:white;color:#374151;font-size:.75rem;font-weight:600;cursor:pointer">Markdown</button>
          </div>
          <div id="suf-panel-file">
            <input id="suf-file" type="file" accept=".pdf,.docx,.doc"
              style="width:100%;font-size:.8rem;border:1px solid #d1d5db;border-radius:.5rem;padding:.45rem .6rem;box-sizing:border-box">
            <p style="font-size:.68rem;color:#9ca3af;margin:.3rem 0 0">支持 PDF、DOCX，最大 20 MB</p>
          </div>
          <div id="suf-panel-md" style="display:none">
            <textarea id="suf-md" rows="6" placeholder="# 标题\n\n写下 Markdown 内容..."
              style="width:100%;border:1px solid #d1d5db;border-radius:.5rem;padding:.45rem .75rem;font-size:.82rem;font-family:monospace;resize:y;box-sizing:border-box"></textarea>
          </div>
        </div>
        <p id="suf-error" style="color:#dc2626;font-size:.75rem;display:none"></p>
        <div style="display:flex;justify-content:flex-end;gap:.75rem;padding-top:.25rem">
          <button type="button" onclick="document.getElementById('modal-sop-upload').classList.add('hidden')"
            style="padding:.5rem 1rem;font-size:.85rem;color:#6b7280;background:none;border:none;cursor:pointer">取消</button>
          <button type="submit" id="suf-submit"
            style="padding:.5rem 1.25rem;font-size:.85rem;font-weight:600;color:white;background:#2563eb;border:none;border-radius:.5rem;cursor:pointer">上传</button>
        </div>
      </div>
    </form>`;
  document.getElementById("modal-sop-upload").classList.remove("hidden");
}

function _sufSwitchTab(tab) {
  const isFile = tab === "file";
  document.getElementById("suf-panel-file").style.display = isFile ? "" : "none";
  document.getElementById("suf-panel-md").style.display   = isFile ? "none" : "";
  document.getElementById("suf-tab-file").style.background = isFile ? "#2563eb" : "white";
  document.getElementById("suf-tab-file").style.color      = isFile ? "white" : "#374151";
  document.getElementById("suf-tab-file").style.borderColor= isFile ? "#2563eb" : "#d1d5db";
  document.getElementById("suf-tab-md").style.background  = isFile ? "white" : "#2563eb";
  document.getElementById("suf-tab-md").style.color       = isFile ? "#374151" : "white";
  document.getElementById("suf-tab-md").style.borderColor = isFile ? "#d1d5db" : "#2563eb";
}

async function _submitSopUpload(defaultType) {
  const type = document.getElementById("suf-type").value;
  const titleZh = document.getElementById("suf-title-zh").value.trim();
  const titleEn = document.getElementById("suf-title-en").value.trim();
  const descZh  = document.getElementById("suf-desc-zh").value.trim();
  const descEn  = document.getElementById("suf-desc-en").value.trim();
  const tagsStr = document.getElementById("suf-tags").value.trim();
  const mdContent = document.getElementById("suf-md").value.trim();
  const fileEl  = document.getElementById("suf-file");
  const errEl   = document.getElementById("suf-error");
  const submitBtn = document.getElementById("suf-submit");

  errEl.style.display = "none";

  if (!titleZh) {
    errEl.textContent = "请填写标题（中文）";
    errEl.style.display = "";
    return;
  }

  const file = fileEl?.files?.[0];
  const mdVisible = document.getElementById("suf-panel-md").style.display !== "none";

  if (!file && (!mdVisible || !mdContent)) {
    errEl.textContent = "请上传文件或填写 Markdown 内容";
    errEl.style.display = "";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "上传中…";

  try {
    const fd = new FormData();
    fd.append("type", type);
    fd.append("title_zh", titleZh);
    fd.append("title_en", titleEn);
    fd.append("description_zh", descZh);
    fd.append("description_en", descEn);
    fd.append("tags", tagsStr);
    if (file) {
      fd.append("file", file);
    } else {
      fd.append("mdContent", mdContent);
    }

    const resp = await apiFetch("/api/sops", { method: "POST", body: fd });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || "上传失败");
    }
    document.getElementById("modal-sop-upload").classList.add("hidden");
    // Re-render the current view
    if (type === "share") {
      renderShare();
    } else {
      renderSops();
    }
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = "";
    submitBtn.disabled = false;
    submitBtn.textContent = "上传";
  }
}

async function renderUserSops() {
  const container = document.getElementById("view-sops");

  let userSops = [];
  try {
    const resp = await apiFetch("/api/sops?type=sop");
    userSops = resp.ok ? await resp.json() : [];
  } catch { userSops = []; }

  const uploadBtn = `
    <button onclick="openSopUploadModal('sop')"
      style="display:inline-flex;align-items:center;gap:.4rem;background:#2563eb;color:white;border:none;border-radius:.5rem;padding:.5rem 1rem;font-size:.8rem;font-weight:600;cursor:pointer;transition:background .2s"
      onmouseover="this.style.background='#1d4ed8'" onmouseout="this.style.background='#2563eb'">
      + 上传 SOP
    </button>`;

  const section = `
    <div id="user-sops-section" style="margin-top:2rem;border-top:2px solid #e5e7eb;padding-top:1.5rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem">
        <div>
          <h3 style="font-size:1rem;font-weight:800;color:#1e3a8a;margin:0">团队 SOP 上传</h3>
          <p style="font-size:.75rem;color:#9ca3af;margin:.2rem 0 0">成员上传的操作规程与文档</p>
        </div>
        ${getUsername() ? uploadBtn : ""}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.875rem">
        ${userSops.map(_userSopCard).join("") || `<p style="color:#9ca3af;padding:1.5rem 0;grid-column:1/-1;font-size:.85rem">${t("noResults")}</p>`}
      </div>
    </div>`;

  // Remove existing section to avoid duplicates on re-render
  const existing = document.getElementById("user-sops-section");
  if (existing) existing.remove();

  container.insertAdjacentHTML("beforeend", section);
}

// ── SOP social widgets (likes, bookmarks, comments) ────────────────

async function renderSopSocial(id) {
  const socialEl = document.getElementById(`sop-social-${id}`);
  if (!socialEl) return;

  // Fetch current user's likes, bookmarks, and comments in parallel
  let myLikes = [], myBookmarks = [], comments = [];
  try {
    const [likesResp, bookmarksResp, commentsResp] = await Promise.all([
      apiFetch("/api/me/likes"),
      apiFetch("/api/me/bookmarks"),
      apiFetch(`/api/sops/${id}/comments`),
    ]);
    myLikes      = await likesResp.json();
    myBookmarks  = await bookmarksResp.json();
    comments     = await commentsResp.json();
  } catch {
    socialEl.innerHTML = '<p class="text-red-400 text-sm">Could not load social features.</p>';
    return;
  }

  const liked      = myLikes.includes(id);
  const bookmarked = myBookmarks.includes(id);
  const username   = getUsername();

  function _likeClass(active) {
    return active
      ? "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm border-red-300 text-red-600 bg-red-50"
      : "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm border-gray-200 text-gray-600 hover:bg-gray-50";
  }
  function _bookmarkClass(active) {
    return active
      ? "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm border-yellow-300 text-yellow-600 bg-yellow-50"
      : "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm border-gray-200 text-gray-600 hover:bg-gray-50";
  }

  function _renderComments(cmts) {
    if (!cmts.length) {
      return '<p class="text-gray-400 text-sm py-4 text-center">No comments yet. Be the first!</p>';
    }
    return cmts.map(c => {
      const date = new Date(c.created_at * 1000).toLocaleDateString();
      const canDelete = (c.username === username) || window.__isAdmin;
      const delBtn = canDelete
        ? `<button onclick="_deleteSopComment('${id}', ${c.id})"
             class="text-xs text-red-400 hover:text-red-600 ml-2">Delete</button>`
        : "";
      return `<div class="flex justify-between py-3 border-b border-gray-100 last:border-0">
        <div class="flex-1">
          <span class="font-medium text-sm text-gray-800">${c.username}</span>
          <span class="text-xs text-gray-400 ml-2">${date}</span>
          <p class="text-sm text-gray-700 mt-1">${c.content.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>
        </div>
        ${delBtn}
      </div>`;
    }).join("");
  }

  socialEl.innerHTML = `
    <div class="mb-6">
      <div class="flex gap-3 mb-6">
        <button id="like-btn-${id}" onclick="_toggleSopLike('${id}')"
          class="${_likeClass(liked)}">
          <span>${liked ? "&#9829;" : "&#9825;"}</span>
          <span id="like-count-${id}">${myLikes.length > 0 ? "" : ""}Like</span>
        </button>
        <button id="bookmark-btn-${id}" onclick="_toggleSopBookmark('${id}')"
          class="${_bookmarkClass(bookmarked)}">
          <span>${bookmarked ? "&#9733;" : "&#9734;"}</span>
          <span id="bookmark-count-${id}">Bookmark</span>
        </button>
      </div>

      <div class="border-t border-gray-200 pt-4">
        <h3 class="font-semibold text-gray-800 mb-3">Comments</h3>
        <div id="comments-list-${id}">${_renderComments(comments)}</div>

        <div class="mt-4">
          <textarea id="comment-input-${id}" rows="3" maxlength="500"
            placeholder="Add a comment (max 500 chars)…"
            class="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
          <div class="flex justify-end mt-2">
            <button onclick="_submitSopComment('${id}')"
              class="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
              Post Comment
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

async function _toggleSopLike(id) {
  try {
    const resp = await apiFetch(`/api/sops/${id}/like`, { method: "POST" });
    const data = await resp.json();
    const btn = document.getElementById(`like-btn-${id}`);
    if (btn) {
      btn.className = data.liked
        ? "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm border-red-300 text-red-600 bg-red-50"
        : "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm border-gray-200 text-gray-600 hover:bg-gray-50";
      btn.innerHTML = `<span>${data.liked ? "&#9829;" : "&#9825;"}</span><span>Like (${data.count})</span>`;
    }
  } catch {}
}

async function _toggleSopBookmark(id) {
  try {
    const resp = await apiFetch(`/api/sops/${id}/bookmark`, { method: "POST" });
    const data = await resp.json();
    const btn = document.getElementById(`bookmark-btn-${id}`);
    if (btn) {
      btn.className = data.bookmarked
        ? "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm border-yellow-300 text-yellow-600 bg-yellow-50"
        : "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm border-gray-200 text-gray-600 hover:bg-gray-50";
      btn.innerHTML = `<span>${data.bookmarked ? "&#9733;" : "&#9734;"}</span><span>Bookmark (${data.count})</span>`;
    }
  } catch {}
}

async function _submitSopComment(id) {
  const input = document.getElementById(`comment-input-${id}`);
  if (!input) return;
  const content = input.value.trim();
  if (!content) return;
  try {
    const resp = await apiFetch(`/api/sops/${id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      alert(err.detail || "Failed to post comment");
      return;
    }
    input.value = "";
    // Refresh comments
    const cResp = await apiFetch(`/api/sops/${id}/comments`);
    const comments = await cResp.json();
    const listEl = document.getElementById(`comments-list-${id}`);
    const username = getUsername();
    if (listEl) {
      if (!comments.length) {
        listEl.innerHTML = '<p class="text-gray-400 text-sm py-4 text-center">No comments yet. Be the first!</p>';
      } else {
        listEl.innerHTML = comments.map(c => {
          const date = new Date(c.created_at * 1000).toLocaleDateString();
          const canDelete = (c.username === username) || window.__isAdmin;
          const delBtn = canDelete
            ? `<button onclick="_deleteSopComment('${id}', ${c.id})"
                 class="text-xs text-red-400 hover:text-red-600 ml-2">Delete</button>`
            : "";
          return `<div class="flex justify-between py-3 border-b border-gray-100 last:border-0">
            <div class="flex-1">
              <span class="font-medium text-sm text-gray-800">${c.username}</span>
              <span class="text-xs text-gray-400 ml-2">${date}</span>
              <p class="text-sm text-gray-700 mt-1">${c.content.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>
            </div>
            ${delBtn}
          </div>`;
        }).join("");
      }
    }
  } catch {}
}

async function _deleteSopComment(sopId, commentId) {
  if (!confirm("Delete this comment?")) return;
  try {
    const resp = await apiFetch(`/api/sops/${sopId}/comments/${commentId}`, { method: "DELETE" });
    if (!resp.ok) {
      const err = await resp.json();
      alert(err.detail || "Failed to delete comment");
      return;
    }
    // Refresh comments
    const cResp = await apiFetch(`/api/sops/${sopId}/comments`);
    const comments = await cResp.json();
    const listEl = document.getElementById(`comments-list-${sopId}`);
    const username = getUsername();
    if (listEl) {
      if (!comments.length) {
        listEl.innerHTML = '<p class="text-gray-400 text-sm py-4 text-center">No comments yet. Be the first!</p>';
      } else {
        listEl.innerHTML = comments.map(c => {
          const date = new Date(c.created_at * 1000).toLocaleDateString();
          const canDelete = (c.username === username) || window.__isAdmin;
          const delBtn = canDelete
            ? `<button onclick="_deleteSopComment('${sopId}', ${c.id})"
                 class="text-xs text-red-400 hover:text-red-600 ml-2">Delete</button>`
            : "";
          return `<div class="flex justify-between py-3 border-b border-gray-100 last:border-0">
            <div class="flex-1">
              <span class="font-medium text-sm text-gray-800">${c.username}</span>
              <span class="text-xs text-gray-400 ml-2">${date}</span>
              <p class="text-sm text-gray-700 mt-1">${c.content.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>
            </div>
            ${delBtn}
          </div>`;
        }).join("");
      }
    }
  } catch {}
}

// ── Shared helpers ────────────────────────────────────────────────
function paperTypeColor(type) {
  return { journal: "bg-blue-100 text-blue-700", conference: "bg-green-100 text-green-700", book: "bg-emerald-100 text-emerald-700" }[type] || "bg-gray-100 text-gray-600";
}

function copyCitationById(evt, id) {
  evt.stopPropagation();
  const allItems = [...(window.DATA.papers || []), ...(window.DATA.books || [])];
  const p = allItems.find(x => x.id === id);
  if (!p) return;

  const authors = (p.authors || []);
  let authorStr = "";
  if (authors.length === 0)      authorStr = "";
  else if (authors.length <= 3)  authorStr = authors.join(", ");
  else                           authorStr = authors.slice(0, 3).join(", ") + ", et al.";

  const parts = [
    authorStr,
    p.year ? `(${p.year})` : "",
    p.title ? `${p.title}.` : "",
    p.journal ? `${p.journal}.` : "",
    p.doi ? `https://doi.org/${p.doi}` : "",
  ].filter(Boolean);
  const citation = parts.join(" ");

  const btn = evt.currentTarget;
  const orig = btn.innerHTML;
  const showCopied = () => {
    btn.innerHTML = "✓ 已复制";
    btn.classList.add("text-green-600");
    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove("text-green-600"); }, 2000);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(citation).then(showCopied).catch(() => {
      _copyFallback(citation); showCopied();
    });
  } else {
    _copyFallback(citation); showCopied();
  }
}

function _copyFallback(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch {}
  document.body.removeChild(ta);
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
        <div class="flex gap-2 mt-2 flex-wrap items-center">
          ${doi}
          <button onclick="copyCitationById(event,'${p.id}')"
            class="text-xs text-gray-400 hover:text-blue-600 transition flex items-center gap-0.5 ml-1">📋 ${t("paper.copyCitation")}</button>
          ${sopBtn}
        </div>
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

// ── Papers ────────────────────────────────────────────────────────
let _papersSearch = "";
let _papersType = "all";

function renderPapers() {
  const data = window.DATA;
  const allPapers = (data.papers || []).filter(p => !p.archived);

  // Reset filters each time view is opened
  _papersSearch = "";
  _papersType = "all";

  const typeBtns = ["all", "journal", "conference"].map(tp => `
    <button data-ptype="${tp}"
      onclick="_setPapersType('${tp}')"
      class="papers-type-btn px-3 py-1.5 text-xs rounded-full border font-medium transition ${tp === "all" ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600 hover:border-blue-400"}">
      ${tp === "all" ? (currentLang === "zh" ? "全部" : "All") : t("type." + tp)}
    </button>`).join("");

  document.getElementById("view-papers").innerHTML = `
    <div class="flex items-center gap-3 mb-6 pb-3 border-b-2 border-blue-900">
      <h2 class="text-xl font-extrabold text-gray-900">${currentLang === "zh" ? "论文库" : "Publications"}</h2>
      <span id="papers-count" class="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">${allPapers.length}</span>
    </div>
    <div class="flex flex-wrap gap-3 mb-5 items-center">
      <input id="papers-search-input" type="text" autocomplete="off"
        placeholder="${currentLang === "zh" ? "搜索标题、摘要、期刊…" : "Search title, abstract, journal…"}"
        oninput="_papersSearch=this.value;_updatePapersResults()"
        class="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
      <div class="flex gap-2 flex-shrink-0">${typeBtns}</div>
    </div>
    <div id="papers-results" class="space-y-3"></div>`;

  _updatePapersResults();
}

function _setPapersType(tp) {
  _papersType = tp;
  document.querySelectorAll(".papers-type-btn").forEach(b => {
    const active = b.dataset.ptype === tp;
    b.className = "papers-type-btn px-3 py-1.5 text-xs rounded-full border font-medium transition " +
      (active ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600 hover:border-blue-400");
  });
  _updatePapersResults();
}

function _updatePapersResults() {
  const allPapers = (window.DATA.papers || []).filter(p => !p.archived);
  const q = _papersSearch.toLowerCase();
  const items = allPapers
    .filter(p => {
      if (_papersType !== "all" && p.type !== _papersType) return false;
      if (!q) return true;
      return (p.title || "").toLowerCase().includes(q) ||
             (p.abstract || "").toLowerCase().includes(q) ||
             (p.journal || "").toLowerCase().includes(q);
    })
    .sort((a, b) => (b.year || 0) - (a.year || 0));

  const countEl = document.getElementById("papers-count");
  if (countEl) countEl.textContent = items.length;

  const resultsEl = document.getElementById("papers-results");
  if (resultsEl) {
    resultsEl.innerHTML = items.length
      ? items.map(p => paperCard(p)).join("")
      : `<p class="text-gray-400 py-12 text-center">${t("noResults")}</p>`;
  }
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
  ).sort((a, b) => (b.year || 0) - (a.year || 0));

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

  // Append user-uploaded SOPs section below the existing library
  if (getUsername()) {
    renderUserSops();
  }
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
      const initials = name.slice(0, 2);
      const color = _avatarColor(initials);
      return `<div style="width:96px;height:128px;flex-shrink:0;border-radius:.5rem;background:${color};display:flex;align-items:center;justify-content:center;color:white;font-size:1.35rem;font-weight:700;letter-spacing:.04em;user-select:none">${initials}</div>`;
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
             data-initials="${name.slice(0,2)}"
             style="width:96px;height:128px;object-fit:cover;object-position:top;border-radius:.5rem;border:1px solid #f3f4f6;transition:opacity .15s"
             onerror="_memberPhotoFallback(this)">
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

// ── Member photo fallback ─────────────────────────────────────────
const _AVATAR_COLORS = ["#3b82f6","#10b981","#8b5cf6","#f59e0b","#ef4444","#06b6d4","#ec4899"];

function _avatarColor(name) {
  let n = 0;
  for (let i = 0; i < name.length; i++) n += name.charCodeAt(i);
  return _AVATAR_COLORS[n % _AVATAR_COLORS.length];
}

function _memberPhotoFallback(img) {
  const initials = (img.dataset.initials || "?").slice(0, 2);
  const color = _avatarColor(initials);
  const div = document.createElement("div");
  div.style.cssText = `width:96px;height:128px;border-radius:.5rem;flex-shrink:0;background:${color};display:flex;align-items:center;justify-content:center;color:white;font-size:1.35rem;font-weight:700;letter-spacing:.04em;user-select:none`;
  div.textContent = initials;
  img.replaceWith(div);
}

// ── Mobile menu ───────────────────────────────────────────────────
function toggleMobileMenu() {
  document.getElementById("mobile-nav-menu").classList.toggle("hidden");
}

function closeMobileMenu() {
  document.getElementById("mobile-nav-menu").classList.add("hidden");
}

// Wire mobile search input (inside dropdown)
document.getElementById("mobile-search-input")?.addEventListener("input", e => {
  const q = e.target.value.trim();
  if (q.length > 1) {
    closeMobileMenu();
    showView("search");
    renderSearch(q);
  } else if (!q) {
    showView(currentView === "search" ? "home" : currentView);
  }
});

// Close mobile menu when any nav-btn inside it is clicked
document.getElementById("mobile-nav-menu")?.addEventListener("click", e => {
  if (e.target.closest(".nav-btn")) closeMobileMenu();
});

// ── Footer ────────────────────────────────────────────────────────
async function initFooter() {
  document.getElementById("footer-year").textContent = new Date().getFullYear();
  try {
    const resp = await fetch("/data/footer_config.json");
    if (!resp.ok) return;
    const cfg = await resp.json();
    const container = document.getElementById("footer-links");
    if (container && cfg.links && cfg.links.length) {
      container.innerHTML = cfg.links.map(l =>
        `<a href="${l.url}" target="_blank" rel="noopener" class="hover:text-gray-700 hover:underline transition">${l.label}</a>`
      ).join('<span class="text-gray-300">·</span>');
    }
  } catch {}
}

function updateNavAdmin() {
  const isAdmin = window.__isAdmin;
  const isLoggedIn = !!getUsername();
  ["nav-share-btn", "mobile-share-btn"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("hidden", !isLoggedIn);
  });
  ["nav-admin-btn", "mobile-admin-btn"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("hidden", !isAdmin);
  });
}

// ── Boot ──────────────────────────────────────────────────────────
async function boot() {
  window.__isAdmin = localStorage.getItem("biomind_is_admin") === "true";
  applyI18n();
  updateNavUser();
  updateNavAdmin();
  initFooter();
  const rawHash = location.hash.slice(1) || "home";
  const [view, subId] = rawHash.split("/");
  if (_AUTH_VIEWS.has(view) && !getUsername()) {
    showView("home");
    renderView("home");
  } else if (_ADMIN_VIEWS.has(view) && !window.__isAdmin) {
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

  // Back-to-top button: show after scrolling 300px
  const _bttBtn = document.getElementById("back-to-top");
  if (_bttBtn) {
    window.addEventListener("scroll", () => {
      _bttBtn.classList.toggle("btt-visible", window.scrollY > 300);
    }, { passive: true });
  }
}

boot();
