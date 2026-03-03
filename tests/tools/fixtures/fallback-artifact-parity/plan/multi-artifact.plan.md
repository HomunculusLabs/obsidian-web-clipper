# Obsidian Web Clipper - Implementation Plan

## TASKPAD Intake Slice (2026-03-02): Fallback-artifact parity gate

### Distilled Scope
Add deterministic `taskpad:fallback-artifact-parity` contract that validates artifact lifecycle state.

### Task Graph
- [x] **TP001**: Define `taskpad:fallback-artifact-parity` rule contract
- [x] **TP002**: Implement parser/resolver for mutator fallback artifacts
- [x] **TP003**: Implement gate evaluation logic
- [ ] **TP004**: Add fixture corpus covering pass/fail scenarios
- [ ] **TP005**: Add focused tests for the new gate

### Verification Commands

bun run typecheck
