# Obsidian Web Clipper - Implementation Plan

## TASKPAD Intake Slice (2026-03-02): Work Queue-targeted auto-ideation seeding for empty-queue intake loops

### Distilled Scope
**Problem**
- Current auto-ideation behavior seeds `## Self-Improvement Backlog` when intake queues are empty.

**In scope**
- Add deterministic `--target-queue work` support to `taskpad:auto-ideation`.

### RepoPrompt Builder Context
- **Risks/edge cases to inspect**:
  - Self-Improvement Backlog insertion remains backward compatible.

### Task Graph
- [ ] **TP001**: First active task
- [ ] **TP002**: Second active task

### Acceptance Criteria
- Self-Improvement Backlog ideation works with mixed markers.

### Verification Commands
```bash
bun run typecheck
bun test tests/tools/taskpad-auto-ideation.test.ts
bun run taskpad:auto-ideation -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md --format json
```
