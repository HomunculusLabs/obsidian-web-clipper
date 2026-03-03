---
artifact: pilot-latency-contract
author: Builder
created_at: 2026-03-01
batch: first-pilot-2026-02
depends_on:
  - TP001
scope:
  - required-inputs
  - timestamp-assumptions
  - cold-aging-rule
  - metric-field-definitions
---

# Pilot Latency Analyzer Contract (`pilot:latency`)

## Purpose

Define the deterministic contract for the `pilot:latency` CLI command that analyzes pilot outreach response timing by channel/CTA variant and emits per-batch/per-channel latency metrics in JSON format.

## Required Inputs

The `pilot:latency` command requires two input artifacts:

### 1. Run Sheet (`--run-sheet <path>`)

**Format**: Markdown file with frontmatter and table

**Required frontmatter fields**:
- `artifact: pilot-run-sheet`
- `batch: <batch-id>`

**Required table columns** (exact order):
| Column | Type | Description |
|--------|------|-------------|
| Recipient Handle | string | Unique recipient identifier (e.g., `pilot_alpha`) |
| Channel | string | Outreach channel (e.g., `X DM`, `Discord DM`, `Email`) |
| Send Status | enum | One of: `not sent`, `sent`, `failed`, `blocked` |
| Sent Timestamp (ISO-8601) | ISO-8601 string | UTC timestamp when message was sent (e.g., `2026-02-27T18:51:34Z`) |
| Artifact Link | string | Link to the artifact sent (unused for latency calculation) |
| CTA Variant (optional) | string | CTA variant identifier for A/B testing (e.g., `CTA-A`, `CTA-B`) |

**Validation rules**:
- Table must have at least one data row
- All rows must have all 5 columns present
- `Sent Timestamp` must be valid ISO-8601 format with `Z` suffix (UTC)
- Only rows with `Send Status: sent` are included in latency calculations
- Duplicate recipient handles are not allowed

### 2. Response Log (`--responses <path>`)

**Format**: Markdown file with frontmatter and table

**Required frontmatter fields**:
- `artifact: pilot-response-log`
- `batch: <batch-id>`

**Required table columns** (exact order):
| Column | Type | Description |
|--------|------|-------------|
| Recipient | string | Recipient handle matching run sheet |
| Source Channel | string | Channel matching run sheet |
| Workflow Sentence | string | Response content or `no response yet` |
| Objection Type | enum | One of: `trust`, `price`, `workflow-fit`, `missing-feature`, `timing`, `other`, `no response yet` |
| WTP ($/mo) | number or `no response yet` | Willingness-to-pay signal |
| Next-Step Decision | enum | One of: `advance`, `nurture`, `disqualify`, `pending` |
| Decision Rationale | string | Human-readable rationale |
| Response State | enum | One of: `no response yet`, `replied`, `follow-up converted`, or other custom state |

**Validation rules**:
- Table must have exactly one row per recipient in run sheet
- `Recipient` must match a handle from the run sheet
- `Source Channel` must match the channel from the run sheet for that recipient
- `Response State` is used to determine reply status

## Timestamp Assumptions

### Send Timestamp Parsing
- **Format**: ISO-8601 with UTC timezone (`Z` suffix)
- **Example**: `2026-02-27T18:51:34Z`
- **Parsing**: Parse to Unix epoch milliseconds using standard ISO-8601 parser
- **Invalid timestamps**: Fail with error code `INVALID_TIMESTAMP` and actionable message indicating row and column

### First Reply Timestamp Derivation
- **Source**: Not currently present in response log schema
- **Assumption**: For initial implementation, if `Response State` is not `no response yet`, treat current analysis timestamp as first reply time
- **Future enhancement**: Response log may add `First Reply Timestamp` column; if present, use it instead
- **Missing reply timestamp**: If recipient has replied but no timestamp available, exclude from `hoursToFirstReply` calculations but count in reply totals

### Timestamp Normalization
- All timestamps are normalized to UTC before calculation
- Hours are calculated as floating-point values with 2 decimal places
- Formula: `hoursToFirstReply = (replyTimestamp - sendTimestamp) / (1000 * 60 * 60)`

