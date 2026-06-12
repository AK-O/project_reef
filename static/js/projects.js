/** Projects tab — v7: tile grid → inline kanban */
import { projects, tasks } from "./api.js";
import { toast } from "./utils.js";
import { loadKanban, getListMode, toggleBoardMode, disconnectBoardObserver } from "./board.js";
import { generateJazzicon, jazziconHue, cacheProjectSettings } from "./jazzicon.js";
import { showQRModal } from "./qr-modal.js";
import { openProjectSettings } from "./project-settings.js";

let _allProjects   = [];
let _initialized   = false;
let _navPanel      = null;
let _editMode      = false;
let _showArchived  = false;
let _openMap       = {};
let _overdueMap    = {};
let _dragEntry     = null;
let _projIndicator = null;

export async function initProjects() {
  if (!_initialized) {
    _initialized = true;

    document.getElementById("btn-new-project")
      .addEventListener("click", () => _openModal());
    document.getElementById("btn-edit-order")
      .addEventListener("click", () => _editMode ? _exitEditMode() : _enterEditMode());
    document.getElementById("btn-show-archive")
      .addEventListener("click", _toggleArchiveView);
    document.getElementById("btn-modal-cancel")
      .addEventListener("click", _closeModal);
    document.getElementById("btn-modal-save")
      .addEventListener("click", _saveProject);
    document.getElementById("modal-overlay")
      .addEventListener("click", (e) => { if (e.target === e.currentTarget) _closeModal(); });
    document.getElementById("btn-back-to-grid")
      .addEventListener("click", () => { history.pushState(null, "", "/projects"); _showGrid(); });
    document.getElementById("btn-project-menu")
      ?.addEventListener("click", () => {
        if (_currentProject) {
          openProjectSettings(_currentProject, _flat(_allProjects), {
            onSave: (updated) => {
              if (updated === null) {
                history.pushState(null, "", "/projects");
                _showGrid();
              } else {
                _currentProject = updated;
                _refreshBoardHeader(updated);
              }
            },
          });
        }
      });
    document.getElementById("btn-toggle-done")
      ?.addEventListener("click", () => {
        _showCompleted = !_showCompleted;
        const btn = document.getElementById("btn-toggle-done");
        if (btn) {
          btn.textContent = _showCompleted ? "Hide done" : "Show done";
          btn.classList.toggle("board-btn-active", _showCompleted);
        }
        if (_currentProject) loadKanban(_currentProject, document.getElementById("kanban-board"), _showCompleted);
      });

    document.getElementById("btn-board-view")
      ?.addEventListener("click", () => {
        toggleBoardMode(); // toggles CSS class only — no re-fetch
        // _updateViewBtn() is called via the board:modechange event below
      });

    // Keep the view-toggle button in sync whenever board.js changes the mode
    // (both user toggle and ResizeObserver auto-switch fire this event)
    document.addEventListener("board:modechange", () => _updateViewBtn());

    // ── Project nav panel ──────────────────────────────────────────
    _navPanel = document.createElement("div");
    _navPanel.className = "project-nav-panel";
    _navPanel.style.display = "none";
    _navPanel.addEventListener("click", (e) => e.stopPropagation());
    document.body.appendChild(_navPanel);

    document.getElementById("btn-project-nav")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        _navPanel.style.display !== "none" ? _closeNavPanel() : _openNavPanel();
      });

    document.addEventListener("keydown", (e) => { if (e.key === "Escape") _closeNavPanel(); });

    window.addEventListener("tasks:changed", () => {
      if (_currentView === "grid" &&
          document.getElementById("tab-projects")?.classList.contains("active"))
        _loadGrid();
    });

    // Re-apply board theme if page is restored from bfcache (back/forward cache)
    window.addEventListener("pageshow", (e) => {
      if (!e.persisted || !_currentProject) return;
      const boardView = document.getElementById("projects-board-view");
      if (!boardView || boardView.style.display === "none") return;
      const h = jazziconHue(_currentProject.id);
      boardView.style.setProperty("--board-hue",      h.toFixed(0));
      boardView.style.setProperty("--board-btn-text", _btnTextColor(h));
    });
  }
  const m = window.location.pathname.match(/^\/projects\/([^/]+)/);
  if (m) {
    const id = m[1];
    if (!_allProjects.length) _allProjects = await projects.list().catch(() => []);
    cacheProjectSettings(_flat(_allProjects));
    const project = _flat(_allProjects).find(p => p.id === id);
    if (project) { _showBoard(project, { addHistory: false }); return; }
  }
  _showGrid();
}

