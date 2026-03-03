import { afterEach, describe, expect, test } from "bun:test";
import { access } from "node:fs/promises";
import {
  createDeterministicHarnessControls,
  createTestVaultSandbox,
  type TestVaultSandbox,
} from "./support/test-vault-sandbox";

const sandboxes: TestVaultSandbox[] = [];

afterEach(async () => {
  while (sandboxes.length > 0) {
    const sandbox = sandboxes.pop();
    if (sandbox) {
      await sandbox.cleanup();
    }
  }
});

describe("test-vault sandbox helper", () => {
  test("creates isolated temp root + vault directories", async () => {
    const sandbox = await createTestVaultSandbox({
      timestampIso: "2026-02-27T19:30:00.000Z",
      titlePrefix: "harness",
    });
    sandboxes.push(sandbox);

    await expect(access(sandbox.tempRoot)).resolves.toBeNull();
    await expect(access(sandbox.vaultRoot)).resolves.toBeNull();
    await expect(access(sandbox.clipsRoot)).resolves.toBeNull();

    const nestedFolder = await sandbox.ensureVaultFolder("Inbox", "Captured");
    await expect(access(nestedFolder)).resolves.toBeNull();
    expect(nestedFolder).toContain("Inbox/Captured");
  });

  test("provides deterministic timestamp controls", () => {
    const controls = createDeterministicHarnessControls({
      timestampIso: "2026-02-27T12:34:56.789Z",
    });

    expect(controls.timestampMs).toBe(Date.parse("2026-02-27T12:34:56.789Z"));
    expect(controls.nowIso()).toBe("2026-02-27T12:34:56.789Z");
    expect(controls.nowDate().toISOString()).toBe("2026-02-27T12:34:56.789Z");
  });

  test("generates deterministic incrementing titles", () => {
    const controls = createDeterministicHarnessControls({
      timestampIso: "2026-02-27T10:00:00.000Z",
      titlePrefix: "headless",
    });

    const first = controls.nextTitle("SeedFinder Clip");
    const second = controls.nextTitle("SeedFinder Clip");

    expect(first).toBe("headless-SeedFinder-Clip-2026-02-27T10-00-00-000Z-01");
    expect(second).toBe("headless-SeedFinder-Clip-2026-02-27T10-00-00-000Z-02");
  });

  test("cleanup removes the sandbox temp root", async () => {
    const sandbox = await createTestVaultSandbox();

    await expect(access(sandbox.tempRoot)).resolves.toBeNull();
    await sandbox.cleanup();
    await expect(access(sandbox.tempRoot)).rejects.toThrow();
  });
});
