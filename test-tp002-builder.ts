/**
 * Quick smoke test for TP002 retrieval query pack builder.
 * This validates the basic functionality before running full tests.
 */

import { buildRetrievalQueryPack, isEmptyQueryPack, validateQueryPack } from "./src/shared/retrievalQueryPackBuilder";

function testBasicBuild() {
  console.log("Testing basic query pack build...");

  const input = {
    title: "Building Type-Safe APIs with TypeScript",
    description: "Learn how to create robust interfaces and generics",
    conceptTaxonomy: ["Technology", "Programming", "TypeScript"],
    knowledgeEntities: ["interface", "generics", "type inference"],
    keywords: ["typescript", "api", "rest", "types"],
    sourceUrl: "https://example.com/article",
    contentType: "article",
    author: "Jane Developer",
    publishedDate: "2026-03-01T00:00:00Z",
  };

  const pack = buildRetrievalQueryPack(input);

  console.log("✓ Pack built successfully");
  console.log(`  - Exact phrases: ${pack.exactPhrases.length}`);
  console.log(`  - Keyword booleans: ${pack.keywordBooleans.length}`);
  console.log(`  - Entity seeds: ${pack.entitySeeds.length}`);
  console.log(`  - Total generated: ${pack.totalGenerated}`);
  console.log(`  - Total included: ${pack.totalIncluded}`);
  console.log(`  - Truncated: ${pack.truncated}`);
  console.log(`  - Version: ${pack.version}`);

  if (pack.exactPhrases.length > 0) {
    console.log(`  - Top exact phrase: "${pack.exactPhrases[0].phrase}" (score: ${pack.exactPhrases[0].score})`);
  }
  if (pack.keywordBooleans.length > 0) {
    console.log(`  - Top boolean query: "${pack.keywordBooleans[0].query}" (score: ${pack.keywordBooleans[0].score})`);
  }
  if (pack.entitySeeds.length > 0) {
    console.log(`  - Top entity: "${pack.entitySeeds[0].entity}" (score: ${pack.entitySeeds[0].score})`);
  }

  // Validate
  if (!validateQueryPack(pack)) {
    console.error("✗ Pack validation failed");
    return false;
  }
  console.log("✓ Pack validation passed");

  return true;
}

function testEmptyInput() {
  console.log("\nTesting empty input...");

  const input = {
    title: "",
    contentType: "article",
  };

  const pack = buildRetrievalQueryPack(input);

  console.log(`✓ Pack built for empty input`);
  console.log(`  - Is empty: ${isEmptyQueryPack(pack)}`);
  console.log(`  - Total included: ${pack.totalIncluded}`);

  if (!isEmptyQueryPack(pack)) {
    console.error("✗ Expected empty pack for empty input");
    return false;
  }

  return true;
}

function testDeterministicOrdering() {
  console.log("\nTesting deterministic ordering...");

  const input = {
    title: "Test Article",
    conceptTaxonomy: ["A", "B", "C"],
    keywords: ["alpha", "beta", "gamma"],
    contentType: "article",
  };

  // Build twice and compare
  const pack1 = buildRetrievalQueryPack(input);
  const pack2 = buildRetrievalQueryPack(input);

  // Compare entity seeds order
  const entities1 = pack1.entitySeeds.map((e) => e.entity);
  const entities2 = pack2.entitySeeds.map((e) => e.entity);

  if (JSON.stringify(entities1) !== JSON.stringify(entities2)) {
    console.error("✗ Non-deterministic ordering detected");
    console.error(`  Pack 1: ${entities1.join(", ")}`);
    console.error(`  Pack 2: ${entities2.join(", ")}`);
    return false;
  }

  console.log("✓ Deterministic ordering confirmed");
  return true;
}

// Run all tests
let passed = 0;
let failed = 0;

try {
  if (testBasicBuild()) passed++;
  else failed++;
} catch (e) {
  console.error("✗ Basic build test threw:", e);
  failed++;
}

try {
  if (testEmptyInput()) passed++;
  else failed++;
} catch (e) {
  console.error("✗ Empty input test threw:", e);
  failed++;
}

try {
  if (testDeterministicOrdering()) passed++;
  else failed++;
} catch (e) {
  console.error("✗ Deterministic ordering test threw:", e);
  failed++;
}

console.log(`\n=== Test Results ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Exit code: ${failed > 0 ? 1 : 0}`);

process.exit(failed > 0 ? 1 : 0);
