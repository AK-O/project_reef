function _hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function _rng(seed) {
  let s = seed;
  return () => {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 2 ** 32;
  };
}

const _projectOverrides = new Map();

export function cacheProjectSettings(projects) {
  for (const p of (Array.isArray(projects) ? projects : [projects])) {
    _projectOverrides.set(String(p.id), {
      color_hue: p.color_hue ?? null,
      icon_seed: p.icon_seed ?? null,
    });
  }
}

// ── Rounded polygon helper ────────────────────────────────────────
// Draws an N-sided regular polygon with smoothed (quadratic-bezier) corners.
// smooth 0.01 = barely rounded, 0.48 = nearly circular.
function _roundedPoly(ctx, cx, cy, r, sides, smooth, rotation) {
  const v = Array.from({ length: sides }, (_, i) => {
    const a = rotation + (i / sides) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
  const s  = Math.max(0.01, Math.min(0.48, smooth));
  const vl = v[sides - 1], v0 = v[0];
  ctx.beginPath();
  ctx.moveTo(vl[0] + (v0[0] - vl[0]) * (1 - s), vl[1] + (v0[1] - vl[1]) * (1 - s));
  for (let i = 0; i < sides; i++) {
    const vc = v[i], vn = v[(i + 1) % sides];
    // Round the corner at vc with a quadratic bezier
    ctx.quadraticCurveTo(vc[0], vc[1],
      vc[0] + (vn[0] - vc[0]) * s, vc[1] + (vn[1] - vc[1]) * s);
    // Straight line along the next edge, leaving room for the following corner
    ctx.lineTo(vn[0] - (vn[0] - vc[0]) * s, vn[1] - (vn[1] - vc[1]) * s);
  }
  ctx.closePath();
}

// ── Shape drawers ─────────────────────────────────────────────────
// Each receives (ctx, cx, cy, size, rand).
// All shapes are positioned with slight random offset from centre.

function _ellipse(ctx, cx, cy, size, rand) {
  const rA    = size * (0.18 + rand() * 0.16);
  const rB    = rA   * (0.44 + rand() * 0.52);
  const rot   = rand() * Math.PI;
  const dist  = size * (0.14 + rand() * 0.22);
  const angle = rand() * Math.PI * 2;
  ctx.beginPath();
  ctx.ellipse(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist,
    rA, rB, rot, 0, Math.PI * 2);
  ctx.fill();
}

function _roundRect(ctx, cx, cy, size, rand) {
  const w     = size * (0.24 + rand() * 0.30);
  const h     = size * (0.24 + rand() * 0.30);
  const r     = Math.min(w, h) * (0.12 + rand() * 0.30);
  const rot   = rand() * Math.PI;
  const dist  = size * (0.06 + rand() * 0.22);
  const angle = rand() * Math.PI * 2;
  ctx.save();
  ctx.translate(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, r);
  ctx.fill();
  ctx.restore();
}

function _cross(ctx, cx, cy, size, rand) {
  const arm   = size * (0.28 + rand() * 0.24);
  const thick = arm  * (0.22 + rand() * 0.26);
  const r     = thick * 0.48;
  const rot   = rand() * Math.PI * 2;
  const dist  = size * (0.04 + rand() * 0.18);
  const angle = rand() * Math.PI * 2;
  ctx.save();
  ctx.translate(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist);
  ctx.rotate(rot);
  // Two bars — their overlapping centre darkens naturally under multiply
  ctx.beginPath(); ctx.roundRect(-arm / 2, -thick / 2, arm, thick, r); ctx.fill();
  ctx.beginPath(); ctx.roundRect(-thick / 2, -arm / 2, thick, arm, r); ctx.fill();
  ctx.restore();
}

function _triangle(ctx, cx, cy, size, rand) {
  const r      = size * (0.24 + rand() * 0.14);
  const smooth = 0.16 + rand() * 0.26;
  const rot    = rand() * Math.PI * 2;
  const dist   = size * (0.05 + rand() * 0.18);
  const angle  = rand() * Math.PI * 2;
  _roundedPoly(ctx,
    cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist,
    r, 3, smooth, rot);
  ctx.fill();
}

function _pentagon(ctx, cx, cy, size, rand) {
  const r      = size * (0.20 + rand() * 0.14);
  const smooth = 0.10 + rand() * 0.22;
  const rot    = rand() * Math.PI * 2;
  const dist   = size * (0.05 + rand() * 0.18);
  const angle  = rand() * Math.PI * 2;
  _roundedPoly(ctx,
    cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist,
    r, 5, smooth, rot);
  ctx.fill();
}

// Organic blob: 6 control points on a slightly irregular ring,
// connected with Catmull-Rom cubic bezier curves.
function _blob(ctx, cx, cy, size, rand) {
  const r0    = size * (0.16 + rand() * 0.16);
  const dist  = size * (0.05 + rand() * 0.18);
  const angle = rand() * Math.PI * 2;
  const rot   = rand() * Math.PI * 2;
  const irreg = 0.28 + rand() * 0.46;   // 0 = circle, ~0.7 = very bumpy
  const ox    = cx + Math.cos(angle) * dist;
  const oy    = cy + Math.sin(angle) * dist;
  const N     = 6;
  const pts   = Array.from({ length: N }, (_, i) => {
    const a = rot + (i / N) * Math.PI * 2;
    const r = r0 * (1 - irreg / 2 + rand() * irreg);
    return [ox + Math.cos(a) * r, oy + Math.sin(a) * r];
  });
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const p0 = pts[(i - 1 + N) % N], p1 = pts[i];
    const p2 = pts[(i + 1) % N],     p3 = pts[(i + 2) % N];
    if (i === 0) ctx.moveTo(p1[0], p1[1]);
    ctx.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1]
    );
  }
  ctx.closePath();
  ctx.fill();
}

