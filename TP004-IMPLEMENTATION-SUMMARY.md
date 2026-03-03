# TP004 Implementation Summary

## Task
**TP004**: Refactor `tests/e2e/headless-clip-harness.test.ts` (or companion helper) so scenario definitions are reusable by the matrix runner without changing existing behavioral assertions.

## Implementation Details

### Files Created
1. **`tests/e2e/support/headless-scenario-helpers.ts`** (new)
   - Shared scenario execution utilities for headless clip testing
   - Exports:
     - `setupDomFromFixture()` - Sets up Happy-DOM environment from HTML fixture
     - `executeScenario()` - Executes a headless clip scenario (extraction, frontmatter, markdown)
     - `withScenario()` - Convenience wrapper with automatic DOM cleanup (supports sync and async callbacks)
     - `loadFixtureHtml()` - Loads fixture HTML content
     - `ScenarioExecutionOptions`, `ScenarioExecutionResult`, `DomRestoreFn` types

### Files Modified

1. **`tests/e2e/headless-clip-harness.test.ts`** (refactored)
   - Removed duplicate DOM setup code (`withFixtureDom` function)
   - Removed direct imports of `extractWebPageContent`, `buildFrontmatterFromClip`, `Window`, `happy-dom`, etc.
   - Replaced inline scenario execution with shared `withScenario()` helper
   - All existing behavioral assertions preserved unchanged:
     - `wires sandbox helpers to extractor/frontmatter clip tooling`
     - `scenario #1: generic web clip assertions`
     - `scenario #2: SeedFinder integrity assertions`
     - `scenario #3: CLI save contract assertions`

2. **`tools/lib/matrix-scenario-validator.ts`** (refactored)
   - Removed duplicate `setupDomFromFixture()` function
   - Now imports and uses shared `setupDomFromFixture` from `headless-scenario-helpers.ts`
   - Maintains same validation behavior and assertion logic

3. **`tools/test-e2e-matrix.ts`** (fixed working directory issue)
   - Added logic to resolve repo root from manifest path
   - Changed working directory to repo root before execution
   - Ensures fixture paths resolve correctly regardless of where script is run

## Key Features

### Reusability
- `headless-scenario-helpers.ts` exports reusable scenario execution functions
- Both the headless-clip-harness test and matrix-scenario-validator use the same DOM setup logic
- `withScenario()` provides a clean API for running scenarios with automatic cleanup

### Backward Compatibility
- All existing behavioral assertions in `headless-clip-harness.test.ts` remain unchanged
- Test behavior and expectations are identical to before refactoring
- `test:quality:headless` continues to work as expected

### Async Support
- `withScenario()` supports both sync and async callbacks
- DOM cleanup happens reliably via `finally` block (for sync) or `.finally()` (for async)
- CLI save scenario tests that use `await saveViaCli()` work correctly

## Verification

### Test Results
All headless clip harness tests pass:
```
tests/e2e/headless-clip-harness.test.ts:
✓ wires sandbox helpers to extractor/frontmatter clip tooling [24.43ms]
✓ scenario #1: generic web clip assertions [8.35ms]
✓ scenario #2: SeedFinder integrity assertions [14.30ms]
✓ scenario #3: CLI save contract assertions [6.21ms]

4 pass
0 fail
43 expect() calls
```

### Matrix Runner Results
Matrix runner executes all scenarios correctly:
```json
{
  "status": "OK",
  "total": 3,
  "passed": 3,
  "failed": 0,
  "scenarios": [
    { "id": "cli-save-contract", "passed": true, "required": true },
    { "id": "generic-web-clip", "passed": true, "required": true },
    { "id": "seedfinder-strain-profile", "passed": true, "required": true }
  ]
}
```

### Quality Gate Verification
`bun run test:quality:headless` passes:
- `typecheck` - ✓
- `test:seedfinder` - 95 pass, 0 fail
- `test:seedfinder:smoke` - 2 pass, 0 fail
- `test:e2e:headless` - 4 pass, 0 fail

## Acceptance Criteria Met

✅ **Scenario definitions are reusable**
   - Shared helper module (`headless-scenario-helpers.ts`) exports scenario execution utilities
   - Both test harness and matrix validator use the same setupDomFromFixture logic
   - `withScenario()` provides a consistent interface for running scenarios

✅ **Existing behavioral assertions unchanged**
   - All 4 tests in `headless-clip-harness.test.ts` pass with identical behavior
   - 43 expect() calls continue to work as before
   - No changes to test assertions or expectations

✅ **Matrix runner integration works**
   - Matrix runner uses the same shared DOM setup logic
   - All 3 scenarios (generic-web-clip, seedfinder-strain-profile, cli-save-contract) pass
   - Deterministic output with stable ordering is maintained

✅ **Code deduplication achieved**
   - Removed duplicate `setupDomFromFixture` from matrix-scenario-validator.ts
   - Removed duplicate `withFixtureDom` from headless-clip-harness.test.ts
   - Single source of truth for DOM setup logic in shared helper module

## Next Steps
- **TP005**: Add at least one additional scenario path already supported in repo tooling/fixtures and register it as required in the manifest
- **TP006**: Add focused tests (new `tests/tools` or `tests/e2e` target) for manifest validation failures, deterministic ordering, and missing-required-scenario diagnostics
- **TP007**: Wire `test:e2e:matrix` in `package.json`, document execution + expected output in `README.md`, and add recommendation for autonomous intake verification usage
