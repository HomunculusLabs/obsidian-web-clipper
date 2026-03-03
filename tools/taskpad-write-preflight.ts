import { closeSync, existsSync, openSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const PERMISSION_ERROR_CODES = new Set(["EPERM", "EACCES", "EROFS"]);

// CLI Output types
interface TaskpadWritePreflightCliOutput {
  taskpadPath: string;
  taskpadExists: boolean;
  parentDirPath: string;
  writable: boolean;
  reasonCode: TaskpadWritePreflightReasonCode;
  mode: "direct-write" | "fallback-artifact" | "error";
  permissionClass: "none" | "permission-denied" | "non-permission";
  detail: string;
}

function getPermissionClass(reasonCode: TaskpadWritePreflightReasonCode): "none" | "permission-denied" | "non-permission" {
  if (reasonCode === "PRECHECK_OK") {
    return "none";
  }
  if (
    reasonCode === "PRECHECK_PERMISSION_EPERM" ||
    reasonCode === "PRECHECK_PERMISSION_EACCES" ||
    reasonCode === "PRECHECK_PERMISSION_EROFS" ||
    reasonCode === "PRECHECK_PERMISSION_DENIED_GENERIC"
  ) {
    return "permission-denied";
  }
  return "non-permission";
}

function getModeFromReasonCode(reasonCode: TaskpadWritePreflightReasonCode): "direct-write" | "fallback-artifact" | "error" {
  switch (reasonCode) {
    case "PRECHECK_OK":
      return "direct-write";
    case "PRECHECK_PERMISSION_EPERM":
    case "PRECHECK_PERMISSION_EACCES":
    case "PRECHECK_PERMISSION_EROFS":
    case "PRECHECK_PERMISSION_DENIED_GENERIC":
      return "fallback-artifact";
    default:
      return "error";
  }
}

function getDetailFromReasonCode(reasonCode: TaskpadWritePreflightReasonCode): string {
  switch (reasonCode) {
    case "PRECHECK_OK":
      return "Probe file created and removed successfully; TASKPAD is writable.";
    case "PRECHECK_PERMISSION_EPERM":
      return "Operation not permitted (EPERM) when attempting to write probe file.";
    case "PRECHECK_PERMISSION_EACCES":
      return "Permission denied (EACCES) when attempting to write probe file.";
    case "PRECHECK_PERMISSION_EROFS":
      return "Read-only file system (EROFS) when attempting to write probe file.";
    case "PRECHECK_PERMISSION_DENIED_GENERIC":
      return "Generic permission denied error when attempting to write probe file.";
    case "PRECHECK_TASKPAD_NOT_FOUND":
      return "TASKPAD file does not exist.";
    case "PRECHECK_TASKPAD_PATH_INVALID":
      return "TASKPAD path is invalid or not a file.";
    case "PRECHECK_PARENT_DIR_NOT_FOUND":
      return "Parent directory does not exist or is not a directory.";
    case "PRECHECK_IO_UNEXPECTED":
      return "Unexpected I/O error during writeability probe.";
    default:
      return "Unknown reason code.";
  }
}

function printUsage(): void {
  console.log("Usage: bun run tools/taskpad-write-preflight.ts -- --taskpad <path>");
  console.log("");
  console.log("Options:");
  console.log("  --taskpad <path>  Target TASKPAD markdown path (required)");
  console.log("  --help, -h        Print this help message");
  console.log("");
  console.log("Exit codes:");
  console.log("  0  Success (mode=direct-write or mode=fallback-artifact)");
  console.log("  1  Error (mode=error)");
}

function parseArgs(args: string[]): { taskpadPath: string | null; help: boolean } {
  let taskpadPath: string | null = null;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--taskpad") {
      if (i + 1 < args.length) {
        taskpadPath = args[i + 1];
        i++;
      }
    }
  }

  return { taskpadPath, help };
}

