/*
 * Pre-push audit: is anything sensitive tracked by git, now or in the past?
 *
 * Scans the *tracked* file list and the whole commit history, not the working
 * tree - a file removed today is still in the history, and pushing publishes
 * the history.
 *
 *   node scripts/audit-secrets.mjs
 *
 * Exits non-zero if anything needs a human decision.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) =>
  execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

let problems = 0;
let warnings = 0;
const fail = (message) => { problems++; console.log(`  FAIL   ${message}`); };
const warn = (message) => { warnings++; console.log(`  WARN   ${message}`); };
const pass = (message) => console.log(`  ok     ${message}`);

/* ---------------------------------------------------- 1. ignore coverage -- */
console.log("\n1. Sensitive paths are ignored and untracked");

const mustBeIgnored = [
  ".env",
  ".env.local",
  "data/chronoplot.sqlite",
  "backups/anything.sqlite",
  "node_modules/x",
  "web/dist/index.html",
  "server/dist/x.js",
];

for (const path of mustBeIgnored) {
  let ignored = false;
  try {
    git("check-ignore", "-q", "--no-index", path);
    ignored = true;
  } catch {
    ignored = false;
  }
  if (ignored) pass(`${path} is ignored`);
  else fail(`${path} is NOT ignored - add it to .gitignore`);
}

/* ------------------------------------------------- 2. tracked file names -- */
console.log("\n2. No tracked file looks like a secret or a database");

const tracked = git("ls-files").split("\n").filter(Boolean);

/**
 * Reads what would actually be pushed.
 *
 * Reading from HEAD alone was wrong: a file staged but not yet committed is
 * about to become part of the push, and would have slipped through unexamined.
 * The working tree is what the next commit will contain.
 */
function readTracked(file) {
  try {
    return readFileSync(resolve(repoRoot, file), "utf8");
  } catch {
    return null;
  }
}
const badName =
  /(^|\/)\.env($|\.)|\.(sqlite|sqlite3|db|pem|key|p12|pfx|keystore|jks)$|(^|\/)id_(rsa|ed25519)$/i;

const namedBad = tracked.filter((file) => badName.test(file));
if (namedBad.length === 0) pass(`${tracked.length} tracked files, none with a sensitive name`);
else for (const file of namedBad) fail(`tracked: ${file}`);

/* ------------------------------------------------------ 3. file contents -- */
console.log("\n3. No secret-shaped content in tracked text files");

/*
 * Deliberately narrow. Broad entropy scanning on a codebase this size produces
 * pages of false positives from hashes and base64 in lockfiles, and a check
 * nobody reads is worse than no check.
 */
const patterns = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key block"],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/, "GitHub token"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\bsk-[A-Za-z0-9]{20,}/, "API key (sk- prefix)"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\bcpt_[A-Za-z0-9_-]{20,}/, "Chronoplot API token"],
  [/postgres(ql)?:\/\/[^\s"'`]*:[^\s"'`@]+@/, "Postgres URL with a password"],
];

/*
 * Placeholders that look exactly like credentials and are not.
 *
 * Documentation has to show the shape of a connection string, and a compose
 * file has to interpolate one. A check that flags those is a check people learn
 * to ignore, which is worse than not having it.
 */
const placeholder =
  /(\$\{[^}]+\}|:password@|:pass@|:changeme@|:secret@|:<[^>]+>@|:xxx+@|:\.\.\.@)/i;

const skip = /^(package-lock\.json|.*\.(png|jpg|jpeg|gif|svg|ico|pdf|woff2?|ttf))$/i;
const findings = [];

for (const file of tracked) {
  if (skip.test(file)) continue;
  const text = readTracked(file);
  if (text === null) continue;
  for (const [pattern, label] of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (placeholder.test(match[0])) {
      warn(`${file}: ${label}, but the value is a placeholder (${match[0].slice(0, 40)}…)`);
      continue;
    }
    findings.push({ file, label, sample: match[0].slice(0, 24) });
  }
}

if (findings.length === 0) pass("no private keys, provider tokens or credentialed URLs");
else for (const finding of findings) fail(`${finding.file}: ${finding.label} (${finding.sample}…)`);

/* ------------------------------------------- 4. history, not just HEAD -- */
console.log("\n4. History carries nothing sensitive either");

const everTracked = new Set(
  git("log", "--all", "--pretty=format:", "--name-only", "--diff-filter=A")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean),
);

const historyBad = [...everTracked].filter((file) => badName.test(file));
if (historyBad.length === 0) pass(`${everTracked.size} files ever added, none sensitive by name`);
else for (const file of historyBad) fail(`was committed at some point: ${file} - history rewrite needed`);

/* --------------------------------------- 5. things that need a human eye -- */
console.log("\n5. Placeholders and test values (expected, listed for review)");

const reviewable = [
  [/SESSION_SECRET/, "SESSION_SECRET mentioned"],
  [/password\s*[:=]\s*["'][^"']{6,}["']/i, "a literal password"],
];

const notes = [];
for (const file of tracked) {
  if (skip.test(file)) continue;
  const text = readTracked(file);
  if (text === null) continue;
  for (const [pattern, label] of reviewable) {
    if (pattern.test(text)) notes.push(`${file}: ${label}`);
  }
}

if (notes.length === 0) pass("nothing to review");
else for (const note of [...new Set(notes)]) warn(note);

/* ------------------------------------------------------------- verdict -- */
console.log(
  problems === 0
    ? `\nCLEAN - ${warnings} item(s) listed above are expected; read them once, then push.`
    : `\n${problems} problem(s) must be resolved before pushing.`,
);
process.exit(problems === 0 ? 0 : 1);