// ── View switching ────────────────────────────────────────────────
let _currentView    = "grid";
let _currentProject = null;
let _showCompleted  = false;

function _showGrid() {
  disconnectBoardObserver();
  document.getElementById("projects-grid-view").style.display  = "";
  document.getElementById("projects-board-view").style.display = "none";
  _currentView = "grid";
  _currentProject = null;
  if (_editMode) {
    _editMode = false;
    const btn = document.getElementById("btn-edit-order");
    if (btn) { btn.textContent = "✎ Order"; btn.classList.remove("active"); }
  }
  document.dispatchEvent(new CustomEvent("nav:setactive", { detail: "projects" }));
  if (_showArchived) _toggleArchiveView(); else _loadGrid();
}

function _showBoard(project, { addHistory = true } = {}) {
  if (addHistory) history.pushState(null, "", `/projects/${project.id}`);
  document.getElementById("projects-grid-view").style.display  = "none";
  const boardView = document.getElementById("projects-board-view");
  if (!boardView) return;

  // Update title, icon, and theme while the board is still hidden so the
  // first visible frame is already correct — no flash of stale content.
  const titleEl = document.getElementById("board-project-title");
  if (titleEl) {
    titleEl.textContent = project.name;
    let iconSlot = document.getElementById("board-project-icon");
    if (!iconSlot) {
      iconSlot = document.createElement("div");
      iconSlot.id    = "board-project-icon";
      iconSlot.className = "board-project-icon";
      titleEl.parentNode.insertBefore(iconSlot, titleEl);
    }
    iconSlot.innerHTML = "";
    iconSlot.appendChild(generateJazzicon(project.id, 34));
  }

  const _hue = jazziconHue(project.id);
  boardView.style.setProperty("--board-hue",      _hue.toFixed(0));
  boardView.style.setProperty("--board-btn-text", _btnTextColor(_hue));
  boardView.style.display = "flex";

  document.dispatchEvent(new CustomEvent("nav:setactive", { detail: "board" }));
  _currentView    = "board";
  _currentProject = project;
  _showCompleted  = false;
  const btn = document.getElementById("btn-toggle-done");
  if (btn) { btn.textContent = "Show done"; btn.classList.remove("board-btn-active"); }

  // resetMode:true → loadKanban measures the kanban-wrap width and picks list/kanban
  // automatically. The ResizeObserver installed by _render() then keeps it responsive.
  loadKanban(project, document.getElementById("kanban-board"), false, {
    resetMode: true,
    readOnly: project.my_role === "viewer",
  });
}

function _updateViewBtn() {
  const btn = document.getElementById("btn-board-view");
  if (!btn) return;
  const list = getListMode();
  btn.textContent = list ? "⊞" : "☰";
  btn.title = list ? "Switch to board view" : "Switch to list view";
  btn.classList.toggle("list-active", list);
}

// ── Project nav panel ─────────────────────────────────────────────
function _openNavPanel() {
  if (!_navPanel || !_allProjects.length) return;
  const btn = document.getElementById("btn-project-nav");
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const panelW = Math.min(280, window.innerWidth - 16);
  let left = rect.left;
  if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8;
  _navPanel.style.top   = `${rect.bottom + 4}px`;
  _navPanel.style.left  = `${Math.max(8, left)}px`;
  _navPanel.style.width = `${panelW}px`;
  _navPanel.innerHTML   = '<div class="nav-panel-hdr">Jump to project</div>';
  _renderNavLevel(_allProjects, 0);
  _navPanel.style.display = "block";
  btn.querySelector(".nav-chevron")?.classList.add("open");
  const active = _navPanel.querySelector(".nav-tree-item.active");
  if (active) setTimeout(() => active.scrollIntoView({ block: "nearest" }), 0);
  setTimeout(() => document.addEventListener("click", _closeNavPanel), 0);
}

