# Ralph Loop — Pi Coding Agent Driver (Obsidian Web Clipper)

This repo uses a Ralph-style loop, driven manually/iteratively by the **Pi coding agent**.

## What "Pi as the driver" means
- Pi (this coding agent) reads/writes files in the repo, runs commands, and commits.
- Progress lives on disk in `IMPLEMENTATION_PLAN.md` and `Tasks/`.
- Each iteration does **one** task, then stops.

## Standard iteration
1. Open `IMPLEMENTATION_PLAN.md`.
2. Pick the first unchecked task.
3. If applicable, open the matching `Tasks/0X_*.md` execution plan for file-level guidance.
4. Implement the task.
5. Run verification commands (typecheck/build/test).
6. Commit.
7. Mark the task `[x]`.
8. End with:

```
RALPH_COMPLETE: <task>
```

## Optional: phase-first execution
If you want to execute phase-by-phase, use `Tasks/00_INDEX.md` as the order and treat each phase file as the "local spec" for the set of tasks you generate in `IMPLEMENTATION_PLAN.md`.
