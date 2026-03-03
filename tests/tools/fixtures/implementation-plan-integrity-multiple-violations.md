# Obsidian Web Clipper - Implementation Plan

## TASKPAD Intake Slice (2026-03-01): Multiple violations test

### Distilled Scope
- This fixture intentionally has multiple violations.

### RepoPrompt Builder Context
- Entry files: IMPLEMENTATION_PLAN.md

### Task Graph
- [ ] **TP003**: Third task (out of order)
- [ ] **TP001**: First task (out of order)
- [ ] **TP001**: Duplicate ID
- [ ] Invalid task line without TP prefix
- [ ] **TP002**: Second task

### Acceptance Criteria
- Tests should fail deterministically.

### Verification Commands
```bash
# No commands here
```