## Cold-Aging Rule

### Definition
A recipient is considered **cold-aged** if:
1. Send status is `sent`
2. `Response State` is `no response yet`
3. Time elapsed since send timestamp exceeds **72 hours** (3 days)

### Threshold
- **Cold threshold**: 72 hours
- **Rationale**: After 72 hours without response, conversion probability drops significantly for direct outreach channels
- **Configuration**: Hardcoded initially; may become configurable via `--cold-threshold-hours` in future version

### Calculation
```
coldAgedCount = count(recipients where:
  sendStatus == "sent" AND
  responseState == "no response yet" AND
  (currentTimestamp - sentTimestamp) / (1000 * 60 * 60) > 72
)
```

## Deterministic Metric Field Definitions

### Output Schema (JSON)

```json
{
  "batchId": "string",
  "analysisTimestamp": "ISO-8601",
  "summary": {
    "totalSent": "number",
    "totalReplied": "number",
    "totalNoReply": "number",
    "totalColdAged": "number",
    "replyRate": "number (0.00-1.00)"
  },
  "latency": {
    "hoursToFirstReply": ["number (2 decimals)"],
    "medianHoursToFirstReply": "number (2 decimals)",
    "p90HoursToFirstReply": "number (2 decimals)",
    "meanHoursToFirstReply": "number (2 decimals)"
  },
  "conversion": {
    "followupConversionRate": "number (0.00-1.00)",
    "followupConvertedCount": "number",
    "followupAttemptedCount": "number"
  },
  "byChannel": {
    "<channel-name>": {
      "sent": "number",
      "replied": "number",
      "replyRate": "number (0.00-1.00)",
      "medianHoursToFirstReply": "number (2 decimals) or null",
      "coldAgedCount": "number"
    }
  },
  "byCTA": {
    "<cta-variant>": {
      "sent": "number",
      "replied": "number",
      "replyRate": "number (0.00-1.00)",
      "medianHoursToFirstReply": "number (2 decimals) or null",
      "coldAgedCount": "number"
    }
  }
}
```

**Note**: The `byCTA` field is only present when the run sheet includes a "CTA Variant" column.

### Metric Calculation Rules

#### `totalSent`
- Count of rows in run sheet with `Send Status: sent`
- Type: Integer ≥ 0

#### `totalReplied`
- Count of recipients with `Response State` not equal to `no response yet`
- Type: Integer ≥ 0

#### `totalNoReply`
- Count of recipients with `Response State: no response yet`
- Type: Integer ≥ 0
- Must equal `totalSent - totalReplied`

#### `totalColdAged` / `coldAgedCount`
- Count of recipients meeting cold-aging criteria (see Cold-Aging Rule)
- Type: Integer ≥ 0

#### `replyRate`
- Formula: `totalReplied / totalSent`
- Type: Float [0.00, 1.00]
- Rounding: 2 decimal places
- Edge case: If `totalSent == 0`, return `0.00`

#### `hoursToFirstReply` (array)
- Array of per-recipient hours-to-first-reply values
- Only includes recipients who have replied (exclude `no response yet`)
- Type: Array of floats, each with 2 decimal places
- Rounding: Round each value to 2 decimal places using "half away from zero" rounding

#### `medianHoursToFirstReply`
- Median of `hoursToFirstReply` array
- Type: Float with 2 decimal places
- Rounding: Round final result to 2 decimal places
- Edge case: If array is empty, return `null`

#### `p90HoursToFirstReply`
- 90th percentile of `hoursToFirstReply` array
- Calculation method: Linear interpolation between closest ranks
- Type: Float with 2 decimal places
- Rounding: Round final result to 2 decimal places
- Edge case: If array has fewer than 10 elements, use nearest-rank method; if empty, return `null`

#### `meanHoursToFirstReply`
- Mean (average) of `hoursToFirstReply` array
- Type: Float with 2 decimal places
- Rounding: Round final result to 2 decimal places
- Edge case: If array is empty, return `null`

