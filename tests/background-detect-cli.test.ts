import { describe, expect, test } from "bun:test";
import { detectVerifiedCli } from "../src/background/handlers/detectCli";
import { getCommonCliPaths } from "../src/shared/cliDetect";

describe("detectVerifiedCli", () => {
  test("returns the first path that verifies successfully", async () => {
    const firstCandidate = getCommonCliPaths()[0] ?? "obsidian-cli";
    const calls: string[] = [];
    const result = await detectVerifiedCli(async (cliPath) => {
      calls.push(cliPath);
      return cliPath === firstCandidate;
    });

    expect(result.cliPath).toBe(firstCandidate);
    expect(result.platform).toBeDefined();
    expect(result.attempted).toBe(true);
    expect(calls[0]).toBe(firstCandidate);
    expect(result.alternatives).not.toContain(firstCandidate);
  });

  test("returns an empty result when no candidate verifies", async () => {
    const result = await detectVerifiedCli(async () => false);

    expect(result.cliPath).toBe("");
    expect(result.attempted).toBe(true);
    expect(result.alternatives.length).toBeGreaterThan(0);
    expect(result.note).toContain("No working Obsidian CLI path could be verified");
  });
});