function _closeNavPanel() {
  if (!_navPanel) return;
  _navPanel.style.display = "none";
  document.getElementById("btn-project-nav")?.querySelector(".nav-chevron")?.classList.remove("open");
  document.removeEventListener("click", _closeNavPanel);
}

function _renderNavLevel(nodes, depth) {
  nodes.forEach(p => {
    const item = document.createElement("button");
    item.className = "nav-tree-item" + (p.id === _currentProject?.id ? " active" : "");
    item.type = "button";
    item.style.paddingLeft = `${14 + depth * 14}px`;
    const hue = jazziconHue(p.id).toFixed(0);
    const check = p.id === _currentProject?.id ? '<span class="nav-tree-check">✓</span>' : "";
    item.innerHTML = `<span class="nav-tree-dot" style="background:hsl(${hue},65%,58%)"></span><span class="nav-tree-name">${esc(p.name)}</span>${check}`;
    item.addEventListener("click", () => { _closeNavPanel(); if (p.id !== _currentProject?.id) _showBoard(p); });
    _navPanel.appendChild(item);
    if (p.children?.length) _renderNavLevel(p.children, depth + 1);
  });
}

// ── Grid ──────────────────────────────────────────────────────────
async function _loadGrid() {
  const grid = document.getElementById("project-grid");
  grid.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    _allProjects = await projects.list();
    cacheProjectSettings(_flat(_allProjects));
    const [allOpen, allOverdue] = await Promise.all([
      tasks.list({ completed: false }).catch(() => []),
      tasks.list({ due: "overdue", completed: false }).catch(() => []),
    ]);
    _openMap = {}; _overdueMap = {};
    allOpen.forEach(t => { if (t.project_id) _openMap[t.project_id] = (_openMap[t.project_id] || 0) + 1; });
    allOverdue.forEach(t => { if (t.project_id) _overdueMap[t.project_id] = (_overdueMap[t.project_id] || 0) + 1; });
    _renderGrid(grid, _allProjects, _openMap, _overdueMap);
  } catch (err) {
    grid.innerHTML = `<p style="color:var(--danger);padding:16px">${esc(err.message)}</p>`;
  }
}

