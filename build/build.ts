import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync, watch as fsWatch } from "node:fs";
import { dirname, join } from "node:path";

const PROJECT_ROOT = process.cwd();
const DIST_DIR = join(PROJECT_ROOT, "dist");

function parseArgs(argv: string[]) {
  return {
    watch: argv.includes("--watch") || argv.includes("-w")
  };
}

function resolvePath(relativePath: string) {
  return join(PROJECT_ROOT, relativePath);
}

function pickFirstExisting(candidates: string[]) {
  for (const candidate of candidates) {
    const abs = resolvePath(candidate);
    if (existsSync(abs)) return abs;
  }
  return null;
}

async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

async function cleanDist() {
  await rm(DIST_DIR, { recursive: true, force: true });
}

function printBuildLogs(logs: any[]) {
  for (const log of logs) {
    if (!log) continue;
    const message = typeof log.message === "string" ? log.message : String(log);
    console.error(message);
  }
}

async function bundleEntrypoint(inputFile: string, outSubdir: string, watchMode: boolean, options?: {
  /** Use ESM format with code splitting for lazy loading */
  esm?: boolean;
}) {
  const outdir = join(DIST_DIR, outSubdir);
  await ensureDir(outdir);

  // ESM format enables code splitting for lazy-loaded modules
  const format = options?.esm ? "esm" : "iife";
  const splitting = options?.esm ? true : false;

  const result = await Bun.build({
    entrypoints: [inputFile],
    outdir,
    target: "browser",
    format,
    splitting,
    minify: !watchMode,
    sourcemap: watchMode ? "external" : "none",
    define: {
      // Polyfill import.meta.url for PDF.js (not needed since we use disableWorker)
      "import.meta.url": JSON.stringify("https://localhost/")
    }
  });

  if (!result.success) {
    printBuildLogs(result.logs || []);
    throw new Error("Build failed");
  }

  // Report chunk sizes for code-split builds
  if (splitting && result.outputs) {
    const chunks = result.outputs
      .filter(o => o.path.endsWith('.js'))
      .map(o => `${o.path.split('/').pop()}: ${(o.size / 1024).toFixed(1)}KB`)
      .join(', ');
    console.log(`  Chunks: ${chunks}`);
  }
}

async function copyFileIfExists(srcFile: string | null, destRelative: string) {
  if (!srcFile) return;
  const destFile = join(DIST_DIR, destRelative);
  await ensureDir(dirname(destFile));
  await cp(srcFile, destFile, { force: true });
}

async function copyDirIfExists(srcDir: string | null, destRelativeDir: string) {
  if (!srcDir) return;
  if (!existsSync(srcDir)) return;
  const destDir = join(DIST_DIR, destRelativeDir);
  await ensureDir(dirname(destDir));
  await cp(srcDir, destDir, { recursive: true, force: true });
}

async function manifestReferencesLib(manifestPath: string | null) {
  if (!manifestPath) return false;
  try {
    const text = await readFile(manifestPath, "utf8");
    return text.includes("lib/turndown.js") || text.includes("lib/readability.js") || text.includes("\"lib/") || text.includes("'lib/");
  } catch {
    return false;
  }
}

async function copyPdfWorker() {
  const workerSrc = resolvePath("node_modules/pdfjs-dist/build/pdf.worker.min.js");
  const workerDest = join(DIST_DIR, "pdfjs/pdf.worker.js");
  await ensureDir(dirname(workerDest));
  await cp(workerSrc, workerDest, { force: true });
}

