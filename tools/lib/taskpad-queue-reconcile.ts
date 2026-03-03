#!/usr/bin/env bun

/**
 * TASKPAD Queue Reconcile Helper
 *
 * Implements the post-seed queue reconcile contract defined in docs/README.md.
 * Inspects target TASKPAD markdown AST/text blocks and computes deterministic
 * section-presence/order diff.
 */

import { readFileSync } from "node:fs";

/**
 * Canonical queue section headings in required order
 */
export const CANONICAL_SECTIONS = [
  "## Work Queue",
  "## Execution Queue",
  "## Autonomous Kickoff Queue",
  "## Self-Improvement Backlog",
] as const;

/**
 * Canonical section identifiers
 */
export type CanonicalSectionKey = keyof CanonicalSectionsPresence;
export type CanonicalSectionName = typeof CANONICAL_SECTIONS[number];

/**
 * Reconcile status values
 */
export type ReconcileStatus = "canonical" | "healed" | "error";

/**
 * Reconcile reason codes
 */
export type ReconcileReasonCode =
  // Success codes
  | "RECONCILE_CANONICAL"
  | "RECONCILE_HEALED"
  // Error codes
  | "RECONCILE_TASKPAD_NOT_FOUND"
  | "RECONCILE_TASKPAD_READ_FAILED"
  | "RECONCILE_TASKPAD_PARSE_FAILED"
  | "RECONCILE_SECTION_ORDER_INVALID"
  // Warning codes (non-blocking)
  | "RECONCILE_MISSING_SECTION"
  | "RECONCILE_OUT_OF_ORDER"
  | "RECONCILE_DUPLICATE_HEADING"
  | "RECONCILE_EMPTY_SECTION";

/**
 * Canonical section presence flags
 */
export interface CanonicalSectionsPresence {
  workQueue: boolean;
  executionQueue: boolean;
  autonomousKickoffQueue: boolean;
  selfImprovementBacklog: boolean;
}

/**
 * Section ordering details
 */
export interface SectionOrdering {
  /** Current order of canonical section headings */
  currentOrder: string[];
  /** Expected canonical order */
  expectedOrder: readonly string[];
  /** Whether order matches canonical */
  isCanonicalOrder: boolean;
}

/**
 * TASKPAD file metadata
 */
export interface TaskpadMetadata {
  path: string;
  lineCount: number;
  sectionCount: number;
}

/**
 * Error details (populated when status=error)
 */
export interface ReconcileError {
  code: string;
  message: string;
  line?: number;
}

/**
 * Complete reconcile result envelope
 */
export interface QueueReconcileResult {
  /** Overall reconcile status */
  status: ReconcileStatus;

  /** Canonical section presence flags */
  sectionsPresent: CanonicalSectionsPresence;

  /** Sections that were healed (empty when status=canonical) */
  healedSections: string[];

  /** Deterministic reason codes (see taxonomy above) */
  reasonCodes: ReconcileReasonCode[];

  /** Section ordering details */
  ordering: SectionOrdering;

  /** TASKPAD file metadata */
  taskpad: TaskpadMetadata;

  /** Error details (populated when status=error) */
  error?: ReconcileError;
}

/**
 * H2 heading match result
 */
interface H2HeadingMatch {
  heading: string;
  lineIndex: number; // 0-indexed
  lineNumber: number; // 1-indexed
  isCanonical: boolean;
  canonicalKey?: CanonicalSectionKey;
  canonicalOrder?: number;
}

/**
 * Section block extracted from markdown
 */
interface SectionBlock {
  heading: string;
  headingLineNumber: number;
  contentStartLineNumber: number;
  contentEndLineNumber: number | null;
  content: string;
}

/**
 * Parsed TASKPAD structure
 */
interface ParsedTaskpad {
  lines: string[];
  h2Headings: H2HeadingMatch[];
  canonicalSections: Map<CanonicalSectionKey, H2HeadingMatch>;
  nonCanonicalHeadings: H2HeadingMatch[];
  frontmatterEndLine: number;
}

/**
 * Reconcile input options
 */
export interface ReconcileOptions {
  taskpadPath: string;
}

/**
 * Parse H2 heading from a line
 */
