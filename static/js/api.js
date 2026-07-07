/** Thin API client — handles auth headers and JSON parsing. */

const BASE = "";  // same origin

function getToken() {
  return localStorage.getItem("pr_token");
}

export function setToken(token) {
  if (token) localStorage.setItem("pr_token", token);
  else localStorage.removeItem("pr_token");
}

export function isAuthenticated() {
  return !!getToken();
}

// Mobile browsers/PWAs can suspend an in-flight fetch (screen lock, app
// backgrounded, wifi<->cellular handover) without ever resolving or
// rejecting it. Without a hard timeout, that leaves save buttons/spinners
// stuck forever — a plain fetch() has no built-in deadline.
const REQUEST_TIMEOUT_MS = 20000;

async function request(method, path, body = null, params = null) {
  const url = new URL(path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined) url.searchParams.set(k, v);
    });
  }

  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body !== null) opts.body = JSON.stringify(body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url.toString(), { ...opts, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Request timed out — check your connection and try again");
    throw new Error("Network error — check your connection and try again");
  } finally {
    clearTimeout(timer);
  }

  if (resp.status === 401) {
    setToken(null);
    window.dispatchEvent(new CustomEvent("auth:expired"));
    throw new Error("Session expired");
  }

  if (resp.status === 204) return null;

  const data = await resp.json();
  if (!resp.ok) {
    const detail = data.detail;
    let msg;
    if (Array.isArray(detail))       msg = detail.map(d => d.msg || JSON.stringify(d)).join("; ");
    else if (typeof detail === "string") msg = detail;
    else if (detail)                 msg = JSON.stringify(detail);
    else                             msg = `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data;
}

const get  = (path, params) => request("GET",    path, null, params);
const post = (path, body)   => request("POST",   path, body);
const patch= (path, body)   => request("PATCH",  path, body);
const del  = (path)         => request("DELETE", path);

export const auth = {
  register:   (body) => post("/api/auth/register", body),
  login:      (body) => post("/api/auth/login", body),
  me:         ()     => get("/api/auth/me"),
  updateMe:   (body) => request("PATCH", "/api/auth/me", body),
  rotateToken:()     => post("/api/auth/token"),
  users:      ()     => get("/api/auth/users"),
};

export const tasks = {
  inbox:   (filter)        => get("/api/tasks/inbox", { filter }),
  list:    (params)        => get("/api/tasks", params),
  preview: (raw_input)     => post("/api/tasks/parse-preview", { raw_input }),
  create:  (body)          => post("/api/tasks", body),
  bulk:    (lines, project_id) => post("/api/tasks/bulk", { lines, project_id }),
  reorder: (ids)           => post("/api/tasks/reorder", { task_ids: ids }),
  get:     (id)            => get(`/api/tasks/${id}`),
  update:  (id, body)      => patch(`/api/tasks/${id}`, body),
  complete:(id)            => post(`/api/tasks/${id}/complete`),
  uncomplete:(id)          => post(`/api/tasks/${id}/uncomplete`),
  delete:  (id)            => del(`/api/tasks/${id}`),
};

export const projects = {
  list:      ()      => get("/api/projects"),
  archived:  ()      => get("/api/projects/archived"),
  create:    (body)  => post("/api/projects", body),
  get:       (id)    => get(`/api/projects/${id}`),
  update:    (id, b) => patch(`/api/projects/${id}`, b),
  archive:   (id)    => post(`/api/projects/${id}/archive`),
  unarchive: (id)    => post(`/api/projects/${id}/unarchive`),
  dashboard: (id)    => get(`/api/projects/${id}/dashboard`),
  buckets:   (id)    => get(`/api/projects/${id}/buckets`),
  addBucket:      (id, b)    => post(`/api/projects/${id}/buckets`, b),
  reorderBuckets: (id, ids)  => post(`/api/projects/${id}/buckets/reorder`, ids),
  addMember:    (id, b)        => post(`/api/projects/${id}/members`, b),
  removeMember: (pid, uid)     => del(`/api/projects/${pid}/members/${uid}`),
  members:      (id)           => get(`/api/projects/${id}/members`),
  updateMember: (id, uid, role)=> request("PATCH", `/api/projects/${id}/members/${uid}`, { role }),
  publicBoard:  (token)        => get(`/api/projects/public/${token}`),
  goals:     (id)    => get(`/api/projects/${id}/goals`),
  createGoal:(id, b) => post(`/api/projects/${id}/goals`, b),
  reorder:   (items) => post("/api/projects/reorder", items),
};

export const buckets = {
  update: (id, b) => patch(`/api/buckets/${id}`, b),
  delete: (id)    => del(`/api/buckets/${id}`),
};

export const goals = {
  complete: (id) => post(`/api/goals/${id}/complete`),
};

export const admin = {
  stats:            ()          => get("/api/admin/stats"),
  vacuum:           ()          => post("/api/admin/vacuum"),
  purgeDone:        ()          => post("/api/admin/db/purge-done"),
  purgeArchived:    ()          => post("/api/admin/db/purge-archived"),
  haConfig:         ()          => get("/api/admin/ha-config"),
  updateHa:         (body)      => patch("/api/admin/ha-config", body),
  haPing:           ()          => post("/api/admin/ha-ping"),
  users:            ()          => get("/api/admin/users"),
  updateUser:       (id, body)  => patch(`/api/admin/users/${id}`, body),
  deleteUser:       (id)        => del(`/api/admin/users/${id}`),
  migrateTasks:     (id, toId)  => post(`/api/admin/users/${id}/migrate-tasks`, { to_user_id: toId }),
  projects:         ()          => get("/api/admin/projects"),
  changeOwner:      (id, ownerId) => patch(`/api/admin/projects/${id}/owner`, { owner_id: ownerId }),
  deleteProject:    (id)        => del(`/api/admin/projects/${id}`),
};
