# Pilot Price Signal Fixtures (TP008)

This document describes the test fixtures for `pilot:price-signal` validation.

## Fixtures Overview

### 1. Brief File
- **File**: `pilot-price-signal.brief.md`
- **Purpose**: OFFER_BRIEF.md test fixture with pricing constraints
- **Key values**:
  - Acceptable test range: **$8-$19/mo**
  - Pilot anchor: **$12/mo**

### 2. Happy Path Fixture
- **Root**: `pilot-price-signal-happy-root/`
- **Batch**: `test-pilot-2026-01/pilot-response-log.md`
- **Status**: `ok`
- **Total Responses**: 10
- **Coverage**: All price buckets represented ($8-$11: 3, $12: 1, $13-$15: 2, $16-$19: 4)
- **Diagnostics**: Empty (no errors)
- **Expected Output**:
  - `recommendedNextAnchor`: 12
  - `band`: high
  - `confidence.level`: 0.8

### 3. Missing WTP Value Fixture
- **Root**: `pilot-price-signal-missing-wtp-root/`
- **Batch**: `test-pilot-2026-02/pilot-response-log.md`
- **Status**: `error`
- **Error Codes**: `MISSING_WTP_VALUE` (3 occurrences)
- **Affected Rows**:
  - `bravo_test`: Empty WTP value
  - `charlie_test`: "no response yet"
  - `echo_test`: Empty WTP value
- **Total Valid Responses**: 2 (alpha_test: 12, delta_test: 10)
- **Expected Output**:
  - `recommendedNextAnchor`: 12
  - `band`: low
  - `confidence.level`: 0.2

### 4. Out of Range WTP Fixture
- **Root**: `pilot-price-signal-out-of-range-root/`
- **Batch**: `test-pilot-2026-03/pilot-response-log.md`
- **Status**: `error`
- **Error Codes**: `WTP_OUT_OF_RANGE` (5 occurrences)
- **Affected Rows**:
  - `bravo_test`: $5 (below range)
  - `charlie_test`: $25 (above range)
  - `delta_test`: $7 (below range)
  - `echo_test`: $20 (above range)
  - `foxtrot_test`: $30 (above range)
- **Total Valid Responses**: 6 (alpha_test: 12, charlie_test: 25 rejected, etc.)
- **Valid After Filtering**: 2 (alpha_test: 12, charlie_test: 15)
- **Expected Output**:
  - `recommendedNextAnchor`: 12
  - `band`: high
  - `confidence.level`: 0.76

### 5. Invalid WTP Value (Malformed) Fixture
- **Root**: `pilot-price-signal-malformed-root/`
- **Batch**: `test-pilot-2026-04/pilot-response-log.md`
- **Status**: `error`
- **Error Codes**: `INVALID_WTP_VALUE`, `MISSING_WTP_VALUE`
- **Affected Rows**:
  - `alpha_test`: "not-a-number" → `INVALID_WTP_VALUE`
  - `bravo_test`: "abc123" → `INVALID_WTP_VALUE`
  - `delta_test`: "N/A" → `MISSING_WTP_VALUE`
- **Total Valid Responses**: 1 (charlie_test: 15)
- **Expected Output**:
  - `recommendedNextAnchor`: 14
  - `band`: low
  - `confidence.level`: 0.1

## Verification Commands

```bash
# Happy path - should return status: ok
bun run pilot:price-signal -- \
  --root tests/tools/fixtures/pilot-price-signal-happy-root \
  --brief tests/tools/fixtures/pilot-price-signal.brief.md \
  --format json

# Missing WTP - should trigger MISSING_WTP_VALUE errors
bun run pilot:price-signal -- \
  --root tests/tools/fixtures/pilot-price-signal-missing-wtp-root \
  --brief tests/tools/fixtures/pilot-price-signal.brief.md \
  --format json

# Out of range WTP - should trigger WTP_OUT_OF_RANGE errors
bun run pilot:price-signal -- \
  --root tests/tools/fixtures/pilot-price-signal-out-of-range-root \
  --brief tests/tools/fixtures/pilot-price-signal.brief.md \
  --format json

# Invalid WTP - should trigger INVALID_WTP_VALUE errors
bun run pilot:price-signal -- \
  --root tests/tools/fixtures/pilot-price-signal-malformed-root \
  --brief tests/tools/fixtures/pilot-price-signal.brief.md \
  --format json
```

## Price Bucket Distribution

All fixtures use the deterministic bucket boundaries:
- **$8-$11**: 8 ≤ WTP < 11.5 (below anchor)
- **$12**: 11.5 ≤ WTP < 12.5 (anchor price point)
- **$13-$15**: 12.5 ≤ WTP < 15.5 (above anchor, mid-high)
- **$16-$19**: 15.5 ≤ WTP ≤ 19 (above anchor, high)

Note: WTP validation rejects values outside $8-$19 before bucket assignment, so $20 triggers `WTP_OUT_OF_RANGE` even though the bucket logic allows up to 20.

## Error Code Reference

| Rule ID | Description | Example Values |
|---------|-------------|----------------|
| `MISSING_WTP_VALUE` | WTP is empty, "no response yet", or "N/A" | `""`, `"no response yet"`, `"N/A"` |
| `INVALID_WTP_VALUE` | WTP cannot be parsed as a number | `"not-a-number"`, `"abc123"` |
| `WTP_OUT_OF_RANGE` | WTP is numeric but outside $8-$19 | `$5`, `$20`, `$25`, `$30` |

## Deterministic Output Guarantees

All fixtures produce deterministic output across runs:
- Stable key ordering in JSON objects
- Precise numeric values (no floating-point drift)
- Consistent error emission order (sorted by recipient)
- Stable timestamp format (ISO 8601 with millisecond precision stripped)
