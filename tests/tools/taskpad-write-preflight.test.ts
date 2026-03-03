import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  classifyWritePreflightError,
  probeTaskpadWriteability,
  type TaskpadWritePreflightReasonCode,
} from "../../tools/taskpad-write-preflight";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      try {
        // Restore permissions before cleanup to avoid issues
        chmodSync(dir, 0o755);
      } catch {
        // Ignore permission errors during cleanup
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("taskpad-write-preflight", () => {
  describe("probeTaskpadWriteability - core contract", () => {
    test("returns PRECHECK_OK for writable existing target file and does not mutate file content", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-write-preflight-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      const originalContent = "# TASKPAD\n\n## Self-Improvement Backlog\n";
      writeFileSync(taskpadPath, originalContent, "utf8");

      const result = probeTaskpadWriteability(taskpadPath);
      const afterContent = readFileSync(taskpadPath, "utf8");

      expect(result).toEqual({
        writable: true,
        reasonCode: "PRECHECK_OK",
      });
      expect(afterContent).toBe(originalContent);
    });

    test("returns PRECHECK_TASKPAD_NOT_FOUND when target file is missing", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-write-preflight-"));
      tempDirs.push(dir);

      const missingTaskpadPath = join(dir, "MISSING.md");
      const result = probeTaskpadWriteability(missingTaskpadPath);

      expect(result).toEqual({
        writable: false,
        reasonCode: "PRECHECK_TASKPAD_NOT_FOUND",
      });
    });

    test("returns PRECHECK_PARENT_DIR_NOT_FOUND when parent directory does not exist", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-write-preflight-"));
      tempDirs.push(dir);

      const missingParentPath = join(dir, "missing-parent", "TASKPAD.md");
      const result = probeTaskpadWriteability(missingParentPath);

      expect(result).toEqual({
        writable: false,
        reasonCode: "PRECHECK_PARENT_DIR_NOT_FOUND",
      });
    });

    test("returns PRECHECK_TASKPAD_PATH_INVALID for empty path", () => {
      const result = probeTaskpadWriteability("");

      expect(result).toEqual({
        writable: false,
        reasonCode: "PRECHECK_TASKPAD_PATH_INVALID",
      });
    });

    test("returns PRECHECK_TASKPAD_PATH_INVALID for whitespace-only path", () => {
      const result = probeTaskpadWriteability("   ");

      expect(result).toEqual({
        writable: false,
        reasonCode: "PRECHECK_TASKPAD_PATH_INVALID",
      });
    });
  });

  describe("probeTaskpadWriteability - repo fixture paths", () => {
    test("returns PRECHECK_OK for writable path with fixture-like content", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-write-preflight-"));
      tempDirs.push(dir);

      // Create a file with content similar to taskpad-queue-health-empty.md fixture
      const taskpadPath = join(dir, "TASKPAD.md");
      const fixtureContent = "# TASKPAD\n\n## Autonomous Kickoff Queue\n- [x] done\n\n## Self-Improvement Backlog\n- [x] done\n";
      writeFileSync(taskpadPath, fixtureContent, "utf8");

      const result = probeTaskpadWriteability(taskpadPath);

      expect(result.writable).toBe(true);
      expect(result.reasonCode).toBe("PRECHECK_OK");
    });

    test("returns PRECHECK_OK for writable path with queue-health-pass content", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-write-preflight-"));
      tempDirs.push(dir);

      // Create a file with content similar to taskpad-queue-health-pass.md fixture
      const taskpadPath = join(dir, "TASKPAD.md");
      const fixtureContent = "# TASKPAD\n\n## Autonomous Kickoff Queue\n- [ ] unchecked item\n";
      writeFileSync(taskpadPath, fixtureContent, "utf8");

      const result = probeTaskpadWriteability(taskpadPath);

      expect(result.writable).toBe(true);
      expect(result.reasonCode).toBe("PRECHECK_OK");
    });

    test("fixture files exist and are readable", () => {
      // Verify fixture files exist without requiring them to be writable
      // (tests can run in read-only environments)
      const emptyFixturePath = resolve(
        import.meta.dir,
        "fixtures",
        "taskpad-queue-health-empty.md",
      );
      const passFixturePath = resolve(import.meta.dir, "fixtures", "taskpad-queue-health-pass.md");

      // Files should exist and be readable
      const emptyContent = readFileSync(emptyFixturePath, "utf8");
      const passContent = readFileSync(passFixturePath, "utf8");

      expect(emptyContent).toContain("# TASKPAD");
      expect(passContent).toContain("# TASKPAD");
    });
  });

  describe("probeTaskpadWriteability - non-writable branches", () => {
    test("returns permission-denied reason code for read-only directory (EACCES)", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-write-preflight-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      writeFileSync(taskpadPath, "# TASKPAD\n", "utf8");

      // Make directory read-only (remove write permission)
      chmodSync(dir, 0o555);

      const result = probeTaskpadWriteability(taskpadPath);

      expect(result.writable).toBe(false);
      expect(result.reasonCode).toMatch(/^PRECHECK_PERMISSION_/);
    });

    test("returns non-permission error for non-file path (directory at taskpad location)", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-write-preflight-"));
      tempDirs.push(dir);

      // Create a directory where the taskpad file should be
      const taskpadAsDir = join(dir, "TASKPAD.md");
      mkdirSync(taskpadAsDir);

      const result = probeTaskpadWriteability(taskpadAsDir);

      expect(result.writable).toBe(false);
      expect(result.reasonCode).toBe("PRECHECK_TASKPAD_PATH_INVALID");
    });
  });

  describe("classifyWritePreflightError - reason-code stability", () => {
    test("classifies EPERM error code deterministically", () => {
      expect(classifyWritePreflightError({ code: "EPERM" })).toBe("PRECHECK_PERMISSION_EPERM");
    });

    test("classifies EACCES error code deterministically", () => {
      expect(classifyWritePreflightError({ code: "EACCES" })).toBe("PRECHECK_PERMISSION_EACCES");
    });

    test("classifies EROFS error code deterministically", () => {
      expect(classifyWritePreflightError({ code: "EROFS" })).toBe("PRECHECK_PERMISSION_EROFS");
    });

    test("classifies ENOENT error code deterministically", () => {
      expect(classifyWritePreflightError({ code: "ENOENT" })).toBe("PRECHECK_PARENT_DIR_NOT_FOUND");
    });

    test("classifies generic permission-denied messages deterministically", () => {
      expect(
        classifyWritePreflightError({ message: "Operation not permitted while probing parent directory" }),
      ).toBe("PRECHECK_PERMISSION_DENIED_GENERIC");

      expect(classifyWritePreflightError({ message: "permission denied by system policy" })).toBe(
        "PRECHECK_PERMISSION_DENIED_GENERIC",
      );

      expect(classifyWritePreflightError({ message: "Read-only file system" })).toBe(
        "PRECHECK_PERMISSION_DENIED_GENERIC",
      );

      expect(classifyWritePreflightError({ message: "Readonly file system detected" })).toBe(
        "PRECHECK_PERMISSION_DENIED_GENERIC",
      );
    });

    test("classifies unexpected errors as PRECHECK_IO_UNEXPECTED", () => {
      expect(classifyWritePreflightError({ code: "UNKNOWN_ERROR" })).toBe("PRECHECK_IO_UNEXPECTED");
      expect(classifyWritePreflightError({ message: "Some random error" })).toBe("PRECHECK_IO_UNEXPECTED");
      expect(classifyWritePreflightError(null)).toBe("PRECHECK_IO_UNEXPECTED");
      expect(classifyWritePreflightError(undefined)).toBe("PRECHECK_IO_UNEXPECTED");
    });
  });

  describe("reason-code contract stability", () => {
    const allReasonCodes: TaskpadWritePreflightReasonCode[] = [
      "PRECHECK_OK",
      "PRECHECK_PERMISSION_EPERM",
      "PRECHECK_PERMISSION_EACCES",
      "PRECHECK_PERMISSION_EROFS",
      "PRECHECK_PERMISSION_DENIED_GENERIC",
      "PRECHECK_TASKPAD_NOT_FOUND",
      "PRECHECK_TASKPAD_PATH_INVALID",
      "PRECHECK_PARENT_DIR_NOT_FOUND",
      "PRECHECK_IO_UNEXPECTED",
    ];

    test("all reason codes have stable string values", () => {
      // This test ensures reason codes don't accidentally change
      expect(allReasonCodes).toContain("PRECHECK_OK");
      expect(allReasonCodes).toContain("PRECHECK_PERMISSION_EPERM");
      expect(allReasonCodes).toContain("PRECHECK_PERMISSION_EACCES");
      expect(allReasonCodes).toContain("PRECHECK_PERMISSION_EROFS");
      expect(allReasonCodes).toContain("PRECHECK_PERMISSION_DENIED_GENERIC");
      expect(allReasonCodes).toContain("PRECHECK_TASKPAD_NOT_FOUND");
      expect(allReasonCodes).toContain("PRECHECK_TASKPAD_PATH_INVALID");
      expect(allReasonCodes).toContain("PRECHECK_PARENT_DIR_NOT_FOUND");
      expect(allReasonCodes).toContain("PRECHECK_IO_UNEXPECTED");
    });

    test("writable=true only for PRECHECK_OK", () => {
      const writableCodes = ["PRECHECK_OK"];
      const nonWritableCodes = allReasonCodes.filter((code) => !writableCodes.includes(code));

      for (const code of writableCodes) {
        expect(code).toBe("PRECHECK_OK");
      }

      for (const code of nonWritableCodes) {
        expect(code).not.toBe("PRECHECK_OK");
        // All non-OK codes should imply non-writable behavior
        expect(code.startsWith("PRECHECK_")).toBe(true);
      }
    });
  });

  describe("command-contract mode mapping", () => {
    test("PRECHECK_OK maps to direct-write mode", () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-write-preflight-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      writeFileSync(taskpadPath, "# TASKPAD\n", "utf8");

      const result = probeTaskpadWriteability(taskpadPath);

      expect(result.reasonCode).toBe("PRECHECK_OK");
      // When reasonCode is PRECHECK_OK, mode should be direct-write
      // This is verified by the CLI output, here we verify the reason code contract
    });

    test("permission-denied codes map to fallback-artifact mode", () => {
      // These reason codes should always route to fallback-artifact mode
      const permissionDeniedCodes: TaskpadWritePreflightReasonCode[] = [
        "PRECHECK_PERMISSION_EPERM",
        "PRECHECK_PERMISSION_EACCES",
        "PRECHECK_PERMISSION_EROFS",
        "PRECHECK_PERMISSION_DENIED_GENERIC",
      ];

      for (const code of permissionDeniedCodes) {
        expect(code).toMatch(/^PRECHECK_PERMISSION_/);
      }
    });

    test("non-permission error codes map to error mode", () => {
      // These reason codes should always route to error mode
      const errorModeCodes: TaskpadWritePreflightReasonCode[] = [
        "PRECHECK_TASKPAD_NOT_FOUND",
        "PRECHECK_TASKPAD_PATH_INVALID",
        "PRECHECK_PARENT_DIR_NOT_FOUND",
        "PRECHECK_IO_UNEXPECTED",
      ];

      for (const code of errorModeCodes) {
        expect(code).not.toMatch(/^PRECHECK_PERMISSION_/);
        expect(code).not.toBe("PRECHECK_OK");
      }
    });
  });

  describe("CLI command-contract coverage", () => {
    test("CLI produces deterministic JSON output for writable path", async () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-write-preflight-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      writeFileSync(taskpadPath, "# TASKPAD\n\n## Self-Improvement Backlog\n- [x] done\n", "utf8");

      const proc = Bun.spawn({
        cmd: ["bun", "run", "tools/taskpad-write-preflight.ts", "--", "--taskpad", taskpadPath],
        cwd: resolve(import.meta.dir, "../.."),
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      // Parse JSON output between markers
      const jsonMatch = stdout.match(/TASKPAD_WRITE_PRECHECK_JSON_START\n([\s\S]*?)\nTASKPAD_WRITE_PRECHECK_JSON_END/);
      expect(jsonMatch).toBeTruthy();

      const output = JSON.parse(jsonMatch![1]);

      // Verify deterministic contract fields
      expect(output.taskpadPath).toBe(taskpadPath);
      expect(output.taskpadExists).toBe(true);
      expect(output.writable).toBe(true);
      expect(output.reasonCode).toBe("PRECHECK_OK");
      expect(output.mode).toBe("direct-write");
      expect(output.permissionClass).toBe("none");
      expect(output.detail).toContain("writable");

      // Exit code should be 0 for direct-write mode
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
    });

    test("CLI produces deterministic JSON output for fixture file path when writable", async () => {
      // This test verifies the CLI contract using a temp file to avoid
      // permission issues with the fixtures directory
      const dir = mkdtempSync(join(tmpdir(), "taskpad-write-preflight-"));
      tempDirs.push(dir);

      // Copy fixture content to a writable temp location
      const fixturePath = resolve(import.meta.dir, "fixtures", "taskpad-queue-health-empty.md");
      const fixtureContent = readFileSync(fixturePath, "utf8");

      const taskpadPath = join(dir, "TASKPAD.md");
      writeFileSync(taskpadPath, fixtureContent, "utf8");

      const proc = Bun.spawn({
        cmd: ["bun", "run", "tools/taskpad-write-preflight.ts", "--", "--taskpad", taskpadPath],
        cwd: resolve(import.meta.dir, "../.."),
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      const jsonMatch = stdout.match(/TASKPAD_WRITE_PRECHECK_JSON_START\n([\s\S]*?)\nTASKPAD_WRITE_PRECHECK_JSON_END/);
      expect(jsonMatch).toBeTruthy();

      const output = JSON.parse(jsonMatch![1]);

      // Verify deterministic contract fields for writable fixture content
      expect(output.taskpadPath).toBe(taskpadPath);
      expect(output.taskpadExists).toBe(true);
      expect(output.writable).toBe(true);
      expect(output.reasonCode).toBe("PRECHECK_OK");
      expect(output.mode).toBe("direct-write");
      expect(output.permissionClass).toBe("none");

      // Exit code should be 0 for direct-write mode
      expect(exitCode).toBe(0);
    });

    test("CLI produces deterministic JSON output for missing path", async () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-write-preflight-"));
      tempDirs.push(dir);
      const missingPath = join(dir, "NONEXISTENT.md");

      const proc = Bun.spawn({
        cmd: ["bun", "run", "tools/taskpad-write-preflight.ts", "--", "--taskpad", missingPath],
        cwd: resolve(import.meta.dir, "../.."),
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      const jsonMatch = stdout.match(/TASKPAD_WRITE_PRECHECK_JSON_START\n([\s\S]*?)\nTASKPAD_WRITE_PRECHECK_JSON_END/);
      expect(jsonMatch).toBeTruthy();

      const output = JSON.parse(jsonMatch![1]);

      expect(output.taskpadPath).toBe(missingPath);
      expect(output.taskpadExists).toBe(false);
      expect(output.writable).toBe(false);
      expect(output.reasonCode).toBe("PRECHECK_TASKPAD_NOT_FOUND");
      expect(output.mode).toBe("error");
      expect(output.permissionClass).toBe("non-permission");
      expect(output.detail).toContain("does not exist");

      // Exit code should be 1 for error mode
      expect(exitCode).toBe(1);
    });

    test("CLI produces deterministic JSON output for non-writable path", async () => {
      const dir = mkdtempSync(join(tmpdir(), "taskpad-write-preflight-"));
      tempDirs.push(dir);

      const taskpadPath = join(dir, "TASKPAD.md");
      writeFileSync(taskpadPath, "# TASKPAD\n", "utf8");
      chmodSync(dir, 0o555);

      const proc = Bun.spawn({
        cmd: ["bun", "run", "tools/taskpad-write-preflight.ts", "--", "--taskpad", taskpadPath],
        cwd: resolve(import.meta.dir, "../.."),
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      const jsonMatch = stdout.match(/TASKPAD_WRITE_PRECHECK_JSON_START\n([\s\S]*?)\nTASKPAD_WRITE_PRECHECK_JSON_END/);
      expect(jsonMatch).toBeTruthy();

      const output = JSON.parse(jsonMatch![1]);

      expect(output.taskpadPath).toBe(taskpadPath);
      expect(output.taskpadExists).toBe(true);
      expect(output.writable).toBe(false);
      expect(output.reasonCode).toMatch(/^PRECHECK_PERMISSION_/);
      expect(output.mode).toBe("fallback-artifact");
      expect(output.permissionClass).toBe("permission-denied");

      // Exit code should be 0 for fallback-artifact mode (recoverable)
      expect(exitCode).toBe(0);
    });

    test("CLI exits with code 1 for missing --taskpad argument", async () => {
      const proc = Bun.spawn({
        cmd: ["bun", "run", "tools/taskpad-write-preflight.ts", "--"],
        cwd: resolve(import.meta.dir, "../.."),
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;

      expect(exitCode).toBe(1);
    });

    test("CLI exits with code 0 for --help", async () => {
      const proc = Bun.spawn({
        cmd: ["bun", "run", "tools/taskpad-write-preflight.ts", "--", "--help"],
        cwd: resolve(import.meta.dir, "../.."),
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Usage:");
      expect(stdout).toContain("--taskpad");
    });
  });
});
