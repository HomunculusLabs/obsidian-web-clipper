import { parseKnowledgeTrustStateSync } from "./src/shared/knowledgeTrustKickoffBriefBuilder";

const content = `---
title: Knowledge Trust State Sync
---

# Knowledge Trust State Sync

## Sync Items

### [HIGH] sync-item-1

**Type:** state-change
**Description:** State updated
**Status:** active
**First detected:** 2026-03-01
**Last updated:** 2026-03-04
`;

// Let me trace through the parsing manually
const lines = content.split("\n");
console.log("Total lines:", lines.length);

// Find state sync section
let syncStart = -1;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]!.trim();
  console.log(`Line ${i}: "${line}"`);
  if (/^#\s+Knowledge\s+Trust.*State\s+Sync/i.test(line) ||
      /^##\s+State\s+Sync/i.test(line) ||
      /trust.*state.*sync/i.test(line)) {
    syncStart = i;
    console.log("Found state sync at line", i);
    break;
  }
}

console.log("syncStart:", syncStart);

// Find the end of the section
let syncEnd = lines.length;
for (let i = syncStart + 1; i < lines.length; i++) {
  if (/^#\s+/.test(lines[i]!.trim())) {
    syncEnd = i;
    console.log("Found end at line", i);
    break;
  }
}

console.log("syncEnd:", syncEnd);

// Extract content
const syncLines = lines.slice(syncStart, syncEnd);
console.log("Sync lines:", syncLines);

// Now check for item headers
for (let i = 0; i < syncLines.length; i++) {
  const line = syncLines[i]!;
  const trimmed = line.trim();
  const itemHeaderMatch = trimmed.match(/^###\s*\[?(CRITICAL|HIGH|MEDIUM|LOW)\]?\s*(.+)$/i);
  if (itemHeaderMatch) {
    console.log(`Found item header at line ${i}:`, itemHeaderMatch);
  }
}

const result = parseKnowledgeTrustStateSync(content, "test.md");
console.log("\nFinal Result:", JSON.stringify(result, null, 2));