async function copyStaticAssets() {
  const manifestPath = pickFirstExisting(["src/manifest.json", "manifest.json"]);
  await copyFileIfExists(manifestPath, "manifest.json");

  const popupHtml = pickFirstExisting(["src/popup/popup.html", "popup/popup.html"]);
  const popupCss = pickFirstExisting(["src/popup/popup.css", "popup/popup.css"]);
  await copyFileIfExists(popupHtml, "popup/popup.html");
  await copyFileIfExists(popupCss, "popup/popup.css");

  const optionsHtml = pickFirstExisting(["src/options/options.html", "options/options.html"]);
  const optionsCss = pickFirstExisting(["src/options/options.css", "options/options.css"]);
  await copyFileIfExists(optionsHtml, "options/options.html");
  await copyFileIfExists(optionsCss, "options/options.css");

  const offscreenHtml = pickFirstExisting(["src/offscreen/offscreen.html"]);
  await copyFileIfExists(offscreenHtml, "offscreen/offscreen.html");

  const iconsDir = pickFirstExisting(["src/icons", "icons"]);
  await copyDirIfExists(iconsDir, "icons");

  const shouldCopyLib = await manifestReferencesLib(manifestPath);
  if (shouldCopyLib) {
    const libDir = pickFirstExisting(["src/lib", "lib"]);
    await copyDirIfExists(libDir, "lib");
  }
}

async function buildAll(watchMode: boolean) {
  const backgroundEntrypoint = pickFirstExisting(["src/background/background.ts", "background.js"]);
  const contentEntrypoint = pickFirstExisting(["src/content/content.ts", "content.js"]);
  const popupEntrypoint = pickFirstExisting(["src/popup/popup.ts", "popup/popup.js"]);
  const optionsEntrypoint = pickFirstExisting(["src/options/options.ts", "options/options.js"]);
  const offscreenEntrypoint = pickFirstExisting(["src/offscreen/offscreen.ts"]);

  const missing: string[] = [];
  if (!backgroundEntrypoint) missing.push("src/background/background.ts (or background.js)");
  if (!contentEntrypoint) missing.push("src/content/content.ts (or content.js)");
  if (!popupEntrypoint) missing.push("src/popup/popup.ts (or popup/popup.js)");
  if (!optionsEntrypoint) missing.push("src/options/options.ts (or options/options.js)");

  if (missing.length !== 0) {
    throw new Error("Missing entrypoints:\n- " + missing.join("\n- "));
  }

  await ensureDir(DIST_DIR);

  await bundleEntrypoint(backgroundEntrypoint!, "background", watchMode);
  // Use ESM with code splitting for content script to enable lazy loading of extractors
  // This reduces initial bundle size by ~75KB (Twitter extractor alone is ~60KB)
  await bundleEntrypoint(contentEntrypoint!, "content", watchMode, { esm: true });
  await bundleEntrypoint(popupEntrypoint!, "popup", watchMode);
  await bundleEntrypoint(optionsEntrypoint!, "options", watchMode);
  if (offscreenEntrypoint) {
    await bundleEntrypoint(offscreenEntrypoint, "offscreen", watchMode);
  }

  await copyStaticAssets();
  await copyPdfWorker();
}

function startWatch(onChange: () => void) {
  const watchTargets: string[] = [];

  const maybeAdd = (relativePath: string) => {
    const abs = resolvePath(relativePath);
    if (existsSync(abs)) watchTargets.push(abs);
  };

  maybeAdd("src");
  maybeAdd("background.js");
  maybeAdd("content.js");
  maybeAdd("popup");
  maybeAdd("options");
  maybeAdd("icons");
  maybeAdd("lib");
  maybeAdd("manifest.json");

  const watchers: ReturnType<typeof fsWatch>[] = [];

  for (const target of watchTargets) {
    try {
      const watcher = fsWatch(target, { recursive: true }, () => onChange());
      watchers.push(watcher);
    } catch (err) {
      console.error("Failed to watch:", target, err);
    }
  }

  return () => {
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {}
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.watch) {
    await cleanDist();
  }

  let building = false;
  let pending = false;
  let debounceTimer: any = null;

  const runBuild = async () => {
    if (building) {
      pending = true;
      return;
    }

    building = true;
    try {
      await buildAll(args.watch);
      console.log("Build complete.");
    } catch (err: any) {
      console.error(err?.message || err);
    } finally {
      building = false;
      if (pending) {
        pending = false;
        await runBuild();
      }
    }
  };

  if (!args.watch) {
    await runBuild();
    return;
  }

  await runBuild();

  const schedule = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      runBuild();
    }, 150);
  };

  startWatch(schedule);
  console.log("Watching for changes...");
}

main();