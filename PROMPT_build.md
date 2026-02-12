# Ralph Building Mode — Pi Coding Agent (Obsidian Web Clipper)

You are in **BUILDING mode**.

Your job is to implement the project **one task at a time** using `IMPLEMENTATION_PLAN.md` as the shared state.

## Inputs (always read)
- `AGENTS.md`
- `IMPLEMENTATION_PLAN.md`
- `TEST_REQUIREMENTS.md`
- If the chosen task belongs to a phase, also read the corresponding expanded execution plan in `Tasks/`.

## How to choose the task
1. Scan `IMPLEMENTATION_PLAN.md` from the top.
2. Choose the **first unchecked** task `- [ ] ...`.
3. Work on **only that task** until it is done.

## How to use `Tasks/` execution plans
If the task is part of a phase (Phase 1..Phase 8), use:
- `Tasks/00_INDEX.md` to find ordering.
- The relevant `Tasks/NN_*.md` file to guide file-level changes.

Do not attempt to execute multiple phases in one iteration.

## Implementation rules
- Prefer small files and modules.
- Keep `src/shared/` as the shared utility center.
- Keep extractors in `src/content/extractors/`, templates in `src/content/templates/`.
- CLI tools go in `tools/` with `--json` and `--stdout` flags.
- Maintain per-file guideline: keep files under 400 LOC where possible.
- Use existing patterns: check how current code does things before adding new patterns.
- All new types go in `src/shared/types.ts` or a new file in `src/shared/`.
- All new message types go in `src/shared/messages.ts`.
- All new settings go in `src/shared/settings.ts` with defaults.

## Creating new tasks (IMPORTANT)
While working on any task, you may discover work that needs to be done — bugs, missing prerequisites, refactors, additional tests, edge cases, or new features that logically follow. **You are expected to create new tasks when appropriate.**

### When to create tasks
- **Missing prerequisite:** current task needs something that doesn't exist yet → add a task for it in the appropriate phase section.
- **Bug found:** discovered a bug in existing code → add a fix task in the `Emergent — Discovered Work` section at the bottom of `IMPLEMENTATION_PLAN.md`.
- **Refactor needed:** a file is getting too large, code is duplicated, or abstractions are wrong → add a refactor task.
- **Test gap:** you notice untested code paths, missing edge cases, or fragile areas → add test tasks.
- **Follow-up work:** the current task reveals obvious next steps not yet in the plan → add them.
- **Spec ambiguity:** if you resolve an ambiguity while implementing, add a task to document the decision.

### How to create tasks
1. Add new `- [ ]` entries to `IMPLEMENTATION_PLAN.md` in the appropriate section:
   - If the task belongs to an existing phase, add it under that phase's heading.
   - If it doesn't fit any phase, add it under `## Emergent — Discovered Work` at the bottom.
2. Use the same format: `- [ ] **Task N**: <description>`
3. If adding multiple related tasks, group them with a sub-heading comment.
4. **Do NOT work on newly created tasks in the same iteration.** Just add them and continue with your current task. The next iteration will pick them up in order.

### Task creation in the commit
Include newly created tasks in the same commit as your completed work. The commit message should note tasks were added, e.g.:
```
feat: implement Twitter thread detection + added 2 follow-up tasks
```

## Verification
Before marking the task complete, run the checks required by `TEST_REQUIREMENTS.md`.
At minimum:
- `bun run typecheck`
- `bun run build`
- `bun test` (once test infra exists)

## Completion
When the task is complete:
1. Commit changes (include any newly created tasks in the same commit).
2. Mark the task `[x]` in `IMPLEMENTATION_PLAN.md`.
3. Output exactly:

```
RALPH_COMPLETE: <the task you completed>
```

If you also created new tasks, add a line:
```
RALPH_TASKS_ADDED: <count> new tasks created
```

Then stop.
