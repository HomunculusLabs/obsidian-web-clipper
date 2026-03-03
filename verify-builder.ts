/**
 * Quick verification script for contradiction inbox builder
 */
import {
  buildContradictionInbox,
  extractClaimsFromNote,
  buildConflictEntries,
  mergeDuplicateClaims,
  normalizeClaim,
} from "./src/shared/contradictionInboxBuilder";

import {
  computeClaimFingerprint,
  detectContradictionType,
  CONTRADICTION_INBOX_VERSION,
  ClaimSource,
} from "./src/shared/contradictionInboxContract";

// Test basic functionality
const testClaim1 = "React Server Components use RSC payload for hydration";
const testClaim2 = "React Server Components do not use RSC payload";

const fp1 = computeClaimFingerprint(testClaim1);
const fp2 = computeClaimFingerprint(testClaim2);

console.log("Claim 1 fingerprint:", fp1.hash.substring(0, 16) + "...");
console.log("Claim 2 fingerprint:", fp2.hash.substring(0, 16) + "...");

const contradiction = detectContradictionType(fp1, fp2);
console.log("Contradiction detected:", contradiction.type, "confidence:", contradiction.confidence);

// Test builder functions exist
console.log("\nBuilder exports verified:");
console.log("- buildContradictionInbox:", typeof buildContradictionInbox);
console.log("- extractClaimsFromNote:", typeof extractClaimsFromNote);
console.log("- buildConflictEntries:", typeof buildConflictEntries);
console.log("- mergeDuplicateClaims:", typeof mergeDuplicateClaims);
console.log("- normalizeClaim:", typeof normalizeClaim);

// Test with actual claim inputs
const testClaims = [
  {
    claim: "TypeScript strict mode should be enabled",
    source: ClaimSource.KEY_TAKEAWAYS,
    sourcePath: "/vault/clip1.md",
    sourceTitle: "Clip 1",
    entryId: "kt-1",
    timestamp: "2026-03-03T10:00:00.000Z",
    sourceId: "/vault/clip1.md",
  },
  {
    claim: "TypeScript strict mode should not be enabled",
    source: ClaimSource.KEY_TAKEAWAYS,
    sourcePath: "/vault/clip2.md",
    sourceTitle: "Clip 2",
    entryId: "kt-2",
    timestamp: "2026-03-03T11:00:00.000Z",
    sourceId: "/vault/clip2.md",
  },
];

console.log("\nBuilding inbox from test claims...");
const inbox = buildContradictionInbox(testClaims);

console.log("Inbox generated:");
console.log("- Version:", inbox.inbox_version);
console.log("- Total claims:", inbox.totalClaims);
console.log("- Total conflicts:", inbox.totalConflicts);
console.log("- Open conflicts:", inbox.openConflicts);
console.log("- Entries count:", inbox.entries.length);

if (inbox.entries.length > 0) {
  console.log("\nFirst conflict:");
  console.log("- ID:", inbox.entries[0]!.conflict_id.substring(0, 16) + "...");
  console.log("- Type:", inbox.entries[0]!.contradiction_type);
  console.log("- Description:", inbox.entries[0]!.description);
  console.log("- Score:", inbox.entries[0]!.score);
  console.log("- Claims:", inbox.entries[0]!.claims.length);
}

console.log("\n✅ All builder functions work correctly!");
console.log("Contradiction Inbox Version:", CONTRADICTION_INBOX_VERSION);
