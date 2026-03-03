# AGENTS.md — Obsidian Web Clipper (Builder Execution Contract)

This file defines the project-local execution contract for Builder Ralph loops.

## Core Contract (strict)
- One run = one TP task from `IMPLEMENTATION_PLAN.md`.
- Always pick the **first unchecked** task line matching `- [ ] **TP###**: ...` in the top active TASKPAD intake slice.
- Do not implement multiple TP tasks in one run.
- Do not re-plan scope here; escalate planning issues to Engineer.

## Preferred Context Workflow (RepoPrompt)
If RepoPrompt is available:
1. `rp_exec tree`
2. `rp_exec search "<task keywords>"`
3. `rp_exec select set/add <relevant files>`
4. `rp_exec context`
5. Read selected files before editing.

If RepoPrompt is unavailable, proceed with direct file reads and report degraded context mode.

## Loop Steps
1. Read `IMPLEMENTATION_PLAN.md` and select first unchecked TP task.
2. Read relevant specs and tests.
3. Implement only selected task.
4. Run verification commands (minimum: typecheck + focused tests).
5. Mark that TP task complete (`[x]`).
6. Commit changes.
7. Output completion marker and stop.

Completion marker:
```
RALPH_COMPLETE: <TP id + short description>
```

Blocked marker:
```
RALPH_BLOCKED: <reason>
```

## Canonical Artifacts
- Plan: `IMPLEMENTATION_PLAN.md`
- Scope intake/backlog: `TASKPAD.md` (vault side, mirrored via orchestrator)
- Test expectations: `TEST_REQUIREMENTS.md`
- Specs: `specs/`

## Commands

### Build
```bash
bun run build
bun run dev
```

### Typecheck
```bash
bun run typecheck
```

### Test
```bash
bun test
```

## Git
Commit after each completed TP task:
```bash
git status
git add -A
git commit -m "feat: <short description>"
```

## Guardrails (stop and escalate)
- Architecture/spec ambiguity beyond current TP scope.
- Missing critical harness/scripts that cannot be safely added in-task.
- Reproducible failures you cannot resolve in-scope.
- Any change likely to break core clipping functionality outside task intent.
