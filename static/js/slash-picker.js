/** Slash-command "/" project picker for quick-add inputs. */

function _flatProjects(tree, out = []) {
  for (const p of tree) {
    out.push({ id: p.id, name: p.name });
    if (p.children?.length) _flatProjects(p.children, out);
  }
  return out;
}

/**
 * Attach a "/" project-picker to an input or textarea.
 * getProjectTreeFn() returns a Promise<ProjectNode[]> (same shape as projects.list()).
 * Returns { getProjectId(), getStrippedInput(), reset() }.
 */
export function attachSlashPicker(inputEl, getProjectTreeFn) {
  let _selectedId    = null;
  let _selectedToken = null;
  let _picker        = null;
  let _activeIdx     = -1;
  let _cache         = null;

  async function _getFlat() {
    if (!_cache) _cache = _flatProjects(await getProjectTreeFn());
    return _cache;
  }

  function _close() {
    _picker?.remove(); _picker = null; _activeIdx = -1;
  }

  // Returns the "/" token immediately before the cursor, or null.
  function _getToken(val, pos) {
    const before = val.slice(0, pos);
    const m = before.match(/(^|[\s])(\/(\S*))$/);
    if (!m) return null;
    const full  = m[2];
    const query = m[3];
    const start = before.length - full.length;
    return { full, query, start, end: pos };
  }

  function _updateActive() {
    if (!_picker) return;
    [..._picker.querySelectorAll(".slash-picker-item")].forEach((el, i) =>
      el.classList.toggle("active", i === _activeIdx));
  }

  function _selectProject(project, tok) {
    const newToken = `/${project.name}`;
    const val      = inputEl.value;
    const newVal   = val.slice(0, tok.start) + newToken + val.slice(tok.end);
    inputEl.value  = newVal;
    const newPos   = tok.start + newToken.length;
    inputEl.setSelectionRange(newPos, newPos);
    _selectedId    = project.id;
    _selectedToken = newToken;
    _close();
    inputEl.focus();
    // Trigger auto-resize for textareas
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function _showPicker(matches, tok) {
    _close();
    const rect = inputEl.getBoundingClientRect();
    _picker = document.createElement("div");
    _picker.className = "slash-picker";
    Object.assign(_picker.style, {
      position: "fixed",
      zIndex:   "9999",
      top:      `${rect.bottom + 4}px`,
      left:     `${rect.left}px`,
      width:    `${Math.max(rect.width, 220)}px`,
    });

    matches.forEach(p => {
      const btn = document.createElement("button");
      btn.type      = "button";
      btn.className = "slash-picker-item";
      btn.textContent = p.name;
      btn.addEventListener("mousedown", e => { e.preventDefault(); _selectProject(p, tok); });
      _picker.appendChild(btn);
    });
    document.body.appendChild(_picker);
  }

  inputEl.addEventListener("input", async () => {
    // Clear stored selection if the user erased the token
    if (_selectedToken && !inputEl.value.includes(_selectedToken)) {
      _selectedId = null; _selectedToken = null;
    }
    const pos     = inputEl.selectionStart ?? inputEl.value.length;
    const tok     = _getToken(inputEl.value, pos);
    if (!tok) { _close(); return; }

    const all     = await _getFlat();
    const q       = tok.query.toLowerCase();
    const matches = q
      ? all.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8)
      : all.slice(0, 8);
    if (!matches.length) { _close(); return; }
    _showPicker(matches, tok);
  });

  inputEl.addEventListener("keydown", e => {
    if (!_picker) return;
    const items = [..._picker.querySelectorAll(".slash-picker-item")];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      _activeIdx = Math.min(_activeIdx + 1, items.length - 1);
      _updateActive();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      _activeIdx = Math.max(_activeIdx - 1, 0);
      _updateActive();
    } else if (e.key === "Enter" && _activeIdx >= 0) {
      e.preventDefault(); e.stopPropagation();
      items[_activeIdx].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    } else if (e.key === "Escape") {
      _close();
    }
  });

  // Close picker on outside click
  document.addEventListener("mousedown", e => {
    if (_picker && !_picker.contains(e.target)) _close();
  }, true);

  // Blur closes with a delay so a click on a picker item fires mousedown first
  inputEl.addEventListener("blur", () => setTimeout(_close, 150));

  return {
    getProjectId() { return _selectedId; },
    getStrippedInput() {
      if (!_selectedToken) return inputEl.value.trim();
      return inputEl.value.replace(_selectedToken, "").replace(/\s{2,}/g, " ").trim();
    },
    reset() { _selectedId = null; _selectedToken = null; _close(); },
    invalidateCache() { _cache = null; },
  };
}
