/** Kanban renderer — v10. Renders into a provided container element. */
import { tasks, projects, buckets } from "./api.js";
import { toast, formatDue, formatCompleted, showConfirm, showPrompt } from "./utils.js";
import { openTaskDetail } from "./task-detail.js";

// ── Responsive mode ───────────────────────────────────────────────
// Column layout constants — must stay in sync with CSS values.
const _COL_W      = 270; // .kanban-col mobile flex-basis
const _COL_W_WIDE = 290; // .kanban-col desktop flex-basis (≥ 600 px)
const _GAP        = 12;  // column gap
const _PAD        = 32;  // board L+R padding on mobile  (16 × 2)
const _PAD_WIDE   = 48;  // board L+R padding on desktop (24 × 2)

// Returns true when wrapWidth is wide enough to show ≥ 3 columns without scrolling
function _fitsKanban(wrapWidth) {
  const wide = wrapWidth >= 600;
  const colW = wide ? _COL_W_WIDE : _COL_W;
  const pad  = wide ? _PAD_WIDE   : _PAD;
  return Math.floor((wrapWidth - pad + _GAP) / (colW + _GAP)) >= 3;
}

let _listMode = false;
export function setListMode(on) { _listMode = on; }
export function getListMode()   { return _listMode; }

// Apply mode: set state + toggle CSS class + notify projects.js via custom event
function _applyMode(listOn) {
  _listMode = listOn;
  document.getElementById("projects-board-view")?.classList.toggle("list-mode", listOn);
  document.dispatchEvent(new CustomEvent("board:modechange", { detail: { listMode: listOn } }));
}

// Toggle called by the user's view button — does NOT re-fetch data
export function toggleBoardMode() { _applyMode(!_listMode); }

// Called when navigating back to the grid so the observer doesn't keep running
let _resizeObs = null;
export function disconnectBoardObserver() {
  _resizeObs?.disconnect();
  _resizeObs = null;
}

// Watches the kanban-wrap for width changes and auto-switches mode when ≥ 3
// columns stop fitting (or start fitting again). Pure CSS-class toggle — no re-fetch.
let _resizeDeb = null;
let _lastWrapW = 0;
function _setupResponsive(wrapEl) {
  disconnectBoardObserver();
  _lastWrapW = wrapEl.clientWidth;
  _resizeObs = new ResizeObserver(entries => {
    clearTimeout(_resizeDeb);
    _resizeDeb = setTimeout(() => {
      const w = entries[0]?.contentRect.width ?? wrapEl.clientWidth;
      if (w === 0 || Math.abs(w - _lastWrapW) < 20) return; // ignore hidden or tiny change
      _lastWrapW = w;
      const shouldList = !_fitsKanban(w);
      if (shouldList !== _listMode) _applyMode(shouldList);
    }, 150);
  });
  _resizeObs.observe(wrapEl);
}

// Module-level drag state
let _dragSourceBody = null;
let _dragCard = null;
let _dragColEl = null;   // set while a column header is being dragged

// Singleton drop indicator element
let _indicator = null;
function _ensureIndicator() {
  if (!_indicator) {
    _indicator = document.createElement("div");
    _indicator.className = "drag-indicator";
  }
  return _indicator;
}

// Returns the card element immediately below cursor (to insert before it)
function _getDragAfterEl(container, y) {
  const cards = [...container.querySelectorAll(".task-card:not(.completed)")]
    .filter(el => el !== _dragCard);
  for (const card of cards) {
    const box = card.getBoundingClientRect();
    if (y < box.top + box.height / 2) return card;
  }
  return null;
}

export async function loadKanban(project, container, showCompleted = false, { resetMode = false, readOnly = false } = {}) {
  // Auto-detect the correct mode from the current container width when opening a new board.
  // Re-renders triggered by user actions (toggle, add task, etc.) pass resetMode:false to
  // preserve the mode the user has already seen.
  if (resetMode) {
    const wrapEl = container.closest(".kanban-wrap") ?? container.parentElement;
    if (wrapEl) _applyMode(!_fitsKanban(wrapEl.clientWidth));
  }
  container.innerHTML = `<div class="loading-center" style="min-width:240px"><div class="spinner"></div></div>`;
  try {
    const params = showCompleted
      ? { project_id: project.id }
      : { project_id: project.id, completed: false };
    const [cols, taskList] = await Promise.all([
      projects.buckets(project.id),
      tasks.list(params),
    ]);
    _render(container, project, cols, taskList, showCompleted, readOnly);
  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger);padding:20px">${esc(err.message)}</p>`;
  }
}

