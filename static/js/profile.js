/** Profile / settings bottom-sheet */
import { auth } from "./api.js";
import { toast, setDisplayTimezone, showConfirm } from "./utils.js";
import { getTimezoneGroups } from "./timezones.js";

let _user    = null;
let _onSaved = null;
let _ready   = false;

/** Call once after login to register the save callback. */
export function initProfile(onSaved) {
  _onSaved = onSaved;
}

/** Open the sheet for a given user. Sets up DOM listeners on first call. */
export function openProfile(user) {
  if (!user) { console.warn("openProfile: no user"); return; }
  _user = user;
  _ensureReady();

  const el = (id) => document.getElementById(id);
  el("profile-username").textContent = user.username;
  el("profile-email").textContent    = user.email;
  el("profile-tz").value             = user.timezone || "Europe/Vienna";
  el("profile-ha").value             = user.ha_notify_service || "";
  _showToken(user.api_token);
  el("profile-overlay").classList.add("open");
}

// ── Lazy init — runs on first openProfile call ────────────────────
function _ensureReady() {
  if (_ready) return;
  _ready = true;

  const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);

  on("profile-overlay", "click",  (e) => { if (e.target === e.currentTarget) _close(); });
  on("profile-cancel",  "click",  _close);
  on("profile-save",    "click",  _save);
  on("profile-form",    "submit", (e) => { e.preventDefault(); _save(); });
  on("btn-rotate-token","click",  _rotate);
  on("btn-copy-token",  "click",  _copy);
  on("btn-toggle-token","click",  _toggle);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("profile-overlay")?.classList.contains("open"))
      _close();
  });

  _buildTzSelect();
}

// ── Actions ───────────────────────────────────────────────────────
function _close() {
  document.getElementById("profile-overlay").classList.remove("open");
}

async function _save() {
  const tz = document.getElementById("profile-tz").value;
  const ha = document.getElementById("profile-ha").value.trim() || null;
  const btn = document.getElementById("profile-save");
  btn.disabled = true; btn.textContent = "…";
  try {
    const updated = await auth.updateMe({ timezone: tz, ha_notify_service: ha });
    _user = updated;
    setDisplayTimezone(tz);
    _close();
    toast("Settings saved ✓", "success");
    _onSaved?.(updated);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Save";
  }
}

async function _rotate() {
  if (!await showConfirm("Generate a new token? The old one stops working immediately.", { confirmText: "Generate", danger: true })) return;
  const btn = document.getElementById("btn-rotate-token");
  btn.disabled = true;
  try {
    const data = await auth.rotateToken();
    if (_user) _user.api_token = data.api_token;
    _showToken(data.api_token);
    toast("New token generated", "success");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

function _copy() {
  const token = _user?.api_token;
  if (!token) { toast("Generate a token first", "error"); return; }
  if (navigator.clipboard) {
    navigator.clipboard.writeText(token)
      .then(() => toast("Token copied ✓", "success"))
      .catch(() => _copyFallback(token));
  } else {
    _copyFallback(token);
  }
}

function _copyFallback(token) {
  const el = document.getElementById("token-display");
  el.type = "text"; el.select();
  document.execCommand("copy");
  el.type = "password";
  toast("Token copied ✓", "success");
}

function _toggle() {
  const el  = document.getElementById("token-display");
  const btn = document.getElementById("btn-toggle-token");
  if (el.type === "password") { el.type = "text";     btn.textContent = "🙈"; }
  else                        { el.type = "password"; btn.textContent = "👁"; }
}

// ── Token display ─────────────────────────────────────────────────
function _showToken(token) {
  const display   = document.getElementById("token-display");
  const noToken   = document.getElementById("token-none");
  const actions   = document.getElementById("token-actions");
  const toggleBtn = document.getElementById("btn-toggle-token");
  const rotateBtn = document.getElementById("btn-rotate-token");

  if (token) {
    display.value           = token;
    display.type            = "password";
    display.style.display   = "block";
    toggleBtn.textContent   = "👁";
    toggleBtn.style.display = "";
    actions.style.display   = "flex";
    noToken.style.display   = "none";
    rotateBtn.textContent   = "↻ Rotate token";
  } else {
    display.style.display   = "none";
    toggleBtn.style.display = "none";
    actions.style.display   = "none";
    noToken.style.display   = "block";
    rotateBtn.textContent   = "Generate token";
  }
}

// ── Timezone select ───────────────────────────────────────────────
function _buildTzSelect() {
  const sel = document.getElementById("profile-tz");
  if (!sel) return;
  sel.innerHTML = "";
  try {
    for (const { group, zones } of getTimezoneGroups()) {
      const grp = document.createElement("optgroup"); grp.label = group;
      zones.forEach(({ value, label }) => {
        const o = document.createElement("option"); o.value = value; o.textContent = label;
        grp.appendChild(o);
      });
      sel.appendChild(grp);
    }
  } catch (err) {
    console.error("Failed to build timezone list:", err);
  }
}
