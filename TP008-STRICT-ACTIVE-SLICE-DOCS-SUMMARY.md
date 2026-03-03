# TP008: Strict Active-Slice Documentation - Implementation Summary

**Task:** Update `README.md` + quality contract docs with strict-active-slice semantics and verification flow.

**Date:** 2026-03-01

## Changes Made

### 1. README.md Updates

#### Added Strict Mode Command Examples
Added three new command examples in the "TASKPAD intake gate" section:
- `bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md --strict-active-slice --format json` (strict mode with JSON output)
- `bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md --strict-active-slice` (strict mode, human-readable)

#### New Section: "Strict Active-Slice Mode"
Added comprehensive documentation covering:

**Purpose:**
- Prevent intake drift in autonomous loops
- Ensure loops stop safely when no executable TP tasks exist
- Handle ambiguous active-slice states deterministically

**Invocation:**
- Base mode (backward compatible)
- Strict mode with JSON output (recommended for autonomous loops)
- Strict mode with human-readable output

**Strict Mode Rules:**
| Rule ID | Condition | Exit Code | Remediation |
|----------|-----------|------------|-------------|
| `PLI009_NO_UNCHECKED_TP_TASKS` | Newest slice has zero unchecked TP tasks | 1 | Archive completed slice or add new tasks |
| `PLI010_AMBIGUOUS_ACTIVE_SLICE` | Cannot deterministically identify active slice | 1 | Fix IMPLEMENTATION_PLAN.md structure |

**Success/Failure Matrix:**
- Compares base mode vs strict mode behavior for all scenarios
- Notes where base mode accepts ambiguous state as "good enough" for manual review

**Expected JSON Output (Strict Mode):**
- Complete example showing `status`, `mode`, `activeSlice`, `violations`, `validatedRules`
- Documents all fields including `heading`, `line`, `hasUncheckedTasks`, TP counts

**Integration with Autoplan Orchestrator:**
- **PLI009 (no unchecked tasks):** Verdict `hold`, reason `AUTOPLAN_HOLD_STRICT_NO_UNCHECKED_TASKS`
- **PLI010 (ambiguous slice):** Verdict `blocked`, reason `AUTOPLAN_BLOCKED_STRICT_AMBIGUOUS_SLICE`
- Base rule failures: Verdict `hold`, reason `AUTOPLAN_HOLD_PLAN_CONTRACT`

**Verification Flow for Autonomous Loops:**
Five-step verification process:
1. Pre-flight checks with strict mode
2. Parse exit status and violations
3. Handle PLI009 (no unchecked tasks) via plan-prune or plan-seed
4. Handle PLI010 (ambiguous slice) via manual fix
5. Post-mutation verification with full intake autoplan

#### Added Verification Evidence Checklist
Added new checklist section "Verification evidence checklist (strict-active-slice mode TP008)":
- Capture pass run with unchecked tasks
- Capture PLI009 failure (no unchecked tasks)
- Capture PLI010 failure (ambiguous slice)
- Verify JSON output includes deterministic `activeSlice` fields
- Verify violation ordering: `PLI001` → `PLI010` → `PLI009` → base rules
- Capture autoplan integration evidence
- Store evidence in `docs/quality/implementation-plan-integrity.md`

#### Reference to Full Documentation
Added pointer to `docs/quality/implementation-plan-integrity.md` for complete contract documentation including:
- Complete rule taxonomy with deterministic IDs
- Detailed pass/failure matrix for all scenarios
- Machine-readable output format specification
- Integration patterns with autonomous intake tools

### 2. Quality Contract Docs

**Status:** No changes required to `docs/quality/implementation-plan-integrity.md`

The existing documentation already contains comprehensive coverage of:
- Strict active-slice mode purpose and invocation
- PLI009 and PLI010 rule definitions with detection scenarios
- Success/failure matrix comparing base vs strict mode
- Machine-readable JSON output format with schema
- Deterministic rule ID ordering
- Integration with `taskpad:intake:autoplan` orchestrator
- Verification commands for strict mode

### 3. IMPLEMENTATION_PLAN.md

**Status:** TP008 marked as completed [x]

## Verification

### Tests Passed
```bash
✅ bun run typecheck
✅ bun test tests/tools/implementation-plan-integrity.test.ts (19 pass, 0 fail)
✅ bun run plan:integrity -- --plan IMPLEMENTATION_PLAN.md --strict-active-slice --format json
```

### Strict Mode Output Verification
Confirmed that strict mode correctly identifies:
- Active slice heading and line number
- Task state: `hasUncheckedTasks: true`, `totalTpTasks: 8`, `uncheckedTpTasks: 1`, `checkedTpTasks: 7`
- All 10 validated rules (8 base + 2 strict)
- Empty violations array when valid

### Autoplan Integration Verification
Confirmed autoplan correctly reports:
- `AUTOPLAN_HOLD_RECOVERY` when queues are empty
- Proper step status tracking (intake-recover, plan-seed, plan-contract)
- Reason codes for each skipped/failed step

## Documentation Coverage

✅ README.md now documents:
- Strict mode invocation examples (JSON and human-readable)
- Complete strict mode rules table (PLI009, PLI010)
- Success/failure matrix comparing base vs strict mode
- Expected JSON output with all required fields
- Integration with autoplan orchestrator
- Five-step verification flow for autonomous loops
- Verification evidence checklist for strict mode
- Reference to full contract documentation

✅ docs/quality/implementation-plan-integrity.md already contains:
- Complete strict-active-slice mode documentation
- Rule definitions with detection scenarios
- Machine-readable output format
- Integration patterns

## Impact Assessment

- **No code changes** - documentation update only
- **Backward compatible** - base mode unchanged
- **Autonomous loop safety** - clear failure semantics for PLI009/PLI010
- **Deterministic behavior** - stable rule ordering and exit codes
- **Auditability** - verification evidence checklist and JSON output

## Next Steps for Operators

1. **For autonomous loops:** Use `--strict-active-slice --format json` in plan:integrity checks
2. **For manual review:** Use `--strict-active-slice` for human-readable output
3. **When PLI009 fires:** Run `taskpad:plan-prune` to archive completed slices
4. **When PLI010 fires:** Manually fix IMPLEMENTATION_PLAN.md slice structure
5. **Verification:** Follow the five-step verification flow documented in README
