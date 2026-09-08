/*
 * End-to-end smoke test against a running Chronoplot API.
 *
 *   node server/test/smoke.mjs                       # against `npm run dev`
 *   BASE=http://localhost:5188 ORIGIN=http://localhost:5188 node server/test/smoke.mjs
 *
 * ORIGIN must match the server's APP_ORIGIN, because the origin check is one of
 * the things under test.
 */
const BASE = process.env.BASE ?? "http://localhost:5174";
const ORIGIN = process.env.ORIGIN ?? "http://localhost:5173";

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

// 16. profile: the display name can be changed
cookies = ownerCookies;
r = await call("PATCH", "/api/auth/profile", { name: "Renamed Tester" });
check("display name can be changed", r.status === 200 && r.json.user?.name === "Renamed Tester", JSON.stringify(r.json).slice(0, 120));
r = await call("GET", "/api/auth/me");
check("the new name persists", r.json.user?.name === "Renamed Tester", JSON.stringify(r.json.user));

// 17. project export/import round-trip
r = await call("GET", `/api/projects/${projectId}`);
const exported = r.json.project.doc;
r = await call("POST", "/api/projects/import", { title: "Imported copy", doc: exported });
check("import creates a project", r.status === 200 && r.json.project?.id !== projectId, `status ${r.status}`);
const importedId = r.json.project?.id;
r = await call("GET", `/api/projects/${importedId}`);
check(
  "the imported project has the same content",
  r.json.project?.doc?.items?.length === exported.items.length,
  `${r.json.project?.doc?.items?.length} vs ${exported.items.length}`,
);
r = await call("POST", "/api/projects/import", { title: "Broken", doc: { schemaVersion: 1 } });
check("a malformed import is rejected", r.status === 400, `status ${r.status}`);
await call("DELETE", `/api/projects/${importedId}`);

// 18. roles: whoever registered first administers the instance
r = await call("GET", "/api/auth/me");
const iAmAdmin = r.json.user?.role === "admin";
check("an account has a role", r.json.user?.role === "admin" || r.json.user?.role === "user", String(r.json.user?.role));

// A non-admin must not reach the admin API. Use the second account for that.
const adminCookies = new Map(cookies);
cookies = new Map();
await call("POST", "/api/auth/login", { email: other, password });
r = await call("GET", "/api/auth/me");
const otherIsAdmin = r.json.user?.role === "admin";
r = await call("GET", "/api/admin/users");
check(
  "a non-admin is refused the admin API",
  otherIsAdmin ? r.status === 200 : r.status === 403,
  `role ${r.json.user?.role ?? ""} status ${r.status}`,
);

cookies = adminCookies;
if (iAmAdmin) {
  r = await call("GET", "/api/admin/users");
  check("admin lists accounts", r.status === 200 && Array.isArray(r.json.users), `status ${r.status}`);

  const madeEmail = `made-${Date.now()}@example.com`;
  r = await call("POST", "/api/admin/users", { name: "Made", email: madeEmail, password: "created-by-admin-pw", role: "user" });
  check("admin creates an account", r.status === 200, JSON.stringify(r.json).slice(0, 120));
  const madeId = r.json.user?.id;

  r = await call("POST", `/api/admin/users/${madeId}/password`, { password: "reset-by-the-admin" });
  check("admin resets a password", r.status === 200, `status ${r.status}`);

  // The reset must actually take effect, and must invalidate the old one.
  const keep = new Map(cookies);
  cookies = new Map();
  r = await call("POST", "/api/auth/login", { email: madeEmail, password: "created-by-admin-pw" });
  check("the old password stops working", r.status === 401, `status ${r.status}`);
  r = await call("POST", "/api/auth/login", { email: madeEmail, password: "reset-by-the-admin" });
  check("the new password works", r.status === 200, `status ${r.status}`);
  cookies = keep;

  r = await call("DELETE", `/api/admin/users/${madeId}`);
  check("admin deletes an account", r.status === 200, `status ${r.status}`);

  // Registration is a stored setting now, not an environment variable.
  r = await call("PUT", "/api/admin/settings", { allowRegistration: false });
  check("admin closes registration", r.status === 200 && r.json.allowRegistration === false);

  const keepAdmin = new Map(cookies);
  cookies = new Map();
  r = await call("POST", "/api/auth/register", { email: `blocked-${Date.now()}@example.com`, password, name: "Blocked" });
  check("registration is refused while closed", r.status === 403, `status ${r.status}`);
  cookies = keepAdmin;

  r = await call("PUT", "/api/admin/settings", { allowRegistration: true });
  check("admin reopens registration", r.status === 200 && r.json.allowRegistration === true);

  r = await call("DELETE", `/api/admin/users/${r.json.id ?? "self"}`);
  check("admin cannot delete itself by a bogus id", r.status === 404 || r.status === 400, `status ${r.status}`);
}

