/**
 * Shared task-edit bottom-sheet modal — v4
 * openTaskDetail(taskId, onDone?) from any tab.
 */
import { tasks, projects } from "./api.js";
import { toast, toastUndo, utcToLocalInput, localInputToISO, addSwipeToDismiss, showConfirm } from "./utils.js";

let _taskId  = null;
let _onDone  = null;
let _ready   = false;

export function initTaskDetail() {
  if (_ready) return;
  _ready = true;

  const overlay = document.getElementById("tdet-overlay");
  if (!overlay) { console.error("tdet-overlay not found"); return; }

  overlay.addEventListener("click",  (e) => { if (e.target === overlay) _close(); });
  const sheet = overlay.querySelector(".modal");
  if (sheet) addSwipeToDismiss(overlay, sheet, _close);
  document.getElementById("tdet-close")?.addEventListener("click",  _close);
  document.getElementById("tdet-cancel").addEventListener("click",  _close);
  document.getElementById("tdet-save").addEventListener("click",    _save);
  document.getElementById("tdet-delete").addEventListener("click",  _delete);
  document.getElementById("tdet-form").addEventListener("submit",   (e) => { e.preventDefault(); _save(); });
  document.getElementById("tdet-clear-due")?.addEventListener("click", () => {
    document.getElementById("tdet-due").value = "";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) _close();
  });
}

export async function openTaskDetail(taskId, onDone) {
  if (!_ready) initTaskDetail();

  _taskId = taskId;
  _onDone = onDone ?? null;

  const overlay = document.getElementById("tdet-overlay");
  overlay.classList.add("open");

  // Always start at top so title is visible first
  const modal = overlay.querySelector(".modal");
  if (modal) modal.scrollTop = 0;

  try {
    const [task, tree] = await Promise.all([
      tasks.get(taskId),
      projects.list().catch(() => []),
    ]);
    _fill(task, tree);
  } catch (err) {
    toast(`Could not load task: ${err.message}`, "error");
    _close();
  }
}

function _fill(task, tree) {
  const allProjects = tree;
  document.getElementById("tdet-title").value    = task.title;
  document.getElementById("tdet-notes").value    = task.notes ?? "";
  document.getElementById("tdet-priority").value = task.priority ?? "normal";
  document.getElementById("tdet-due").value      = utcToLocalInput(task.due_at);
  const recEl = document.getElementById("tdet-recurrence");
  if (recEl) recEl.value = task.recurrence?.freq ?? "";

  const sel = document.getElementById("tdet-project");
  sel.innerHTML = `<option value="">📥 Inbox (no project)</option>`;
  function _addProjectOpts(nodes, depth) {
    nodes.forEach(p => {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = depth > 0 ? `${'  '.repeat(depth)}└ ${p.name}` : p.name;
      if (p.id === task.project_id) o.selected = true;
      sel.appendChild(o);
      if (p.children?.length) _addProjectOpts(p.children, depth + 1);
    });
  }
  _addProjectOpts(allProjects, 0);

  _renderSubtasks(task);

}

function _renderSubtasks(task) {
  const list  = document.getElementById("tdet-subtasks-list");
  if (!list) return;
  list.innerHTML = "";

  const all  = task.subtasks ?? [];
  const open = all.filter(s => !s.completed_at);
  const done = all.filter(s =>  s.completed_at);
  [...open, ...done].forEach(s => _appendSubtaskRow(list, s));
  _updateSubtaskCount(all.length, done.length);

  // Replace input to clear old listeners
  const old = document.getElementById("tdet-subtask-input");
  if (!old) return;
  const inp = old.cloneNode(true);
  old.replaceWith(inp);
  inp.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const val = inp.value.trim();
    if (!val) return;
    inp.disabled = true;
    try {
      const sub = await tasks.create({
        raw_input: val,
        parent_task_id: task.id,
        project_id: task.project_id || null,
      });
      inp.value = "";
      _appendSubtaskRow(list, sub);
      const rows = list.querySelectorAll(".subtask-row");
      const doneCt = list.querySelectorAll(".subtask-check.done").length;
      _updateSubtaskCount(rows.length, doneCt);
      window.dispatchEvent(new CustomEvent("tasks:changed"));
    } catch (err) { toast(err.message, "error"); }
    finally { inp.disabled = false; inp.focus(); }
  });
}

