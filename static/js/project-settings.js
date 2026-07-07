import { projects as projectsApi, auth as authApi } from "./api.js";
import { toast, addSwipeToDismiss } from "./utils.js";
import { generateJazzicon, jazziconHue, cacheProjectSettings } from "./jazzicon.js";
import { showQRModal, drawQROnCanvas } from "./qr-modal.js";

let _project = null;
let _draft = {};
let _flatProjects = [];
let _onSave = null;
let _overlay = null;

function _getDescendantIds(id, flat) {
  const result = [];
  for (const p of flat.filter(x => x.parent_id === id)) {
    result.push(p.id);
    result.push(..._getDescendantIds(p.id, flat));
  }
  return result;
}

function _syncDraftCache() {
  cacheProjectSettings([{ id: _project.id, color_hue: _draft.color_hue, icon_seed: _draft.icon_seed }]);
}

function _refreshIconPreview(wrap) {
  wrap.innerHTML = "";
  wrap.appendChild(generateJazzicon(_project.id, 72));
}

function _refreshQR(canvas) {
  drawQROnCanvas(canvas, _project, 180);
}

export function openProjectSettings(project, flatProjects, { onSave } = {}) {
  _project = project;
  _draft = { color_hue: project.color_hue ?? null, icon_seed: project.icon_seed ?? null };
  _flatProjects = flatProjects;
  _onSave = onSave ?? null;

  document.getElementById("ps-modal-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "ps-modal-overlay";
  overlay.className = "modal-overlay";

  const sheet = document.createElement("div");
  sheet.className = "modal";

  const title = document.createElement("div");
  title.className = "modal-title";
  title.textContent = "Project Settings";

  const iconSection = document.createElement("div");
  iconSection.className = "ps-icon-section";

  const iconWrap = document.createElement("div");
  iconWrap.className = "ps-icon-wrap";
  _syncDraftCache();
  iconWrap.appendChild(generateJazzicon(_project.id, 72));

  const iconControls = document.createElement("div");
  iconControls.className = "ps-icon-controls";

  const newIconBtn = document.createElement("button");
  newIconBtn.type = "button";
  newIconBtn.className = "btn btn-ghost btn-sm";
  newIconBtn.textContent = "⟳ New icon";
  newIconBtn.addEventListener("click", () => {
    _draft.icon_seed = Math.floor(Math.random() * 1e6) + 1;
    _syncDraftCache();
    _refreshIconPreview(iconWrap);
    _refreshQR(qrCanvas);
  });

  iconControls.appendChild(newIconBtn);
  iconSection.append(iconWrap, iconControls);

  const nameGroup = document.createElement("div");
  nameGroup.className = "form-group";
  const nameLabel = document.createElement("label");
  nameLabel.className = "form-label";
  nameLabel.textContent = "Name";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "";
  nameInput.value = _project.name;
  nameGroup.append(nameLabel, nameInput);

  const colourGroup = document.createElement("div");
  colourGroup.className = "form-group";
  const colourLabel = document.createElement("label");
  colourLabel.className = "form-label";
  colourLabel.textContent = "Colour";

  const hueRow = document.createElement("div");
  hueRow.className = "ps-hue-row";

  const swatch = document.createElement("div");
  swatch.className = "ps-hue-swatch";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "359";
  slider.className = "ps-hue-slider";

  const autoBtn = document.createElement("button");
  autoBtn.type = "button";
  autoBtn.className = "ps-auto-btn";
  autoBtn.textContent = "Auto";

  const currentHue = _draft.color_hue != null ? _draft.color_hue : Math.round(jazziconHue(_project.id));
  slider.value = String(currentHue);
  swatch.style.background = `hsl(${currentHue}, 70%, 55%)`;
  autoBtn.style.display = _draft.color_hue != null ? "" : "none";

  slider.addEventListener("input", () => {
    const h = parseInt(slider.value, 10);
    _draft.color_hue = h;
    swatch.style.background = `hsl(${h}, 70%, 55%)`;
    autoBtn.style.display = "";
    _syncDraftCache();
    _refreshIconPreview(iconWrap);
    _refreshQR(qrCanvas);
  });

  autoBtn.addEventListener("click", () => {
    _draft.color_hue = null;
    _syncDraftCache();
    const computed = Math.round(jazziconHue(_project.id));
    slider.value = String(computed);
    swatch.style.background = `hsl(${computed}, 70%, 55%)`;
    autoBtn.style.display = "none";
    _refreshIconPreview(iconWrap);
    _refreshQR(qrCanvas);
  });

  hueRow.append(swatch, slider, autoBtn);
  colourGroup.append(colourLabel, hueRow);

  const parentGroup = document.createElement("div");
  parentGroup.className = "form-group";
  const parentLabel = document.createElement("label");
  parentLabel.className = "form-label";
  parentLabel.textContent = "Parent project";
  const parentSelect = document.createElement("select");
  parentSelect.className = "form-select";

  const rootOpt = document.createElement("option");
  rootOpt.value = "";
  rootOpt.textContent = "— Root project —";
  if (!_project.parent_id) rootOpt.selected = true;
  parentSelect.appendChild(rootOpt);

  const excludedIds = new Set([_project.id, ..._getDescendantIds(_project.id, _flatProjects)]);
  for (const p of _flatProjects) {
    if (excludedIds.has(p.id)) continue;
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === _project.parent_id) opt.selected = true;
    parentSelect.appendChild(opt);
  }
  parentGroup.append(parentLabel, parentSelect);

  const isOwner = _project.my_role === "owner";

  // ── Members section ───────────────────────────────────────────────
  const memberSection = document.createElement("div");
  memberSection.className = "ps-share-section";

  const memberTitle = document.createElement("div");
  memberTitle.className = "ps-section-title";
  memberTitle.textContent = "Members";
  memberSection.appendChild(memberTitle);

  const memberList = document.createElement("div");
  memberList.className = "ps-member-list";
  memberSection.appendChild(memberList);

  function _renderMembers() {
    memberList.innerHTML = "";
    const members = _project.members || [];
    if (!members.length) {
      memberList.innerHTML = `<div class="ps-member-empty">No shared members yet</div>`;
    }
    members.forEach(m => {
      const row = document.createElement("div");
      row.className = "ps-member-row";
      const name = document.createElement("span");
      name.className = "ps-member-name";
      name.textContent = m.username;

      if (isOwner) {
        const roleSel = document.createElement("select");
        roleSel.className = "ps-member-role-sel";
        ["viewer","contributor","owner"].forEach(r => {
          const o = document.createElement("option");
          o.value = r; o.textContent = r;
          if (r === m.role) o.selected = true;
          roleSel.appendChild(o);
        });
        roleSel.addEventListener("change", async () => {
          try {
            await projectsApi.updateMember(_project.id, m.user_id, roleSel.value);
            m.role = roleSel.value;
            toast("Role updated", "success");
          } catch (err) { toast(err.message, "error"); roleSel.value = m.role; }
        });

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "btn btn-ghost btn-sm ps-member-remove";
        removeBtn.textContent = "✕";
        removeBtn.title = "Remove member";
        removeBtn.addEventListener("click", async () => {
          if (!confirm(`Remove ${m.username} from this project?`)) return;
          try {
            await projectsApi.removeMember(_project.id, m.user_id);
            _project.members = _project.members.filter(x => x.user_id !== m.user_id);
            _renderMembers();
            toast("Member removed", "success");
          } catch (err) { toast(err.message, "error"); }
        });
        row.append(name, roleSel, removeBtn);
      } else {
        const roleBadge = document.createElement("span");
        roleBadge.className = "ps-member-role-badge";
        roleBadge.textContent = m.role;
        row.append(name, roleBadge);
      }
      memberList.appendChild(row);
    });
  }
  _renderMembers();

  if (isOwner) {
    const addRow = document.createElement("div");
    addRow.className = "ps-member-add-row";

    const userSelect = document.createElement("select");
    userSelect.className = "ps-member-user-sel";
    const loadingOpt = document.createElement("option");
    loadingOpt.textContent = "Loading users…";
    loadingOpt.disabled = true;
    loadingOpt.selected = true;
    userSelect.appendChild(loadingOpt);

    const roleSelect = document.createElement("select");
    roleSelect.className = "ps-member-role-sel";
    ["viewer","contributor","owner"].forEach(r => {
      const o = document.createElement("option");
      o.value = r; o.textContent = r;
      if (r === "contributor") o.selected = true;
      roleSelect.appendChild(o);
    });

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn-ghost btn-sm ps-add-btn";
    addBtn.textContent = "+ Add";

    addBtn.addEventListener("click", async () => {
      const username = userSelect.value;
      if (!username || userSelect.selectedIndex === 0) { toast("Pick a user first", "error"); return; }
      try {
        const member = await projectsApi.addMember(_project.id, { username, role: roleSelect.value });
        _project.members = [...(_project.members || []), member];
        _renderMembers();
        // remove added user from the select
        const opt = [...userSelect.options].find(o => o.value === username);
        if (opt) opt.remove();
        userSelect.selectedIndex = 0;
        toast(`${member.username} added`, "success");
      } catch (err) { toast(err.message, "error"); }
    });

    addRow.append(userSelect, roleSelect, addBtn);
    memberSection.appendChild(addRow);

    // Load users async and populate select
    authApi.users().then(users => {
      userSelect.innerHTML = "";
      const existingIds = new Set((_project.members || []).map(m => m.user_id));
      const available = users.filter(u => !existingIds.has(u.id));
      if (!available.length) {
        const o = document.createElement("option");
        o.textContent = "No users to add";
        o.disabled = true; o.selected = true;
        userSelect.appendChild(o);
        addBtn.disabled = true;
        return;
      }
      const placeholder = document.createElement("option");
      placeholder.textContent = "Select user…";
      placeholder.disabled = true; placeholder.selected = true; placeholder.value = "";
      userSelect.appendChild(placeholder);
      available.forEach(u => {
        const o = document.createElement("option");
        o.value = u.username; o.textContent = u.username;
        userSelect.appendChild(o);
      });
    }).catch(() => {
      userSelect.innerHTML = "";
      const o = document.createElement("option");
      o.textContent = "Failed to load users"; o.disabled = true; o.selected = true;
      userSelect.appendChild(o);
    });
  }

  // ── Share / QR section ────────────────────────────────────────────
  const shareSection = document.createElement("div");
  shareSection.className = "ps-share-section";

  const shareTitle = document.createElement("div");
  shareTitle.className = "ps-section-title";
  shareTitle.textContent = "Public board (view-only)";

  const qrWrap = document.createElement("div");
  qrWrap.className = "ps-qr-wrap";

  const qrCanvas = document.createElement("canvas");
  qrCanvas.className = "ps-qr-canvas";
  qrWrap.appendChild(qrCanvas);

  const shareBtns = document.createElement("div");
  shareBtns.className = "ps-share-btns";

  const publicUrl = _project.public_token
    ? `${window.location.origin}/board/${_project.public_token}`
    : `${window.location.origin}/projects/${_project.id}`;

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn btn-ghost btn-sm";
  copyBtn.textContent = "📋 Copy link";
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(publicUrl)
      .then(() => toast("View-only link copied", "success"))
      .catch(() => toast("Copy failed", "error"));
  });

  const openQRBtn = document.createElement("button");
  openQRBtn.type = "button";
  openQRBtn.className = "btn btn-ghost btn-sm";
  openQRBtn.textContent = "↗ Open QR";
  openQRBtn.addEventListener("click", () => showQRModal(_project));

  shareBtns.append(copyBtn, openQRBtn);
  shareSection.append(shareTitle, qrWrap, shareBtns);

  const dangerSection = document.createElement("div");
  dangerSection.className = "ps-danger-section";

  const archiveBtn = document.createElement("button");
  archiveBtn.type = "button";
  archiveBtn.className = "btn btn-danger btn-sm";
  archiveBtn.style.width = "100%";
  archiveBtn.textContent = "Archive project";
  archiveBtn.addEventListener("click", async () => {
    if (!confirm(`Archive "${_project.name}"?\nIt will be hidden from the grid.`)) return;
    try {
      await projectsApi.archive(_project.id);
      toast("Project archived", "success");
      _close();
      if (_onSave) _onSave(null);
    } catch (err) {
      toast(err.message, "error");
    }
  });

  dangerSection.appendChild(archiveBtn);

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-ghost btn-sm";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    cacheProjectSettings([_project]);
    _close();
  });

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", async () => {
    const patch = {};
    const newName = nameInput.value.trim();
    if (newName && newName !== _project.name) patch.name = newName;
    const newParent = parentSelect.value || null;
    if (newParent !== (_project.parent_id ?? null)) patch.parent_id = newParent;
    if (_draft.color_hue !== (_project.color_hue ?? null)) patch.color_hue = _draft.color_hue;
    if (_draft.icon_seed !== (_project.icon_seed ?? null)) patch.icon_seed = _draft.icon_seed;

    if (!Object.keys(patch).length) { _close(); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = "…";
    try {
      const updated = await projectsApi.update(_project.id, patch);
      cacheProjectSettings([updated]);
      toast("Saved", "success");
      _close();
      if (_onSave) _onSave(updated);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });

  actions.append(cancelBtn, saveBtn);

  // Non-owners: disable name/color/icon/parent editing
  if (!isOwner) {
    nameInput.disabled = true;
    slider.disabled = true;
    autoBtn.disabled = true;
    newIconBtn.disabled = true;
    parentSelect.disabled = true;
    saveBtn.style.display = "none";
    archiveBtn.style.display = "none";
  }

  sheet.append(title, iconSection, nameGroup, colourGroup, parentGroup, memberSection, shareSection, dangerSection, actions);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      cacheProjectSettings([_project]);
      _close();
    }
  });
  addSwipeToDismiss(overlay, sheet, () => { cacheProjectSettings([_project]); _close(); });

  _overlay = overlay;
  requestAnimationFrame(() => {
    overlay.classList.add("open");
    _refreshQR(qrCanvas);
  });
}

function _close() {
  if (!_overlay) return;
  _overlay.classList.remove("open");
  setTimeout(() => { _overlay?.remove(); _overlay = null; }, 240);
}
