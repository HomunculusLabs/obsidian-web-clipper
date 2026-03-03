# Gitea Agent Governance Setup

This repository ships a Gitea-native CI governance flow for agent-generated code.

## Files Added

- `PROJECT_CONSTITUTION.md`
- `.gitea/workflows/agent-governance.yml`
- `.gitea/pull_request_template.md`
- `tools/ci/policy-check.mjs`
- `tools/ci/validate-pr-body.mjs`

## What CI Enforces

1. **PR Metadata Gate**
   - Runs `tools/ci/validate-pr-body.mjs`
   - Enforces provenance/checklist fields for agent-generated PRs.

2. **Constitution Policy Gate**
   - Runs `tools/ci/policy-check.mjs`
   - Blocks dangerous patterns and probable secrets in added lines.
   - Requires test/spec updates when source files change.

3. **Quality Gate**
   - Runs `bun run ci:full`
   - Requires typecheck, lint, format check, and tests to pass.

## Required Gitea Repository Settings (manual)

In Gitea repository settings:

1. Enable Actions and register a runner for this repo/org.
2. Protect `main` branch.
3. Require pull requests to merge.
4. Require status checks:
   - `PR Metadata Gate`
   - `Constitution Policy Gate`
   - `Quality Gate (typecheck/lint/format/tests)`
5. Require at least one human approval for merge.
6. Disable force-push to protected branches.
7. (Recommended) Require signed commits.

## Agent PR Convention

For agent-generated PRs, either:
- set branch name like `agent/<something>`, or
- include `[agent]` in PR title, or
- set `Agent-Generated: true` in PR body.

Then fill all provenance fields in PR template.

## Notes

- `policy-check.mjs` supports allowlisted exceptions by adding `constitution-allow` on the same line as a flagged pattern.
- Exceptions still require explicit human approval and PR justification.
