#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath || !existsSync(eventPath)) {
  console.log("ℹ️ No event payload detected; skipping PR metadata validation.");
  process.exit(0);
}

let event;
try {
  event = JSON.parse(readFileSync(eventPath, "utf8"));
} catch {
  console.log("ℹ️ Could not parse event payload; skipping PR metadata validation.");
  process.exit(0);
}

const pr = event.pull_request;
if (!pr) {
  console.log("ℹ️ Not a pull_request event; skipping PR metadata validation.");
  process.exit(0);
}

const title = pr.title ?? "";
const body = pr.body ?? "";
const headRef = pr.head?.ref ?? "";

const isAgentPR =
  /Agent-Generated:\s*true/i.test(body) ||
  /^agent\//i.test(headRef) ||
  /\[agent\]/i.test(title);

if (!isAgentPR) {
  console.log("ℹ️ PR is not marked as agent-generated; metadata gate skipped.");
  process.exit(0);
}

const requiredMarkers = [
  "## Constitution Checklist",
  "## Security Review",
  "## Agent Provenance",
  "Agent-Generated: true",
  "Model:",
  "Run-ID:",
  "Task/Issue:",
  "- [x] I verified this PR against PROJECT_CONSTITUTION.md",
  "- [x] I reviewed security impact (input validation, secrets, auth/authz)",
  "- [x] I ran required quality checks (typecheck/lint/tests)",
];

const missing = requiredMarkers.filter((marker) => !body.includes(marker));

if (missing.length > 0) {
  console.error("❌ Agent PR metadata validation failed.");
  console.error("Missing required PR body markers:");
  for (const marker of missing) {
    console.error(` - ${marker}`);
  }
  process.exit(1);
}

console.log("✅ Agent PR metadata validation passed.");