export async function loadPublicBoard(token, container) {
  container.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const data = await projects.publicBoard(token);
    const project = { id: data.id, name: data.name, color_hue: data.color_hue, icon_seed: data.icon_seed };
    const titleEl = document.getElementById("public-board-title");
    if (titleEl) titleEl.textContent = data.name;
    _render(container, project, data.buckets, data.tasks, false, true);
  } catch (err) {
    const titleEl = document.getElementById("public-board-title");
    if (titleEl) titleEl.textContent = "Board not found";
    container.innerHTML = `<p style="color:var(--danger);padding:20px">${esc(err.message)}</p>`;
  }
}

function _render(container, project, cols, taskList, showCompleted, readOnly = false) {
  container.innerHTML = "";

  if (readOnly) container.classList.add("read-only-board");
  else container.classList.remove("read-only-board");

  // Apply list/kanban mode to the board-view ancestor
  const boardView = document.getElementById("projects-board-view");
  boardView?.classList.toggle("list-mode", _listMode);

  const open = taskList.filter(t => !t.completed_at);
  const done = taskList.filter(t =>  t.completed_at);

  const unsortedOpen = open.filter(t => !t.bucket_id);
  const unsortedDone = showCompleted ? done.filter(t => !t.bucket_id) : [];
  container.appendChild(_col(null, "Unsorted", unsortedOpen, unsortedDone, project, cols, container, showCompleted, readOnly));

  cols.forEach(col => {
    const colOpen = open.filter(t => t.bucket_id === col.id);
    const colDone = showCompleted ? done.filter(t => t.bucket_id === col.id) : [];
    container.appendChild(_col(col, col.name, colOpen, colDone, project, cols, container, showCompleted, readOnly));
  });

  if (!readOnly) {
    // ── Inline "+ Column" form (replaces prompt) ──────────────────
    const addWrap = document.createElement("div");
    addWrap.className = "add-col-wrap";
    addWrap.style.cssText = "flex-shrink:0;display:flex;flex-direction:column;align-items:flex-start;padding-top:4px;gap:8px;width:220px";

    const triggerBtn = document.createElement("button");
    triggerBtn.className = "btn btn-sm btn-ghost";
    triggerBtn.style.cssText = "border-color:var(--otter);color:var(--otter);white-space:nowrap";
    triggerBtn.textContent = "+ Column";

    const formEl = document.createElement("div");
    formEl.style.cssText = "display:none;flex-direction:column;gap:6px;width:100%";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Column name…";
    nameInput.style.cssText = "padding:8px 12px;border:1.5px solid var(--otter);border-radius:var(--radius-xs);font-size:14px;background:var(--bg-card);color:var(--text);outline:none;width:100%";

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:6px";

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn btn-sm btn-primary";
    confirmBtn.style.flex = "1";
    confirmBtn.textContent = "Add";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-sm btn-ghost";
    cancelBtn.textContent = "✕";

    btnRow.append(confirmBtn, cancelBtn);
    formEl.append(nameInput, btnRow);
    addWrap.append(triggerBtn, formEl);

    triggerBtn.addEventListener("click", () => {
      triggerBtn.style.display = "none";
      formEl.style.display = "flex";
      nameInput.focus();
    });

    cancelBtn.addEventListener("click", () => {
      formEl.style.display = "none";
      triggerBtn.style.display = "";
      nameInput.value = "";
    });

    const doAdd = async () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      try {
        await projects.addBucket(project.id, { name, position: cols.length });
        toast("Column added", "success");
        loadKanban(project, container, showCompleted);
      } catch (err) { toast(err.message, "error"); }
    };

    confirmBtn.addEventListener("click", doAdd);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doAdd();
      if (e.key === "Escape") cancelBtn.click();
    });

    container.appendChild(addWrap);
  }

  // Wire up the ResizeObserver so the mode adapts if the window is resized
  if (!readOnly) {
    const wrapEl = container.closest(".kanban-wrap") ?? container.parentElement;
    if (wrapEl) _setupResponsive(wrapEl);
  }
}