function _renderGrid(grid, tree, openMap, overdueMap) {
  grid.innerHTML = "";
  grid.classList.toggle("edit-mode", _editMode);
  if (!tree.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🐙</div><p>No projects yet</p><small>Tap + New to create your first project</small></div>`;
    return;
  }
  tree.forEach(p => grid.appendChild(_projectEntry(p, openMap, overdueMap, 0)));
  if (_editMode) {
    _attachContainerDnd(grid);
    grid.querySelectorAll(".project-children").forEach(_attachContainerDnd);
  }
}

function _totalDescendants(p) {
  let n = 0;
  (p.children || []).forEach(c => { n += 1 + _totalDescendants(c); });
  return n;
}

function _sumDescendants(p, map) {
  let n = map[p.id] || 0;
  (p.children || []).forEach(c => { n += _sumDescendants(c, map); });
  return n;
}

function _projectEntry(p, openMap, overdueMap, depth) {
  const entry = document.createElement("div");
  entry.className = "project-entry";
  entry.dataset.projectId = p.id;

  const open       = _sumDescendants(p, openMap);
  const overdue    = _sumDescendants(p, overdueMap);
  const hue        = jazziconHue(p.id);
  const iconSize   = depth === 0 ? 38 : depth === 1 ? 32 : 26;
  const childCount = p.children?.length || 0;
  const totalSubs  = _totalDescendants(p);

  const isShared = p.my_role && p.my_role !== "owner";

  const tile = document.createElement("div");
  tile.className = `project-tile${isShared ? " project-tile--shared" : ""}`;
  tile.style.setProperty("--tile-hue", hue.toFixed(0));
  const sharedBadge = isShared
    ? `<span class="project-shared-badge">${p.my_role}</span>`
    : "";
  tile.innerHTML = `
    <div class="project-tile-icon" title="Tap for QR code"></div>
    <div class="project-tile-body">
      <div class="project-tile-name">${esc(p.name)}${sharedBadge}</div>
    </div>
    <div class="project-tile-badges">
      <span class="tile-badge tile-badge-tasks">${open}<span class="tb-lbl"> task${open !== 1 ? "s" : ""}</span></span>
      ${overdue > 0 ? `<span class="tile-badge tile-badge-overdue">${overdue}<span class="tb-lbl"> late</span></span>` : ""}
      ${childCount > 0 ? `<button class="tile-badge tile-badge-subs" type="button"><span class="subs-chevron">▸</span>${totalSubs}<span class="tb-lbl"> sub</span></button>` : ""}
    </div>
    <button class="tile-menu-btn" type="button" title="Project options">⋯</button>`;

  if (_editMode) {
    const handle = document.createElement("div");
    handle.className = "drag-handle";
    handle.innerHTML = "⠿";
    tile.prepend(handle);
    entry.draggable = true;
    entry.addEventListener("dragstart", (e) => {
      _dragEntry = entry;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", p.id);
      setTimeout(() => entry.classList.add("drag-ghost"), 0);
    });
    entry.addEventListener("dragend", () => {
      entry.classList.remove("drag-ghost");
      _projIndicator?.remove();
      _dragEntry = null;
    });
  }

  const iconDiv = tile.querySelector(".project-tile-icon");
  iconDiv.appendChild(generateJazzicon(p.id, iconSize));

  iconDiv.addEventListener("click", (e) => { e.stopPropagation(); if (!_editMode) showQRModal(p); });
  tile.addEventListener("click", (e) => {
    if (_editMode) return;
    if (e.target.closest(".tile-menu-btn") || e.target.closest(".project-tile-icon") || e.target.closest(".tile-badge-subs")) return;
    _showBoard(p);
  });
  tile.querySelector(".tile-menu-btn").addEventListener("click", (e) => {
    if (_editMode) return;
    e.stopPropagation();
    openProjectSettings(p, _flat(_allProjects), { onSave: () => _loadGrid() });
  });

  entry.appendChild(tile);

  if (childCount > 0) {
    const childrenEl = document.createElement("div");
    childrenEl.className = "project-children";
    // Start expanded by default
    p.children.forEach(child => childrenEl.appendChild(_projectEntry(child, openMap, overdueMap, depth + 1)));
    entry.appendChild(childrenEl);

    const subsBtn = tile.querySelector(".tile-badge-subs");
    subsBtn.classList.add("open");
    subsBtn.addEventListener("click", (e) => {
      if (_editMode) return;
      e.stopPropagation();
      const isOpen = childrenEl.style.display !== "none";
      childrenEl.style.display = isOpen ? "none" : "";
      subsBtn.classList.toggle("open", !isOpen);
    });
  }

  return entry;
}

// ── Archive view ──────────────────────────────────────────────────
function _toggleArchiveView() {
  _showArchived = !_showArchived;
  const archBtn  = document.getElementById("btn-show-archive");
  const editBtn  = document.getElementById("btn-edit-order");
  const newBtn   = document.getElementById("btn-new-project");
  if (archBtn) { archBtn.classList.toggle("active", _showArchived); }
  if (editBtn) editBtn.style.display = _showArchived ? "none" : "";
  if (newBtn)  newBtn.style.display  = _showArchived ? "none" : "";
  if (_showArchived) {
    if (_editMode) _exitEditMode();
    _loadArchivedGrid();
  } else {
    _loadGrid();
  }
}

async function _loadArchivedGrid() {
  const grid = document.getElementById("project-grid");
  grid.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const [activeTree, archivedList] = await Promise.all([
      projects.list(),
      projects.archived(),
    ]);

    if (!archivedList.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><p>No archived projects</p></div>`;
      return;
    }

    const archivedIds = new Set(archivedList.map(p => p.id));
    // Combine active (flat) and archived into one list with an _archived flag
    const allFlat = [
      ..._flat(activeTree).map(p => ({ ...p, _archived: false })),
      ...archivedList.map(p => ({ ...p, _archived: true })),
    ];
    const allIds = new Set(allFlat.map(p => p.id));
    // Orphaned items (missing parent) surface at root
    const treeInput = allFlat.map(p => ({
      ...p,
      parent_id: (p.parent_id && allIds.has(p.parent_id)) ? p.parent_id : null,
    }));

    const combined = _buildCombinedTree(treeInput, null);
    // Only show root branches that contain at least one archived node
    const visible = combined.filter(p => _hasArchived(p, archivedIds));

    grid.innerHTML = "";
    visible.forEach(p => grid.appendChild(_archiveEntry(p, 0, archivedIds)));
  } catch (err) {
    grid.innerHTML = `<p style="color:var(--danger);padding:16px">${esc(err.message)}</p>`;
  }
}