function runCli(): void {
  const args = process.argv.slice(2);
  const { taskpadPath, help } = parseArgs(args);

  if (help) {
    printUsage();
    process.exit(0);
  }

  if (!taskpadPath) {
    console.error("Error: --taskpad <path> is required");
    printUsage();
    process.exit(1);
  }

  const resolvedPath = resolve(taskpadPath);
  const parentDir = dirname(resolvedPath);
  const taskpadExists = existsSync(resolvedPath) && statSync(resolvedPath).isFile();

  let result: TaskpadWritePreflightResult;
  let runtimeError: unknown = null;

  try {
    result = probeTaskpadWriteability(taskpadPath);
  } catch (error) {
    runtimeError = error;
    result = {
      writable: false,
      reasonCode: "PRECHECK_IO_UNEXPECTED",
    };
  }

  const mode = getModeFromReasonCode(result.reasonCode);
  const permissionClass = getPermissionClass(result.reasonCode);
  const detail = runtimeError
    ? `Runtime error: ${runtimeError instanceof Error ? runtimeError.message : String(runtimeError)}`
    : getDetailFromReasonCode(result.reasonCode);

  const output: TaskpadWritePreflightCliOutput = {
    taskpadPath: resolvedPath,
    taskpadExists,
    parentDirPath: parentDir,
    writable: result.writable,
    reasonCode: result.reasonCode,
    mode,
    permissionClass,
    detail,
  };

  // Machine-readable JSON between markers
  console.log("TASKPAD_WRITE_PRECHECK_JSON_START");
  console.log(JSON.stringify(output, null, 2));
  console.log("TASKPAD_WRITE_PRECHECK_JSON_END");

  // Human-readable summary
  console.log("");
  console.log("=== TASKPAD Write Preflight Summary ===");
  console.log(`Taskpad Path:    ${output.taskpadPath}`);
  console.log(`Taskpad Exists:  ${output.taskpadExists}`);
  console.log(`Parent Dir:      ${output.parentDirPath}`);
  console.log(`Writable:        ${output.writable}`);
  console.log(`Reason Code:     ${output.reasonCode}`);
  console.log(`Mode:            ${output.mode}`);
  console.log(`Permission Class: ${output.permissionClass}`);
  console.log(`Detail:          ${output.detail}`);
  console.log("========================================");

  // Exit with appropriate code
  if (mode === "error") {
    process.exit(1);
  }
  process.exit(0);
}

// Run CLI if this file is executed directly
if (import.meta.main) {
  runCli();
}

export type TaskpadWritePreflightReasonCode =
  | "PRECHECK_OK"
  | "PRECHECK_PERMISSION_EPERM"
  | "PRECHECK_PERMISSION_EACCES"
  | "PRECHECK_PERMISSION_EROFS"
  | "PRECHECK_PERMISSION_DENIED_GENERIC"
  | "PRECHECK_TASKPAD_NOT_FOUND"
  | "PRECHECK_TASKPAD_PATH_INVALID"
  | "PRECHECK_PARENT_DIR_NOT_FOUND"
  | "PRECHECK_IO_UNEXPECTED";

export interface TaskpadWritePreflightResult {
  writable: boolean;
  reasonCode: TaskpadWritePreflightReasonCode;
}

interface IOErrorLike {
  code?: string;
  message?: string;
}

export function classifyWritePreflightError(error: unknown): TaskpadWritePreflightReasonCode {
  const ioError = typeof error === "object" && error !== null ? (error as IOErrorLike) : null;
  const code = ioError?.code;

  if (code === "EPERM") {
    return "PRECHECK_PERMISSION_EPERM";
  }

  if (code === "EACCES") {
    return "PRECHECK_PERMISSION_EACCES";
  }

  if (code === "EROFS") {
    return "PRECHECK_PERMISSION_EROFS";
  }

  if (code === "ENOENT") {
    return "PRECHECK_PARENT_DIR_NOT_FOUND";
  }

  const message = ioError?.message ?? "";
  if (/(operation not permitted|permission denied|read-only file system|readonly file system)/i.test(message)) {
    return "PRECHECK_PERMISSION_DENIED_GENERIC";
  }

  return "PRECHECK_IO_UNEXPECTED";
}

