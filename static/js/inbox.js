/**
 * Tasks tab — v10.
 * Pill-button filter (due / project / status) + sort + search + undo.
 */
import { tasks, projects } from "./api.js";
import { toast, toastUndo, formatDue, formatCompleted, formatDateTime } from "./utils.js";
import { openTaskDetail } from "./task-detail.js";
import { generateJazzicon, jazziconHue, cacheProjectSettings } from "./jazzicon.js";
import { attachSlashPicker } from "./slash-picker.js";

// Filter state
let _fltDue      = "";       // "" (all) | "today" | "overdue" | "none"
let _fltProject  = "";       // "" (all) | "__inbox__" | project-id
let _fltStatus   = "";       // "" (open) | "done" | "all"
let _doneDays    = 7;
let _sortBy      = "due";
let _searchQuery = "";
let _sectionsCollapsed = false;

// Project options for the project pill dropdown
let _projectOptions = [
  { value: "", label: "All" },
  { value: "__inbox__", label: "📥 Inbox" },
];

// Only one dropdown open at a time
let _activeDropdown = null;

let _initialized = false;
let _debounce    = null;

export async function initInbox() {
  if (!_initialized) {
    _initialized = true;
    _setupQuickAdd();
    _setupFilters();
    window.addEventListener("tasks:changed", () => {
      if (document.getElementById("tab-tasks")?.classList.contains("active")) _loadTasks();
    });
  }
  _refreshProjectSelect();
  _loadTasks();
}

// ── Quick-add bar ─────────────────────────────────────────────────
function _setupQuickAdd() {
  const input   = document.getElementById("quick-add-input");
  const btn     = document.getElementById("quick-add-btn");
  const preview = document.getElementById("quick-add-preview");
  const preTitle= document.getElementById("qa-preview-title");
  const preDate = document.getElementById("qa-preview-date");

  const slashPicker = attachSlashPicker(input, () => projects.list());

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  input.addEventListener("input", () => {
    clearTimeout(_debounce);
    const val = slashPicker.getStrippedInput();
    if (!val) { preview.style.display = "none"; return; }
    _debounce = setTimeout(async () => {
      try {
        const p = await tasks.preview(val);
        preTitle.textContent = p.title || val;
        preDate.textContent  = p.due_at ? `📅 ${formatDateTime(p.due_at)}` : "No date detected";
        preview.style.display = "block";
      } catch { preview.style.display = "none"; }
    }, 350);
  });

  const submit = async () => {
    const val    = slashPicker.getStrippedInput(); if (!val) return;
    const projId = slashPicker.getProjectId();
    btn.disabled = true; btn.textContent = "…";
    try {
      await tasks.create({ raw_input: val, project_id: projId });
      input.value = ""; input.style.height = "auto"; preview.style.display = "none";
      slashPicker.reset();
      toast("Task added ✓", "success");
      window.dispatchEvent(new CustomEvent("tasks:changed"));
    } catch (err) { toast(err.message, "error"); }
    finally { btn.disabled = false; btn.textContent = "+"; input.focus(); }
  };

  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } });
  btn.addEventListener("click", submit);

  // Keyboard shortcut: N or C focuses quick-add
  document.addEventListener("keydown", (e) => {
    if (e.key !== "n" && e.key !== "c") return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
    if (!document.getElementById("tab-tasks")?.classList.contains("active")) return;
    e.preventDefault();
    input.focus();
  });
}

async function _refreshProjectSelect() {
  try {
    const tree = await projects.list();
    cacheProjectSettings(_flatTree(tree));
    _projectOptions = [
      { value: "", label: "All", depth: 0 },
      { value: "__inbox__", label: "📥 Inbox", depth: 0 },
      ..._treeOptions(tree).map(({ id, name, depth }) => ({ value: id, label: name, depth })),
    ];
  } catch { /* non-fatal */ }
}