function _buildCombinedTree(flat, parentId) {
  return flat
    .filter(p => (p.parent_id || null) === parentId)
    .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name))
    .map(p => ({ ...p, children: _buildCombinedTree(flat, p.id) }));
}

// Returns true if this node or any descendant is archived
function _hasArchived(node, archivedIds) {
  if (archivedIds.has(node.id)) return true;
  return (node.children || []).some(c => _hasArchived(c, archivedIds));
}

function _archiveEntry(p, depth, archivedIds) {
  const entry = document.createElement("div");
  entry.className = "project-entry";

  const hue      = jazziconHue(p.id);
  const iconSize = depth === 0 ? 38 : depth === 1 ? 32 : 26;
  const isArchived = archivedIds.has(p.id);

  const tile = document.createElement("div");
  tile.className = "project-tile" + (isArchived ? " project-tile-archived" : "");
  tile.style.setProperty("--tile-hue", hue.toFixed(0));
  tile.innerHTML = `
    <div class="project-tile-icon"></div>
    <div class="project-tile-body" style="flex:1;min-width:0">
      <div class="project-tile-name">${esc(p.name)}</div>
    </div>
    ${isArchived ? `<button class="btn btn-sm btn-ghost restore-btn" type="button">Restore</button>` : ""}`;

  tile.querySelector(".project-tile-icon").appendChild(generateJazzicon(p.id, iconSize));

  if (isArchived) {
    tile.querySelector(".restore-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await projects.unarchive(p.id);
        toast(`"${p.name}" restored`, "success");
        _loadArchivedGrid();
      } catch (err) { toast(err.message, "error"); }
    });
  }

  entry.appendChild(tile);

  const childrenToShow = (p.children || []).filter(c => _hasArchived(c, archivedIds));
  if (childrenToShow.length) {
    const childrenEl = document.createElement("div");
    childrenEl.className = "project-children";
    childrenToShow.forEach(c => childrenEl.appendChild(_archiveEntry(c, depth + 1, archivedIds)));
    entry.appendChild(childrenEl);
  }

  return entry;
}

// ── Edit-order mode ───────────────────────────────────────────────
function _enterEditMode() {
  _editMode = true;
  const btn = document.getElementById("btn-edit-order");
  if (btn) { btn.textContent = "✓ Done"; btn.classList.add("active"); }
  const grid = document.getElementById("project-grid");
  _renderGrid(grid, _allProjects, _openMap, _overdueMap);
}

async function _exitEditMode() {
  _editMode = false;
  const btn = document.getElementById("btn-edit-order");
  if (btn) { btn.textContent = "✎ Order"; btn.classList.remove("active"); }
  await _loadGrid(); // re-fetch to confirm persisted order from server
}

function _ensureProjIndicator() {
  if (!_projIndicator) {
    _projIndicator = document.createElement("div");
    _projIndicator.className = "proj-drag-indicator";
  }
  return _projIndicator;
}