function parseH2Heading(line: string, lineIndex: number): H2HeadingMatch | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("## ")) {
    return null;
  }

  const heading = trimmed;
  const canonicalIndex = CANONICAL_SECTIONS.indexOf(heading as CanonicalSectionName);

  return {
    heading,
    lineIndex,
    lineNumber: lineIndex + 1,
    isCanonical: canonicalIndex !== -1,
    canonicalKey: canonicalIndex !== -1 ? getCanonicalKey(heading as CanonicalSectionName) : undefined,
    canonicalOrder: canonicalIndex !== -1 ? canonicalIndex : undefined,
  };
}

/**
 * Get canonical key from section heading
 */
function getCanonicalKey(heading: CanonicalSectionName): CanonicalSectionKey {
  switch (heading) {
    case "## Work Queue":
      return "workQueue";
    case "## Execution Queue":
      return "executionQueue";
    case "## Autonomous Kickoff Queue":
      return "autonomousKickoffQueue";
    case "## Self-Improvement Backlog":
      return "selfImprovementBacklog";
  }
}

/**
 * Detect frontmatter end line (first non-comment, non-empty line after start)
 */
function detectFrontmatterEnd(lines: string[]): number {
  if (lines.length === 0) {
    return 0;
  }

  const firstLine = lines[0].trim();
  if (firstLine !== "---") {
    return 0;
  }

  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "---") {
      return i + 1; // Line after frontmatter end
    }
  }

  // Never found closing ---, so no frontmatter
  return 0;
}

/**
 * Parse TASKPAD markdown into structured representation
 */
export function parseTaskpad(markdown: string): ParsedTaskpad {
  const lines = markdown.split(/\r?\n/);
  const h2Headings: H2HeadingMatch[] = [];
  const canonicalSections = new Map<CanonicalSectionKey, H2HeadingMatch>();
  const nonCanonicalHeadings: H2HeadingMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = parseH2Heading(lines[i], i);
    if (match) {
      h2Headings.push(match);

      if (match.isCanonical && match.canonicalKey) {
        // Only store first occurrence of each canonical heading
        if (!canonicalSections.has(match.canonicalKey)) {
          canonicalSections.set(match.canonicalKey, match);
        }
      } else {
        nonCanonicalHeadings.push(match);
      }
    }
  }

  const frontmatterEndLine = detectFrontmatterEnd(lines);

  return {
    lines,
    h2Headings,
    canonicalSections,
    nonCanonicalHeadings,
    frontmatterEndLine,
  };
}

/**
 * Compute section presence flags
 */
function computeSectionsPresent(parsed: ParsedTaskpad): CanonicalSectionsPresence {
  return {
    workQueue: parsed.canonicalSections.has("workQueue"),
    executionQueue: parsed.canonicalSections.has("executionQueue"),
    autonomousKickoffQueue: parsed.canonicalSections.has("autonomousKickoffQueue"),
    selfImprovementBacklog: parsed.canonicalSections.has("selfImprovementBacklog"),
  };
}

/**
 * Compute current canonical heading order
 */
function computeCurrentOrder(parsed: ParsedTaskpad): string[] {
  const order: string[] = [];
  const seen = new Set<CanonicalSectionKey>();

  for (const heading of parsed.h2Headings) {
    if (heading.isCanonical && heading.canonicalKey) {
      // Only include first occurrence of each canonical section
      if (!seen.has(heading.canonicalKey)) {
        order.push(heading.heading);
        seen.add(heading.canonicalKey);
      }
    }
  }

  return order;
}

/**
 * Check if current order matches canonical
 */
