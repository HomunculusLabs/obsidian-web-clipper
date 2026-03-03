# TP006 Implementation Summary

**Task**: Add focused tests (new `tests/tools` or `tests/e2e` target) for manifest validation failures, deterministic ordering, and missing-required-scenario diagnostics.

**Date**: 2026-03-01
**Status**: ✅ Complete

## Implementation Details

### Changes Made

**Files Created:**
- `tests/tools/test-e2e-matrix.test.ts` - Comprehensive test suite for the scenario matrix runner

**Files Modified:**
- `tools/test-e2e-matrix.ts` - Fixed repo root detection to handle temp directories in tests

### Test Coverage

The test suite covers three main areas as specified in TP006:

#### 1. Manifest Validation Failures
Tests verify that the matrix runner correctly reports errors for:
- Invalid JSON in manifest files (`MATRIX_MANIFEST_PARSE_ERROR`)
- Missing `manifestVersion` field (`MATRIX_MANIFEST_SCHEMA_INVALID`)
- Missing `scenarios` array (`MATRIX_MANIFEST_SCHEMA_INVALID`)
- Non-array `scenarios` field (`MATRIX_MANIFEST_SCHEMA_INVALID`)
- Missing manifest file handling

#### 2. Missing-Required-Scenario Diagnostics
Tests verify that the matrix runner correctly detects and reports:
- Missing `generic-web-clip` scenario
- Missing `seedfinder-strain-profile` scenario
- Missing `cli-save-contract` scenario
- All three missing required scenarios simultaneously
- Alphabetical sorting of missing required scenarios

#### 3. Deterministic Ordering
Tests verify that scenario results are sorted deterministically:
- Required scenarios before optional scenarios
- Alphabetical sorting within each group (required/optional)
- Stable ordering across multiple runs (excluding timestamp/duration fields)
- Mixed required/optional scenario ordering

#### Additional Coverage
- **Error Codes and Diagnostics**: Machine-readable error codes with context information
- **Human Format Output**: Correct human-readable output with `--format human`
- **Scenario Filtering**: `--scenario` flag behavior for filtering to specific scenarios

### Tool Fix

**Issue**: The `test-e2e-matrix.ts` tool assumed the manifest path always contained `/tests/` and used this to determine the repo root. When tests created manifests in temp directories, this caused a crash.

**Fix**: Updated the repo root detection to fall back to `process.cwd()` when the manifest path doesn't contain `/tests/`:

```typescript
const repoRoot = resolvedManifestPath.includes("/tests/")
  ? resolvedManifestPath.split("/tests/")[0]
  : process.cwd();
```

## Test Results

All 20 tests pass:

```
TP006: Scenario Matrix Tests > manifest validation failures
  ✓ should fail with error code for invalid JSON
  ✓ should fail with error code for missing manifestVersion
  ✓ should fail with error code for missing scenarios array
  ✓ should fail with error code for non-array scenarios
  ✓ should handle missing manifest file gracefully

TP006: Scenario Matrix Tests > missing-required-scenario diagnostics
  ✓ should detect missing required scenario: generic-web-clip
  ✓ should detect missing required scenario: seedfinder-strain-profile
  ✓ should detect missing required scenario: cli-save-contract
  ✓ should detect all three missing required scenarios
  ✓ should report missing required scenarios sorted alphabetically

TP006: Scenario Matrix Tests > deterministic ordering
  ✓ should sort scenarios deterministically by required status then id
  ✓ should produce deterministic JSON output across multiple runs
  ✓ should maintain stable ordering with mixed required/optional scenarios

TP006: Scenario Matrix Tests > error codes and diagnostics
  ✓ should include machine-readable error codes for all failure modes
  ✓ should include context information in error diagnostics
  ✓ should include failure codes in scenario results

TP006: Scenario Matrix Tests > human format output
  ✓ should output human-readable format with --format human
  ✓ should show missing required scenarios in human format

TP006: Scenario Matrix Tests > scenario filtering
  ✓ should filter to single scenario with --scenario flag
  ✓ should handle missing --scenario filter gracefully

20 pass, 0 fail
```

## Verification

### Commands Run
```bash
# Typecheck
bun run typecheck

# Test the new test file
bun test tests/tools/test-e2e-matrix.test.ts

# Verify the matrix runner still works
bun run test:e2e:matrix -- --manifest tests/e2e/fixtures/clip-scenario-manifest.json --format json

# Verify existing e2e tests still pass
bun test tests/e2e/headless-clip-harness.test.ts
```

### Results
- ✅ Typecheck passes
- ✅ All 20 new tests pass
- ✅ Matrix runner emits deterministic JSON output with stable ordering
- ✅ All required scenarios detected and validated
- ✅ Existing e2e tests unaffected

## Acceptance Criteria Met

✅ `bun run test:e2e:matrix -- --manifest tests/e2e/fixtures/clip-scenario-manifest.json --format json` emits deterministic output with stable ordering and explicit diagnostics when required scenarios are missing.

✅ Matrix gate covers generic web, SeedFinder, and CLI-save scenarios via a shared manifest contract.

✅ Failure output includes actionable machine-readable reason codes for schema drift, missing scenarios, and assertion mismatch classes.

✅ `test:quality:headless` (via headless-clip-harness.test.ts) remains runnable and compatible with the new matrix gate workflow.

## Code Quality

- ✅ Typecheck passes (`bun run typecheck`)
- ✅ Tests follow existing patterns from other tool tests (pilot-price-signal, etc.)
- ✅ Deterministic ordering verified across multiple runs
- ✅ Machine-readable error codes match the contract
- ✅ Tests are isolated and don't affect existing functionality
