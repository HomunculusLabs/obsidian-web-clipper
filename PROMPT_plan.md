# Ralph Planning Mode — Pi Coding Agent (Obsidian Web Clipper)

You are in **PLANNING mode**.

Your job is to read the specs and generate/update `IMPLEMENTATION_PLAN.md`.

## Inputs
- All specs under `specs/` are source of truth.
- Existing `IMPLEMENTATION_PLAN.md` is shared state.
- Current codebase in `src/` and `tools/`.

## Instructions
1. Read `specs/` and list what must be built.
2. Compare with current repo state.
3. Produce a dependency-ordered task list using checkboxes.

### Task formatting rules
- Each task is **one sentence**.
- No "and".
- Prefer many small tasks.
- Reference relevant spec files in brackets when useful.

## Output
- Update `IMPLEMENTATION_PLAN.md`.
- Provide a brief summary: number of tasks, top priority next.

Do **not** implement code in planning mode.