// ── Custom dropdown helper ────────────────────────────────────────
function _openFilterDropdown(btn, options, currentValue, onSelect) {
  if (_activeDropdown) { _activeDropdown.remove(); _activeDropdown = null; }

  const menu = document.createElement("div");
  menu.className = "filter-dropdown";

  options.forEach(opt => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "filter-dropdown-item" + (opt.value === currentValue ? " selected" : "");
    const depth = opt.depth ?? 0;
    if (depth > 0) {
      item.style.paddingLeft = `${8 + depth * 16}px`;
      const connector = document.createElement("span");
      connector.className = "fdd-connector";
      connector.textContent = "└ ";
      item.appendChild(connector);
      item.appendChild(document.createTextNode(opt.label));
    } else {
      item.textContent = opt.label;
    }
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.remove();
      _activeDropdown = null;
      onSelect(opt.value);
    });
    menu.appendChild(item);
  });

  document.body.appendChild(menu);
  _activeDropdown = menu;

  const rect = btn.getBoundingClientRect();
  menu.style.top  = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;

  requestAnimationFrame(() => {
    const mw = menu.offsetWidth;
    const maxLeft = window.innerWidth - 8 - mw;
    if (parseFloat(menu.style.left) > maxLeft) {
      menu.style.left = `${Math.max(8, maxLeft)}px`;
    }
  });

  const close = (e) => {
    if (menu.contains(e.target)) return;
    menu.remove();
    _activeDropdown = null;
    document.removeEventListener("click", close, true);
  };
  setTimeout(() => document.addEventListener("click", close, true), 0);
}

function _setPillLabel(id, label, isActive) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.innerHTML = `<span class="pill-text">${esc(label)}</span><span class="flt-arrow">▾</span>`;
  btn.classList.toggle("active", isActive);
}

// ── Filter definitions ────────────────────────────────────────────
const _DUE_OPTS = [
  { value: "",        label: "All" },
  { value: "today",   label: "Due today" },
  { value: "overdue", label: "Overdue" },
  { value: "none",    label: "No due date" },
];
const _STATUS_OPTS = [
  { value: "",     label: "Open" },
  { value: "done", label: "Completed" },
  { value: "all",  label: "All" },
];
const _SORT_OPTS = [
  { value: "due",      label: "↕ Due date" },
  { value: "priority", label: "↕ Priority" },
  { value: "title",    label: "↕ A–Z" },
  { value: "created",  label: "↕ Newest" },
];

