# Project Constitution — Obsidian Web Clipper

This constitution defines the non-negotiable standards for all code changes, including agent-generated changes.

## 1) Security Baseline (MANDATORY)

1. No secrets in source, tests, logs, fixtures, or commit history.
2. All external/untrusted input must be validated before use.
3. Do not introduce dynamic code execution (`eval`, `new Function`) without explicit approved exception.
4. Do not introduce shell execution paths with untrusted input.
5. Dependency risk must be reviewed for new packages.

## 2) Quality Baseline (MANDATORY)

1. CI must pass: typecheck, lint, format check, and test suite.
2. Source changes must include test coverage for behavior changes.
3. Keep PRs scoped to a single intent.
4. Maintain existing code patterns and folder boundaries.

## 3) Agent Governance Baseline (MANDATORY)

1. Agent-generated changes must come through pull requests (no direct pushes to protected branches).
2. PRs must include provenance (agent identity, run id/session id, model, and task reference).
3. Agent-generated PRs must include explicit constitution and security checklist confirmation.
4. Agent-generated PRs require human review before merge.

## 4) Enforced CI Gates

The CI pipeline enforces the following checks:

- **PR metadata gate** (`validate-pr-body.mjs`) for agent provenance/checklist compliance.
- **Constitution policy gate** (`policy-check.mjs`) for banned patterns, secret regexes, and test-presence requirements.
- **Quality gate** (`bun run ci:full`) for typecheck/lint/format/tests.

## 5) Exceptions

Any exception must:

1. Be documented in the PR body under `## Constitution Exception`.
2. Include business justification and risk mitigation.
3. Be explicitly approved by a human reviewer.

If an exception is not documented and approved, the change is non-compliant.
