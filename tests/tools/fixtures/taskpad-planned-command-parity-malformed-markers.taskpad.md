# Test TASKPAD - Malformed Markers

## Work Queue
- [ ] (planned-2026-03-01) Valid parenthesized marker - should be detected Verify: typecheck
- [ ] planned-2026-03-02 Valid unparenthesized marker - should be detected Verify: test

# Invalid date formats
- [ ] (planned-2026-13-45) Invalid month/day - should be rejected Verify: lint
- [ ] planned-2026-00-00 Invalid month/day - should be rejected Verify: format
- [ ] (planned-26-03-01) Short year format - should be rejected Verify: taskpad:auto-ideation
- [ ] planned-2026/03/01 Wrong separator - should be rejected Verify: taskpad:plan-seed
- [ ] (planned-2026-3-1) Single digit month/day - should be rejected Verify: pilot:sample-gap-planner

# Unbalanced parentheses
- [ ] planned-2026-03-03) Extra closing paren - should be rejected Verify: pilot:price-signal
- [ ] (planned-2026-03-04 Extra opening paren - should be rejected Verify: taskpad:intake-autoplan
- [ ] ((planned-2026-03-05)) Double parens outer - should be rejected Verify: taskpad:queue-health

# Whitespace in markers
- [ ] (planned- 2026-03-06) Space after paren - should be rejected Verify: taskpad:planned-command-parity
- [ ] (planned-2026 -03-07) Space before dash - should be rejected Verify: typecheck
- [ ] (planned-2026-03 -08) Space after dash - should be rejected Verify: test
- [ ] planned- 2026-03-09 Space after planned - should be rejected Verify: lint

# Missing date components
- [ ] (planned-) Missing date entirely - should be rejected Verify: format
- [ ] planned-XXXX-XX-XX Placeholder dates - should be rejected Verify: taskpad:auto-ideation
- [ ] (planned-TBD) Non-date placeholder - should be rejected Verify: taskpad:plan-seed

# Case variations (should still work if lowercase 'planned-')
- [ ] planned-2026-03-10 Valid lowercase - should be detected Verify: pilot:sample-gap-planner
- [ ] (planned-2026-03-11) Valid lowercase parenthesized - should be detected Verify: pilot:price-signal

# Mixed valid and malformed to test filtering
- [ ] (planned-2026-03-12) Another valid parenthesized - should be detected Verify: taskpad:intake-autoplan
- [ ] planned-2026-03-13 Another valid unparenthesized - should be detected Verify: taskpad:queue-health

## Execution Queue
- [ ] Active task
