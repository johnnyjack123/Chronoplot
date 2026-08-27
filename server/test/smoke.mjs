// End-to-end smoke test against a running Chronoplot API.
const BASE = "http://localhost:5174";
const ORIGIN = "http://localhost:5173";

let cookies = new Map();
const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");

function absorb(res) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    const name = pair.slice(0, idx);
    const value = pair.slice(idx + 1);
    if (value === "") cookies.delete(name);
    else cookies.set(name, value);
  }
}

async function call(method, path, body, extraHeaders = {}) {
  const headers = { origin: ORIGIN, ...extraHeaders };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookies.size) headers.cookie = cookieHeader();
  // Do not clobber a token the caller deliberately supplied - that is what the
  // bad-token case is testing.
  const csrf = cookies.get("cp_csrf");
  if (csrf && method !== "GET" && !("x-csrf-token" in extraHeaders)) {
    headers["x-csrf-token"] = csrf;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  absorb(res);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

const email = `smoke-${Date.now()}@example.com`;
const password = "correct-horse-battery";

// 1. health
let r = await call("GET", "/api/health");
check("health responds", r.status === 200 && r.json.ok === true, JSON.stringify(r.json));

// 2. unauthenticated project list is rejected
r = await call("GET", "/api/projects");
check("projects require auth", r.status === 401, `status ${r.status}`);

// 3. register
r = await call("POST", "/api/auth/register", { email, password, name: "Smoke Tester" });
check("register succeeds", r.status === 200 && r.json.user?.email === email, JSON.stringify(r.json).slice(0, 120));
check("session cookie set", cookies.has("cp_session"));
check("csrf cookie set", cookies.has("cp_csrf"));

// 4. weak password rejected
const before = new Map(cookies);
r = await call("POST", "/api/auth/register", { email: `x${Date.now()}@e.com`, password: "short", name: "X" });
check("weak password rejected", r.status === 400, `status ${r.status}`);
cookies = before;

// 5. create a project
r = await call("POST", "/api/projects", { title: "Smoke Timeline" });
check("create project", r.status === 200 && r.json.project?.id, JSON.stringify(r.json).slice(0, 140));
const projectId = r.json.project?.id;
const version = r.json.project?.version;

// 6. CSRF: a mutating request without the header must fail
r = await call("POST", "/api/projects", { title: "No CSRF" }, { "x-csrf-token": "wrong" });
check("bad csrf token rejected", r.status === 403, `status ${r.status}`);

// 7. cross-origin request rejected
r = await call("POST", "/api/projects", { title: "Evil" }, { origin: "http://evil.example" });
check("foreign origin rejected", r.status === 403, `status ${r.status}`);

// 8. read the project back
r = await call("GET", `/api/projects/${projectId}`);
check("read project", r.status === 200 && r.json.project?.doc?.rows?.length === 1);
const doc = r.json.project.doc;

// 9. save a change
const rowId = doc.rows[0].id;
doc.items.push({
  id: "item-1", rowId, kind: "bar", title: "Phase one",
  color: 1, start: "2026-02-01", end: "2026-04-30", precision: "day",
});
r = await call("PUT", `/api/projects/${projectId}`, { title: "Smoke Timeline", doc, baseVersion: version });
check("save project", r.status === 200 && r.json.version === version + 1, JSON.stringify(r.json).slice(0, 140));

// 10. stale save is a conflict, not a silent overwrite
r = await call("PUT", `/api/projects/${projectId}`, { title: "Stale", doc, baseVersion: version });
check("stale save conflicts", r.status === 409 && r.json.error?.code === "version_conflict", `status ${r.status}`);

// 11. an item pointing at a missing row is refused
const brokenDoc = structuredClone(doc);
brokenDoc.items[0].rowId = "does-not-exist";
r = await call("PUT", `/api/projects/${projectId}`, { title: "Broken", doc: brokenDoc, baseVersion: version + 1 });
check("dangling row reference refused", r.status === 422, `status ${r.status}`);

// 12. a second account cannot see the project
const other = `other-${Date.now()}@example.com`;
cookies = new Map();
r = await call("POST", "/api/auth/register", { email: other, password, name: "Other" });
check("second account registers", r.status === 200);
r = await call("GET", `/api/projects/${projectId}`);
check("other user cannot read project", r.status === 404, `status ${r.status}`);

// 13. wrong password fails
cookies = new Map();
r = await call("POST", "/api/auth/login", { email, password: "definitely-wrong-pw" });
check("wrong password rejected", r.status === 401, `status ${r.status}`);

// 14. correct login works
r = await call("POST", "/api/auth/login", { email, password });
check("login succeeds", r.status === 200 && r.json.user?.email === email);

// 15. share with the other account, then it can read
r = await call("POST", `/api/projects/${projectId}/members`, { email: other, role: "viewer" });
check("share project", r.status === 200, JSON.stringify(r.json).slice(0, 120));

const ownerCookies = new Map(cookies);
cookies = new Map();
r = await call("POST", "/api/auth/login", { email: other, password });
r = await call("GET", `/api/projects/${projectId}`);
check("viewer can read shared project", r.status === 200, `status ${r.status}`);
r = await call("PUT", `/api/projects/${projectId}`, { title: "Viewer edit", doc, baseVersion: version + 1 });
check("viewer cannot write", r.status === 403 && r.json.error?.code === "read_only", `status ${r.status}`);

// 16. owner deletes
cookies = ownerCookies;
r = await call("DELETE", `/api/projects/${projectId}`);
check("owner deletes project", r.status === 200);

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
