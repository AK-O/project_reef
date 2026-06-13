/** Shared UI utilities — v4 */

// Timezone for due-date display. Set to user's IANA zone after login.
// Falls back to Europe/Vienna (never raw UTC) so dates always feel local.
let _tz = (() => {
  const b = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (b && b !== "UTC") ? b : "Europe/Vienna";
})();

export function setDisplayTimezone(tz) {
  if (tz && tz !== "UTC") _tz = tz;
}

export function getDisplayTimezone() { return _tz; }

export function toast(msg, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3000);
}

export function formatCompleted(isoString) {
  if (!isoString) return null;
  const d   = new Date(isoString);
  const fmt = (opts) => new Intl.DateTimeFormat("default", { timeZone: _tz, ...opts }).format(d);
  return { text: `Done · ${fmt({ month: "short", day: "numeric" })} ${fmt({ hour: "2-digit", minute: "2-digit" })}`, cls: "completed" };
}

export function toastUndo(msg, onUndo, duration = 5000) {
  const el = document.getElementById("undo-toast");
  if (!el) return;
  el.querySelector(".undo-msg").textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  const btn = el.querySelector(".undo-btn");
  const newBtn = btn.cloneNode(true);
  btn.replaceWith(newBtn);
  newBtn.addEventListener("click", () => {
    clearTimeout(el._t);
    el.classList.remove("show");
    onUndo();
  });
  el._t = setTimeout(() => el.classList.remove("show"), duration);
}

export function formatDue(isoString) {
  if (!isoString) return null;
  const d   = new Date(isoString);
  const now = new Date();

  const fmt  = (date, opts) =>
    new Intl.DateTimeFormat("default", { timeZone: _tz, ...opts }).format(date);
  const ymd  = (date) =>
    fmt(date, { year: "numeric", month: "2-digit", day: "2-digit" });
  const time = fmt(d, { hour: "2-digit", minute: "2-digit" });

  if (d < now) {
    return { text: `Overdue · ${fmt(d, { month: "short", day: "numeric" })} ${time}`, cls: "overdue" };
  }
  if (ymd(d) === ymd(now)) {
    return { text: `Today ${time}`, cls: "today" };
  }
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (ymd(d) === ymd(tomorrow)) {
    return { text: `Tomorrow ${time}`, cls: "" };
  }
  return { text: `${fmt(d, { month: "short", day: "numeric" })} ${time}`, cls: "" };
}

// Convert UTC ISO string → value for <input type="datetime-local"> in user's tz
export function utcToLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  // Get local parts in user's timezone
  const fmt = (opts) => new Intl.DateTimeFormat("en-CA", { timeZone: _tz, ...opts }).format(d);
  const date = fmt({ year: "numeric", month: "2-digit", day: "2-digit" });
  const time = fmt({ hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date}T${time}`;
}

// Convert datetime-local value (treated as user's tz) → UTC ISO string
export function localInputToISO(localStr) {
  if (!localStr) return null;
  // Parse the input as if it's in the user's timezone
  const [datePart, timePart] = localStr.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, min] = timePart.split(":").map(Number);

  // Use Temporal-style approach: create a string with explicit offset
  // We find the offset for this specific datetime in the user's timezone
  const approxUtc = new Date(Date.UTC(year, month - 1, day, hour, min));
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: _tz,
    hour: "2-digit", minute: "2-digit", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  // Binary-search the correct UTC time (handles DST correctly)
  const parts = formatter.formatToParts(approxUtc);
  const p = {};
  parts.forEach(({ type, value }) => { p[type] = value; });
  const localFromUtc = new Date(Date.UTC(
    parseInt(p.year), parseInt(p.month) - 1, parseInt(p.day),
    parseInt(p.hour === "24" ? "0" : p.hour), parseInt(p.minute)
  ));
  const diff = approxUtc - localFromUtc;
  return new Date(approxUtc.getTime() + diff).toISOString();
}

/** Readable datetime string in the user's tz — for previews and labels. */
export function formatDateTime(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("default", {
    timeZone: _tz, dateStyle: "medium", timeStyle: "short",
  }).format(new Date(iso));
}

function _escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Mobile-friendly confirm dialog — replaces browser confirm().
 * Returns Promise<boolean>.
 */
export function showConfirm(message, { confirmText = "Confirm", danger = false } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-sheet">
        <p class="confirm-msg">${_escHtml(message)}</p>
        <div class="confirm-actions">
          <button class="btn btn-ghost confirm-cancel">Cancel</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"} confirm-ok">${_escHtml(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("open"));
    const close = (result) => {
      overlay.classList.remove("open");
      setTimeout(() => overlay.remove(), 220);
      resolve(result);
    };
    overlay.querySelector(".confirm-ok").addEventListener("click", () => close(true));
    overlay.querySelector(".confirm-cancel").addEventListener("click", () => close(false));
    overlay.addEventListener("click", e => { if (e.target === overlay) close(false); });
  });
}

/**
 * Mobile-friendly prompt dialog — replaces browser prompt().
 * Returns Promise<string|null> (null = cancelled).
 */
export function showPrompt(message, defaultValue = "") {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-sheet">
        <p class="confirm-msg">${_escHtml(message)}</p>
        <input class="confirm-input" type="text" value="${_escHtml(defaultValue)}" autocomplete="off">
        <div class="confirm-actions">
          <button class="btn btn-ghost confirm-cancel">Cancel</button>
          <button class="btn btn-primary confirm-ok">OK</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("open"));
    const input = overlay.querySelector(".confirm-input");
    const close = (result) => {
      overlay.classList.remove("open");
      setTimeout(() => overlay.remove(), 220);
      resolve(result);
    };
    setTimeout(() => { input.focus(); input.select(); }, 120);
    overlay.querySelector(".confirm-ok").addEventListener("click", () => close(input.value.trim() || null));
    overlay.querySelector(".confirm-cancel").addEventListener("click", () => close(null));
    overlay.addEventListener("click", e => { if (e.target === overlay) close(null); });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter")  { e.preventDefault(); close(input.value.trim() || null); }
      if (e.key === "Escape") close(null);
    });
  });
}

/**
 * Wire swipe-to-dismiss on a bottom-sheet modal.
 * Drag starts only when the touch begins in the top HANDLE_ZONE px of sheetEl
 * (the visual drag handle area). Dismisses on release if dragged > DISMISS_PX.
 */
export function addSwipeToDismiss(overlay, sheetEl, closeFn) {
  const HANDLE_ZONE = 60;
  const DISMISS_PX  = 100;

  let startY = 0, deltaY = 0, dragging = false;

  sheetEl.addEventListener("touchstart", (e) => {
    const rect = sheetEl.getBoundingClientRect();
    if (e.touches[0].clientY - rect.top > HANDLE_ZONE) return;
    startY   = e.touches[0].clientY;
    deltaY   = 0;
    dragging = true;
    sheetEl.style.transition = "none";
  }, { passive: true });

  sheetEl.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    deltaY = Math.max(0, e.touches[0].clientY - startY);
    sheetEl.style.transform = `translateY(${deltaY}px)`;
  }, { passive: true });

  sheetEl.addEventListener("touchend", () => {
    if (!dragging) return;
    dragging = false;
    sheetEl.style.transition = "";
    if (deltaY > DISMISS_PX) {
      sheetEl.style.transform = "translateY(100%)";
      setTimeout(closeFn, 180);
    } else {
      sheetEl.style.transform = "";
    }
    deltaY = 0;
  }, { passive: true });
}
