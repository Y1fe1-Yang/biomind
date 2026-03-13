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

// ── View renderers (stubs — implemented in Chunk 4) ───────────────
function renderView(name) {
  const renders = {
    timeline: renderTimeline,
    directions: renderDirections,
    sops: renderSops,
    presentations: renderPresentations,
  };
  if (renders[name]) renders[name]();
}

function renderTimeline() { document.getElementById("view-timeline").innerHTML = "<p class='text-gray-400 py-12 text-center'>Timeline coming soon</p>"; }
function renderDirections() { document.getElementById("view-directions").innerHTML = "<p class='text-gray-400 py-12 text-center'>Directions coming soon</p>"; }
function renderSops() { document.getElementById("view-sops").innerHTML = "<p class='text-gray-400 py-12 text-center'>SOPs coming soon</p>"; }
function renderPresentations() { document.getElementById("view-presentations").innerHTML = "<p class='text-gray-400 py-12 text-center'>Presentations coming soon</p>"; }
function renderSearch(q) { document.getElementById("view-search").innerHTML = `<p class='text-gray-400 py-12 text-center'>Search: ${q}</p>`; }

// ── Boot ──────────────────────────────────────────────────────────
async function boot() {
  applyI18n();
  if (!getUsername()) await promptUsername();

  const hash = location.hash.replace("#", "") || "timeline";
  showView(hash);
  renderView(hash);
}

boot();