// 19. API tokens and the external sync endpoint
cookies = ownerCookies;

r = await call("POST", "/api/tokens", { name: "Obsidian" });
check("a token can be created", r.status === 200 && typeof r.json.token === "string", `status ${r.status}`);
const token = r.json.token;
const tokenId = r.json.id;
check("the token is recognisable", typeof token === "string" && token.startsWith("cpt_"), String(token).slice(0, 6));

r = await call("GET", "/api/tokens");
check("tokens can be listed", r.status === 200 && r.json.tokens?.length >= 1);
check("the list never returns the secret", !JSON.stringify(r.json).includes(token));

// Bearer requests carry no cookies, so they must also bypass the CSRF check.
const bearer = { authorization: `Bearer ${token}` };
const noCookies = new Map();
const withToken = async (method, path, body) => {
  const keep = cookies;
  cookies = noCookies;
  const result = await call(method, path, body, bearer);
  cookies = keep;
  return result;
};

r = await withToken("GET", "/api/auth/me");
check("a token authenticates", r.status === 200 && r.json.user?.email === email, `status ${r.status}`);

// A token must not be able to mint tokens: a leaked one would otherwise be an
// unrevokable foothold.
r = await withToken("POST", "/api/tokens", { name: "Escalation" });
check("a token cannot create tokens", r.status === 403 && r.json.error?.code === "session_required", `status ${r.status}`);
r = await withToken("POST", "/api/auth/password", { currentPassword: password, password: "another-good-password" });
check("a token cannot change the password", r.status === 403, `status ${r.status}`);

r = await withToken("POST", `/api/projects/${projectId}/sync`, {
  source: { kind: "obsidian", vault: "Smoke" },
  items: [
    { path: "a.md", title: "From a note", start: "2026-04-01", end: "2026-06-30",
      precision: "day", lane: "Notes", url: "obsidian://open?vault=Smoke&file=a" },
  ],
});
check("a sync creates a card", r.status === 200 && r.json.created === 1, JSON.stringify(r.json).slice(0, 140));
check("the sync created its lane", r.json.lanesCreated?.includes("Notes"));

r = await call("GET", `/api/projects/${projectId}`);
const synced = r.json.project.doc.items.find((i) => i.source?.path === "a.md");
check("the card records its origin", synced?.source?.vault === "Smoke", String(synced?.source?.vault));
check("and its link back", synced?.source?.url?.startsWith("obsidian://"), String(synced?.source?.url));

// A dry run must report without writing.
const versionBefore = r.json.project.version;
r = await withToken("POST", `/api/projects/${projectId}/sync`, {
  source: { kind: "obsidian", vault: "Smoke" },
  dryRun: true,
  items: [],
});
check("a dry run reports removals", r.status === 200 && r.json.removed === 1, JSON.stringify(r.json).slice(0, 120));
r = await call("GET", `/api/projects/${projectId}`);
check("a dry run changes nothing", r.json.project.version === versionBefore, `${r.json.project.version} vs ${versionBefore}`);

// A javascript: link would be stored cross-site scripting in every export.
r = await withToken("POST", `/api/projects/${projectId}/sync`, {
  source: { kind: "obsidian", vault: "Smoke" },
  items: [{ path: "x.md", title: "Bad", start: "2026-04-01", precision: "day", url: "javascript:alert(1)" }],
});
check("a javascript: link is refused", r.status === 400, `status ${r.status}`);

// A scoped token must not reach past its project.
r = await call("POST", "/api/projects", { title: "Another project" });
const otherProjectId = r.json.project.id;
r = await call("POST", "/api/tokens", { name: "Scoped", projectId: otherProjectId });
const scopedToken = r.json.token;

const scoped = { authorization: `Bearer ${scopedToken}` };
{
  const keep = cookies;
  cookies = new Map();
  r = await call("POST", `/api/projects/${projectId}/sync`, {
    source: { kind: "obsidian", vault: "Smoke" }, items: [],
  }, scoped);
  check("a scoped token is refused elsewhere", r.status === 403 && r.json.error?.code === "token_scope", `status ${r.status}`);
  r = await call("POST", `/api/projects/${otherProjectId}/sync`, {
    source: { kind: "obsidian", vault: "Smoke" }, items: [],
  }, scoped);
  check("a scoped token works on its own project", r.status === 200, `status ${r.status}`);
  cookies = keep;
}
await call("DELETE", `/api/projects/${otherProjectId}`);

// Revocation must take effect immediately.
r = await call("DELETE", `/api/tokens/${tokenId}`);
check("a token can be revoked", r.status === 200);
r = await withToken("GET", "/api/auth/me");
check("a revoked token stops working", r.json.user === null, JSON.stringify(r.json).slice(0, 80));

// 20. owner deletes
cookies = ownerCookies;
r = await call("DELETE", `/api/projects/${projectId}`);
check("owner deletes project", r.status === 200);

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
