/** Admin panel — health, users, projects, HA config, DB maintenance */
import { admin } from "./api.js";
import { toast }  from "./utils.js";

let _wired      = false;
let _selfId     = null;
let _usersCache = [];

export async function initAdmin(currentUser) {
  _selfId = currentUser?.id;
  if (!_wired) { _wired = true; _wire(); }
  await _refresh();
}

// ── Wire static buttons ───────────────────────────────────────────

function _wire() {
  const on = (id, fn) => document.getElementById(id)?.addEventListener("click", fn);
  on("btn-admin-refresh",    _refresh);
  on("btn-admin-vacuum",     _vacuum);
  on("btn-purge-done",       _purgeDone);
  on("btn-purge-archived",   _purgeArchived);
  on("btn-admin-ha-save",    _saveHa);
  on("btn-admin-ha-ping",    _haPing);
}

// ── Main refresh ──────────────────────────────────────────────────

async function _refresh() {
  const btn = document.getElementById("btn-admin-refresh");
  if (btn) { btn.disabled = true; btn.textContent = "…"; }
  try {
    const [stats, users, projects, haConf] = await Promise.all([
      admin.stats(), admin.users(), admin.projects(), admin.haConfig(),
    ]);
    _usersCache = users;
    _renderChips(stats);
    _renderSystem(stats);
    _renderDb(stats);
    _renderHa(haConf);
    _renderEnv(stats);
    _renderUsers(users);
    _renderProjects(projects, users);
  } catch (err) {
    toast("Load error: " + err.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "↻ Refresh"; }
  }
}

// ── Actions ───────────────────────────────────────────────────────

async function _vacuum() {
  if (!confirm("Optimize the database? This reclaims space from deleted rows.")) return;
  const btn = document.getElementById("btn-admin-vacuum");
  btn.disabled = true; btn.textContent = "…";
  try { await admin.vacuum(); toast("Database optimized ✓", "success"); await _refresh(); }
  catch (err) { toast(err.message, "error"); }
  finally { btn.disabled = false; btn.textContent = "Optimize"; }
}

async function _purgeDone() {
  if (!confirm("Permanently delete ALL completed tasks? This cannot be undone.")) return;
  try {
    const r = await admin.purgeDone();
    toast(`Deleted ${r.deleted} completed task(s)`, "success");
    await _refresh();
  } catch (err) { toast(err.message, "error"); }
}

async function _purgeArchived() {
  if (!confirm("Permanently delete ALL archived projects and their tasks? This cannot be undone.")) return;
  try {
    const r = await admin.purgeArchived();
    toast(`Deleted ${r.deleted} archived project(s)`, "success");
    await _refresh();
  } catch (err) { toast(err.message, "error"); }
}

async function _saveHa() {
  const url     = document.getElementById("ha-url-input")?.value.trim();
  const token   = document.getElementById("ha-token-input")?.value.trim();
  const appUrl  = document.getElementById("ha-app-url-input")?.value.trim();
  const btn = document.getElementById("btn-admin-ha-save");
  btn.disabled = true; btn.textContent = "…";
  try {
    await admin.updateHa({ url, token: token || undefined, app_url: appUrl });
    document.getElementById("ha-token-input").value = "";
    toast("HA config saved ✓", "success");
    await _refresh();
  } catch (err) { toast(err.message, "error"); }
  finally { btn.disabled = false; btn.textContent = "Save"; }
}

async function _haPing() {
  const btn = document.getElementById("btn-admin-ha-ping");
  btn.disabled = true; btn.textContent = "Testing…";
  try {
    const res = await admin.haPing();
    if (res.ok) toast("HA reachable: " + res.message, "success");
    else        toast("HA error: " + res.error, "error");
  } catch (err) { toast(err.message, "error"); }
  finally { btn.disabled = false; btn.textContent = "Test"; }
}

async function _toggleAdmin(userId, makeAdmin) {
  try { await admin.updateUser(userId, { is_admin: makeAdmin }); await _refresh(); }
  catch (err) { toast(err.message, "error"); }
}

async function _deleteUser(userId, username) {
  if (!confirm(`Delete user "${username}" and all their tasks & projects? This cannot be undone.`)) return;
  try {
    await admin.deleteUser(userId);
    toast(`"${username}" deleted`, "success");
    await _refresh();
  } catch (err) { toast(err.message, "error"); }
}

