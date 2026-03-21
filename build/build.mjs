import { build } from "esbuild";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync, watch as fsWatch } from "node:fs";
import { dirname, join } from "node:path";

const PROJECT_ROOT = process.cwd();
const DIST_DIR = join(PROJECT_ROOT, "dist");

function parseArgs(argv) {
  return {
    watch: argv.includes("--watch") || argv.includes("-w")
  };
}

function resolvePath(relativePath) {
  return join(PROJECT_ROOT, relativePath);
}

function pickFirstExisting(candidates) {
  for (const candidate of candidates) {
    const abs = resolvePath(candidate);
    if (existsSync(abs)) return abs;
  }
  return null;
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function cleanDist() {
  await rm(DIST_DIR, { recursive: true, force: true });
}

function printBuildLogs(logs) {
  for (const log of logs) {
    if (!log) continue;
    const text = typeof log.text === "string" ? log.text : typeof log.message === "string" ? log.message : String(log);
    console.error(text);
  }
}

async function bundleEntrypoint(inputFile, outFile, watchMode) {
  await ensureDir(dirname(outFile));

  const result = await build({
    entryPoints: [inputFile],
    outfile: outFile,
    bundle: true,
    platform: "browser",
    target: ["chrome114"],
    format: "iife",
    minify: !watchMode,
    sourcemap: watchMode ? "external" : false,
    define: {
      "import.meta.url": JSON.stringify("https://localhost/")
    },
    logLevel: "silent"
  });

  if (result.errors.length > 0) {
    printBuildLogs(result.errors);
    throw new Error("Build failed");
  }

  if (watchMode && result.warnings.length > 0) {
    printBuildLogs(result.warnings);
  }
}

async function copyFileIfExists(srcFile, destRelative) {
  if (!srcFile) return;
  const destFile = join(DIST_DIR, destRelative);
  await ensureDir(dirname(destFile));
  await cp(srcFile, destFile, { force: true });
}

async function copyDirIfExists(srcDir, destRelativeDir) {
  if (!srcDir) return;
  if (!existsSync(srcDir)) return;
  const destDir = join(DIST_DIR, destRelativeDir);
  await ensureDir(dirname(destDir));
  await cp(srcDir, destDir, { recursive: true, force: true });
}

async function copyPdfWorker() {
  const workerSrc = resolvePath("node_modules/pdfjs-dist/build/pdf.worker.min.js");
  const workerDest = join(DIST_DIR, "pdfjs/pdf.worker.js");
  await ensureDir(dirname(workerDest));
  await cp(workerSrc, workerDest, { force: true });
}

async function manifestReferencesLib(manifestPath) {
  if (!manifestPath) return false;
  try {
    const text = await readFile(manifestPath, "utf8");
    return text.includes("lib/turndown.js") || text.includes("lib/readability.js") || text.includes('"lib/') || text.includes("'lib/");
  } catch {
    return false;
  }
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

async function buildAll(watchMode) {
  const backgroundEntrypoint = pickFirstExisting(["src/background/background.ts", "background.js"]);
  const contentEntrypoint = pickFirstExisting(["src/content/content.ts", "content.js"]);
  const popupEntrypoint = pickFirstExisting(["src/popup/popup.ts", "popup/popup.js"]);
  const optionsEntrypoint = pickFirstExisting(["src/options/options.ts", "options/options.js"]);
  const offscreenEntrypoint = pickFirstExisting(["src/offscreen/offscreen.ts"]);

  const missing = [];
  if (!backgroundEntrypoint) missing.push("src/background/background.ts (or background.js)");
  if (!contentEntrypoint) missing.push("src/content/content.ts (or content.js)");
  if (!popupEntrypoint) missing.push("src/popup/popup.ts (or popup/popup.js)");
  if (!optionsEntrypoint) missing.push("src/options/options.ts (or options/options.js)");

  if (missing.length !== 0) {
    throw new Error("Missing entrypoints:\n- " + missing.join("\n- "));
  }

  await ensureDir(DIST_DIR);

  await bundleEntrypoint(backgroundEntrypoint, join(DIST_DIR, "background/background.js"), watchMode);
  await bundleEntrypoint(contentEntrypoint, join(DIST_DIR, "content/content.js"), watchMode);
  await bundleEntrypoint(popupEntrypoint, join(DIST_DIR, "popup/popup.js"), watchMode);
  await bundleEntrypoint(optionsEntrypoint, join(DIST_DIR, "options/options.js"), watchMode);

  if (offscreenEntrypoint) {
    await bundleEntrypoint(offscreenEntrypoint, join(DIST_DIR, "offscreen/offscreen.js"), watchMode);
  }

  await copyStaticAssets();
  await copyPdfWorker();
}

function startWatch(onChange) {
  const watchTargets = [];

  const maybeAdd = (relativePath) => {
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

  const watchers = [];

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
  let debounceTimer = null;

  const runBuild = async () => {
    if (building) {
      pending = true;
      return;
    }

    building = true;
    try {
      await buildAll(args.watch);
      console.log("Build complete.");
    } catch (err) {
      console.error(err?.message || err);
      process.exitCode = 1;
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