function _col(bucket, name, taskList, completedList, project, allBuckets, container, showCompleted, readOnly = false) {
  const col = document.createElement("div");
  col.className = "kanban-col";
  if (bucket) col.dataset.bucketId = bucket.id;

  const menuBtn = (bucket && !readOnly)
    ? `<button class="col-menu-btn" title="Column options">⋯</button>`
    : "";
  const dragHandle = (bucket && !readOnly)
    ? `<span class="col-drag-handle" title="Drag to reorder">⠿</span>`
    : "";

  col.innerHTML = `
    <div class="col-header"${(bucket && !readOnly) ? ' draggable="true"' : ""}>
      ${dragHandle}
      <span class="col-header-name">${esc(name)}</span>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <span class="col-count">${taskList.length}</span>
        ${menuBtn}
      </div>
    </div>
    <div class="col-tasks"></div>`;

  const body = col.querySelector(".col-tasks");
  taskList.forEach(t => body.appendChild(_card(t, project, allBuckets, container, showCompleted, readOnly)));

  if (completedList.length) {
    const sep = document.createElement("div");
    sep.className = "col-done-sep";
    sep.textContent = `${completedList.length} completed`;
    body.appendChild(sep);
    completedList.forEach(t => body.appendChild(_card(t, project, allBuckets, container, showCompleted, readOnly)));
  }

  if (!readOnly) {
    // Input lives inside the scroll container so it appears right below the last card
    const addEl = document.createElement("div");
    addEl.className = "add-task-inline";
    addEl.innerHTML = `<input type="text" placeholder="+ Quick add…">`;
    body.appendChild(addEl);

    // ⋯ column menu (rename / delete)
    const menuEl = col.querySelector(".col-menu-btn");
    if (menuEl && bucket) {
      menuEl.addEventListener("click", (e) => {
        e.stopPropagation();
        _showColMenu(e, bucket, project, container, showCompleted);
      });
    }

    // Inline add
    addEl.querySelector("input").addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      const val = e.target.value.trim(); if (!val) return;
      try {
        const created = await tasks.create({ raw_input: val, project_id: project.id, bucket_id: bucket?.id || null });
        e.target.value = "";
        body.insertBefore(_card(created, project, allBuckets, container, showCompleted), body.firstChild);
        col.querySelector(".col-count").textContent = parseInt(col.querySelector(".col-count").textContent) + 1;
        window.dispatchEvent(new CustomEvent("tasks:changed"));
      } catch (err) { toast(err.message, "error"); }
    });
  }

  // ── Column drag-to-reorder ────────────────────────────────────────
  const header = col.querySelector(".col-header");
  if (bucket && header && !readOnly) {
    header.addEventListener("dragstart", (e) => {
      _dragColEl = col;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", bucket.id);
      col.classList.add("col-dragging");
      e.stopPropagation();
    });
    header.addEventListener("dragend", () => {
      _dragColEl = null;
      col.classList.remove("col-dragging");
      container.querySelectorAll(".kanban-col").forEach(c =>
        c.classList.remove("drag-col-before", "drag-col-after")
      );
    });
  }

  col.addEventListener("dragover", (e) => {
    if (!_dragColEl || _dragColEl === col) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = col.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    col.classList.toggle("drag-col-before", before);
    col.classList.toggle("drag-col-after", !before);
  });
  col.addEventListener("dragleave", (e) => {
    if (_dragColEl && !col.contains(e.relatedTarget)) {
      col.classList.remove("drag-col-before", "drag-col-after");
    }
  });
  col.addEventListener("drop", async (e) => {
    if (!_dragColEl || _dragColEl === col) return;
    e.preventDefault();
    e.stopPropagation();
    col.classList.remove("drag-col-before", "drag-col-after");
    const rect = col.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    container.insertBefore(_dragColEl, before ? col : col.nextSibling);
    // Collect new bucket order (skip unsorted col which has no data-bucket-id)
    const ids = [...container.querySelectorAll(".kanban-col[data-bucket-id]")]
      .map(c => c.dataset.bucketId);
    try {
      await projects.reorderBuckets(project.id, ids);
    } catch (err) {
      toast("Failed to save column order", "error");
      loadKanban(project, container, showCompleted);
    }
  });

  // Drop target for cards
  body.addEventListener("dragover", (e) => {
    if (_dragColEl) return;  // ignore card-drop events during column drag
    e.preventDefault();
    col.classList.add("drag-over");
    if (_dragSourceBody === body) {
      // Same column: show indicator where card will land
      const afterEl = _getDragAfterEl(body, e.clientY);
      const ind = _ensureIndicator();
      const sep = body.querySelector(".col-done-sep");
      const addInline = body.querySelector(".add-task-inline");
      afterEl ? body.insertBefore(ind, afterEl) : body.insertBefore(ind, sep || addInline || null);
    }
  });
  col.addEventListener("dragleave", (e) => {
    if (!col.contains(e.relatedTarget)) {
      col.classList.remove("drag-over");
      const ind = _ensureIndicator();
      if (body.contains(ind)) ind.remove();
    }
  });
  body.addEventListener("drop", async (e) => {
    if (_dragColEl) return;  // column drag handled above
    e.preventDefault();
    col.classList.remove("drag-over");
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;

    if (_dragSourceBody === body) {
      // Same-column reorder
      const ind = _ensureIndicator();
      const dragged = body.querySelector(`[data-task-id="${id}"]`);
      if (dragged && body.contains(ind)) {
        body.insertBefore(dragged, ind);
      }
      ind.remove();
      const ids = [...body.querySelectorAll(".task-card:not(.completed)")]
        .map(c => c.dataset.taskId).filter(Boolean);
      try {
        await tasks.reorder(ids);
      } catch (err) {
        toast(err.message, "error");
        loadKanban(project, container, showCompleted);
      }
    } else {
      // Cross-column move
      _ensureIndicator().remove();
      try {
        await tasks.update(id, { bucket_id: bucket?.id || null });
        loadKanban(project, container, showCompleted);
      } catch (err) { toast(err.message, "error"); }
    }
  });

  return col;
}

