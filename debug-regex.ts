const content = 'First outreach batch (10 qualified ICP contacts) yields **>=3 correctly formatted `PILOT YES` replies**';

// Check what's after >=3
const afterNum = content.match(/First outreach batch \((\d+)\s+qualified[^)]*\)\s+yields\s+\**>=(\d+)(.*)/);
console.log('After >=N:', JSON.stringify(afterNum?.[3]));

// The [^r\*]* should match everything up to 'r' or '*'
console.log('Issue: [^r*]* stops at first r, so it cannot skip past "formatted"');

// The problem: `[^r\*]*` excludes 'r', so when it sees "formatted" it stops at the first 'r'
// Then the pattern tries to match "(replies|`PILOT)" starting from "rmatted..." which fails

// Solution: the pattern needs to be more flexible to skip past "formatted" text