function _getDragAfterEntry(container, y) {
  const entries = [...container.querySelectorAll(":scope > .project-entry")]
    .filter(e => e !== _dragEntry);
  for (const entry of entries) {
    const box = entry.getBoundingClientRect();
    if (y < box.top + box.height / 2) return entry;
  }
  return null;
}

function _attachContainerDnd(container) {
  container.addEventListener("dragover", (e) => {
    if (!_dragEntry || _dragEntry.parentElement !== container) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const after = _getDragAfterEntry(container, e.clientY);
    const ind   = _ensureProjIndicator();
    after ? container.insertBefore(ind, after) : container.appendChild(ind);
  });
  container.addEventListener("dragleave", (e) => {
    if (!container.contains(e.relatedTarget)) _projIndicator?.remove();
  });
  container.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!_dragEntry || _dragEntry.parentElement !== container) return;
    const after = _getDragAfterEntry(container, e.clientY);
    if (after) container.insertBefore(_dragEntry, after);
    else        container.appendChild(_dragEntry);
    _projIndicator?.remove();
    _saveOrder(container);
  });
}

async function _saveOrder(container) {
  const items = [...container.querySelectorAll(":scope > .project-entry")].map((el, i) => ({
    id: el.dataset.projectId,
    sort_order: i,
  }));
  try {
    await projects.reorder(items);
  } catch (err) {
    toast("Could not save order", "error");
  }
}

// ── Modal ─────────────────────────────────────────────────────────
function _openModal(parentId = null) {
  document.getElementById("new-project-name").value = "";
  document.getElementById("project-error").textContent = "";
  const sel = document.getElementById("new-project-parent");
  sel.innerHTML = `<option value="">— Root project —</option>`;
  _flat(_allProjects).forEach(p => {
    const o = document.createElement("option"); o.value = p.id; o.textContent = p.name;
    if (p.id === parentId) o.selected = true; sel.appendChild(o);
  });
  document.getElementById("modal-overlay").classList.add("open");
  document.getElementById("new-project-name").focus();
}

function _closeModal() { document.getElementById("modal-overlay").classList.remove("open"); }

async function _saveProject() {
  const name = document.getElementById("new-project-name").value.trim();
  const errEl = document.getElementById("project-error");
  if (!name) { errEl.textContent = "Name is required"; return; }
  const parentId = document.getElementById("new-project-parent").value || null;
  try {
    await projects.create({ name, parent_id: parentId });
    _closeModal(); toast("Project created", "success");
    await _loadGrid();
  } catch (e) { errEl.textContent = e.message; }
}

