# Obsidian Web Clipper - Implementation Plan

## TASKPAD Intake Slice (2026-03-02): Work Queue-targeted auto-ideation seeding for empty-queue intake loops

### Distilled Scope
**Problem**
- Current auto-ideation behavior seeds `## Self-Improvement Backlog` when intake queues are empty, but this can leave the project without a directly executable `## Work Queue` item for the next Engineer loop.
- The latest TASKPAD state has no unchecked items across tracked intake queues, so autonomous ideation needs a deterministic path that produces one immediately plannable Work Queue slice instead of staging-only backlog churn.

**In scope**
- Add deterministic `--target-queue work` support to `taskpad:auto-ideation` so selected candidates can be inserted into `## Work Queue` when queues are empty.

### RepoPrompt Builder Context
- **Risks/edge cases to inspect**:
  - Work Queue insertion must preserve verify-command scaffold for planned-command-parity compatibility.

### Task Graph
- [ ] **TP001**: First active task
- [ ] **TP002**: Second active task

### Acceptance Criteria
- `bun run taskpad:auto-ideation -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md --target-queue work --format json` inserts exactly one canonical Work Queue bullet.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-auto-ideation.test.ts
bun run taskpad:auto-ideation -- --taskpad "8 - Projects/Homunculus Labs/Projects/Software/Obsidian Web Clipper/TASKPAD.md" --plan IMPLEMENTATION_PLAN.md --target-queue work --format json
```