#### `followupConversionRate`
- **Definition**: Proportion of recipients who received a follow-up message and subsequently converted (replied positively)
- **Detection of follow-up sent**: Parse `Decision Rationale` or `Send Outcome Log` for phrases like "sent follow-up" or multiple send timestamps for same recipient
- **Detection of conversion**: `Next-Step Decision: advance` after follow-up was sent
- Formula: `followupConvertedCount / followupAttemptedCount`
- Type: Float [0.00, 1.00]
- Rounding: 2 decimal places
- Edge case: If `followupAttemptedCount == 0`, return `0.00`

#### `followupConvertedCount`
- Count of recipients who converted after receiving a follow-up
- Type: Integer ≥ 0

#### `followupAttemptedCount`
- Count of recipients who received at least one follow-up message
- Type: Integer ≥ 0

#### `byChannel` metrics
- Each metric above (`sent`, `replied`, `replyRate`, `medianHoursToFirstReply`, `coldAgedCount`) calculated per unique channel
- Channel names match `Channel` column in run sheet exactly
- `medianHoursToFirstReply` is `null` if channel has no replies

### Percentile Calculation Method

For `p90HoursToFirstReply`, use linear interpolation:

1. Sort `hoursToFirstReply` array in ascending order
2. Calculate rank: `r = 0.9 * (n - 1)` where `n` is array length
3. Calculate lower index: `i_lower = floor(r)`
4. Calculate upper index: `i_upper = ceil(r)`
5. Calculate fraction: `f = r - i_lower`
6. If `i_lower == i_upper`, return `sorted[i_lower]`
7. Otherwise: `p90 = sorted[i_lower] * (1 - f) + sorted[i_upper] * f`
8. Round to 2 decimal places

### Median Calculation Method

For `medianHoursToFirstReply`:

1. Sort `hoursToFirstReply` array in ascending order
2. If array length `n` is odd: return `sorted[(n - 1) / 2]`
3. If array length `n` is even: return `(sorted[n/2 - 1] + sorted[n/2]) / 2`
4. Round to 2 decimal places

### Rounding Policy

All floating-point metrics use **"half away from zero"** rounding to 2 decimal places:
- 1.235 → 1.24
- 1.245 → 1.25
- -1.235 → -1.24

In JavaScript/TypeScript: `Math.round(value * 100) / 100`

## Error Codes

| Code | Description | Exit Code |
|------|-------------|-----------|
| `INVALID_RUN_SHEET` | Run sheet file not found, malformed, or missing required columns | 1 |
| `INVALID_RESPONSE_LOG` | Response log file not found, malformed, or missing required columns | 2 |
| `INVALID_TIMESTAMP` | Timestamp in run sheet is not valid ISO-8601 with Z suffix | 3 |
| `RECIPIENT_MISMATCH` | Response log contains recipient not present in run sheet | 4 |
| `DUPLICATE_RECIPIENT` | Run sheet contains duplicate recipient handles | 5 |
| `NO_SENT_ROWS` | Run sheet has no rows with `Send Status: sent` | 6 |
| `CHANNEL_MISMATCH` | Recipient's channel in response log doesn't match run sheet | 7 |

## Determinism Guarantees

To ensure repeated runs produce identical output:

1. **Timestamps**: Always parsed as UTC; current time only used for cold-aging checks
2. **Rounding**: Consistent "half away from zero" rounding for all floats
3. **Percentiles**: Linear interpolation method is deterministic
4. **Medians**: Deterministic for both odd and even-length arrays
5. **Channel ordering**: `byChannel` keys sorted alphabetically in JSON output
6. **Array ordering**: `hoursToFirstReply` array sorted ascending in JSON output

## Usage Example

```bash
bun run pilot:latency \
  --run-sheet docs/distribution/first-pilot-2026-02/pilot-run-sheet.md \
  --responses docs/distribution/first-pilot-2026-02/pilot-response-log.md \
  --format json
```

## Future Enhancements

- `--cold-threshold-hours <number>`: Configurable cold-aging threshold
- `Response First Reply Timestamp` column in response log for precise latency
- Historical comparison flags (`--compare-batch <batch-id>`)