function isCanonicalOrder(currentOrder: string[]): boolean {
  if (currentOrder.length !== CANONICAL_SECTIONS.length) {
    return false;
  }

  for (let i = 0; i < currentOrder.length; i++) {
    if (currentOrder[i] !== CANONICAL_SECTIONS[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Detect missing canonical sections
 */
function detectMissingSections(parsed: ParsedTaskpad): CanonicalSectionKey[] {
  const missing: CanonicalSectionKey[] = [];

  for (let i = 0; i < CANONICAL_SECTIONS.length; i++) {
    const key = getCanonicalKey(CANONICAL_SECTIONS[i]);
    if (!parsed.canonicalSections.has(key)) {
      missing.push(key);
    }
  }

  return missing;
}

/**
 * Detect out-of-order canonical sections
 */
function detectOutOfOrderSections(parsed: ParsedTaskpad): boolean {
  let lastOrder = -1;

  for (const heading of parsed.h2Headings) {
    if (heading.isCanonical && heading.canonicalOrder !== undefined) {
      // Only check first occurrence of each canonical section
      const key = heading.canonicalKey;
      if (key && !parsed.canonicalSections.has(key)) {
        // Skip duplicates
        continue;
      }

      if (heading.canonicalOrder <= lastOrder) {
        return true; // Out of order detected
      }
      lastOrder = heading.canonicalOrder;
    }
  }

  return false;
}

/**
 * Detect duplicate canonical headings
 */
function detectDuplicateHeadings(parsed: ParsedTaskpad): Map<CanonicalSectionKey, number[]> {
  const duplicates = new Map<CanonicalSectionKey, number[]>();

  for (const heading of parsed.h2Headings) {
    if (heading.isCanonical && heading.canonicalKey) {
      const key = heading.canonicalKey;
      const firstOccurrence = parsed.canonicalSections.get(key);

      // If this heading is not the first occurrence, it's a duplicate
      if (firstOccurrence && heading.lineNumber !== firstOccurrence.lineNumber) {
        if (!duplicates.has(key)) {
          duplicates.set(key, []);
        }
        duplicates.get(key)!.push(heading.lineNumber);
      }
    }
  }

  return duplicates;
}

/**
 * Check if a canonical section is empty (no content after heading)
 */
function isSectionEmpty(parsed: ParsedTaskpad, key: CanonicalSectionKey): boolean {
  const section = parsed.canonicalSections.get(key);
  if (!section) {
    return false; // Section doesn't exist, not "empty"
  }

  // Find next H2 or end of file
  let nextH2Index = -1;
  for (let i = section.lineIndex + 1; i < parsed.lines.length; i++) {
    const trimmed = parsed.lines[i].trim();
    if (trimmed.startsWith("## ")) {
      nextH2Index = i;
      break;
    }
  }

  // Check if all lines between heading and next H2 are empty/whitespace
  const contentEnd = nextH2Index === -1 ? parsed.lines.length : nextH2Index;
  for (let i = section.lineIndex + 1; i < contentEnd; i++) {
    const trimmed = parsed.lines[i].trim();
    if (trimmed.length > 0) {
      return false; // Has content
    }
  }

  return true; // All whitespace
}

/**
 * Detect empty canonical sections
 */
function detectEmptySections(parsed: ParsedTaskpad): CanonicalSectionKey[] {
  const empty: CanonicalSectionKey[] = [];

  for (const key of parsed.canonicalSections.keys()) {
    if (isSectionEmpty(parsed, key)) {
      empty.push(key);
    }
  }

  return empty;
}

/**
 * Build deterministic reason codes list
 */
export function buildReasonCodes(
  parsed: ParsedTaskpad,
  status: ReconcileStatus,
): ReconcileReasonCode[] {
  const codes: ReconcileReasonCode[] = [];

  if (status === "error") {
    return codes;
  }

  // Check for missing sections
  const missingSections = detectMissingSections(parsed);
  if (missingSections.length > 0) {
    codes.push("RECONCILE_MISSING_SECTION");
  }

  // Check for out-of-order sections
  if (detectOutOfOrderSections(parsed)) {
    codes.push("RECONCILE_OUT_OF_ORDER");
  }

  // Check for duplicate headings
  const duplicates = detectDuplicateHeadings(parsed);
  if (duplicates.size > 0) {
    codes.push("RECONCILE_DUPLICATE_HEADING");
  }

  // Check for empty sections (informational, lowest priority)
  const emptySections = detectEmptySections(parsed);
  if (emptySections.length > 0 && codes.length === 0) {
    // Only report empty sections if no other issues
    codes.push("RECONCILE_EMPTY_SECTION");
  }

  // If no issues, it's canonical
  if (codes.length === 0) {
    codes.push("RECONCILE_CANONICAL");
  } else {
    codes.push("RECONCILE_HEALED");
  }

  return codes;
}

/**
 * Build taskpad metadata
 */
function buildTaskpadMetadata(taskpadPath: string, parsed: ParsedTaskpad): TaskpadMetadata {
  return {
    path: taskpadPath,
    lineCount: parsed.lines.length,
    sectionCount: parsed.h2Headings.length,
  };
}

/**
 * Build section ordering details
 */
function buildSectionOrdering(parsed: ParsedTaskpad): SectionOrdering {
  const currentOrder = computeCurrentOrder(parsed);

  return {
    currentOrder,
    expectedOrder: CANONICAL_SECTIONS,
    isCanonicalOrder: isCanonicalOrder(currentOrder),
  };
}

/**
 * Main reconcile function
 *
 * Inspects target TASKPAD markdown and computes deterministic section-presence/order diff.
 *
 * @param options - Reconcile options including taskpad path
 * @returns Reconcile result envelope
 */
export function reconcileTaskpad(options: ReconcileOptions): QueueReconcileResult {
  const { taskpadPath } = options;

  // Check if taskpad file exists
  let markdown: string;
  try {
    markdown = readFileSync(taskpadPath, "utf8");
  } catch (error) {
    return {
      status: "error",
      sectionsPresent: {
        workQueue: false,
        executionQueue: false,
        autonomousKickoffQueue: false,
        selfImprovementBacklog: false,
      },
      healedSections: [],
      reasonCodes: ["RECONCILE_TASKPAD_NOT_FOUND"],
      ordering: {
        currentOrder: [],
        expectedOrder: CANONICAL_SECTIONS,
        isCanonicalOrder: false,
      },
      taskpad: {
        path: taskpadPath,
        lineCount: 0,
        sectionCount: 0,
      },
      error: {
        code: "RECONCILE_TASKPAD_NOT_FOUND",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  // Parse taskpad markdown
  let parsed: ParsedTaskpad;
  try {
    parsed = parseTaskpad(markdown);
  } catch (error) {
    return {
      status: "error",
      sectionsPresent: {
        workQueue: false,
        executionQueue: false,
        autonomousKickoffQueue: false,
        selfImprovementBacklog: false,
      },
      healedSections: [],
      reasonCodes: ["RECONCILE_TASKPAD_PARSE_FAILED"],
      ordering: {
        currentOrder: [],
        expectedOrder: CANONICAL_SECTIONS,
        isCanonicalOrder: false,
      },
      taskpad: {
        path: taskpadPath,
        lineCount: markdown.split(/\r?\n/).length,
        sectionCount: 0,
      },
      error: {
        code: "RECONCILE_TASKPAD_PARSE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  // Compute section presence
  const sectionsPresent = computeSectionsPresent(parsed);

  // Build reason codes
  const reasonCodes = buildReasonCodes(parsed, "canonical");

  // Determine status
  const status: ReconcileStatus = reasonCodes.includes("RECONCILE_CANONICAL")
    ? "canonical"
    : reasonCodes.includes("RECONCILE_EMPTY_SECTION")
      ? "canonical" // Empty sections are informational, not a failure
      : "healed";

  // Build result
  return {
    status,
    sectionsPresent,
    healedSections: status === "healed" ? detectMissingSections(parsed).map((key) => CANONICAL_SECTIONS[getCanonicalOrderIndex(key)]) : [],
    reasonCodes,
    ordering: buildSectionOrdering(parsed),
    taskpad: buildTaskpadMetadata(taskpadPath, parsed),
  };
}

/**
 * Get canonical order index from section key
 */
function getCanonicalOrderIndex(key: CanonicalSectionKey): number {
  switch (key) {
    case "workQueue":
      return 0;
    case "executionQueue":
      return 1;
    case "autonomousKickoffQueue":
      return 2;
    case "selfImprovementBacklog":
      return 3;
  }
}

/**
 * Extract section block for a given H2 heading
 */
function extractSectionBlock(parsed: ParsedTaskpad, headingMatch: H2HeadingMatch): SectionBlock {
  const contentStartLineNumber = headingMatch.lineNumber + 1;
  let contentEndLineNumber: number | null = null;

  // Find next H2 or end of file
  for (let i = headingMatch.lineIndex + 1; i < parsed.lines.length; i++) {
    const trimmed = parsed.lines[i].trim();
    if (trimmed.startsWith("## ")) {
      contentEndLineNumber = i + 1;
      break;
    }
  }

  const contentStartIndex = headingMatch.lineIndex + 1;
  const contentEndIndex = contentEndLineNumber !== null ? contentEndLineNumber - 1 : parsed.lines.length;

  const content = parsed.lines.slice(contentStartIndex, contentEndIndex).join("\n");

  return {
    heading: headingMatch.heading,
    headingLineNumber: headingMatch.lineNumber,
    contentStartLineNumber,
    contentEndLineNumber,
    content,
  };
}

/**
 * Get all section blocks (canonical and non-canonical)
 */
function getAllSectionBlocks(parsed: ParsedTaskpad): SectionBlock[] {
  const blocks: SectionBlock[] = [];

  for (const heading of parsed.h2Headings) {
    blocks.push(extractSectionBlock(parsed, heading));
  }

  return blocks;
}

/**
 * Insertion position for a missing canonical section
 */
function findInsertionPositionForMissingSection(
  parsed: ParsedTaskpad,
  missingKey: CanonicalSectionKey,
): number {
  const missingOrder = getCanonicalOrderIndex(missingKey);

  // Find the next canonical section that exists (lower in canonical order)
  let nextCanonicalLine: number | null = null;
  for (const heading of parsed.h2Headings) {
    if (heading.isCanonical && heading.canonicalOrder !== undefined && heading.canonicalOrder > missingOrder) {
      if (nextCanonicalLine === null || heading.lineIndex < nextCanonicalLine) {
        nextCanonicalLine = heading.lineIndex;
      }
    }
  }

  // If there's a lower-order canonical section, insert before it
  if (nextCanonicalLine !== null) {
    // Insert with one blank line before
    return nextCanonicalLine;
  }

  // If all higher-order canonical sections exist, insert after the last one
  let lastHigherOrderLine = parsed.frontmatterEndLine;
  for (const heading of parsed.h2Headings) {
    if (heading.isCanonical && heading.canonicalOrder !== undefined && heading.canonicalOrder < missingOrder) {
      if (heading.lineIndex > lastHigherOrderLine) {
        lastHigherOrderLine = heading.lineIndex;
      }
    }
  }

  // If we found a higher-order section, insert after its content block
  if (lastHigherOrderLine > parsed.frontmatterEndLine) {
    // Find the end of this section's content
    for (let i = lastHigherOrderLine + 1; i < parsed.lines.length; i++) {
      const trimmed = parsed.lines[i].trim();
      if (trimmed.startsWith("## ")) {
        return i; // Insert before next section
      }
    }
    return parsed.lines.length; // Insert at end of file
  }

  // No canonical sections exist, insert at document start (after frontmatter)
  return parsed.frontmatterEndLine;
}

/**
 * Build insertion lines for a missing section
 */
function buildMissingSectionLines(sectionHeading: string): string[] {
  return ["", sectionHeading, ""];
}

/**
 * Heal missing canonical sections
 */
function healMissingSections(parsed: ParsedTaskpad, missingKeys: CanonicalSectionKey[]): ParsedTaskpad {
  if (missingKeys.length === 0) {
    return parsed;
  }

  // Sort missing keys by canonical order (highest first to maintain insertion positions)
  const sortedMissing = [...missingKeys].sort((a, b) => getCanonicalOrderIndex(b) - getCanonicalOrderIndex(a));

  let lines = [...parsed.lines];

  for (const missingKey of sortedMissing) {
    const sectionHeading = CANONICAL_SECTIONS[getCanonicalOrderIndex(missingKey)];
    const insertPosition = findInsertionPositionForMissingSection(parsed, missingKey);
    const insertionLines = buildMissingSectionLines(sectionHeading);

    // Insert the new section
    lines = [...lines.slice(0, insertPosition), ...insertionLines, ...lines.slice(insertPosition)];

    // Re-parse after each insertion to update line indices
    parsed = parseTaskpad(lines.join("\n"));
  }

  return parsed;
}

/**
 * Reorder sections to canonical order
 */
function healOutOfOrderSections(parsed: ParsedTaskpad): ParsedTaskpad {
  const currentOrder = computeCurrentOrder(parsed);
  if (isCanonicalOrder(currentOrder)) {
    return parsed; // Already in order
  }

  const allBlocks = getAllSectionBlocks(parsed);

  // Separate canonical and non-canonical blocks
  const canonicalBlocks = new Map<CanonicalSectionKey, SectionBlock>();
  const nonCanonicalBlocks: SectionBlock[] = [];

  for (const block of allBlocks) {
    const headingMatch = parsed.h2Headings.find((h) => h.heading === block.heading);
    if (headingMatch?.isCanonical && headingMatch?.canonicalKey) {
      if (!canonicalBlocks.has(headingMatch.canonicalKey)) {
        canonicalBlocks.set(headingMatch.canonicalKey, block);
      }
    } else {
      nonCanonicalBlocks.push(block);
    }
  }

  // Build new lines in canonical order
  const newLines: string[] = [];

  // Keep frontmatter
  for (let i = 0; i < parsed.frontmatterEndLine; i++) {
    newLines.push(parsed.lines[i]);
  }

  // Insert canonical sections in order
  for (let i = 0; i < CANONICAL_SECTIONS.length; i++) {
    const key = getCanonicalKey(CANONICAL_SECTIONS[i]);
    const block = canonicalBlocks.get(key);

    if (block) {
      // Add blank line before section
      newLines.push("");
      // Add heading
      newLines.push(block.heading);
      // Add content if exists
      if (block.content.length > 0) {
        const contentLines = block.content.split("\n");
        newLines.push(...contentLines);
      }
    }
  }

  // Add non-canonical sections at the end, preserving their relative order
  for (const block of nonCanonicalBlocks) {
    // Add blank line before section
    newLines.push("");
    // Add heading
    newLines.push(block.heading);
    // Add content if exists
    if (block.content.length > 0) {
      const contentLines = block.content.split("\n");
      newLines.push(...contentLines);
    }
  }

  return parseTaskpad(newLines.join("\n"));
}

/**
 * Auto-heal result
 */
export interface QueueReconcileHealResult extends QueueReconcileResult {
  /** Healed markdown content */
  healedMarkdown: string | null;
  /** Whether mutations were applied */
  mutated: boolean;
}

/**
 * Build reconcile result from parsed taskpad
 */
function buildReconcileResultFromParsed(
  taskpadPath: string,
  parsed: ParsedTaskpad,
  originalMarkdown: string,
  healedMarkdown?: string,
): QueueReconcileResult {
  const sectionsPresent = computeSectionsPresent(parsed);
  const reasonCodes = buildReasonCodes(parsed, "canonical");

  const status: ReconcileStatus = reasonCodes.includes("RECONCILE_CANONICAL")
    ? "canonical"
    : reasonCodes.includes("RECONCILE_EMPTY_SECTION")
      ? "canonical" // Empty sections are informational, not a failure
      : "healed";

  return {
    status,
    sectionsPresent,
    healedSections: status === "healed" ? detectMissingSections(parsed).map((key) => CANONICAL_SECTIONS[getCanonicalOrderIndex(key)]) : [],
    reasonCodes,
    ordering: buildSectionOrdering(parsed),
    taskpad: buildTaskpadMetadata(taskpadPath, parsed),
  };
}

/**
 * Heal taskpad markdown to canonical structure
 *
 * Implements auto-heal for missing/out-of-order canonical headings
 * with stable insertion anchors and no duplicate heading creation.
 *
 * @param options - Reconcile options including taskpad path
 * @returns Reconcile result with healed markdown
 */
export function healTaskpad(options: ReconcileOptions): QueueReconcileHealResult {
  // First, run reconcile to detect issues
  const reconcileResult = reconcileTaskpad(options);

  // If file not found or parse error, return without healing
  if (reconcileResult.status === "error") {
    return {
      ...reconcileResult,
      healedMarkdown: null,
      mutated: false,
    };
  }

  // If already canonical, return as-is
  if (reconcileResult.status === "canonical") {
    return {
      ...reconcileResult,
      healedMarkdown: null,
      mutated: false,
    };
  }

  // Read the markdown content
  let markdown: string;
  try {
    markdown = readFileSync(options.taskpadPath, "utf8");
  } catch {
    return {
      ...reconcileResult,
      healedMarkdown: null,
      mutated: false,
    };
  }

  let parsed = parseTaskpad(markdown);

  // Heal missing sections first
  const missingSections = detectMissingSections(parsed);
  if (missingSections.length > 0) {
    parsed = healMissingSections(parsed, missingSections);
  }

  // Then heal out-of-order sections
  const outOfOrder = detectOutOfOrderSections(parsed);
  if (outOfOrder) {
    parsed = healOutOfOrderSections(parsed);
  }

  // Get the healed markdown
  const healedMarkdown = parsed.lines.join("\n");
  const mutated = healedMarkdown !== markdown;

  // Build reconcile result from healed content
  const healedReconcileResult = buildReconcileResultFromParsed(
    options.taskpadPath,
    parsed,
    markdown,
    healedMarkdown,
  );

  // Build final result
  return {
    ...healedReconcileResult,
    healedMarkdown: healedMarkdown && mutated ? healedMarkdown : null,
    mutated,
  };
}