function isPermissionDeniedReason(reasonCode: TaskpadWritePreflightReasonCode): boolean {
  return (
    reasonCode === "PRECHECK_PERMISSION_EPERM" ||
    reasonCode === "PRECHECK_PERMISSION_EACCES" ||
    reasonCode === "PRECHECK_PERMISSION_EROFS" ||
    reasonCode === "PRECHECK_PERMISSION_DENIED_GENERIC"
  );
}

function normalizeTargetPath(taskpadPath: string): string | null {
  if (typeof taskpadPath !== "string" || taskpadPath.trim().length === 0) {
    return null;
  }

  try {
    return resolve(taskpadPath);
  } catch {
    return null;
  }
}

export function probeTaskpadWriteability(taskpadPath: string): TaskpadWritePreflightResult {
  const resolvedTaskpadPath = normalizeTargetPath(taskpadPath);

  if (!resolvedTaskpadPath) {
    return {
      writable: false,
      reasonCode: "PRECHECK_TASKPAD_PATH_INVALID",
    };
  }

  const parentDirPath = dirname(resolvedTaskpadPath);

  let parentStats: ReturnType<typeof statSync>;
  try {
    parentStats = statSync(parentDirPath);
  } catch (error) {
    const reasonCode = classifyWritePreflightError(error);
    if (reasonCode === "PRECHECK_PARENT_DIR_NOT_FOUND") {
      return {
        writable: false,
        reasonCode,
      };
    }

    if (isPermissionDeniedReason(reasonCode)) {
      return {
        writable: false,
        reasonCode,
      };
    }

    return {
      writable: false,
      reasonCode: "PRECHECK_IO_UNEXPECTED",
    };
  }

  if (!parentStats.isDirectory()) {
    return {
      writable: false,
      reasonCode: "PRECHECK_PARENT_DIR_NOT_FOUND",
    };
  }

  try {
    const taskpadStats = statSync(resolvedTaskpadPath);
    if (!taskpadStats.isFile()) {
      return {
        writable: false,
        reasonCode: "PRECHECK_TASKPAD_PATH_INVALID",
      };
    }
  } catch (error) {
    const ioError = error as IOErrorLike;
    if (ioError?.code === "ENOENT") {
      return {
        writable: false,
        reasonCode: "PRECHECK_TASKPAD_NOT_FOUND",
      };
    }

    const reasonCode = classifyWritePreflightError(error);
    if (isPermissionDeniedReason(reasonCode)) {
      return {
        writable: false,
        reasonCode,
      };
    }

    return {
      writable: false,
      reasonCode: "PRECHECK_IO_UNEXPECTED",
    };
  }

  const probeFileName = `.${basename(resolvedTaskpadPath)}.write-preflight-probe-${process.pid}`;
  const probePath = resolve(parentDirPath, probeFileName);

  let fd: number | null = null;
  try {
    fd = openSync(probePath, "wx");
    closeSync(fd);
    fd = null;
    unlinkSync(probePath);

    return {
      writable: true,
      reasonCode: "PRECHECK_OK",
    };
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Best-effort cleanup for failed probe writes.
      }
    }

    try {
      unlinkSync(probePath);
    } catch {
      // Best-effort cleanup for failed probe writes.
    }

    const reasonCode = classifyWritePreflightError(error);

    if (reasonCode === "PRECHECK_PARENT_DIR_NOT_FOUND") {
      return {
        writable: false,
        reasonCode,
      };
    }

    if (isPermissionDeniedReason(reasonCode)) {
      return {
        writable: false,
        reasonCode,
      };
    }

    if (PERMISSION_ERROR_CODES.has((error as IOErrorLike)?.code ?? "")) {
      return {
        writable: false,
        reasonCode: "PRECHECK_PERMISSION_DENIED_GENERIC",
      };
    }

    return {
      writable: false,
      reasonCode: "PRECHECK_IO_UNEXPECTED",
    };
  }
}
