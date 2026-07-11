/** ProjectReef — app shell v8 */
import { auth, setToken, isAuthenticated } from "./api.js";
import { toast, setDisplayTimezone } from "./utils.js";
import { initInbox }                    from "./inbox.js";
import { initProjects, openBoardPicker } from "./projects.js";
import { initTaskDetail, openTaskDetail } from "./task-detail.js";
import { initProfile, openProfile } from "./profile.js";
import { initAdmin } from "./admin.js";
import { getTimezoneGroups } from "./timezones.js";
import { loadPublicBoard } from "./board.js";

let currentUser = null;

// ── Populate timezone dropdowns ───────────────────────────────────
function _buildTzSelect(selId, selected) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML = "";
  for (const { group, zones } of getTimezoneGroups()) {
    const grp = document.createElement("optgroup"); grp.label = group;
    zones.forEach(({ value, label }) => {
      const o = document.createElement("option"); o.value = value; o.textContent = label;
      if (value === selected) o.selected = true;
      grp.appendChild(o);
    });
    sel.appendChild(grp);
  }
}

// ── Auth tab toggle ───────────────────────────────────────────────
document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const w = tab.dataset.tab;
    document.getElementById("login-form").classList.toggle("hidden",    w !== "login");
    document.getElementById("register-form").classList.toggle("hidden", w !== "register");
  });
});

// Pre-populate register timezone select with browser guess
_buildTzSelect("register-tz", _detectTz());

// ── Login ─────────────────────────────────────────────────────────
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("login-error"); errEl.textContent = "";
  const fd = new FormData(e.target);
  try {
    const data = await auth.login({ username: fd.get("username"), password: fd.get("password") });
    setToken(data.access_token); currentUser = data.user; _showApp();
  } catch (ex) { errEl.textContent = ex.message; }
});

// ── Register ──────────────────────────────────────────────────────
document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("register-error"); errEl.textContent = "";
  const fd = new FormData(e.target);
  try {
    const data = await auth.register({
      username: fd.get("username"), email: fd.get("email"),
      password: fd.get("password"), timezone: fd.get("timezone") || "Europe/Vienna",
    });
    setToken(data.access_token); currentUser = data.user; _showApp();
  } catch (ex) { errEl.textContent = ex.message; }
});

// ── Logout ────────────────────────────────────────────────────────
document.getElementById("btn-logout").addEventListener("click", () => {
  setToken(null); currentUser = null; _showAuth();
});
document.getElementById("btn-logout-sb")?.addEventListener("click", () => {
  setToken(null); currentUser = null; _showAuth();
});

// ── Tab switching ─────────────────────────────────────────────────
export function switchTab(tab, { replace = false, url = null } = {}) {
  document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.tab === tab));
  document.querySelectorAll(".tab-pane").forEach(p => p.classList.toggle("active", p.id === `tab-${tab}`));
  document.getElementById("btn-admin-sb")?.classList.toggle("active", tab === "admin");
  const finalUrl = url ?? `/${tab}`;
  if (replace) history.replaceState(null, "", finalUrl);
  else         history.pushState(null, "", finalUrl);
  if (tab === "tasks")    initInbox();
  if (tab === "projects") initProjects();
  if (tab === "admin")    initAdmin(currentUser);
}

// ── Boot ──────────────────────────────────────────────────────────
async function boot() {
  const path = window.location.pathname;
  if (path.startsWith("/board/")) {
    const token = path.split("/board/")[1];
    document.getElementById("loading").classList.add("hidden");
    document.getElementById("public-board-screen").classList.remove("hidden");
    document.getElementById("public-board-title").textContent = "Loading…";
    loadPublicBoard(token, document.getElementById("public-kanban-board"));
    return;
  }

  if (!isAuthenticated()) { document.getElementById("loading").classList.add("hidden"); _showAuth(); return; }
  try {
    currentUser = await auth.me();
    document.getElementById("loading").classList.add("hidden");
    _showApp();
  } catch {
    setToken(null); document.getElementById("loading").classList.add("hidden"); _showAuth();
  }
}

function _showApp() {
  // Capture before switchTab() below rewrites the URL (via history.replaceState)
  // and drops the query string.
  const deepLinkTaskId = new URLSearchParams(window.location.search).get("task");

  document.getElementById("auth-screen").classList.remove("active");
  document.getElementById("main-screen").classList.add("active");

  const tz = currentUser?.timezone;
  setDisplayTimezone((tz && tz !== "UTC") ? tz : _detectTz());

  // Wire interactive elements FIRST — nothing below can prevent these
  document.getElementById("btn-profile").onclick = () => openProfile(currentUser);
  document.getElementById("btn-profile-sb")?.addEventListener("click", () => openProfile(currentUser));
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.onclick = () => btn.dataset.tab === "board" ? openBoardPicker() : switchTab(btn.dataset.tab);
  });

  // Admin footer button
  const adminSb = document.getElementById("btn-admin-sb");
  if (adminSb) {
    adminSb.style.display = currentUser?.is_admin ? "" : "none";
    adminSb.onclick = () => switchTab("admin");
  }
  if (!currentUser?.is_admin && window.location.pathname === "/admin") {
    history.replaceState(null, "", "/tasks");
  }

  // projects.js dispatches this when entering/leaving a board so the "board"
  // nav item stays in sync without coupling the two modules.
  document.addEventListener("nav:setactive", (e) => {
    document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.tab === e.detail));
    document.getElementById("btn-admin-sb")?.classList.remove("active");
  });

  initTaskDetail();
  initProfile((updated) => {
    currentUser = updated;
    setDisplayTimezone(updated.timezone);
    const active = document.querySelector(".nav-item.active")?.dataset.tab;
    if (active) switchTab(active);
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});

  // Respect deep-link URL; default to tasks
  const path = window.location.pathname.replace(/\/$/, "");
  const isProjects = path === "/projects" || path.startsWith("/projects/");
  const isAdmin    = path === "/admin";
  const startTab   = isAdmin ? "admin" : isProjects ? "projects" : "tasks";
  switchTab(startTab, { replace: true, url: path || "/tasks" });

  // Keep URL in sync with browser back/forward
  window.addEventListener("popstate", () => {
    const p = window.location.pathname.replace(/\/$/, "");
    if (p === "/projects" || p.startsWith("/projects/")) {
      switchTab("projects", { replace: true, url: p });
    } else if (p === "/admin") {
      switchTab("admin",    { replace: true });
    } else {
      switchTab("tasks",    { replace: true });
    }
  });

  // Deep link from a reminder notification tap (?task=<id>) — open it now
  // that the tasks tab (and its modal) are wired up.
  if (deepLinkTaskId) openTaskDetail(deepLinkTaskId);
}

function _showAuth() {
  document.getElementById("main-screen").classList.remove("active");
  document.getElementById("auth-screen").classList.add("active");
  document.querySelector('#login-form [name="username"]').value = "";
  document.querySelector('#login-form [name="password"]').value = "";
}

function _detectTz() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (tz && tz !== "UTC") ? tz : "Europe/Vienna";
}

window.addEventListener("auth:expired", () => { toast("Session expired", "error"); _showAuth(); });
window.addEventListener("projects:goto-board", (e) => {
  switchTab("projects", { url: `/projects/${e.detail.projectId}` });
});

boot();
