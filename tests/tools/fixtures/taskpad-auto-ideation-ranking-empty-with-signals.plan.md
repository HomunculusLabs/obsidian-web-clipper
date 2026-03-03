# Obsidian Web Clipper - Implementation Plan

## TASKPAD Intake Slice (2026-03-01): Deterministic auto-ideation ranking drift gate

### Distilled Scope
- Keep candidate ranking deterministic for empty-queue seeding.

### RepoPrompt Builder Context
- **Risks/edge cases to inspect:**
  - Ranking tie-break drift could silently reorder backlog seeding priorities.

### Task Graph
- [ ] **TP001**: Add fixture-driven ranking assertions
- [ ] **TP002**: Verify deterministic top-3 ordering

### Acceptance Criteria
- Ranking order is deterministic for identical inputs.

### Verification Commands
```bash
bun test tests/tools/taskpad-auto-ideation.test.ts
```

## TASKPAD Intake Slice (2026-02-28): Semantic dedupe guardrails for AUTO_IDEATION backlog seeding

### Distilled Scope
- Completed slice retained for recent-theme extraction.

### RepoPrompt Builder Context
- **Risks/edge cases to inspect:**
  - Near-duplicate bullets could bypass dedupe rules.

### Task Graph
- [x] **TP001**: Define semantic dedupe normalization contract
- [x] **TP002**: Implement deterministic semantic key builder

### Acceptance Criteria
- Semantically equivalent bullets dedupe deterministically.

### Verification Commands
```bash
bun test tests/tools/taskpad-auto-ideation.test.ts
```
