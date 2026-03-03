# Obsidian Web Clipper - Implementation Plan

## TASKPAD Intake Slice (2026-03-02): Work Queue-targeted auto-ideation seeding for empty-queue intake loops

### Distilled Scope
**Problem**
- Current auto-ideation behavior seeds `## Self-Improvement Backlog` when intake queues are empty, but this can leave the project without a directly executable `## Work Queue` item.

**In scope**
- Add deterministic `--target-queue work` support to `taskpad:auto-ideation`.

### RepoPrompt Builder Context
- **Risks/edge cases to inspect**:
  - Work Queue insertion must preserve verify-command scaffold.

### Task Graph
- [ ] **TP001**: First active task
- [ ] **TP002**: Second active task

### Acceptance Criteria
- Work Queue ideation fails when heading is missing.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-auto-ideation.test.ts
bun run taskpad:auto-ideation -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md --target-queue work --format json
```