async function _migrateTasksConfirm(fromId, toId, fromName, toName) {
  if (!confirm(`Move all tasks from "${fromName}" to "${toName}"?`)) return;
  try {
    const r = await admin.migrateTasks(fromId, toId);
    toast(`Moved ${r.moved} task(s) to ${toName}`, "success");
    await _refresh();
  } catch (err) { toast(err.message, "error"); }
}

async function _changeOwner(projectId, newOwnerId) {
  try {
    const r = await admin.changeOwner(projectId, newOwnerId);
    toast(`Owner changed to ${r.owner}`, "success");
  } catch (err) {
    toast(err.message, "error");
    await _refresh(); // revert select
  }
}

async function _deleteProject(projectId, name) {
  if (!confirm(`Delete project "${name}" and all its tasks? This cannot be undone.`)) return;
  try {
    await admin.deleteProject(projectId);
    toast(`"${name}" deleted`, "success");
    await _refresh();
  } catch (err) { toast(err.message, "error"); }
}

// ── Render chips ──────────────────────────────────────────────────

function _renderChips(s) {
  const c = s.counts;
  _chip("asc-open",     c.tasks_open);
  _chip("asc-done",     c.tasks_completed);
  _chip("asc-overdue",  c.tasks_overdue);
  _chip("asc-projects", c.projects_active);
  _chip("asc-users",    c.users);
  document.getElementById("asc-overdue")
    ?.classList.toggle("danger", c.tasks_overdue > 0);
}

function _chip(id, v) {
  const el = document.getElementById(id)?.querySelector(".ac-num");
  if (el) el.textContent = v;
}

// ── Render info sections ──────────────────────────────────────────

function _renderSystem(s) {
  _rows("admin-system-rows", [
    ["Version",   s.version],
    ["Uptime",    _uptime(s.uptime_seconds)],
    ["Scheduler", '<span class="admin-badge ok">Running</span>'],
    ["Users",     `${s.counts.users} (${s.counts.admins} admin)`],
  ], true);
}

function _renderDb(s) {
  const c = s.counts;
  _rows("admin-db-rows", [
    ["Size",      s.db.size_human ?? "—"],
    ["Path",      `<code class="admin-code">${_esc(s.db.path)}</code>`],
    ["Done tasks",     c.tasks_completed],
    ["Archived proj.", c.projects_archived],
    ["Buckets",   c.buckets],
    ["Goals",     `${c.goals_open} open · ${c.goals_completed} done`],
    ["Comments",  c.comments],
  ], true);
}

function _renderHa(haConf) {
  const urlInput = document.getElementById("ha-url-input");
  if (urlInput && !urlInput.dataset.dirty) urlInput.value = haConf.url || "";
  const appUrlInput = document.getElementById("ha-app-url-input");
  if (appUrlInput && !appUrlInput.dataset.dirty) appUrlInput.value = haConf.app_url || "";
  const statusEl = document.getElementById("ha-status-badge");
  if (statusEl) {
    statusEl.className = "admin-badge " + (haConf.url ? "ok" : "warn");
    statusEl.textContent = haConf.url ? "Configured" : "Not configured";
    if (haConf.token_set) statusEl.textContent += " · token set";
  }
}

function _renderEnv(s) {
  _rows("admin-env-rows", [
    ["Port",    s.env.port],
    ["Origins", s.env.allowed_origins || "—"],
  ]);
}

// ── Render users table ────────────────────────────────────────────

