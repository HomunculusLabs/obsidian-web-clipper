# Implementation Plan

## TASKPAD Intake Slice (2026-03-04): MarkItDown priority-brief refresh contract parity gate

### Distilled Scope
**In scope**
- Add deterministic `taskpad:markitdown-priority-brief-refresh-contract-parity` analysis for planned/generated `markitdown-conversion-priority-brief.md` artifacts.
- Validate required wiring across `src/popup/save.ts`, `src/shared/messages.ts`, `src/background/router.ts`, and `src/background/handlers/refreshMarkitdownConversionPriorityBrief.ts`.

### Task Graph
- [x] **TP001**: Specify parity gate contract
- [x] **TP002**: Implement `tools/taskpad-markitdown-priority-brief-refresh-contract-parity.ts`
- [x] **TP003**: Add deterministic fixture corpus + tests

### Verification Commands
```bash
bun run taskpad:markitdown-priority-brief-refresh-contract-parity -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md --project-root . --format json
```