function _refreshBoardHeader(project) {
  const boardView = document.getElementById("projects-board-view");
  if (!boardView) return;
  const hue = jazziconHue(project.id);
  boardView.style.setProperty("--board-hue", hue.toFixed(0));
  boardView.style.setProperty("--board-btn-text", _btnTextColor(hue));
  const titleEl = document.getElementById("board-project-title");
  if (titleEl) titleEl.textContent = project.name;
  const iconSlot = document.getElementById("board-project-icon");
  if (iconSlot) {
    iconSlot.innerHTML = "";
    iconSlot.appendChild(generateJazzicon(project.id, 34));
  }
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Return "#ffffff" or "#111827" depending on whether hsl(h,s%,l%)
 * is dark enough to need white text (WCAG relative-luminance check).
 */
function _btnTextColor(h, s = 62, l = 52) {
  s /= 100; l /= 100;
  const c  = (1 - Math.abs(2 * l - 1)) * s;
  const x  = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m  = l - c / 2;
  const hi = Math.floor(h / 60) % 6;
  let r, g, b;
  if      (hi === 0) { r=c+m; g=x+m; b=m;   }
  else if (hi === 1) { r=x+m; g=c+m; b=m;   }
  else if (hi === 2) { r=m;   g=c+m; b=x+m; }
  else if (hi === 3) { r=m;   g=x+m; b=c+m; }
  else if (hi === 4) { r=x+m; g=m;   b=c+m; }
  else               { r=c+m; g=m;   b=x+m; }
  const lin = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum < 0.28 ? "#ffffff" : "#111827";
}

function _flat(tree, acc = []) {
  tree.forEach(p => { acc.push(p); if (p.children?.length) _flat(p.children, acc); }); return acc;
}

function _depth(tree, id, d = 0) {
  for (const p of tree) {
    if (p.id === id) return d;
    if (p.children?.length) { const r = _depth(p.children, id, d + 1); if (r >= 0) return r; }
  }
  return 0;
}

function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

// ── Board picker ──────────────────────────────────────────────────

export async function openBoardPicker() {
  if (document.getElementById("bp-overlay")) return;   // already open

  const overlay = document.createElement("div");
  overlay.id = "bp-overlay";
  overlay.className = "modal-overlay";

  const modal = document.createElement("div");
  modal.className = "modal bp-modal";
  modal.innerHTML = `
    <div class="bp-hdr">
      <img src="/icons/otter_icon.png" class="bp-title-icon" alt="">
      <span class="bp-title-text">Boards</span>
      <button class="btn-icon bp-close" type="button" title="Close">✕</button>
    </div>
    <input id="bp-search" type="search" class="text-input bp-search-input"
           placeholder="Search projects…" autocomplete="off" spellcheck="false">
    <div id="bp-list" class="bp-list">
      <div class="loading-center"><div class="spinner"></div></div>
    </div>`;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const listEl   = document.getElementById("bp-list");
  const searchEl = document.getElementById("bp-search");

  const close = () => {
    overlay.classList.remove("open");
    setTimeout(() => overlay.remove(), 240);
  };
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  modal.querySelector(".bp-close").addEventListener("click", close);
  const onKey = e => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);

  requestAnimationFrame(() => overlay.classList.add("open"));

  // Fetch projects if not already loaded
  let tree = _allProjects;
  if (!tree.length) {
    tree = await projects.list().catch(() => []);
    _allProjects = tree;
    cacheProjectSettings(_flat(tree));
  }

  const makeItem = (p, depth) => {
    const hue = jazziconHue(p.id).toFixed(0);
    const isCurrent = p.id === _currentProject?.id;
    const isShared = p.my_role && p.my_role !== "owner";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bp-item" + (isCurrent ? " bp-item-current" : "") + (isShared ? " bp-item-shared" : "");
    btn.style.paddingLeft = `${12 + depth * 16}px`;
    const dot = document.createElement("span");
    dot.className = "bp-dot";
    dot.style.background = `hsl(${hue},65%,55%)`;
    const icon = generateJazzicon(p.id, 26);
    const name = document.createElement("span");
    name.className = "bp-name";
    name.textContent = p.name;
    btn.append(dot, icon, name);
    if (isShared) {
      const badge = document.createElement("span");
      badge.className = "bp-shared-badge";
      badge.textContent = p.my_role;
      btn.appendChild(badge);
    }
    if (isCurrent) {
      const chk = document.createElement("span");
      chk.className = "bp-check";
      chk.textContent = "✓";
      btn.appendChild(chk);
    }
    btn.addEventListener("click", () => {
      close();
      window.dispatchEvent(new CustomEvent("projects:goto-board", { detail: { projectId: p.id } }));
    });
    return btn;
  };

  const renderList = (q) => {
    const query = q.toLowerCase().trim();
    listEl.innerHTML = "";
    if (query) {
      const hits = _flat(tree).filter(p => p.name.toLowerCase().includes(query));
      if (!hits.length) {
        listEl.innerHTML = `<p class="bp-empty">No projects found</p>`;
        return;
      }
      hits.forEach(p => listEl.appendChild(makeItem(p, 0)));
    } else {
      const walk = (nodes, depth) => nodes.forEach(p => {
        listEl.appendChild(makeItem(p, depth));
        if (p.children?.length) walk(p.children, depth + 1);
      });
      walk(tree, 0);
    }
  };

  renderList("");
  searchEl.addEventListener("input", () => renderList(searchEl.value));
  setTimeout(() => searchEl.focus(), 60);
}