function _showColMenu(e, bucket, project, container, showCompleted) {
  document.querySelectorAll(".col-dropdown").forEach(d => d.remove());

  const menu = document.createElement("div");
  menu.className = "col-dropdown";
  menu.innerHTML = `
    <button class="col-dropdown-item" data-action="rename">✎ Rename</button>
    <button class="col-dropdown-item danger" data-action="delete">🗑 Delete column</button>`;
  document.body.appendChild(menu);

  const rect    = e.currentTarget.getBoundingClientRect();
  const menuH   = 80;
  const spaceB  = window.innerHeight - rect.bottom - 4;
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 180)}px`;
  menu.style.top  = spaceB >= menuH
    ? `${rect.bottom + 4}px`
    : `${Math.max(4, rect.top - menuH - 4)}px`;

  const close = () => menu.remove();
  setTimeout(() => document.addEventListener("click", close, { once: true }), 0);

  menu.querySelector('[data-action="rename"]').addEventListener("click", async () => {
    close();
    const name = await showPrompt("New column name:", bucket.name);
    if (!name?.trim() || name.trim() === bucket.name) return;
    try {
      await buckets.update(bucket.id, { name: name.trim() });
      toast("Renamed", "success");
      loadKanban(project, container, showCompleted);
    } catch (err) { toast(err.message, "error"); }
  });

  menu.querySelector('[data-action="delete"]').addEventListener("click", async () => {
    close();
    if (!await showConfirm(`Delete column "${bucket.name}"? Tasks will become unsorted.`, { confirmText: "Delete", danger: true })) return;
    try {
      await buckets.delete(bucket.id);
      toast("Column deleted", "success");
      loadKanban(project, container, showCompleted);
    } catch (err) { toast(err.message, "error"); }
  });
}

function _card(task, project, allBuckets, container, showCompleted, readOnly = false) {
  const card = document.createElement("div");
  card.className = `task-card priority-${task.priority}${task.completed_at ? " completed" : ""}`;
  card.draggable = !task.completed_at && !readOnly;
  card.dataset.taskId = task.id;

  const dueInfo = task.completed_at
    ? formatCompleted(task.completed_at)
    : (task.due_at ? formatDue(task.due_at) : null);

  const priorityLabel = task.priority === "high" ? "⬆ High" : task.priority === "low" ? "⬇ Low" : "";
  const subtaskTotal  = task.subtasks?.length ?? 0;
  const subtaskDone   = subtaskTotal ? task.subtasks.filter(s => s.completed_at).length : 0;

  card.innerHTML = `
    ${readOnly ? "" : `<div class="task-check${task.completed_at ? " done" : ""}"></div>`}
    <div class="task-body">
      <div class="task-title">
        <span class="task-title-text">${esc(task.title)}</span>
        ${subtaskTotal ? `<span class="task-sub-badge">${subtaskDone}/${subtaskTotal}</span>` : ""}
        ${dueInfo ? `<span class="task-due ${dueInfo.cls}">${dueInfo.text}</span>` : ""}
        ${priorityLabel ? `<span class="task-priority-chip ${task.priority}">${priorityLabel}</span>` : ""}
      </div>
    </div>
    ${readOnly ? "" : `<button class="card-move-btn" title="Move to column" aria-label="Move task">⇄</button>`}`;

  if (readOnly) return card;

  let _dragged = false;
  card.addEventListener("dragstart", (e) => {
    _dragged = true;
    _dragCard = card;
    _dragSourceBody = card.closest(".col-tasks");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.id);
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    _dragCard = null;
    _dragSourceBody = null;
    _ensureIndicator().remove();
    document.querySelectorAll(".kanban-col.drag-over").forEach(c => c.classList.remove("drag-over"));
    setTimeout(() => { _dragged = false; }, 60);
  });

  card.querySelector(".task-check").addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      if (task.completed_at) {
        await tasks.uncomplete(task.id);
        toast("Reopened", "success");
        loadKanban(project, container, showCompleted);
      } else {
        await tasks.complete(task.id);
        toast("Done ✓", "success");
        card.remove();
        window.dispatchEvent(new CustomEvent("tasks:changed"));
      }
    } catch (err) { toast(err.message, "error"); }
  });

  card.querySelector(".card-move-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    _showMovePicker(task, project, allBuckets, container, showCompleted);
  });
  card.addEventListener("click", (e) => {
    if (_dragged || e.target.closest(".task-check") || e.target.closest(".card-move-btn")) return;
    openTaskDetail(task.id, () => loadKanban(project, container, showCompleted));
  });
  return card;
}

function _showMovePicker(task, project, allBuckets, container, showCompleted) {
  const cols = [{ id: null, name: "Unsorted" }, ...allBuckets]
    .filter(c => (c.id ?? null) !== (task.bucket_id ?? null));

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <p class="move-picker-title">Move to…</p>
      <div class="move-picker-list">
        ${cols.map(c => `
          <button class="move-picker-item" data-id="${c.id ?? ""}">
            <span class="move-picker-icon">›</span>${esc(c.name)}
          </button>`).join("")}
      </div>
      <button class="btn btn-ghost" style="width:100%;margin-top:12px">Cancel</button>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));

  const close = () => {
    overlay.classList.remove("open");
    setTimeout(() => overlay.remove(), 240);
  };

  overlay.querySelector(".btn-ghost").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  overlay.querySelectorAll(".move-picker-item").forEach(btn => {
    btn.addEventListener("click", async () => {
      const bucketId = btn.dataset.id === "" ? null : btn.dataset.id;
      close();
      try {
        await tasks.update(task.id, { bucket_id: bucketId });
        toast("Moved", "success");
        loadKanban(project, container, showCompleted);
      } catch (err) { toast(err.message, "error"); }
    });
  });
}

function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
