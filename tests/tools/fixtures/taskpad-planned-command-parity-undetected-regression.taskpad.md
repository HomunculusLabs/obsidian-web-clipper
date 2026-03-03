# Test TASKPAD - Undetected Item Regression Cases

## Work Queue
# Section boundary cases - first and last items
- [ ] planned-2026-03-01 First item in Work Queue section Verify: typecheck
- [ ] (planned-2026-03-02) Second item with parenthesized Verify: test
- [ ] (planned-2026-03-20) Last item in Work Queue section Verify: lint

# Complex text that might confuse parsing
- [ ] planned-2026-03-03 Task with "planned-2026-03-99" in quotes - should only detect the marker Verify: format
- [ ] (planned-2026-03-04) Task with (planned-2026-03-88) in text - should only detect the marker Verify: taskpad:auto-ideation
- [ ] planned-2026-03-05 Task mentioning planned-2026-03-07 as a dependency - should detect this item only Verify: taskpad:plan-seed

# Special characters and formatting
- [ ] planned-2026-03-06 Task with *bold* and _italic_ text Verify: pilot:sample-gap-planner
- [ ] (planned-2026-03-07) Task with `code` and [links](https://example.com) Verify: pilot:price-signal
- [ ] planned-2026-03-08 Task with escaped characters: &amp; &lt; &gt; Verify: taskpad:intake-autoplan

# Multiple Verify: clauses and complex command lists
- [ ] planned-2026-03-09 Task with multiple commands: Verify: typecheck, test, lint, format
- [ ] (planned-2026-03-10) Task with "and" separator: Verify: typecheck and test and lint
- [ ] planned-2026-03-11 Task with mixed separators: Verify: typecheck, test and lint, format

# Items with empty or minimal text
- [ ] planned-2026-03-12 Verify: taskpad:queue-health
- [ ] (planned-2026-03-13) Verify: taskpad:planned-command-parity

# Indented items (different bullet styles)
* [ ] planned-2026-03-14 Asterisk bullet with planned marker Verify: typecheck
+ [ ] (planned-2026-03-15) Plus bullet with parenthesized marker Verify: test

# Items with dates that look like other markers
- [ ] planned-2026-03-16 Task with 2026-03-17 as a reference date - should detect marker Verify: lint
- [ ] (planned-2026-03-17) Task mentioning PR #2026 as a reference - should detect marker Verify: format

# Items near section transitions
- [ ] planned-2026-03-18 Item just before Execution Queue Verify: taskpad:auto-ideation

## Execution Queue
- [ ] Active task
- [ ] planned-2026-03-19 This should NOT be detected (not in Work Queue) Verify: taskpad:plan-seed

## Work Queue
- [ ] planned-2026-03-21 Item in second Work Queue section - should be detected Verify: pilot:sample-gap-planner

## Self-Improvement Backlog
- [ ] planned-2026-03-22 This should NOT be detected (not in Work Queue) Verify: pilot:price-signal

# Items with unicode characters
- [ ] planned-2026-03-23 Task with unicode: café, naïve, résumé Verify: taskpad:intake-autoplan
- [ ] (planned-2026-03-24) Task with emoji in description 🎯 📊 ✅ Verify: taskpad:queue-health

# Very long task descriptions
- [ ] planned-2026-03-25 This is a very long task description that contains a lot of text and continues for quite some time but should still be correctly detected and parsed by the planned marker detection algorithm regardless of how much text comes after the marker itself Verify: taskpad:planned-command-parity

## Completed Items Section
- [x] planned-2026-03-26 This is CHECKED and should NOT be detected Verify: typecheck
- [x] (planned-2026-03-27) This is also CHECKED with parens - should NOT be detected Verify: test