function _renderUsers(users) {
  const wrap = document.getElementById("admin-users-body");
  if (!wrap) return;
  if (!users.length) { wrap.innerHTML = '<p class="admin-empty">No users.</p>'; return; }

  const rows = users.map(u => {
    const isSelf     = u.id === _selfId;
    const roleBadge  = u.is_admin
      ? `<span class="admin-badge ok">Admin</span>`
      : `<span class="admin-badge muted">User</span>`;
    const otherUsers = users.filter(x => x.id !== u.id);
    const migrateBtn = otherUsers.length
      ? `<select class="admin-migrate-sel" data-from="${u.id}" data-fromname="${_esc(u.username)}" title="Move tasks to another user">
           <option value="">⇄</option>
           ${otherUsers.map(o => `<option value="${o.id}">${_esc(o.username)}</option>`).join("")}
         </select>`
      : "";
    const toggleBtn = isSelf ? "" : u.is_admin
      ? `<button class="admin-action-btn" data-action="demote" data-id="${u.id}" title="Remove admin">☆</button>`
      : `<button class="admin-action-btn" data-action="promote" data-id="${u.id}" title="Make admin">★</button>`;
    const deleteBtn = isSelf ? "" :
      `<button class="admin-action-btn danger" data-action="del-user" data-id="${u.id}" data-name="${_esc(u.username)}" title="Delete user">✕</button>`;
    const taskColor = u.overdue > 0 ? "style=\"color:var(--danger)\"" : "";

    return `<tr${isSelf ? ' class="admin-row-self"' : ""}>
      <td class="admin-td-main">
        <div class="admin-user-name">${_esc(u.username)}${isSelf ? ' <span class="admin-you">(you)</span>' : ""}</div>
        <div class="admin-user-email">${_esc(u.email)}</div>
      </td>
      <td class="admin-col-sm-hide">${roleBadge}</td>
      <td class="admin-col-sm-hide"><span ${taskColor}>${u.open_tasks}</span>&thinsp;/&thinsp;${u.projects}p</td>
      <td class="admin-td-actions">${migrateBtn}${toggleBtn}${deleteBtn}</td>
    </tr>`;
  }).join("");

  wrap.innerHTML = `<table class="admin-table">
    <thead><tr><th>User</th><th class="admin-col-sm-hide">Role</th><th class="admin-col-sm-hide">Tasks/Proj</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  wrap.querySelectorAll("[data-action]").forEach(btn => {
    const { action, id, name } = btn.dataset;
    btn.addEventListener("click", () => {
      if (action === "promote")  _toggleAdmin(id, true);
      if (action === "demote")   _toggleAdmin(id, false);
      if (action === "del-user") _deleteUser(id, name);
    });
  });

  wrap.querySelectorAll(".admin-migrate-sel").forEach(sel => {
    sel.addEventListener("change", () => {
      const toId   = sel.value;
      const toName = sel.options[sel.selectedIndex].text;
      if (!toId) return;
      _migrateTasksConfirm(sel.dataset.from, toId, sel.dataset.fromname, toName)
        .finally(() => { sel.value = ""; });
    });
  });
}

// ── Render projects table ─────────────────────────────────────────

function _renderProjects(projects, users) {
  const wrap = document.getElementById("admin-projects-body");
  if (!wrap) return;
  if (!projects.length) { wrap.innerHTML = '<p class="admin-empty">No projects.</p>'; return; }

  const userOpts = users.map(u =>
    `<option value="${u.id}">${_esc(u.username)}</option>`
  ).join("");

  const rows = projects.map(p => {
    const status = p.archived
      ? '<span class="admin-badge muted">Archived</span>'
      : '<span class="admin-badge ok">Active</span>';
    const ownerSel = `<select class="admin-owner-sel" data-project="${p.id}">${
      users.map(u =>
        `<option value="${u.id}"${u.id === p.owner_id ? " selected" : ""}>${_esc(u.username)}</option>`
      ).join("")
    }</select>`;

    return `<tr>
      <td class="admin-td-main">${_esc(p.name)}</td>
      <td>${ownerSel}</td>
      <td>${p.open_tasks}</td>
      <td>${status}</td>
      <td class="admin-td-actions">
        <button class="admin-action-btn danger" data-action="del-proj" data-id="${p.id}" data-name="${_esc(p.name)}">✕ Delete</button>
      </td>
    </tr>`;
  }).join("");

  wrap.innerHTML = `<table class="admin-table">
    <thead><tr><th>Project</th><th>Owner</th><th>Open</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  wrap.querySelectorAll(".admin-owner-sel").forEach(sel => {
    sel.addEventListener("change", () => _changeOwner(sel.dataset.project, sel.value));
  });
  wrap.querySelectorAll("[data-action='del-proj']").forEach(btn => {
    btn.addEventListener("click", () => _deleteProject(btn.dataset.id, btn.dataset.name));
  });
}

// ── Helpers ───────────────────────────────────────────────────────

function _rows(id, pairs, html = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = pairs.map(([k, v]) =>
    `<div class="admin-row">
      <span class="admin-row-key">${k}</span>
      <span class="admin-row-val">${html ? v : _esc(String(v))}</span>
    </div>`
  ).join("");
}

function _esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function _uptime(secs) {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
