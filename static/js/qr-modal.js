/**
 * QR modal — shows a coloured QR code with Jazzicon in the centre.
 * Requires qrcode-generator (global `window.qrcode`) loaded via <script>.
 */
import { generateJazzicon, jazziconHue } from "./jazzicon.js";

export function showQRModal(project) {
  document.getElementById("qr-modal-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id        = "qr-modal-overlay";
  overlay.className = "modal-overlay";

  const card = document.createElement("div");
  card.className = "qr-modal-card";

  const title = document.createElement("div");
  title.className   = "qr-modal-title";
  title.textContent = project.name;

  const canvas = document.createElement("canvas");
  canvas.className = "qr-canvas";

  const hint = document.createElement("p");
  hint.className   = "qr-hint";
  hint.textContent = "Tap to open · Scan to share";

  card.append(title, canvas, hint);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));

  drawQROnCanvas(canvas, project);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) _close(overlay);
  });
}

function _close(overlay) {
  overlay.classList.remove("open");
  setTimeout(() => overlay.remove(), 240);
}

export function drawQROnCanvas(canvas, project, maxPx = 290) {
  if (!window.qrcode) {
    canvas.insertAdjacentHTML("afterend",
      `<p class="qr-error">QR library not loaded.<br>Add qrcode-generator via CDN or static file.</p>`);
    return;
  }

  const url = project.public_token
    ? `${window.location.origin}/board/${project.public_token}`
    : `${window.location.origin}/projects/${project.id}`;

  const qr = window.qrcode(0, "H");
  qr.addData(url);
  qr.make();

  const modules   = qr.getModuleCount();
  const cell      = 8;
  const qrPx      = modules * cell;
  const pad       = 20;
  const total     = qrPx + pad * 2;
  const scale     = Math.min(1, maxPx / total);

  canvas.width  = Math.round(total * scale);
  canvas.height = Math.round(total * scale);
  canvas.style.width  = canvas.width  + "px";
  canvas.style.height = canvas.height + "px";

  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  // White background
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, total, total);

  // Dark QR colour tied to the project's Jazzicon hue
  const hue      = jazziconHue(project.id);
  const qrColor  = `hsl(${hue.toFixed(0)}, 78%, 36%)`;

  // Logo occupies 22% of the QR pixel area
  const logoSize = Math.floor(qrPx * 0.22);
  const logoX    = pad + (qrPx - logoSize) / 2;
  const logoY    = pad + (qrPx - logoSize) / 2;

  // Draw rounded QR modules, skipping the logo zone
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (!qr.isDark(r, c)) continue;
      const x = pad + c * cell;
      const y = pad + r * cell;
      if (_overlaps(x, y, cell, logoX, logoY, logoSize)) continue;
      ctx.fillStyle = qrColor;
      _roundRect(ctx, x + 0.5, y + 0.5, cell - 1, cell - 1, cell * 0.3);
      ctx.fill();
    }
  }

  // Centre: white ring + Jazzicon canvas
  const jCanvas = generateJazzicon(project.id, logoSize);
  const cx = pad + qrPx / 2;
  const cy = pad + qrPx / 2;

  ctx.beginPath();
  ctx.arc(cx, cy, logoSize / 2 + 5, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.drawImage(jCanvas, logoX, logoY, logoSize, logoSize);
}

function _overlaps(x, y, cell, lx, ly, ls) {
  return x + cell > lx && x < lx + ls && y + cell > ly && y < ly + ls;
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}
