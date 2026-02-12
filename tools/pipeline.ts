#!/usr/bin/env bun
/**
 * Pipeline Tool — Chain multiple clipping tools together
 *
 * Compose operations into pipelines for automated research workflows.
 * Supports both a simple DSL and JSON configuration.
 *
 * Usage:
 *   # Simple pipeline: search and clip top 5 results
 *   bun run tools/pipeline.ts --steps "search:obsidian plugins -> clip:top5 -> save:obsidian"
 *
 *   # Pipeline from JSON config file
 *   bun run tools/pipeline.ts --config pipeline.json
 *
 *   # Output as JSON
 *   bun run tools/pipeline.ts --steps "search:AI news -> clip:top3" --json
 *
 *   # Clip multiple URLs then save
 *   bun run tools/pipeline.ts --steps "clip:https://example.com,https://other.com -> save:obsidian"
 *
 *   # YouTube + search combo
 *   bun run tools/pipeline.ts --steps "youtube:https://youtube.com/watch?v=abc -> save:obsidian"
 *
 * DSL Syntax:
 *   step1 -> step2 -> step3
 *
 * Step Types:
 *   search:<query>           - Search Google for query
 *   clip:<url>[,url2,...]    - Clip specific URLs
 *   clip:top<N>              - Clip top N results from previous search
 *   clip:all                 - Clip all results from previous search
 *   youtube:<url>            - Clip YouTube video with transcript
 *   save:obsidian            - Save all results to Obsidian
 *   filter:<field>:<value>   - Filter results by field (e.g., filter:pageType:web)
 *   tags:<tag1,tag2>         - Add tags to results
 *   output:stdout            - Output results to stdout
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { sanitizeFilename } from "../src/shared/sanitize";
import {
  createLogger,
  type Logger,
  type ToolOutput,
} from "./lib/clipper-core";
import {
  loadConfig,
  mergeWithDefaults,
  getConfigHelpText,
  type WebClipperConfig,
} from "./lib/config";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PipelineStep {
  type: "search" | "clip" | "youtube" | "save" | "filter" | "tags" | "output";
  params: Record<string, unknown>;
}

interface PipelineConfig {
  /** Pipeline name for logging */
  name?: string;
  /** Pipeline steps */
  steps: PipelineStep[];
  /** Obsidian settings */
  obsidian?: {
    cli?: boolean;
    cliPath?: string;
    vault?: string;
    folder?: string;
  };
  /** Browser settings */
  browser?: {
    profile?: string;
    headless?: boolean;
    wait?: number;
  };
  /** Default tags to apply */
  tags?: string[];
  /** Continue on error */
  continueOnError?: boolean;
  /** Max concurrent clips */
  concurrency?: number;
}

interface PipelineResult {
  success: boolean;
  name: string;
  totalSteps: number;
  completedSteps: number;
  results: ToolOutput[];
  errors: string[];
}

interface IntermediateResult {
  urls?: string[];
  results: ToolOutput[];
}

// ─── CLI Options ─────────────────────────────────────────────────────────────

interface CLIOptions {
  steps: string;
  configFile: string | null;
  json: boolean;
  stdout: boolean;
  cli: boolean;
  cliPath: string;
  vault: string;
  folder: string;
  profile: string | null;
  headless: boolean;
  tags: string[];
  continueOnError: boolean;
  concurrency: number;
  topN: number;
}

