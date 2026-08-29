/*
 * First-run behaviour of a locked-down instance.
 *
 * Run against a server started with ALLOW_REGISTRATION=false and an EMPTY
 * database:
 *
 *   DATABASE_URL=/tmp/first-run.sqlite ALLOW_REGISTRATION=false PORT=5187 \
 *   APP_ORIGIN=http://localhost:5187 npm start &
 *   BASE=http://localhost:5187 ORIGIN=http://localhost:5187 node server/test/first-run.mjs
 *
 * The case matters because closed-by-default is the right setting for a public
 * deployment - the first person to register becomes the administrator, so an
 * instance that is briefly open is an instance a stranger can own. That is only
 * safe if the owner can still create the first account, which is what this
 * checks. If the exemption broke, a fresh locked-down instance would be
 * permanently unusable, and nothing else in the suite would notice.
 */
const BASE = process.env.BASE ?? "http://localhost:5187";
const ORIGIN = process.env.ORIGIN ?? "http://localhost:5187";

let cookies = new Map();
const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");

function absorb(response) {
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (value === "") cookies.delete(name);
    else cookies.set(name, value);
  }
}

async function call(method, path, body) {
  const headers = { origin: ORIGIN };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookies.size) headers.cookie = cookieHeader();
  const csrf = cookies.get("cp_csrf");
  if (csrf && method !== "GET") headers["x-csrf-token"] = csrf;

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  absorb(response);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, json };
}

let failed = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};

/* 1. The database must be empty, or this proves nothing. */
let r = await call("GET", "/api/auth/me");
check("the instance reports registration closed", r.json.allowRegistration === false, String(r.json.allowRegistration));

/* 2. The very first account gets in anyway, and administers the instance. */
const owner = `owner-${Date.now()}@example.com`;
r = await call("POST", "/api/auth/register", {
  name: "Owner",
  email: owner,
  password: "the-first-account-password",
});
check("the first account can register despite the lock", r.status === 200, `status ${r.status}`);
check("the first account is an administrator", r.json.user?.role === "admin", String(r.json.user?.role));

/* 3. Everyone after them is refused. */
const stranger = new Map(cookies);
cookies = new Map();
r = await call("POST", "/api/auth/register", {
  name: "Stranger",
  email: `stranger-${Date.now()}@example.com`,
  password: "a-perfectly-fine-password",
});
check("the second account is refused", r.status === 403, `status ${r.status}`);
check("and told why", r.json.error?.code === "registration_closed", String(r.json.error?.code));

/* 4. The administrator can open it, and then a second account works. */
cookies = stranger;
r = await call("PUT", "/api/admin/settings", { allowRegistration: true });
check("the administrator can open registration", r.status === 200, `status ${r.status}`);

cookies = new Map();
r = await call("POST", "/api/auth/register", {
  name: "Colleague",
  email: `colleague-${Date.now()}@example.com`,
  password: "a-perfectly-fine-password",
});
check("a second account can now register", r.status === 200, `status ${r.status}`);
check("but is not an administrator", r.json.user?.role === "user", String(r.json.user?.role));

console.log(failed === 0 ? "\nAll first-run checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
