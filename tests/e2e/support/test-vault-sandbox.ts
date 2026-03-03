import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface DeterministicHarnessControls {
  /** Stable timestamp in ISO format used by the harness. */
  readonly timestampIso: string;
  /** Stable timestamp in epoch milliseconds. */
  readonly timestampMs: number;
  /** Returns a Date object for the deterministic timestamp. */
  nowDate(): Date;
  /** Returns the deterministic ISO timestamp. */
  nowIso(): string;
  /** Returns an incrementing deterministic title. */
  nextTitle(base?: string): string;
}

export interface TestVaultSandbox {
  /** Temp root for this test harness sandbox. */
  readonly tempRoot: string;
  /** Root folder that represents the test vault. */
  readonly vaultRoot: string;
  /** Default notes output folder inside the vault. */
  readonly clipsRoot: string;
  /** Deterministic timestamp/title controls for assertions. */
  readonly deterministic: DeterministicHarnessControls;
  /** Resolve an absolute path inside the vault root. */
  resolveInVault(...parts: string[]): string;
  /** Creates (if needed) and returns a folder path in the vault. */
  ensureVaultFolder(...parts: string[]): Promise<string>;
  /** Deletes the whole temp sandbox recursively. */
  cleanup(): Promise<void>;
}

export interface CreateTestVaultSandboxOptions {
  /** Prefix passed to mkdtemp. */
  prefix?: string;
  /** Name of the vault directory inside temp root. */
  vaultName?: string;
  /** Initial clip output folder inside the vault. */
  clipsFolder?: string;
  /** Deterministic ISO timestamp for harness assertions. */
  timestampIso?: string;
  /** Deterministic title prefix for generated note titles. */
  titlePrefix?: string;
}

function sanitizeTitlePart(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]/g, "")
    .replace(/\-+/g, "-")
    .replace(/^\-|\-$/g, "");
}

export function createDeterministicHarnessControls(options: {
  timestampIso?: string;
  titlePrefix?: string;
} = {}): DeterministicHarnessControls {
  const timestampIso = options.timestampIso ?? "2026-02-27T12:00:00.000Z";
  const timestampMs = Date.parse(timestampIso);

  if (Number.isNaN(timestampMs)) {
    throw new Error(`Invalid deterministic timestampIso: ${timestampIso}`);
  }

  const prefix = sanitizeTitlePart(options.titlePrefix ?? "headless-clip");
  let counter = 0;

  return {
    timestampIso,
    timestampMs,
    nowDate: () => new Date(timestampMs),
    nowIso: () => new Date(timestampMs).toISOString(),
    nextTitle(base = "clip") {
      counter += 1;
      const basePart = sanitizeTitlePart(base) || "clip";
      const stamp = timestampIso.replace(/[:.]/g, "-");
      return `${prefix}-${basePart}-${stamp}-${String(counter).padStart(2, "0")}`;
    },
  };
}

export async function createTestVaultSandbox(
  options: CreateTestVaultSandboxOptions = {}
): Promise<TestVaultSandbox> {
  const prefix = options.prefix ?? "owc-headless-harness-";
  const vaultName = options.vaultName ?? "TestVault";
  const clipsFolder = options.clipsFolder ?? "Clips";

  const tempRoot = await mkdtemp(join(tmpdir(), prefix));
  const vaultRoot = join(tempRoot, vaultName);
  const clipsRoot = join(vaultRoot, clipsFolder);

  await mkdir(clipsRoot, { recursive: true });

  const deterministic = createDeterministicHarnessControls({
    timestampIso: options.timestampIso,
    titlePrefix: options.titlePrefix,
  });

  const resolveInVault = (...parts: string[]): string => join(vaultRoot, ...parts);

  const ensureVaultFolder = async (...parts: string[]): Promise<string> => {
    const folderPath = resolveInVault(...parts);
    await mkdir(folderPath, { recursive: true });
    return folderPath;
  };

  const cleanup = async (): Promise<void> => {
    await rm(tempRoot, { recursive: true, force: true });
  };

  return {
    tempRoot,
    vaultRoot,
    clipsRoot,
    deterministic,
    resolveInVault,
    ensureVaultFolder,
    cleanup,
  };
}