const DEFAULT_OPTS: CLIOptions = {
  steps: "",
  configFile: null,
  json: false,
  stdout: false,
  cli: false,
  cliPath: "obsidian-cli",
  vault: "Main Vault",
  folder: "Clips",
  profile: null,
  headless: true,
  tags: ["web-clip"],
  continueOnError: false,
  concurrency: 4,
  topN: 5,
};

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[], log: Logger): CLIOptions {
  const opts = { ...DEFAULT_OPTS };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--steps" || arg === "-s") {
      i++;
      opts.steps = argv[i] || "";
    } else if (arg === "--config" || arg === "-c") {
      i++;
      opts.configFile = argv[i] || null;
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--stdout") {
      opts.stdout = true;
    } else if (arg === "--cli") {
      opts.cli = true;
    } else if (arg === "--cli-path") {
      i++;
      opts.cliPath = argv[i] || opts.cliPath;
    } else if (arg === "--vault") {
      i++;
      opts.vault = argv[i] || opts.vault;
    } else if (arg === "--folder") {
      i++;
      opts.folder = argv[i] || opts.folder;
    } else if (arg === "--profile") {
      i++;
      opts.profile = argv[i] || null;
    } else if (arg === "--no-headless") {
      opts.headless = false;
    } else if (arg === "--tags") {
      i++;
      opts.tags = (argv[i] || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    } else if (arg === "--continue-on-error") {
      opts.continueOnError = true;
    } else if (arg === "--concurrency" || arg === "-p") {
      i++;
      opts.concurrency = parseInt(argv[i] || "4", 10);
    } else if (arg === "--top" || arg === "-n") {
      i++;
      opts.topN = parseInt(argv[i] || "5", 10);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      log.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }

    i++;
  }

  return opts;
}

function printHelp(): void {
  console.log(`
Pipeline Tool — Chain multiple clipping tools together

USAGE:
  bun run tools/pipeline.ts --steps "step1 -> step2 -> step3"
  bun run tools/pipeline.ts --config pipeline.json

DSL SYNTAX:
  Steps are chained with "->". Each step passes results to the next.

  search:<query>           Search Google for query
  clip:<url>[,url2,...]    Clip specific URLs (comma-separated)
  clip:top<N>              Clip top N results from previous step
  clip:all                 Clip all results from previous step
  youtube:<url>            Clip YouTube video with transcript
  save:obsidian            Save all results to Obsidian
  filter:<field>:<value>   Filter results by field
  tags:<tag1,tag2>         Add tags to results
  output:stdout            Output results to stdout

OPTIONS:
  --steps, -s <dsl>        Pipeline steps in DSL format
  --config, -c <file>      Load pipeline from JSON config file
  --json                   Output structured JSON to stdout
  --stdout                 Output markdown to stdout
  --cli                    Use Obsidian CLI for saves
  --cli-path <path>        Path to obsidian-cli binary
  --vault <name>           Obsidian vault name (default: "Main Vault")
  --folder <path>          Obsidian folder path (default: "Clips")
  --profile <path>         Chrome user data dir for auth
  --no-headless            Show browser window
  --tags <a,b,c>           Default tags (default: "web-clip")
  --continue-on-error      Continue pipeline on step failure
  --concurrency, -p <n>    Max concurrent operations (default: 4)
  --top, -n <n>            Default top N for clip:topN (default: 5)
  --help, -h               Show this help message

EXAMPLES:
  # Search and clip top 5 results
  bun run tools/pipeline.ts -s "search:obsidian plugins -> clip:top5 -> save:obsidian"

  # Clip specific URLs and output as JSON
  bun run tools/pipeline.ts -s "clip:https://example.com,https://other.com" --json

  # YouTube to Obsidian
  bun run tools/pipeline.ts -s "youtube:https://youtube.com/watch?v=abc -> save:obsidian"

  # Complex pipeline from config file
  bun run tools/pipeline.ts --config research-pipeline.json

  # With filtering and tags
  bun run tools/pipeline.ts -s "search:AI research -> clip:top10 -> filter:pageType:web -> tags:research,AI -> save:obsidian"

JSON CONFIG FORMAT:
  {
    "name": "My Pipeline",
    "steps": [
      { "type": "search", "params": { "query": "obsidian plugins" } },
      { "type": "clip", "params": { "top": 5 } },
      { "type": "save", "params": { "target": "obsidian" } }
    ],
    "obsidian": {
      "vault": "Research",
      "folder": "Clips/Web"
    },
    "tags": ["research"],
    "continueOnError": true
  }
`);
}

// ─── DSL Parser ──────────────────────────────────────────────────────────────

