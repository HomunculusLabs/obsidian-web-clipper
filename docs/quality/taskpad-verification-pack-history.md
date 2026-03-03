# TASKPAD Verification Pack History Contract

## Purpose

Define a deterministic NDJSON telemetry contract for recording `taskpad:verification-pack` generation and `taskpad:verification-pack-contract` evaluation events across autonomous intake loops.

## Problem Statement

`taskpad:verification-pack` and `taskpad:verification-pack-contract` produce deterministic Builder handoff state, but without run-to-run telemetry, drift/regressions in handoff packets become hard to attribute across autonomous cycles. This contract defines the canonical history artifact for auditability.

## History Event Schema

Each line in the NDJSON history file represents one deterministic history event.

### Required Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `number` | ✅ | History schema version (must be `1`) |
| `eventType` | `string` | ✅ | Event type: `"pack-generated"` or `"contract-evaluated"` |
| `sliceId` | `string` | ✅ | Unique identifier for the intake slice (format: `YYYY-MM-DD-slug`) |
| `workQueueFingerprint` | `string` | ✅ | SHA-256 hash of canonical work queue state (sorted bullet texts) |
| `packHash` | `string` | ✅ | SHA-256 hash of the verification pack JSON content |
| `generatedAt` | `string` | ✅ | ISO 8601 timestamp in UTC (format: `YYYY-MM-DDTHH:mm:ss.sssZ`) |
| `sourceCommand` | `string` | ✅ | Command that generated this event: `"taskpad:verification-pack"` or `"taskpad:verification-pack-contract"` |
| `driftRuleId` | `string \| null` | ✅ | Rule ID if contract evaluation failed, otherwise `null` |
| `eventId` | `string` | ✅ | Unique event identifier (UUID v4 or deterministic ULID) |

### Optional Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `planPath` | `string` | ❌ | Absolute path to IMPLEMENTATION_PLAN.md |
| `taskpadPath` | `string` | ❌ | Absolute path to TASKPAD.md |
| `durationMs` | `number` | ❌ | Command execution duration in milliseconds |
| `metadata` | `object` | ❌ | Additional metadata (see below) |

### Metadata Object (Optional)

| Field | Type | Description |
|-------|------|-------------|
| `uncheckedCount` | `number` | Number of unchecked TP tasks in the slice |
| `plannedCount` | `number` | Number of planned Work Queue items |
| `commandCount` | `number` | Number of verification commands in the slice |
| `inputHash` | `string` | SHA-256 of combined inputs (taskpad + plan content) |

## Event Types

### `pack-generated`

Emitted when `taskpad:verification-pack` successfully generates a handoff pack.

```json
{
  "version": 1,
  "eventType": "pack-generated",
  "sliceId": "2026-03-02-verification-pack-history",
  "workQueueFingerprint": "a1b2c3d4e5f6...",
  "packHash": "f6e5d4c3b2a1...",
  "generatedAt": "2026-03-02T15:30:00.000Z",
  "sourceCommand": "taskpad:verification-pack",
  "driftRuleId": null,
  "eventId": "evt-550e8400-e29b-41d4-a716-446655440000",
  "metadata": {
    "uncheckedCount": 6,
    "plannedCount": 3,
    "commandCount": 5,
    "inputHash": "deadbeef..."
  }
}
```

### `contract-evaluated`

Emitted when `taskpad:verification-pack-contract` evaluates a pack against current slice state.

**Pass case:**
```json
{
  "version": 1,
  "eventType": "contract-evaluated",
  "sliceId": "2026-03-02-verification-pack-history",
  "workQueueFingerprint": "a1b2c3d4e5f6...",
  "packHash": "f6e5d4c3b2a1...",
  "generatedAt": "2026-03-02T15:31:00.000Z",
  "sourceCommand": "taskpad:verification-pack-contract",
  "driftRuleId": null,
  "eventId": "evt-550e8400-e29b-41d4-a716-446655440001"
}
```

**Fail case:**
```json
{
  "version": 1,
  "eventType": "contract-evaluated",
  "sliceId": "2026-03-02-verification-pack-history",
  "workQueueFingerprint": "a1b2c3d4e5f6...",
  "packHash": "f6e5d4c3b2a1...",
  "generatedAt": "2026-03-02T15:32:00.000Z",
  "sourceCommand": "taskpad:verification-pack-contract",
  "driftRuleId": "VPH003_PACK_HASH_MISMATCH",
  "eventId": "evt-550e8400-e29b-41d4-a716-446655440002"
}
```

