# Obsidian Web Clipper - Implementation Plan

## TASKPAD Intake Slice (2026-03-01): Deterministic auto-ideation ranking drift gate

### Distilled Scope
- Keep candidate ranking deterministic for empty-queue seeding.

### RepoPrompt Builder Context
- **Risks/edge cases to inspect:**
  - Snapshot drift could change selected backlog seeds without explicit intent.

### Task Graph
- [ ] **TP001**: Add fixture-driven ranking assertions
- [ ] **TP002**: Verify deterministic top-3 ordering

### Acceptance Criteria
- Ranking order is deterministic for identical inputs.

### Verification Commands
```bash
bun test tests/tools/taskpad-auto-ideation.test.ts
```