function parseDSL(dsl: string, log: Logger): PipelineStep[] {
  const steps: PipelineStep[] = [];
  const parts = dsl.split("->").map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) {
      log.error(`Invalid step syntax: ${part}`);
      continue;
    }

    const type = part.slice(0, colonIdx).trim().toLowerCase();
    const paramsStr = part.slice(colonIdx + 1).trim();

    switch (type) {
      case "search":
        steps.push({ type: "search", params: { query: paramsStr } });
        break;

      case "clip":
        if (paramsStr.startsWith("top")) {
          const n = parseInt(paramsStr.slice(3), 10) || 5;
          steps.push({ type: "clip", params: { top: n } });
        } else if (paramsStr === "all") {
          steps.push({ type: "clip", params: { top: Infinity } });
        } else {
          const urls = paramsStr.split(",").map((u) => u.trim()).filter(Boolean);
          steps.push({ type: "clip", params: { urls } });
        }
        break;

      case "youtube":
        steps.push({ type: "youtube", params: { url: paramsStr } });
        break;

      case "save":
        steps.push({ type: "save", params: { target: paramsStr || "obsidian" } });
        break;

      case "filter":
        // filter:field:value
        const [field, ...valueParts] = paramsStr.split(":");
        steps.push({ type: "filter", params: { field, value: valueParts.join(":") } });
        break;

      case "tags":
        const tags = paramsStr.split(",").map((t) => t.trim()).filter(Boolean);
        steps.push({ type: "tags", params: { tags } });
        break;

      case "output":
        steps.push({ type: "output", params: { target: paramsStr || "stdout" } });
        break;

      default:
        log.error(`Unknown step type: ${type}`);
    }
  }

  return steps;
}

// ─── JSON Config Loader ───────────────────────────────────────────────────────

