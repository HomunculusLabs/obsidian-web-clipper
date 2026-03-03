import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const EXECUTION_QUEUE_HEADING_REGEX = /^##\s+Execution Queue\b/;
const CHECKED_CHECKBOX_REGEX = /^(\s*[-*+]\s+\[[xX]\]\s+)/;
const UNCHECKED_CHECKBOX_REGEX = /^(\s*[-*+]\s+\[\s*\]\s+)/;
const EXECUTION_QUEUE_PRUNE_TMP_FILE_TAG = ".taskpad-execution-queue-prune.tmp";

export const EXECUTION_QUEUE_PRUNE_RULE_IDS = {
  PRUNE_OK: "EQP001_PRUNE_OK",
  PRUNE_NOOP_NO_ARCHIVE_CANDIDATES: "EQP002_PRUNE_NOOP_NO_ARCHIVE_CANDIDATES",
  PRUNE_NOOP_EXECUTION_QUEUE_MISSING: "EQP003_PRUNE_NOOP_EXECUTION_QUEUE_MISSING",
  PRUNE_INPUT_INVALID: "EQP004_PRUNE_INPUT_INVALID",
  PRUNE_TASKPAD_READ_FAILED: "EQP005_PRUNE_TASKPAD_READ_FAILED",
  PRUNE_TASKPAD_STRUCTURE_INVALID: "EQP006_PRUNE_TASKPAD_STRUCTURE_INVALID",
  PRUNE_ARCHIVE_WRITE_FAILED: "EQP007_PRUNE_ARCHIVE_WRITE_FAILED",
  PRUNE_TASKPAD_WRITE_FAILED: "EQP008_PRUNE_TASKPAD_WRITE_FAILED",
  PRUNE_ATOMIC_COMMIT_ABORTED: "EQP009_PRUNE_ATOMIC_COMMIT_ABORTED",
} as const;

export type ExecutionQueuePruneReasonCode = (typeof EXECUTION_QUEUE_PRUNE_RULE_IDS)[keyof typeof EXECUTION_QUEUE_PRUNE_RULE_IDS];

export type CheckboxState = "checked" | "unchecked";

export type MarkerShape = "unparenthesized" | "parenthesized" | "none";

export interface ExecutionQueueBulletFingerprint {
  lineNumber: number;
  rawText: string;
  checkboxState: CheckboxState;
  markerShape: MarkerShape;
  plannedDate: string | null;
  taskText: string;
  fingerprintHash: string;
}

export interface ExecutionQueueParseResult {
  reasonCode: ExecutionQueuePruneReasonCode;
  executionQueueHeadingFound: boolean;
  executionQueueStartLine: number;
  executionQueueEndLine: number;
  allBullets: ExecutionQueueBulletFingerprint[];
  archivedBullets: ExecutionQueueBulletFingerprint[];
  preservedBullets: ExecutionQueueBulletFingerprint[];
  structuralErrors: string[];
}

export interface ExecutionQueuePruneResult {
  status: "success" | "noop" | "error";
  reasonCode: ExecutionQueuePruneReasonCode;
  inputs: {
    taskpadPath: string;
    archivePath: string;
  };
  stats: {
    totalExecutionQueueLines: number;
    archivedBulletsCount: number;
    preservedBulletsCount: number;
  };
  archivedBullets: ExecutionQueueBulletFingerprint[];
  structuralErrors: string[];
  timestamp: string;
}

function getLines(markdown: string): string[] {
  return markdown.split(/\r?\n/);
}