// ── Filters ───────────────────────────────────────────────────────
function _setupFilters() {
  const doneRow = document.getElementById("done-options-row");
  const daysSel = document.getElementById("done-days-select");

  document.getElementById("flt-due-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    _openFilterDropdown(e.currentTarget, _DUE_OPTS, _fltDue, (val) => {
      _fltDue = val;
      const opt = _DUE_OPTS.find(o => o.value === val);
      _setPillLabel("flt-due-btn", opt?.label || "All", !!val);
      _sync(); _loadTasks();
    });
  });

  document.getElementById("flt-project-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    _openFilterDropdown(e.currentTarget, _projectOptions, _fltProject, (val) => {
      _fltProject = val;
      const opt = _projectOptions.find(o => o.value === val);
      _setPillLabel("flt-project-btn", opt?.label || "Project", !!val);
      _sync(); _loadTasks();
    });
  });

  document.getElementById("flt-status-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    _openFilterDropdown(e.currentTarget, _STATUS_OPTS, _fltStatus, (val) => {
      _fltStatus = val;
      if (val === "done" || val === "all") { _fltDue = ""; _setPillLabel("flt-due-btn", "All", false); }
      const opt = _STATUS_OPTS.find(o => o.value === val);
      _setPillLabel("flt-status-btn", opt?.label || "Open", !!val);
      doneRow?.classList.toggle("hidden", val !== "done");
      _sync(); _loadTasks();
    });
  });

  document.getElementById("sort-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    _openFilterDropdown(e.currentTarget, _SORT_OPTS, _sortBy, (val) => {
      _sortBy = val;
      const opt = _SORT_OPTS.find(o => o.value === val);
      _setPillLabel("sort-btn", opt?.label || "↕ Due date", false);
      _loadTasks();
    });
  });

  document.getElementById("flt-clear")?.addEventListener("click", () => {
    _fltDue = ""; _fltProject = ""; _fltStatus = "";
    _setPillLabel("flt-due-btn", "All", false);
    _setPillLabel("flt-project-btn", "Project", false);
    _setPillLabel("flt-status-btn", "Open", false);
    doneRow?.classList.add("hidden");
    _sync(); _loadTasks();
    toast("Filters cleared", "success");
  });

  daysSel?.addEventListener("change", (e) => {
    _doneDays = e.target.value === "" ? null : parseInt(e.target.value, 10);
    _loadTasks();
  });

  // Search
  const searchToggle = document.getElementById("btn-search-toggle");
  const searchRow    = document.getElementById("search-row");
  const searchInput  = document.getElementById("search-input");

  searchToggle?.addEventListener("click", () => {
    const nowHidden = searchRow.classList.toggle("hidden");
    searchToggle.classList.toggle("active", !nowHidden);
    if (!nowHidden) searchInput.focus();
    else { searchInput.value = ""; _searchQuery = ""; _loadTasks(); }
  });

  document.getElementById("search-clear")?.addEventListener("click", () => {
    searchInput.value = "";
    searchRow.classList.add("hidden");
    searchToggle?.classList.remove("active");
    _searchQuery = ""; _loadTasks();
  });

  searchInput?.addEventListener("input", () => {
    _searchQuery = searchInput.value.trim();
    _loadTasks();
  });

  // Collapse / expand all sections
  const collapseBtn = document.getElementById("btn-collapse-sections");
  collapseBtn?.addEventListener("click", () => {
    _sectionsCollapsed = !_sectionsCollapsed;
    _applyCollapseState();
    collapseBtn.textContent = _sectionsCollapsed ? "⊕" : "⊖";
    collapseBtn.title = _sectionsCollapsed ? "Expand all" : "Collapse all";
  });
}

function _sync() {
  const hasFilter = _fltDue || _fltProject || _fltStatus;
  document.getElementById("flt-clear")?.classList.toggle("hidden", !hasFilter);
}

function _applyCollapseState() {
  document.querySelectorAll("#inbox-list .task-section-header").forEach(h => {
    const body = h.nextElementSibling;
    if (!body) return;
    body.style.display = _sectionsCollapsed ? "none" : "";
    h.classList.toggle("collapsed", _sectionsCollapsed);
  });
}