async function loadPipelineConfig(
  filePath: string,
  log: Logger
): Promise<PipelineConfig | null> {
  const absolutePath = resolve(filePath);

  if (!existsSync(absolutePath)) {
    log.error(`Config file not found: ${absolutePath}`);
    return null;
  }

  try {
    const content = await readFile(absolutePath, "utf-8");
    const config = JSON.parse(content);

    // Validate
    if (!Array.isArray(config.steps)) {
      log.error("Config must have a 'steps' array");
      return null;
    }

    return config as PipelineConfig;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Failed to parse config: ${message}`);
    return null;
  }
}

// ─── Tool Execution ──────────────────────────────────────────────────────────

async function runTool(
  tool: string,
  args: string[],
  log: Logger,
  quiet = false
): Promise<string> {
  return new Promise((resolve, reject) => {
    const toolPath = resolve(import.meta.dir, `${tool}.ts`);
    const proc = spawn("bun", ["run", toolPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      if (!quiet) {
        process.stderr.write(data);
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Tool ${tool} exited with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

async function runSearchClip(
  query: string,
  opts: CLIOptions,
  log: Logger
): Promise<ToolOutput[]> {
  const args = [
    "--query", query,
    "--top", String(opts.topN),
    "--json",
  ];

  if (opts.profile) {
    args.push("--profile", opts.profile);
  }

  if (!opts.headless) {
    args.push("--no-headless");
  }

  const stdout = await runTool("search-clip", args, log, true);
  const result = JSON.parse(stdout);

  // Convert search results to ToolOutput format
  const outputs: ToolOutput[] = (result.results || []).map((r: any) => ({
    success: r.success,
    url: r.url,
    title: r.title,
    markdown: r.markdown,
    content: r.content,
    tags: r.tags || opts.tags,
    error: r.error,
    data: r.data,
  }));

  return outputs;
}

async function runClipUrl(
  url: string,
  opts: CLIOptions,
  log: Logger
): Promise<ToolOutput> {
  const args = ["--json", url];

  if (opts.profile) {
    args.push("--profile", opts.profile);
  }

  if (!opts.headless) {
    args.push("--no-headless");
  }

  args.push("--wait", "5000");

  const stdout = await runTool("clip-url", args, log, true);
  return JSON.parse(stdout);
}

async function runBatchClip(
  urls: string[],
  opts: CLIOptions,
  log: Logger
): Promise<ToolOutput[]> {
  const args = [
    "--json",
    "--parallel", String(opts.concurrency),
    ...urls,
  ];

  if (opts.profile) {
    args.push("--profile", opts.profile);
  }

  if (!opts.headless) {
    args.push("--no-headless");
  }

  if (opts.continueOnError) {
    args.push("--continue-on-error");
  }

  const stdout = await runTool("batch-clip", args, log, true);
  const result = JSON.parse(stdout);

  return (result.results || []).map((r: any) => ({
    success: r.success,
    url: r.url,
    title: r.title,
    markdown: r.markdown,
    content: r.content,
    tags: r.tags || opts.tags,
    error: r.error,
    data: r.data,
  }));
}

async function runYouTubeClip(
  url: string,
  opts: CLIOptions,
  log: Logger
): Promise<ToolOutput> {
  const args = ["--json", url];

  if (opts.profile) {
    args.push("--profile", opts.profile);
  }

  if (!opts.headless) {
    args.push("--no-headless");
  }

  const stdout = await runTool("youtube-transcript", args, log, true);
  return JSON.parse(stdout);
}

async function saveToObsidian(
  results: ToolOutput[],
  opts: CLIOptions,
  log: Logger
): Promise<number> {
  let saved = 0;

  for (const result of results) {
    if (!result.success || !result.markdown) continue;

    const title = sanitizeFilename(result.title || "Untitled");
    const filePath = opts.folder ? `${opts.folder}/${title}` : title;

    const args = [
      "--cli",
      "--cli-path", opts.cliPath,
      "--vault", opts.vault,
      "--folder", opts.folder,
      "--stdout",
    ];

    try {
      // Use clip-stdin to save
      const stdinContent = result.markdown;
      const clipStdinPath = resolve(import.meta.dir, "clip-stdin.ts");

      const proc = spawn("bun", ["run", clipStdinPath, ...args], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      proc.stdin.write(stdinContent);
      proc.stdin.end();

      await new Promise<void>((resolve, reject) => {
        proc.on("close", (code) => {
          if (code === 0) {
            saved++;
            log(`  📎 Saved: ${title}`);
            resolve();
          } else {
            reject(new Error(`clip-stdin exited with code ${code}`));
          }
        });
        proc.on("error", reject);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`  ✗ Failed to save ${title}: ${message}`);
    }
  }

  return saved;
}

// ─── Pipeline Execution ───────────────────────────────────────────────────────

async function executePipeline(
  steps: PipelineStep[],
  opts: CLIOptions,
  log: Logger
): Promise<PipelineResult> {
  const result: PipelineResult = {
    success: true,
    name: "Pipeline",
    totalSteps: steps.length,
    completedSteps: 0,
    results: [],
    errors: [],
  };

  let state: IntermediateResult = {
    urls: [],
    results: [],
  };

  for (const step of steps) {
    log(`\n▶ Step: ${step.type}${step.params.query ? ` "${step.params.query}"` : ""}`);

    try {
      switch (step.type) {
        case "search": {
          const query = step.params.query as string;
          const outputs = await runSearchClip(query, opts, log);

          // Collect URLs for next step
          state.urls = outputs
            .filter((o) => o.success)
            .map((o) => o.url);

          state.results = outputs;
          log(`  ✓ Search found ${outputs.length} results`);
          break;
        }

        case "clip": {
          const urls = step.params.urls as string[] | undefined;
          const top = step.params.top as number | undefined;

          if (urls && urls.length > 0) {
            // Explicit URLs
            state.results = await runBatchClip(urls, opts, log);
            log(`  ✓ Clipped ${state.results.filter((r) => r.success).length}/${urls.length} URLs`);
          } else if (state.urls && state.urls.length > 0) {
            // Clip from previous step
            const toClip = top ? state.urls.slice(0, top) : state.urls;
            state.results = await runBatchClip(toClip, opts, log);
            log(`  ✓ Clipped ${state.results.filter((r) => r.success).length}/${toClip.length} URLs`);
          } else {
            log.error("  ✗ No URLs to clip");
          }
          break;
        }

        case "youtube": {
          const url = step.params.url as string;
          const output = await runYouTubeClip(url, opts, log);
          state.results = [output];
          state.urls = [url];
          log(`  ✓ YouTube: ${output.title}`);
          break;
        }

        case "save": {
          const target = step.params.target as string;
          if (target === "obsidian") {
            const saved = await saveToObsidian(state.results, opts, log);
            log(`  ✓ Saved ${saved} notes to Obsidian`);
          } else {
            log.error(`  ✗ Unknown save target: ${target}`);
          }
          break;
        }

        case "filter": {
          const field = step.params.field as string;
          const value = step.params.value as string;

          state.results = state.results.filter((r) => {
            const fieldValue = (r as any)[field] || (r.data as any)?.[field];
            return fieldValue === value;
          });

          log(`  ✓ Filtered to ${state.results.length} results`);
          break;
        }

        case "tags": {
          const tags = step.params.tags as string[];
          state.results = state.results.map((r) => ({
            ...r,
            tags: [...(r.tags || []), ...tags],
          }));
          log(`  ✓ Added tags: ${tags.join(", ")}`);
          break;
        }

        case "output": {
          const target = step.params.target as string;
          if (target === "stdout") {
            for (const r of state.results) {
              if (r.markdown) {
                console.log(r.markdown);
                console.log("\n---\n");
              }
            }
            log(`  ✓ Output ${state.results.length} results to stdout`);
          }
          break;
        }

        default:
          log.error(`  ✗ Unknown step type: ${(step as any).type}`);
      }

      result.completedSteps++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Step ${step.type}: ${message}`);
      log.error(`  ✗ Step failed: ${message}`);

      if (!opts.continueOnError) {
        result.success = false;
        break;
      }
    }
  }

  // Collect all results
  result.results = state.results;

  return result;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const log = createLogger();
  const cliOpts = parseArgs(process.argv.slice(2), log);

  // Quiet mode for JSON/stdout
  if (cliOpts.json || cliOpts.stdout) {
    log.setQuiet(true);
  }

  // Load pipeline config
  let pipelineConfig: PipelineConfig;

  if (cliOpts.configFile) {
    const config = await loadPipelineConfig(cliOpts.configFile, log);
    if (!config) {
      process.exit(1);
    }
    pipelineConfig = config;

    // Merge CLI options with config
    if (config.obsidian) {
      cliOpts.cli = config.obsidian.cli ?? cliOpts.cli;
      cliOpts.cliPath = config.obsidian.cliPath ?? cliOpts.cliPath;
      cliOpts.vault = config.obsidian.vault ?? cliOpts.vault;
      cliOpts.folder = config.obsidian.folder ?? cliOpts.folder;
    }
    if (config.tags) {
      cliOpts.tags = config.tags;
    }
    if (config.continueOnError !== undefined) {
      cliOpts.continueOnError = config.continueOnError;
    }
    if (config.concurrency !== undefined) {
      cliOpts.concurrency = config.concurrency;
    }
  } else if (cliOpts.steps) {
    // Parse DSL
    const steps = parseDSL(cliOpts.steps, log);
    if (steps.length === 0) {
      log.error("No valid pipeline steps provided");
      printHelp();
      process.exit(1);
    }
    pipelineConfig = { steps };
  } else {
    log.error("No pipeline provided. Use --steps or --config");
    printHelp();
    process.exit(1);
  }

  log(`\n⚙️  Pipeline Tool`);
  log(`   Steps: ${pipelineConfig.steps.length}`);
  log(`   Vault: ${cliOpts.vault}`);
  log(`   Folder: ${cliOpts.folder}`);
  log(`   Continue on error: ${cliOpts.continueOnError}\n`);

  // Execute pipeline
  const result = await executePipeline(pipelineConfig.steps, cliOpts, log);

  // Output results
  if (cliOpts.json) {
    console.log(JSON.stringify(result, null, 2));
  }

  // Summary
  if (!cliOpts.json && !cliOpts.stdout) {
    log(`\n────────────────────────────────────`);
    if (result.success) {
      log(`✅ Pipeline complete: ${result.completedSteps}/${result.totalSteps} steps`);
      log(`   Results: ${result.results.filter((r) => r.success).length}/${result.results.length} successful`);
    } else {
      log(`❌ Pipeline failed after ${result.completedSteps} steps`);
      for (const error of result.errors) {
        log(`   Error: ${error}`);
      }
    }
    log();
  }

  // Exit code
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