const _SHAPES = [_ellipse, _roundRect, _cross, _triangle, _pentagon, _blob];

// ── Public API ────────────────────────────────────────────────────

export function generateJazzicon(id, size = 48) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");

  const ov = _projectOverrides.get(String(id)) ?? {};
  const seedStr = ov.icon_seed != null ? `${id}#${ov.icon_seed}` : String(id);
  const seed = _hash(seedStr);
  const rand = _rng(seed);

  const computedHue = rand() * 360;   // call 1 — must stay first; jazziconHue reads this
  const hue = ov.color_hue != null ? ov.color_hue : computedHue;
  const sat = 72 + rand() * 20;

  // Circular clip + white background
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2, cy = size / 2;

  // Pick 2–3 shape types for this icon via Fisher-Yates on 6 indices
  const idx = [0, 1, 2, 3, 4, 5];
  for (let i = 5; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const poolSize = 2 + Math.floor(rand() * 2);   // 2 or 3 types
  const pool = idx.slice(0, poolSize);

  const n = 4 + Math.floor(rand() * 3);           // 4–6 shapes total

  ctx.globalCompositeOperation = "multiply";

  for (let i = 0; i < n; i++) {
    const bHue = (hue + (rand() - 0.5) * 42 + 360) % 360;
    const bLit = 64 + rand() * 20;
    ctx.fillStyle = `hsl(${bHue.toFixed(0)}, ${sat.toFixed(0)}%, ${bLit.toFixed(0)}%)`;
    _SHAPES[pool[Math.floor(rand() * pool.length)]](ctx, cx, cy, size, rand);
  }

  ctx.globalCompositeOperation = "source-over";
  return canvas;
}

export function jazziconHue(id) {
  const ov = _projectOverrides.get(String(id)) ?? {};
  if (ov.color_hue != null) return ov.color_hue;
  const seedStr = ov.icon_seed != null ? `${id}#${ov.icon_seed}` : String(id);
  return _rng(_hash(seedStr))() * 360;
}
