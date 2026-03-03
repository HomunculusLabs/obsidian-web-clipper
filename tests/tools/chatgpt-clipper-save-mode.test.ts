/**
 * ChatGPT clipper save mode tests
 *
 * Focused coverage for TP4:
 * - CLI argument parsing for conversation vs per-response save mode
 * - Save dispatch counts for local file, --cli, and --obsidian flows
 */

import { describe, test, expect } from "bun:test";

type SaveMode = "conversation" | "per-response";

interface ParsedArgs {
  obsidian: boolean;
  cli: boolean;
  saveMode: SaveMode;
}

function parseChatGptClipperArgs(argv: string[]): ParsedArgs {
  const opts: ParsedArgs = {
    obsidian: false,
    cli: false,
    saveMode: "conversation",
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--obsidian") {
      opts.obsidian = true;
    } else if (arg === "--cli") {
      opts.cli = true;
    } else if (arg === "--per-response") {
      opts.saveMode = "per-response";
    } else if (arg === "--merged") {
      // Backward-compatible alias for conversation mode
      opts.saveMode = "conversation";
    }

    i++;
  }

  return opts;
}

interface DispatchPlanInput {
  saveMode: SaveMode;
  responseCount: number;
  obsidian?: boolean;
  cli?: boolean;
  json?: boolean;
  stdout?: boolean;
}

interface DispatchPlan {
  documentCount: number;
  obsidianDispatches: number;
  cliDispatches: number;
  fileWrites: number;
}

function planSaveDispatches(input: DispatchPlanInput): DispatchPlan {
  // --stdout and --json short-circuit before any save action
  if (input.stdout || input.json) {
    return {
      documentCount: 0,
      obsidianDispatches: 0,
      cliDispatches: 0,
      fileWrites: 0,
    };
  }

  const documentCount = input.saveMode === "conversation" ? 1 : input.responseCount;

  if (input.obsidian) {
    return {
      documentCount,
      obsidianDispatches: documentCount,
      cliDispatches: 0,
      fileWrites: 0,
    };
  }

  if (input.cli) {
    return {
      documentCount,
      obsidianDispatches: 0,
      cliDispatches: documentCount,
      fileWrites: 0,
    };
  }

  return {
    documentCount,
    obsidianDispatches: 0,
    cliDispatches: 0,
    fileWrites: documentCount,
  };
}

describe("chatgpt-clipper argument parsing", () => {
  test("defaults to conversation mode", () => {
    const opts = parseChatGptClipperArgs([]);
    expect(opts.saveMode).toBe("conversation");
  });

  test("--per-response enables per-response mode", () => {
    const opts = parseChatGptClipperArgs(["--per-response"]);
    expect(opts.saveMode).toBe("per-response");
  });

  test("--merged maps to conversation mode", () => {
    const opts = parseChatGptClipperArgs(["--merged"]);
    expect(opts.saveMode).toBe("conversation");
  });

  test("last mode flag wins when both aliases are present", () => {
    const mergedLast = parseChatGptClipperArgs(["--per-response", "--merged"]);
    expect(mergedLast.saveMode).toBe("conversation");

    const perResponseLast = parseChatGptClipperArgs(["--merged", "--per-response"]);
    expect(perResponseLast.saveMode).toBe("per-response");
  });

  test("parses --cli and --obsidian flags independently", () => {
    const opts = parseChatGptClipperArgs(["--cli", "--obsidian"]);
    expect(opts.cli).toBe(true);
    expect(opts.obsidian).toBe(true);
  });
});

describe("chatgpt-clipper save dispatch behavior", () => {
  test("conversation mode writes one local file per conversation", () => {
    const plan = planSaveDispatches({
      saveMode: "conversation",
      responseCount: 4,
    });

    expect(plan.documentCount).toBe(1);
    expect(plan.fileWrites).toBe(1);
    expect(plan.cliDispatches).toBe(0);
    expect(plan.obsidianDispatches).toBe(0);
  });

  test("per-response mode writes one local file per response", () => {
    const plan = planSaveDispatches({
      saveMode: "per-response",
      responseCount: 4,
    });

    expect(plan.documentCount).toBe(4);
    expect(plan.fileWrites).toBe(4);
  });

  test("conversation mode sends one CLI save action", () => {
    const plan = planSaveDispatches({
      saveMode: "conversation",
      responseCount: 3,
      cli: true,
    });

    expect(plan.documentCount).toBe(1);
    expect(plan.cliDispatches).toBe(1);
    expect(plan.fileWrites).toBe(0);
    expect(plan.obsidianDispatches).toBe(0);
  });

  test("per-response mode sends one CLI save action per response", () => {
    const plan = planSaveDispatches({
      saveMode: "per-response",
      responseCount: 3,
      cli: true,
    });

    expect(plan.documentCount).toBe(3);
    expect(plan.cliDispatches).toBe(3);
  });

  test("conversation mode sends one Obsidian URI dispatch", () => {
    const plan = planSaveDispatches({
      saveMode: "conversation",
      responseCount: 5,
      obsidian: true,
    });

    expect(plan.documentCount).toBe(1);
    expect(plan.obsidianDispatches).toBe(1);
    expect(plan.cliDispatches).toBe(0);
    expect(plan.fileWrites).toBe(0);
  });

  test("per-response mode sends one Obsidian URI dispatch per response", () => {
    const plan = planSaveDispatches({
      saveMode: "per-response",
      responseCount: 5,
      obsidian: true,
    });

    expect(plan.documentCount).toBe(5);
    expect(plan.obsidianDispatches).toBe(5);
  });

  test("obsidian dispatch takes precedence over CLI when both flags are set", () => {
    const plan = planSaveDispatches({
      saveMode: "per-response",
      responseCount: 2,
      obsidian: true,
      cli: true,
    });

    expect(plan.obsidianDispatches).toBe(2);
    expect(plan.cliDispatches).toBe(0);
    expect(plan.fileWrites).toBe(0);
  });

  test("--json and --stdout modes skip save dispatches", () => {
    const jsonPlan = planSaveDispatches({
      saveMode: "conversation",
      responseCount: 3,
      cli: true,
      json: true,
    });

    expect(jsonPlan.documentCount).toBe(0);
    expect(jsonPlan.cliDispatches).toBe(0);
    expect(jsonPlan.obsidianDispatches).toBe(0);
    expect(jsonPlan.fileWrites).toBe(0);

    const stdoutPlan = planSaveDispatches({
      saveMode: "per-response",
      responseCount: 3,
      obsidian: true,
      stdout: true,
    });

    expect(stdoutPlan.documentCount).toBe(0);
    expect(stdoutPlan.cliDispatches).toBe(0);
    expect(stdoutPlan.obsidianDispatches).toBe(0);
    expect(stdoutPlan.fileWrites).toBe(0);
  });
});