## Rule IDs

History events reference these deterministic rule IDs for contract failures:

| Rule ID | Severity | Description |
|---------|----------|-------------|
| `VPH001_SLICE_ID_MISMATCH` | `error` | Pack slice ID doesn't match current active slice |
| `VPH002_FINGERPRINT_MISMATCH` | `error` | Work queue fingerprint doesn't match current state |
| `VPH003_PACK_HASH_MISMATCH` | `error` | Pack content hash doesn't match expected value |
| `VPH004_PACK_NOT_FOUND` | `error` | Referenced pack file does not exist |
| `VPH005_PACK_PARSE_ERROR` | `error` | Pack file is not valid JSON |
| `VPH006_MISSING_REQUIRED_FIELD` | `error` | Pack is missing required fields |
| `VPH007_COMMAND_NOT_EXECUTABLE` | `warning` | Verification command not found in package.json |
| `VPH008_HISTORY_APPEND_FAILED` | `error` | Failed to append event to history file |
| `VPH009_HISTORY_READ_FAILED` | `error` | Failed to read/parse history file |
| `VPH010_DUPLICATE_EVENT_SUPPRESSED` | `info` | Duplicate event was not appended (idempotency) |

## Idempotency Semantics

History emission MUST be idempotent for repeated runs with unchanged inputs:

### Duplicate Detection Key

Events are considered duplicates when these fields match:
- `sliceId`
- `workQueueFingerprint`
- `packHash`
- `sourceCommand`
- `driftRuleId` (null must match null)

### Idempotency Behavior

1. **First run:** Append full event to history with new `eventId`
2. **Duplicate run:**
   - If `--history-dedupe=skip` (default): Do not append; emit diagnostic with `VPH010_DUPLICATE_EVENT_SUPPRESSED`
   - If `--history-dedupe=append`: Append anyway with new `eventId` and `metadata.duplicateOf` referencing original
   - If `--history-dedupe=noop`: Append a minimal noop event with `eventType="duplicate-suppressed"`

### Deterministic Ordering

History events MUST be appended in the order they are generated. Each append operation:
1. Opens file in append mode (O_APPEND)
2. Writes single NDJSON line with trailing newline
3. Closes file immediately
4. No batching or buffering across events

## File Format

- **Format:** NDJSON (Newline Delimited JSON)
- **Extension:** `.ndjson`
- **Encoding:** UTF-8
- **Line ending:** LF (`\n`)
- **Default path:** `docs/quality/taskpad-verification-pack-history.ndjson`

### Example File Content

```ndjson
{"version":1,"eventType":"pack-generated","sliceId":"2026-03-02-verification-pack-history","workQueueFingerprint":"abc123...","packHash":"def456...","generatedAt":"2026-03-02T15:30:00.000Z","sourceCommand":"taskpad:verification-pack","driftRuleId":null,"eventId":"evt-550e8400-e29b-41d4-a716-446655440000"}
{"version":1,"eventType":"contract-evaluated","sliceId":"2026-03-02-verification-pack-history","workQueueFingerprint":"abc123...","packHash":"def456...","generatedAt":"2026-03-02T15:31:00.000Z","sourceCommand":"taskpad:verification-pack-contract","driftRuleId":null,"eventId":"evt-550e8400-e29b-41d4-a716-446655440001"}
```

## CLI Contract (for history-aware commands)

### Common Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `--history <path>` | ❌ | Path to history NDJSON file (default: `docs/quality/taskpad-verification-pack-history.ndjson`) |
| `--history-dedupe <mode>` | ❌ | Dedupe mode: `skip` (default), `append`, `noop` |
| `--history-dry-run` | ❌ | Emit event to stdout instead of appending to file |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `VPH_HISTORY_PATH` | Default history file path override |
| `VPH_DEDUPE_MODE` | Default dedupe mode override |

## TypeScript Types

See `tools/lib/taskpad-verification-pack-history.ts` for canonical type definitions.

## Verification Commands

```bash
# Generate pack with history logging
bun run taskpad:verification-pack -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md --history docs/quality/taskpad-verification-pack-history.ndjson

# Evaluate contract with history logging
bun run taskpad:verification-pack-contract -- --taskpad TASKPAD.md --plan IMPLEMENTATION_PLAN.md --pack pack.json --history docs/quality/taskpad-verification-pack-history.ndjson

# Run history tests
bun test tests/tools/taskpad-verification-pack-history.test.ts
```