// ── Task loading ──────────────────────────────────────────────────
async function _loadTasks() {
  const list = document.getElementById("inbox-list");
  list.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;

  try {
    const isDone = _fltStatus === "done";
    const isAll  = _fltStatus === "all";

    const params = {};
    if (isDone) {
      params.completed = true;
      if (_doneDays != null) params.completed_days = _doneDays;
    } else if (!isAll) {
      // Default: Open only
      params.completed = false;
    }
    // Due filter — skip for Done view; "none" is handled client-side
    if (!isDone && _fltDue && _fltDue !== "none") params.due = _fltDue;
    // Project filter is applied client-side so descendants are included automatically

    const [rawItems, tree, overdueItems] = await Promise.all([
      tasks.list(params),
      projects.list().catch(() => []),
      tasks.list({ due: "overdue", completed: false }).catch(() => []),
    ]);

    cacheProjectSettings(_flatTree(tree));
    const projMap = {};
    _flatTree(tree).forEach(p => { projMap[p.id] = p; });

    // Build the set of project IDs that match the active filter (including descendants)
    let items;
    if (_fltProject === "__inbox__") {
      items = rawItems.filter(t => !t.project_id);
    } else if (_fltProject) {
      const ids = _descendantIds(_fltProject, tree);
      items = rawItems.filter(t => t.project_id && ids.has(t.project_id));
    } else {
      items = rawItems;
    }

    // "No due date" filter — client-side
    if (_fltDue === "none") items = items.filter(t => !t.due_at);

    // Sort
    if (isDone) {
      items = [...items].sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
    } else if (isAll) {
      const open = _sortTasks(items.filter(t => !t.completed_at));
      const done = [...items.filter(t =>  t.completed_at)]
        .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
      items = [...open, ...done];
    } else {
      items = _sortTasks(items);
    }

    // Search
    items = _searchFilter(items);

    // Render
    list.innerHTML = "";
    if (!items.length) {
      const hasFilter = _fltDue || _fltProject || _fltStatus || _searchQuery;
      const icon = isDone ? "✓" : (_searchQuery ? "🔍" : "✨");
      const msg  = isDone
        ? "No completed tasks"
        : (_searchQuery ? "No results" : (hasFilter ? "Nothing matches" : "All clear!"));
      const sub  = _searchQuery
        ? `No tasks match "${_searchQuery}"`
        : (hasFilter ? "Try changing or clearing the filters" : "Add a task above to get started");
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${msg}</p><small>${sub}</small></div>`;
      _updateBadge(overdueItems.length);
      return;
    }

    if (_fltProject === "__inbox__") {
      // Inbox: flat list, no grouping needed
      items.forEach(t => list.appendChild(_card(t)));
    } else if (_fltProject) {
      // Project filter: group by the selected project + its subprojects
      const byProject = {};
      items.forEach(t => {
        if (t.project_id) (byProject[t.project_id] = byProject[t.project_id] || []).push(t);
      });
      const rootNode = _flatTree(tree).find(p => p.id === _fltProject);
      if (rootNode) {
        if (byProject[rootNode.id]?.length)
          list.appendChild(_section(projMap[rootNode.id] ?? rootNode, byProject[rootNode.id], rootNode.id));
        if (rootNode.children?.length)
          _renderProjectTree(list, rootNode.children, byProject, projMap);
      } else {
        items.forEach(t => list.appendChild(_card(t)));
      }
    } else {
      // All projects: group by inbox / project tree
      const inbox     = items.filter(t => !t.project_id);
      const byProject = {};
      items.filter(t => t.project_id).forEach(t => {
        (byProject[t.project_id] = byProject[t.project_id] || []).push(t);
      });
      if (inbox.length) list.appendChild(_section("📥 Inbox", inbox, null));
      _renderProjectTree(list, tree, byProject, projMap);
    }

    if (_sectionsCollapsed) _applyCollapseState();
    _updateBadge(overdueItems.length);

  } catch (err) {
    list.innerHTML = `<p style="color:var(--danger);padding:16px">${esc(err.message)}</p>`;
  }
}

// ── Sort + search helpers ─────────────────────────────────────────
function _sortTasks(list) {
  const copy = [...list];
  if (_sortBy === "priority") {
    const order = { high: 0, normal: 1, low: 2 };
    copy.sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1));
  } else if (_sortBy === "title") {
    copy.sort((a, b) => a.title.localeCompare(b.title));
  } else if (_sortBy === "created") {
    copy.sort((a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0));
  } else {
    copy.sort((a, b) => {
      if (!a.due_at && !b.due_at) return 0;
      if (!a.due_at) return 1; if (!b.due_at) return -1;
      return new Date(a.due_at) - new Date(b.due_at);
    });
  }
  return copy;
}

function _searchFilter(items) {
  if (!_searchQuery) return items;
  const q = _searchQuery.toLowerCase();
  return items.filter(t => t.title.toLowerCase().includes(q));
}

// ── Section + card ────────────────────────────────────────────────
function _section(titleOrProject, items, projectId = null) {
  const proj     = (titleOrProject && typeof titleOrProject === "object") ? titleOrProject : null;
  const title    = proj ? proj.name : titleOrProject;
  const isShared = proj && proj.my_role && proj.my_role !== "owner";

  const wrap = document.createElement("div"); wrap.className = "task-section";
  const header = document.createElement("div");
  header.className = "task-section-header" + (projectId ? " has-project" : "") + (isShared ? " section-shared" : "");
  header.dataset.projectId = projectId != null ? String(projectId) : "__inbox__";

  if (projectId) {
    header.style.setProperty("--section-hue", jazziconHue(projectId).toFixed(0));
    const icon = generateJazzicon(projectId, 26);
    icon.className = "task-section-icon";
    header.appendChild(document.createElement("span")).className = "task-section-chevron";
    header.querySelector(".task-section-chevron").textContent = "▾";
    header.appendChild(icon);
  } else {
    const chev = document.createElement("span");
    chev.className = "task-section-chevron"; chev.textContent = "▾";
    header.appendChild(chev);
  }

  const nameEl = document.createElement("span");
  nameEl.className = "task-section-name"; nameEl.textContent = title;
  if (isShared) {
    const badge = document.createElement("span");
    badge.className = "section-shared-badge";
    badge.textContent = proj.my_role;
    nameEl.appendChild(badge);
  }
  const countEl = document.createElement("span");
  countEl.className = "task-section-count"; countEl.textContent = items.length;
  header.appendChild(nameEl); header.appendChild(countEl);

  // Jump-to-board button for project sections
  if (projectId) {
    const jumpBtn = document.createElement("button");
    jumpBtn.className = "section-jump-btn";
    jumpBtn.type = "button";
    jumpBtn.title = "Open board";
    jumpBtn.textContent = "↗";
    jumpBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent("projects:goto-board", {
        detail: { projectId: projectId }
      }));
    });
    header.appendChild(jumpBtn);
  }

  const body = document.createElement("div"); body.className = "task-section-body";
  items.forEach(t => body.appendChild(_card(t)));
  // Read DOM state so external collapse-all stays in sync
  header.addEventListener("click", () => {
    const nowCollapsed = !header.classList.contains("collapsed");
    body.style.display = nowCollapsed ? "none" : "";
    header.classList.toggle("collapsed", nowCollapsed);
  });

  // ── Drag-and-drop: whole section wrap is the drop target ──────────
  wrap.addEventListener("dragover", (e) => {
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    header.classList.add("drag-over");
  });
  wrap.addEventListener("dragleave", (e) => {
    if (!wrap.contains(e.relatedTarget)) header.classList.remove("drag-over");
  });
  wrap.addEventListener("drop", async (e) => {
    e.preventDefault(); e.stopPropagation();
    header.classList.remove("drag-over");
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    const targetProjId = header.dataset.projectId === "__inbox__"
      ? null
      : header.dataset.projectId;
    try {
      await tasks.update(taskId, { project_id: targetProjId });
      toast(`Moved to ${nameEl.textContent}`, "success");
      _loadTasks();
    } catch (err) { toast(err.message, "error"); }
  });

  wrap.append(header, body); return wrap;
}

function _card(task) {
  const card = document.createElement("div");
  card.className = `task-card priority-${task.priority}${task.completed_at ? " completed" : ""}`;
  card.setAttribute("draggable", "true");
  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", String(task.id));
    e.dataTransfer.effectAllowed = "move";
    requestAnimationFrame(() => card.classList.add("dragging"));
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));

  const dueInfo = task.completed_at
    ? formatCompleted(task.completed_at)
    : (task.due_at ? formatDue(task.due_at) : null);

  const priorityLabel = task.priority === "high" ? "⬆ High" : task.priority === "low" ? "⬇ Low" : "";
  const subtaskTotal  = task.subtasks?.length ?? 0;
  const subtaskDone   = subtaskTotal ? (task.subtasks.filter(s => s.completed_at).length) : 0;

  card.innerHTML = `
    <div class="task-check${task.completed_at ? " done" : ""}"></div>
    <div class="task-body">
      <div class="task-title${task.completed_at ? " done" : ""}">
        <span class="task-title-text">${esc(task.title)}</span>
        ${subtaskTotal ? `<span class="task-sub-badge">${subtaskDone}/${subtaskTotal}</span>` : ""}
        ${dueInfo ? `<span class="task-due ${dueInfo.cls}">${dueInfo.text}</span>` : ""}
        ${priorityLabel ? `<span class="task-priority-chip ${task.priority}">${priorityLabel}</span>` : ""}
      </div>
    </div>
    <span class="task-edit-hint">›</span>`;

  const checkEl = card.querySelector(".task-check");

  checkEl.addEventListener("click", async (e) => {
    e.stopPropagation();
    const completing = !task.completed_at;
    try {
      if (completing) {
        await tasks.complete(task.id);
        task.completed_at = new Date().toISOString();
      } else {
        await tasks.uncomplete(task.id);
        task.completed_at = null;
      }

      // In "All" view, tasks never leave the list when completing/uncompleting
      const leavesView = completing
        ? _fltStatus === ""
        : _fltStatus === "done";

      if (completing) {
        checkEl.classList.add("done");
        card.classList.add("completed");
        card.querySelector(".task-title").classList.add("done");

        if (leavesView) {
          let undone = false;
          toastUndo("Task completed", async () => {
            undone = true;
            try {
              await tasks.uncomplete(task.id);
              task.completed_at = null;
              checkEl.classList.remove("done");
              card.classList.remove("completed");
              card.querySelector(".task-title").classList.remove("done");
            } catch (err) { toast(err.message, "error"); }
          });
          setTimeout(() => {
            if (undone) return;
            card.style.transition = "opacity .25s";
            card.style.opacity = "0";
            setTimeout(() => {
              card.remove();
              _updateBadge(document.querySelectorAll("#inbox-list .task-card:not(.completed) .task-due.overdue").length);
            }, 260);
          }, 5000);
        }
      } else {
        if (leavesView) {
          card.style.transition = "opacity .25s"; card.style.opacity = "0";
          setTimeout(() => {
            card.remove();
            _updateBadge(document.querySelectorAll("#inbox-list .task-card:not(.completed) .task-due.overdue").length);
          }, 260);
        } else {
          checkEl.classList.remove("done");
          card.classList.remove("completed");
          card.querySelector(".task-title").classList.remove("done");
        }
      }
    } catch (err) { toast(err.message, "error"); }
  });

  card.addEventListener("click", (e) => {
    if (e.target.closest(".task-check")) return;
    openTaskDetail(task.id, _loadTasks);
  });
  return card;
}

// ── Nested project-section rendering ─────────────────────────────
function _renderProjectTree(container, nodes, byProject, projMap) {
  nodes.forEach(p => {
    if (!_anyDescendantHasTasks(p, byProject)) return;
    const sec = _section(projMap[p.id] ?? p, byProject[p.id] || [], p.id);
    container.appendChild(sec);
    if (p.children?.length) {
      const nested = document.createElement("div");
      nested.className = "task-section-nested";
      _renderProjectTree(nested, p.children, byProject, projMap);
      if (nested.childElementCount) container.appendChild(nested);
    }
  });
}

function _anyDescendantHasTasks(p, byProject) {
  if ((byProject[p.id]?.length ?? 0) > 0) return true;
  return p.children?.some(c => _anyDescendantHasTasks(c, byProject)) ?? false;
}

function _updateBadge(n) {
  const b = document.querySelector('.nav-item[data-tab="tasks"] .badge');
  if (!b) return; b.textContent = n > 0 ? String(n) : ""; b.style.display = n > 0 ? "flex" : "none";
}

function _flatTree(tree, acc = []) {
  tree.forEach(p => { acc.push(p); if (p.children?.length) _flatTree(p.children, acc); }); return acc;
}

function _treeOptions(nodes, depth = 0, acc = []) {
  nodes.forEach(p => {
    acc.push({ id: p.id, name: p.name, depth });
    if (p.children?.length) _treeOptions(p.children, depth + 1, acc);
  });
  return acc;
}

// Returns a Set of the given project's ID plus all descendant IDs
function _descendantIds(projectId, tree) {
  const node = _flatTree(tree).find(p => p.id === projectId);
  if (!node) return new Set([projectId]);
  return new Set([node, ..._flatTree(node.children ?? [])].map(p => p.id));
}
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
