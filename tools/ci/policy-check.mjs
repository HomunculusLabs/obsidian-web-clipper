#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function tryRun(cmd) {
  try {
    return run(cmd);
  } catch {
    return "";
  }
}

function loadEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) return null;
  try {
    return JSON.parse(readFileSync(eventPath, "utf8"));
  } catch {
    return null;
  }
}

function resolveDiffRange() {
  const event = loadEvent();
  const prBase = event?.pull_request?.base?.sha;
  const prHead = event?.pull_request?.head?.sha;

  if (prBase && prHead) return { base: prBase, head: prHead };

  if (tryRun("git rev-parse --verify HEAD~1")) {
    return { base: "HEAD~1", head: "HEAD" };
  }

  return { base: "", head: "HEAD" };
}

function changedFiles(base, head) {
  if (!base) {
    return tryRun(`git show --name-only --pretty=format: ${head}`)
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
  }

  return tryRun(`git diff --name-only ${base} ${head}`)
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

function addedLines(base, head) {
  const cmd = base
    ? `git diff --unified=0 ${base} ${head}`
    : `git show --unified=0 ${head}`;

  const raw = tryRun(cmd);
  return raw
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
}

const { base, head } = resolveDiffRange();
const files = changedFiles(base, head);
const lines = addedLines(base, head);

const violations = [];

const sourceTouched = files.some((f) =>
  /^(src|tools|build|lib|popup|options|native-host)\//.test(f),
);
const testsTouched = files.some(
  (f) => /^(tests|specs)\//.test(f) || /\.test\.(ts|tsx|js|jsx)$/.test(f),
);

if (sourceTouched && !testsTouched) {
  violations.push(
    "Source files changed without any test/spec updates (tests/ or specs/).",
  );
}

const blockedCodePatterns = [
  { regex: /\beval\s*\(/, message: "Blocked pattern: eval()" },
  { regex: /\bnew\s+Function\s*\(/, message: "Blocked pattern: new Function()" },
  {
    regex: /child_process\s*\.\s*(exec|execSync|spawn|spawnSync)\s*\(/,
    message: "Blocked pattern: child_process exec/spawn",
  },
  { regex: /shell\s*:\s*true/, message: "Blocked pattern: shell: true" },
];

const secretPatterns = [
  { regex: /AKIA[0-9A-Z]{16}/, message: "Possible AWS access key in diff" },
  { regex: /ghp_[A-Za-z0-9]{36}/, message: "Possible GitHub token in diff" },
  {
    regex: /-----BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY-----/,
    message: "Private key material detected in diff",
  },
  {
    regex: /(api[_-]?key|token|secret)\s*[:=]\s*["'][^"']{8,}["']/i,
    message: "Possible hardcoded secret assignment in diff",
  },
];

for (const line of lines) {
  if (line.includes("constitution-allow")) continue;

  for (const rule of blockedCodePatterns) {
    if (rule.regex.test(line)) {
      violations.push(`${rule.message}: ${line.slice(0, 180)}`);
    }
  }

  for (const rule of secretPatterns) {
    if (rule.regex.test(line)) {
      violations.push(`${rule.message}: ${line.slice(0, 180)}`);
    }
  }
}

if (violations.length > 0) {
  console.error("❌ Constitution policy check failed:");
  for (const v of violations) console.error(` - ${v}`);
  process.exit(1);
}

console.log("✅ Constitution policy check passed.");