function _appendSubtaskRow(list, sub) {
  const row   = document.createElement("div");
  row.className = "subtask-row";
  const done  = !!sub.completed_at;
  row.innerHTML = `
    <div class="subtask-check ${done ? "done" : ""}"></div>
    <span class="subtask-title ${done ? "done" : ""}">${_esc(sub.title)}</span>
    <button class="subtask-del" type="button" title="Delete subtask">✕</button>`;

  row.querySelector(".subtask-check").addEventListener("click", async (e) => {
    const check  = e.currentTarget;
    const isDone = check.classList.contains("done");
    try {
      if (isDone) {
        await tasks.uncomplete(sub.id);
        check.classList.remove("done");
        row.querySelector(".subtask-title").classList.remove("done");
      } else {
        await tasks.complete(sub.id);
        check.classList.add("done");
        row.querySelector(".subtask-title").classList.add("done");
      }
      const l      = document.getElementById("tdet-subtasks-list");
      const doneCt = l.querySelectorAll(".subtask-check.done").length;
      _updateSubtaskCount(l.querySelectorAll(".subtask-row").length, doneCt);
      window.dispatchEvent(new CustomEvent("tasks:changed"));
    } catch (err) { toast(err.message, "error"); }
  });

  row.querySelector(".subtask-del").addEventListener("click", () => {
    // No undelete endpoint exists, so soft-delete client-side: hide the row
    // immediately but delay the actual API call so an accidental tap can
    // still be undone via the toast.
    row.style.display = "none";
    const refreshCount = () => {
      const l    = document.getElementById("tdet-subtasks-list");
      const rows = [...l.querySelectorAll(".subtask-row")].filter(r => r.style.display !== "none");
      const doneCt = rows.filter(r => r.querySelector(".subtask-check").classList.contains("done")).length;
      _updateSubtaskCount(rows.length, doneCt);
    };
    refreshCount();

    let undone = false;
    toastUndo("Sub-task deleted", () => {
      undone = true;
      row.style.display = "";
      refreshCount();
    });

    setTimeout(async () => {
      if (undone) return;
      try {
        await tasks.delete(sub.id);
        row.remove();
        window.dispatchEvent(new CustomEvent("tasks:changed"));
      } catch (err) {
        toast(err.message, "error");
        row.style.display = "";
        refreshCount();
      }
    }, 5000);
  });

  list.appendChild(row);
}

function _updateSubtaskCount(total, done) {
  const el = document.getElementById("tdet-subtasks-count");
  if (!el) return;
  if (total === 0) { el.textContent = ""; el.style.display = "none"; }
  else { el.textContent = `${done}/${total}`; el.style.display = ""; }
}

function _esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function _save() {
  const title = document.getElementById("tdet-title").value.trim();
  if (!title) {
    document.getElementById("tdet-title").focus();
    return;
  }

  const btn = document.getElementById("tdet-save");
  btn.disabled    = true;
  btn.textContent = "…";

  try {
    const dueLocal = document.getElementById("tdet-due").value;
    const freq     = document.getElementById("tdet-recurrence")?.value ?? "";
    await tasks.update(_taskId, {
      title,
      notes:      document.getElementById("tdet-notes").value.trim() || null,
      priority:   document.getElementById("tdet-priority").value,
      project_id: document.getElementById("tdet-project").value || null,
      due_at:     localInputToISO(dueLocal),
      recurrence: freq ? { freq, interval: 1 } : null,
    });
    _close();
    toast("Saved ✓", "success");
    window.dispatchEvent(new CustomEvent("tasks:changed"));
    _onDone?.();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled    = false;
    btn.textContent = "Save";
  }
}

async function _delete() {
  if (!await showConfirm("Delete this task?", { confirmText: "Delete", danger: true })) return;
  try {
    await tasks.delete(_taskId);
    _close();
    toast("Deleted", "success");
    window.dispatchEvent(new CustomEvent("tasks:changed"));
    _onDone?.();
  } catch (err) {
    toast(err.message, "error");
  }
}

function _close() {
  document.getElementById("tdet-overlay").classList.remove("open");
  _taskId = null;
}

function _flat(tree, acc = []) {
  tree.forEach(p => { acc.push(p); if (p.children?.length) _flat(p.children, acc); });
  return acc;
}