function getDetectedNewline(markdown: string): "\n" | "\r\n" {
  return markdown.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeTrailingNewline(markdown: string, newline: "\n" | "\r\n"): string {
  const normalized = markdown.replace(/\r\n/g, "\n").replace(/\n+$/g, "");
  return normalized.length === 0 ? "" : `${normalized}${newline}`;
}

function computeFingerprintHash(fingerprint: ExecutionQueueBulletFingerprint): string {
  const normalized = [
    fingerprint.lineNumber,
    fingerprint.checkboxState,
    fingerprint.markerShape,
    fingerprint.plannedDate,
    fingerprint.taskText.trim(),
  ].join("|");

  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function extractCheckboxState(line: string): CheckboxState | null {
  if (CHECKED_CHECKBOX_REGEX.test(line)) {
    return "checked";
  }
  if (UNCHECKED_CHECKBOX_REGEX.test(line)) {
    return "unchecked";
  }
  return null;
}

function extractPlannedMarker(line: string): { date: string | null; shape: MarkerShape } {
  // Match unparenthesized: planned-YYYY-MM-DD anywhere in the text
  const unparenthesizedMatch = line.match(/(?:^|\s)(planned-(\d{4}-\d{2}-\d{2}))(?:\s|$)/);
  if (unparenthesizedMatch) {
    return { date: unparenthesizedMatch[2], shape: "unparenthesized" };
  }

  // Match parenthesized: (planned-YYYY-MM-DD) anywhere in the text
  const parenthesizedMatch = line.match(/\(planned-(\d{4}-\d{2}-\d{2})\)/);
  if (parenthesizedMatch) {
    return { date: parenthesizedMatch[1], shape: "parenthesized" };
  }

  return { date: null, shape: "none" };
}

function extractTaskText(line: string, checkboxState: CheckboxState | null, plannedDate: string | null): string {
  let text = line;

  // Remove checkbox prefix
  if (checkboxState) {
    text = text.replace(CHECKED_CHECKBOX_REGEX, "").replace(UNCHECKED_CHECKBOX_REGEX, "");
  }

  // Remove planned marker (both unparenthesized and parenthesized forms)
  if (plannedDate) {
    // Remove parenthesized form: (planned-YYYY-MM-DD)
    text = text.replace(/\(planned-\d{4}-\d{2}-\d{2}\)/g, "");
    // Remove unparenthesized form: planned-YYYY-MM-DD (with surrounding whitespace)
    text = text.replace(/(?:^|\s)planned-\d{4}-\d{2}-\d{2}(?:\s|$)/g, " ");
  }

  // Clean up extra whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

function isArchiveCandidate(bullet: ExecutionQueueBulletFingerprint): boolean {
  return bullet.checkboxState === "checked" || bullet.plannedDate !== null;
}

export function parseExecutionQueueSection(taskpadMarkdown: string): ExecutionQueueParseResult {
  const lines = getLines(taskpadMarkdown);

  const executionQueueHeadingIndexes = lines.reduce<number[]>((indexes, line, index) => {
    if (EXECUTION_QUEUE_HEADING_REGEX.test(line.trim())) {
      indexes.push(index);
    }
    return indexes;
  }, []);

  if (executionQueueHeadingIndexes.length === 0) {
    return {
      reasonCode: "EQP003_PRUNE_NOOP_EXECUTION_QUEUE_MISSING",
      executionQueueHeadingFound: false,
      executionQueueStartLine: -1,
      executionQueueEndLine: -1,
      allBullets: [],
      archivedBullets: [],
      preservedBullets: [],
      structuralErrors: [],
    };
  }

  if (executionQueueHeadingIndexes.length > 1) {
    return {
      reasonCode: "EQP006_PRUNE_TASKPAD_STRUCTURE_INVALID",
      executionQueueHeadingFound: true,
      executionQueueStartLine: executionQueueHeadingIndexes[0] + 1,
      executionQueueEndLine: -1,
      allBullets: [],
      archivedBullets: [],
      preservedBullets: [],
      structuralErrors: ["Multiple '## Execution Queue' headings found; only one is allowed."],
    };
  }

  const startLine = executionQueueHeadingIndexes[0];
  let endLine = lines.length;

  for (let i = startLine + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith("## ")) {
      endLine = i;
      break;
    }
  }

  const executionQueueLines = lines.slice(startLine + 1, endLine);
  const structuralErrors: string[] = [];
  const allBullets: ExecutionQueueBulletFingerprint[] = [];

  for (let i = 0; i < executionQueueLines.length; i++) {
    const line = executionQueueLines[i];
    const originalLineNumber = startLine + 1 + i + 1;

    const checkboxState = extractCheckboxState(line);

    if (!checkboxState) {
      continue;
    }

    const { date: plannedDate, shape: markerShape } = extractPlannedMarker(line);
    const taskText = extractTaskText(line, checkboxState, plannedDate);

    const fingerprint: ExecutionQueueBulletFingerprint = {
      lineNumber: originalLineNumber,
      rawText: line,
      checkboxState,
      markerShape,
      plannedDate,
      taskText,
      fingerprintHash: "",
    };

    fingerprint.fingerprintHash = computeFingerprintHash(fingerprint);
    allBullets.push(fingerprint);
  }

  const archivedBullets = allBullets.filter(isArchiveCandidate);
  const preservedBullets = allBullets.filter((b) => !isArchiveCandidate(b));

  return {
    reasonCode: "EQP001_PRUNE_OK",
    executionQueueHeadingFound: true,
    executionQueueStartLine: startLine + 1,
    executionQueueEndLine: endLine,
    allBullets,
    archivedBullets,
    preservedBullets,
    structuralErrors,
  };
}

export function buildArchiveMarkdownWithBullets(
  existingArchiveMarkdown: string | null,
  archivedBullets: ExecutionQueueBulletFingerprint[],
  taskpadPath: string,
): { reasonCode: ExecutionQueuePruneReasonCode; archiveMarkdown: string | null; structuralErrors: string[] } {
  if (archivedBullets.length === 0) {
    return {
      reasonCode: "EQP002_PRUNE_NOOP_NO_ARCHIVE_CANDIDATES",
      archiveMarkdown: existingArchiveMarkdown,
      structuralErrors: [],
    };
  }

  const newline = getDetectedNewline(existingArchiveMarkdown ?? archivedBullets[0]?.rawText ?? "\n");
  const now = new Date().toISOString();
  const today = now.split("T")[0];

  const archiveHeader = `<!--${newline}
TASKPAD Execution Queue Archive: ${today}${newline}
Generated: ${now}${newline}
Source TASKPAD: ${taskpadPath}${newline}
-->`;

  const sectionHeading = `${newline}${newline}---${newline}${newline}## Archived from ${today}${newline}${newline}`;

  const archivedLines = archivedBullets
    .sort((a, b) => a.lineNumber - b.lineNumber)
    .map((bullet) => {
      return `${bullet.rawText} <!-- fingerprint: ${bullet.fingerprintHash} -->`;
    });

  const sectionContent = archivedLines.join(newline);
  const newSection = `${sectionHeading}${sectionContent}`;

  if (!existingArchiveMarkdown || existingArchiveMarkdown.trim().length === 0) {
    return {
      reasonCode: "EQP001_PRUNE_OK",
      archiveMarkdown: normalizeTrailingNewline(`${archiveHeader}${newSection}`, newline),
      structuralErrors: [],
    };
  }

  const combined = `${normalizeTrailingNewline(existingArchiveMarkdown, newline)}${newSection}`;

  return {
    reasonCode: "EQP001_PRUNE_OK",
    archiveMarkdown: normalizeTrailingNewline(combined, newline),
    structuralErrors: [],
  };
}

export function rewriteTaskpadWithoutArchivedBullets(
  taskpadMarkdown: string,
  parseResult: ExecutionQueueParseResult,
): { reasonCode: ExecutionQueuePruneReasonCode; updatedTaskpadMarkdown: string | null; structuralErrors: string[] } {
  if (parseResult.reasonCode !== "EQP001_PRUNE_OK") {
    return {
      reasonCode: parseResult.reasonCode,
      updatedTaskpadMarkdown: null,
      structuralErrors: parseResult.structuralErrors,
    };
  }

  if (parseResult.archivedBullets.length === 0) {
    return {
      reasonCode: "EQP002_PRUNE_NOOP_NO_ARCHIVE_CANDIDATES",
      updatedTaskpadMarkdown: taskpadMarkdown,
      structuralErrors: [],
    };
  }

  const archivedLineNumbers = new Set(parseResult.archivedBullets.map((b) => b.lineNumber));
  const lines = getLines(taskpadMarkdown);
  const filteredLines = lines.filter((_, index) => !archivedLineNumbers.has(index + 1));
  const updatedTaskpadMarkdown = filteredLines.join("\n");

  return {
    reasonCode: "EQP001_PRUNE_OK",
    updatedTaskpadMarkdown,
    structuralErrors: [],
  };
}

function buildAtomicTempPath(targetPath: string): string {
  return `${targetPath}${EXECUTION_QUEUE_PRUNE_TMP_FILE_TAG}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanupTempFile(path: string): void {
  try {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // Best-effort cleanup only.
  }
}

interface ExecutionQueuePruneAtomicWriteOptions {
  taskpadPath: string;
  archivePath: string;
  updatedTaskpadMarkdown: string;
  updatedArchiveMarkdown: string;
}

interface ExecutionQueuePruneAtomicWriteResult {
  reasonCode: ExecutionQueuePruneReasonCode;
  committed: boolean;
}

export function writeExecutionQueuePruneFilesAtomically(
  options: ExecutionQueuePruneAtomicWriteOptions,
): ExecutionQueuePruneAtomicWriteResult {
  const archiveTempPath = buildAtomicTempPath(options.archivePath);
  const taskpadTempPath = buildAtomicTempPath(options.taskpadPath);

  let originalArchive: string | null = null;
  let originalTaskpad: string;

  try {
    originalTaskpad = readFileSync(options.taskpadPath, "utf8");
  } catch {
    return {
      reasonCode: "EQP005_PRUNE_TASKPAD_READ_FAILED",
      committed: false,
    };
  }

  try {
    if (existsSync(options.archivePath)) {
      originalArchive = readFileSync(options.archivePath, "utf8");
    }
  } catch {
    return {
      reasonCode: "EQP007_PRUNE_ARCHIVE_WRITE_FAILED",
      committed: false,
    };
  }

  try {
    mkdirSync(dirname(options.archivePath), { recursive: true });
  } catch {
    return {
      reasonCode: "EQP007_PRUNE_ARCHIVE_WRITE_FAILED",
      committed: false,
    };
  }

  let archiveCommitted = false;
  let taskpadCommitted = false;

  try {
    try {
      writeFileSync(archiveTempPath, options.updatedArchiveMarkdown, "utf8");
    } catch {
      return {
        reasonCode: "EQP007_PRUNE_ARCHIVE_WRITE_FAILED",
        committed: false,
      };
    }

    try {
      writeFileSync(taskpadTempPath, options.updatedTaskpadMarkdown, "utf8");
    } catch {
      return {
        reasonCode: "EQP008_PRUNE_TASKPAD_WRITE_FAILED",
        committed: false,
      };
    }

    renameSync(archiveTempPath, options.archivePath);
    archiveCommitted = true;

    renameSync(taskpadTempPath, options.taskpadPath);
    taskpadCommitted = true;

    return {
      reasonCode: "EQP001_PRUNE_OK",
      committed: true,
    };
  } catch {
    try {
      if (archiveCommitted) {
        if (originalArchive === null) {
          unlinkSync(options.archivePath);
        } else {
          writeFileSync(options.archivePath, originalArchive, "utf8");
        }
      }

      if (taskpadCommitted) {
        writeFileSync(options.taskpadPath, originalTaskpad, "utf8");
      }
    } catch {
      // Best-effort rollback only.
    }

    return {
      reasonCode: "EQP009_PRUNE_ATOMIC_COMMIT_ABORTED",
      committed: false,
    };
  } finally {
    cleanupTempFile(archiveTempPath);
    cleanupTempFile(taskpadTempPath);
  }
}

export function pruneExecutionQueue(
  taskpadPath: string,
  archivePath: string,
): ExecutionQueuePruneResult {
  const resolvedTaskpadPath = resolve(taskpadPath);
  const resolvedArchivePath = resolve(archivePath);

  let taskpadMarkdown: string;

  try {
    taskpadMarkdown = readFileSync(resolvedTaskpadPath, "utf8");
  } catch {
    return {
      status: "error",
      reasonCode: "EQP005_PRUNE_TASKPAD_READ_FAILED",
      inputs: {
        taskpadPath: resolvedTaskpadPath,
        archivePath: resolvedArchivePath,
      },
      stats: {
        totalExecutionQueueLines: 0,
        archivedBulletsCount: 0,
        preservedBulletsCount: 0,
      },
      archivedBullets: [],
      structuralErrors: [],
      timestamp: new Date().toISOString(),
    };
  }

  let existingArchiveMarkdown: string | null = null;
  try {
    if (existsSync(resolvedArchivePath)) {
      existingArchiveMarkdown = readFileSync(resolvedArchivePath, "utf8");
    }
  } catch {
    return {
      status: "error",
      reasonCode: "EQP007_PRUNE_ARCHIVE_WRITE_FAILED",
      inputs: {
        taskpadPath: resolvedTaskpadPath,
        archivePath: resolvedArchivePath,
      },
      stats: {
        totalExecutionQueueLines: 0,
        archivedBulletsCount: 0,
        preservedBulletsCount: 0,
      },
      archivedBullets: [],
      structuralErrors: [],
      timestamp: new Date().toISOString(),
    };
  }

  const parseResult = parseExecutionQueueSection(taskpadMarkdown);

  if (parseResult.reasonCode === "EQP003_PRUNE_NOOP_EXECUTION_QUEUE_MISSING") {
    return {
      status: "noop",
      reasonCode: parseResult.reasonCode,
      inputs: {
        taskpadPath: resolvedTaskpadPath,
        archivePath: resolvedArchivePath,
      },
      stats: {
        totalExecutionQueueLines: 0,
        archivedBulletsCount: 0,
        preservedBulletsCount: 0,
      },
      archivedBullets: [],
      structuralErrors: [],
      timestamp: new Date().toISOString(),
    };
  }

  if (parseResult.reasonCode !== "EQP001_PRUNE_OK") {
    return {
      status: "error",
      reasonCode: parseResult.reasonCode,
      inputs: {
        taskpadPath: resolvedTaskpadPath,
        archivePath: resolvedArchivePath,
      },
      stats: {
        totalExecutionQueueLines: parseResult.allBullets.length,
        archivedBulletsCount: 0,
        preservedBulletsCount: parseResult.allBullets.length,
      },
      archivedBullets: [],
      structuralErrors: parseResult.structuralErrors,
      timestamp: new Date().toISOString(),
    };
  }

  if (parseResult.archivedBullets.length === 0) {
    return {
      status: "noop",
      reasonCode: "EQP002_PRUNE_NOOP_NO_ARCHIVE_CANDIDATES",
      inputs: {
        taskpadPath: resolvedTaskpadPath,
        archivePath: resolvedArchivePath,
      },
      stats: {
        totalExecutionQueueLines: parseResult.allBullets.length,
        archivedBulletsCount: 0,
        preservedBulletsCount: parseResult.preservedBullets.length,
      },
      archivedBullets: [],
      structuralErrors: [],
      timestamp: new Date().toISOString(),
    };
  }

  const archiveResult = buildArchiveMarkdownWithBullets(
    existingArchiveMarkdown,
    parseResult.archivedBullets,
    resolvedTaskpadPath,
  );

  if (archiveResult.reasonCode !== "EQP001_PRUNE_OK") {
    return {
      status: "error",
      reasonCode: archiveResult.reasonCode,
      inputs: {
        taskpadPath: resolvedTaskpadPath,
        archivePath: resolvedArchivePath,
      },
      stats: {
        totalExecutionQueueLines: parseResult.allBullets.length,
        archivedBulletsCount: 0,
        preservedBulletsCount: parseResult.preservedBullets.length,
      },
      archivedBullets: [],
      structuralErrors: archiveResult.structuralErrors,
      timestamp: new Date().toISOString(),
    };
  }

  const taskpadResult = rewriteTaskpadWithoutArchivedBullets(taskpadMarkdown, parseResult);

  if (taskpadResult.reasonCode !== "EQP001_PRUNE_OK") {
    return {
      status: "error",
      reasonCode: taskpadResult.reasonCode,
      inputs: {
        taskpadPath: resolvedTaskpadPath,
        archivePath: resolvedArchivePath,
      },
      stats: {
        totalExecutionQueueLines: parseResult.allBullets.length,
        archivedBulletsCount: 0,
        preservedBulletsCount: parseResult.preservedBullets.length,
      },
      archivedBullets: [],
      structuralErrors: taskpadResult.structuralErrors,
      timestamp: new Date().toISOString(),
    };
  }

  const atomicResult = writeExecutionQueuePruneFilesAtomically({
    taskpadPath: resolvedTaskpadPath,
    archivePath: resolvedArchivePath,
    updatedTaskpadMarkdown: taskpadResult.updatedTaskpadMarkdown!,
    updatedArchiveMarkdown: archiveResult.archiveMarkdown!,
  });

  if (!atomicResult.committed) {
    return {
      status: "error",
      reasonCode: atomicResult.reasonCode,
      inputs: {
        taskpadPath: resolvedTaskpadPath,
        archivePath: resolvedArchivePath,
      },
      stats: {
        totalExecutionQueueLines: parseResult.allBullets.length,
        archivedBulletsCount: 0,
        preservedBulletsCount: parseResult.preservedBullets.length,
      },
      archivedBullets: [],
      structuralErrors: [],
      timestamp: new Date().toISOString(),
    };
  }

  return {
    status: "success",
    reasonCode: "EQP001_PRUNE_OK",
    inputs: {
      taskpadPath: resolvedTaskpadPath,
      archivePath: resolvedArchivePath,
    },
    stats: {
      totalExecutionQueueLines: parseResult.allBullets.length,
      archivedBulletsCount: parseResult.archivedBullets.length,
      preservedBulletsCount: parseResult.preservedBullets.length,
    },
    archivedBullets: parseResult.archivedBullets.sort((a, b) => a.lineNumber - b.lineNumber),
    structuralErrors: [],
    timestamp: new Date().toISOString(),
  };
}

function formatHumanOutput(result: ExecutionQueuePruneResult): string {
  const statusUpper = result.status.toUpperCase();
  const separator = "─".repeat(60);

  const lines = [
    `TASKPAD Execution Queue Prune: ${statusUpper}`,
    separator,
    "Input:",
    `  - taskpad: ${result.inputs.taskpadPath}`,
    `  - archive: ${result.inputs.archivePath}`,
    "",
    "Stats:",
    `  - totalExecutionQueueLines: ${result.stats.totalExecutionQueueLines}`,
    `  - archivedBulletsCount: ${result.stats.archivedBulletsCount}`,
    `  - preservedBulletsCount: ${result.stats.preservedBulletsCount}`,
    "",
    `Archived bullets: ${result.stats.archivedBulletsCount}`,
    `Preserved bullets: ${result.stats.preservedBulletsCount}`,
    "",
    `Reason: ${result.reasonCode}`,
  ];

  if (result.structuralErrors.length > 0) {
    lines.push("");
    lines.push("Structural errors:");
    for (const error of result.structuralErrors) {
      lines.push(`  - ${error}`);
    }
  }

  return lines.join("\n");
}

function formatJsonOutput(result: ExecutionQueuePruneResult): string {
  // Sort keys alphabetically for deterministic output
  const sortedArchivedBullets = result.archivedBullets.sort((a, b) => {
    if (a.lineNumber !== b.lineNumber) {
      return a.lineNumber - b.lineNumber;
    }
    return a.rawText.localeCompare(b.rawText);
  });

  const jsonOutput = JSON.stringify(
    {
      archivedBullets: sortedArchivedBullets,
      inputs: result.inputs,
      reasonCode: result.reasonCode,
      stats: result.stats,
      status: result.status,
      structuralErrors: result.structuralErrors.sort(),
      timestamp: result.timestamp,
    },
    null,
    2,
  );

  return `TASKPAD_EXECUTION_QUEUE_PRUNE_JSON_START\n${jsonOutput}\nTASKPAD_EXECUTION_QUEUE_PRUNE_JSON_END`;
}

function parseArgs(argv: string[]): { taskpadPath?: string; archivePath?: string; format: "json" | "human" } {
  let taskpadPath: string | undefined;
  let archivePath: string | undefined;
  let format: "json" | "human" = "json";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--taskpad" && i + 1 < argv.length) {
      taskpadPath = argv[i + 1];
      i++;
    } else if (arg === "--archive" && i + 1 < argv.length) {
      archivePath = argv[i + 1];
      i++;
    } else if (arg === "--format" && i + 1 < argv.length) {
      const formatValue = argv[i + 1];
      if (formatValue === "json" || formatValue === "human") {
        format = formatValue;
      }
      i++;
    } else if (!arg.startsWith("--")) {
      if (!taskpadPath) {
        taskpadPath = arg;
      }
    }
  }

  return { taskpadPath, archivePath, format };
}

function printHelp(): void {
  console.error(`
Usage: bun run taskpad:execution-queue-prune -- --taskpad <path> --archive <path> [--format json|human]

Arguments:
  --taskpad <path>       Path to TASKPAD.md file (required)
  --archive <path>       Path to archive file (required)
  --format <format>      Output format: json (default) or human

Examples:
  bun run taskpad:execution-queue-prune -- --taskpad TASKPAD.md --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md"
  bun run taskpad:execution-queue-prune -- --taskpad TASKPAD.md --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md" --format json
  bun run taskpad:execution-queue-prune -- --taskpad TASKPAD.md --archive "docs/archive/TASKPAD_ARCHIVE_2026-03.md" --format human
`);
}

function main(): void {
  const { taskpadPath, archivePath, format } = parseArgs(process.argv.slice(2));

  if (!taskpadPath) {
    console.error("Missing TASKPAD path. Provide --taskpad <path>.");
    printHelp();
    process.exit(2);
  }

  if (!archivePath) {
    console.error("Missing archive path. Provide --archive <path>.");
    printHelp();
    process.exit(2);
  }

  const result = pruneExecutionQueue(taskpadPath, archivePath);

  if (format === "json") {
    console.log(formatJsonOutput(result));
  } else {
    console.log(formatHumanOutput(result));
  }

  const exitCode = result.status === "error" ? 1 : 0;
  process.exit(exitCode);
}

if (import.meta.main) {
  main();
}
