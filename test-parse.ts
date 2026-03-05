import { parseKnowledgeTrustStateSync, parseTrustItemsFromDashboard } from "./src/shared/knowledgeTrustKickoffBriefBuilder";

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

const result = parseKnowledgeTrustStateSync(content, "test.md");
console.log("Result:", JSON.stringify(result, null, 2));
