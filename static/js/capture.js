/** Capture tab — v4 */
import { tasks, projects } from "./api.js";
import { toast } from "./utils.js";

let _debounce = null;
let _initialized = false;

export async function initCapture() {
  if (_initialized) return;
  _initialized = true;

  const input   = document.getElementById("capture-input");
  const submit  = document.getElementById("capture-submit");
  const preview = document.getElementById("capture-preview");
  const preTitle= document.getElementById("preview-title");
  const preDate = document.getElementById("preview-date");
  const projSel = document.getElementById("capture-project");

  // Load project list
  try {
    const tree = await projects.list();
    projSel.innerHTML = `<option value="">📥 Inbox</option>`;
    _populate(projSel, tree, 0);
  } catch { /* non-fatal */ }

  // Auto-resize textarea
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  });

  // Live NLP preview (debounced)
  input.addEventListener("input", () => {
    clearTimeout(_debounce);
    const val = input.value.trim();
    if (!val) { preview.style.display = "none"; return; }
    _debounce = setTimeout(async () => {
      try {
        const p = await tasks.preview(val);
        preTitle.textContent = p.title || val;
        preDate.textContent  = p.due_at
          ? `📅 ${new Date(p.due_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
          : "";
        preview.style.display = "block";
      } catch { preview.style.display = "none"; }
    }, 380);
  });

  // Enter to submit, Shift+Enter for newline
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); _doSubmit(); }
  });
  submit.addEventListener("click", _doSubmit);

  async function _doSubmit() {
    const val = input.value.trim();
    if (!val) return;
    submit.disabled    = true;
    submit.textContent = "…";
    try {
      await tasks.create({ raw_input: val, project_id: projSel.value || null });
      input.value        = "";
      input.style.height = "auto";
      preview.style.display = "none";
      toast("Task captured ✓", "success");
      input.focus();
      window.dispatchEvent(new CustomEvent("tasks:changed"));
    } catch (err) {
      toast(err.message, "error");
    } finally {
      submit.disabled    = false;
      submit.textContent = "Add";
    }
  }

}

function _populate(sel, tree, depth) {
  tree.forEach(p => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = "  ".repeat(depth) + p.name;
    sel.appendChild(o);
    if (p.children?.length) _populate(sel, p.children, depth + 1);
  });
}
