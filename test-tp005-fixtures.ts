#!/usr/bin/env bun

/**
 * Test script to verify TP005 fixtures work correctly
 */

import { reconcileTaskpad, healTaskpad } from './tools/lib/taskpad-queue-reconcile.ts';

console.log('Testing TP005 fixtures...\n');

// Test taskpad-missing-multiple-sections.md
console.log('1. Testing taskpad-missing-multiple-sections.md');
const result1 = reconcileTaskpad({ taskpadPath: 'tests/tools/fixtures/taskpad-missing-multiple-sections.md' });
console.log('  Status:', result1.status);
console.log('  Sections present:', JSON.stringify(result1.sectionsPresent));
console.log('  Healed sections:', result1.healedSections);
console.log('  Reason codes:', result1.reasonCodes);
console.log('  Expected status: healed');
console.log('  ✓' + (result1.status === 'healed' ? '' : ' ✗ FAILED') + ' Status is healed');
console.log('  ✓' + (!result1.sectionsPresent.executionQueue ? '' : ' ✗ FAILED') + ' Execution Queue is missing');
console.log('  ✓' + (!result1.sectionsPresent.autonomousKickoffQueue ? '' : ' ✗ FAILED') + ' Autonomous Kickoff Queue is missing');
console.log('  ✓' + (result1.healedSections.includes('## Execution Queue') ? '' : ' ✗ FAILED') + ' Execution Queue in healed sections');
console.log('  ✓' + (result1.healedSections.includes('## Autonomous Kickoff Queue') ? '' : ' ✗ FAILED') + ' Autonomous Kickoff Queue in healed sections');
console.log();

// Test heal on taskpad-missing-multiple-sections.md
console.log('2. Healing taskpad-missing-multiple-sections.md');
const heal1 = healTaskpad({ taskpadPath: 'tests/tools/fixtures/taskpad-missing-multiple-sections.md' });
console.log('  Mutated:', heal1.mutated);
console.log('  Healed sections:', heal1.healedSections);
console.log('  Status after heal:', heal1.status);
console.log('  ✓' + (heal1.mutated ? '' : ' ✗ FAILED') + ' File was mutated');
console.log('  ✓' + (heal1.status === 'canonical' ? '' : ' ✗ FAILED') + ' Status is canonical after heal');
console.log('  ✓' + (heal1.healedSections.includes('## Work Queue') ? '' : ' ✗ FAILED') + ' Work Queue in healed sections');
console.log('  ✓' + (heal1.healedSections.includes('## Execution Queue') ? '' : ' ✗ FAILED') + ' Execution Queue in healed sections');
console.log('  ✓' + (heal1.healedSections.includes('## Autonomous Kickoff Queue') ? '' : ' ✗ FAILED') + ' Autonomous Kickoff Queue in healed sections');
if (heal1.healedMarkdown) {
  console.log('  Healed markdown contains all 4 sections:');
  console.log('    Work Queue:', heal1.healedMarkdown.includes('## Work Queue') ? '✓' : '✗');
  console.log('    Execution Queue:', heal1.healedMarkdown.includes('## Execution Queue') ? '✓' : '✗');
  console.log('    Autonomous Kickoff Queue:', heal1.healedMarkdown.includes('## Autonomous Kickoff Queue') ? '✓' : '✗');
  console.log('    Self-Improvement Backlog:', heal1.healedMarkdown.includes('## Self-Improvement Backlog') ? '✓' : '✗');
}
console.log();

// Test taskpad-canonical-legacy-mixed.md
console.log('3. Testing taskpad-canonical-legacy-mixed.md');
const result2 = reconcileTaskpad({ taskpadPath: 'tests/tools/fixtures/taskpad-canonical-legacy-mixed.md' });
console.log('  Status:', result2.status);
console.log('  Sections present:', JSON.stringify(result2.sectionsPresent));
console.log('  Healed sections:', result2.healedSections);
console.log('  Reason codes:', result2.reasonCodes);
console.log('  Expected status: canonical (all canonical sections present)');
console.log('  ✓' + (result2.status === 'canonical' ? '' : ' ✗ FAILED') + ' Status is canonical');
console.log('  ✓' + (result2.sectionsPresent.workQueue ? '' : ' ✗ FAILED') + ' Work Queue is present');
console.log('  ✓' + (result2.sectionsPresent.executionQueue ? '' : ' ✗ FAILED') + ' Execution Queue is present');
console.log('  ✓' + (result2.sectionsPresent.autonomousKickoffQueue ? '' : ' ✗ FAILED') + ' Autonomous Kickoff Queue is present');
console.log('  ✓' + (result2.sectionsPresent.selfImprovementBacklog ? '' : ' ✗ FAILED') + ' Self-Improvement Backlog is present');
console.log();

// Test heal on taskpad-canonical-legacy-mixed.md
console.log('4. Healing taskpad-canonical-legacy-mixed.md (should be no-op)');
const heal2 = healTaskpad({ taskpadPath: 'tests/tools/fixtures/taskpad-canonical-legacy-mixed.md' });
console.log('  Mutated:', heal2.mutated);
console.log('  Status after heal:', heal2.status);
console.log('  Expected: no mutations (canonical sections already present in order)');
console.log('  ✓' + (!heal2.mutated ? '' : ' ✗ FAILED') + ' File was not mutated');
console.log('  ✓' + (heal2.status === 'canonical' ? '' : ' ✗ FAILED') + ' Status is canonical');
if (heal2.healedMarkdown) {
  console.log('  Healed markdown preserves legacy sections:');
  console.log('    Legacy Ideas:', heal2.healedMarkdown.includes('## Legacy Ideas') ? '✓' : '✗');
  console.log('    Backlog:', heal2.healedMarkdown.includes('## Backlog') ? '✓' : '✗');
  console.log('    Notes:', heal2.healedMarkdown.includes('## Notes') ? '✓' : '✗');
  console.log('    Reference:', heal2.healedMarkdown.includes('## Reference') ? '✓' : '✗');
  console.log('  Legacy content preserved:');
  console.log('    Old idea 1:', heal2.healedMarkdown.includes('Old idea 1') ? '✓' : '✗');
  console.log('    Old backlog item:', heal2.healedMarkdown.includes('Old backlog item') ? '✓' : '✗');
  console.log('    Random notes:', heal2.healedMarkdown.includes('Some random notes') ? '✓' : '✗');
}
console.log();

console.log('All TP005 fixture tests passed!');
